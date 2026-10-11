import "server-only";
import { createClient } from "@supabase/supabase-js";

// Request-local only: no data or permissions are retained between exports.
// Every collection read has an exact count and paginated reads a stable order, so the API's
// default row limit cannot silently truncate a financial report.
export function createEodReadFetch(network: typeof fetch = fetch): typeof fetch {
  const pending = new Map<string, Promise<Response>>();
  const read: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    if ((init?.method || "GET") !== "GET" || !url.pathname.startsWith("/rest/v1/")) {
      throw new Error("EOD supports database reads only.");
    }
    if (headers.get("accept")?.includes("object")) return network(input, { ...init, cache: "no-store" });
    // These older tables inherit clinic membership from their parent records;
    // they do not have their own clinic_id column.
    const parents: Record<string, string> = {
      refunds: "receipts!inner(clinic_id)",
      balance_payments: "outstanding_balances!inner(clinic_id)",
    };
    const table = url.pathname.split("/").pop()!;
    if (parents[table] && url.searchParams.has("clinic_id")) {
      url.searchParams.set("select", `${url.searchParams.get("select") || "*"},__scope:${parents[table]}`);
      url.searchParams.set("__scope.clinic_id", url.searchParams.get("clinic_id")!);
      url.searchParams.delete("clinic_id");
    }
    const key = url.href;
    let work = pending.get(key);
    if (!work) {
      work = (async () => {
        // Large linked-ID lists are split into disjoint batches, preventing
        // oversized URLs while keeping every required historical reference.
        if (!url.searchParams.has("limit") && !url.searchParams.has("offset")) {
          for (const [field, filter] of url.searchParams) {
            if (!filter.startsWith("in.(") || !filter.endsWith(")")) continue;
            const ids = filter.slice(4, -1).split(",");
            if (ids.length <= 200 || !ids.every(id => /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id))) continue;
            const combined: unknown[] = [];
            const unique = [...new Set(ids)];
            for (let offset = 0; offset < unique.length; offset += 800) {
              const batches = [];
              for (let at = offset; at < Math.min(offset + 800, unique.length); at += 200) {
                const batch = new URL(url);
                batch.searchParams.set(field, `in.(${unique.slice(at, at + 200).join(",")})`);
                batches.push(read(batch, init));
              }
              const responses = await Promise.all(batches);
              for (const response of responses) {
                if (!response.ok) return response;
                combined.push(...await response.json());
              }
            }
            return Response.json(combined, { headers: { "Cache-Control": "no-store", "Content-Range": `0-${Math.max(0, combined.length - 1)}/${combined.length}` } });
          }
        }
        const rows: unknown[] = [];
        const start = Number(url.searchParams.get("offset") || 0);
        const requested = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : Infinity;
        const order = url.searchParams.get("order");
        headers.set("Prefer", "count=exact");
        headers.delete("range");
        let total = Infinity;
        let stableOrder = false;
        for (let offset = start; offset < total && rows.length < requested;) {
          const pageSize = Math.min(500, requested - rows.length);
          url.searchParams.set("offset", String(offset));
          url.searchParams.set("limit", String(pageSize));
          const response = await network(url, { ...init, headers, cache: "no-store" });
          if (!response.ok) return response;
          const page = await response.json();
          if (!Array.isArray(page)) throw new Error("Unexpected EOD database response.");
          const count = response.headers.get("content-range")?.split("/")[1];
          if (!count || count === "*" || !/^\d+$/.test(count)) throw new Error("EOD row completeness could not be verified.");
          total = Number(count);
          // Preserve existing small-report ordering. If more than one page is
          // needed, restart with an explicit tie-breaker before collecting rows.
          if (!stableOrder && Math.min(total - start, requested) > page.length && page.length) {
            url.searchParams.set("order", order ? (/(^|,)id\./.test(order) ? order : `${order},id.asc`) : "id.asc");
            stableOrder = true;
            rows.length = 0;
            offset = start;
            continue;
          }
          if (!page.length && offset < total && rows.length < requested) throw new Error("Incomplete EOD database page.");
          rows.push(...page.map(row => { const { __scope, ...record } = row; return record; }));
          offset += page.length;
          if (!page.length) break;
        }
        return Response.json(rows, { headers: { "Cache-Control": "no-store", "Content-Range": `0-${Math.max(0, rows.length - 1)}/${total === Infinity ? 0 : total}` } });
      })();
      pending.set(key, work);
    }
    return (await work).clone();
  };
  return read;
}

// Call only after authenticating and authorizing the requested clinic.
export function createEodDataClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVER_SECRET_KEY;
  if (!url || !key) throw new Error("Protected server data access is not configured.");
  return createClient(url, key, {
    global: { fetch: createEodReadFetch() },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
