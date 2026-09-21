import { createServerSupabaseClient, readAppSession } from "../../../../lib/api-session";
import { fromMinorUnits, toMinorUnits } from "../../../../lib/money";
import { fetchAllPages } from "../../../../lib/paginated-fetch";
import { canAccessReports } from "../../../../lib/session-auth";

export const dynamic = "force-dynamic";

type ReceiptRow = { id: string; clinic_id: string | null; patient_id: string | null; created_at: string; transaction_type?: string | null };
type ReceiptItemRow = {
  id: string; receipt_id: string; service_id: string; quantity: number | null;
  price: number | string | null; original_price: number | string | null; total: number | string | null;
  service_name_snapshot: string | null; taxable_amount: number | string | null;
};
type ServiceRow = { id: string; name: string | null; display_name: string | null; category: string | null; category_id: string | null };
type RefundItemRow = { receipt_item_id: string | null; amount: number | string | null; refunded_treatment_amount: number | string | null };
type ServiceAccumulator = {
  id: string; name: string; category: string; quantity: number; grossMinor: number;
  discountMinor: number; refundMinor: number; patientIds: Set<string>; trendMinor: Map<string, number>;
};

const PAGE_SIZE = 1000;
const ID_BATCH_SIZE = 100;

function parseDubaiRange(startDate: unknown, endDate: unknown) {
  const start = String(startDate || "");
  const end = String(endDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
    throw new Error("A valid startDate and endDate are required.");
  }
  const startDateValue = new Date(`${start}T00:00:00+04:00`);
  const endExclusive = new Date(`${end}T00:00:00+04:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const days = Math.floor((endExclusive.getTime() - startDateValue.getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 1 || days > 3660) throw new Error("The selected date range is invalid or too large.");
  return { start, end, startIso: startDateValue.toISOString(), endIso: endExclusive.toISOString(), days };
}

function trendLabel(key: string, granularity: "day" | "month") {
  const date = new Date(`${granularity === "month" ? `${key}-01` : key}T00:00:00+04:00`);
  return date.toLocaleDateString("en-GB", granularity === "month"
    ? { month: "short", year: "numeric", timeZone: "Asia/Dubai" }
    : { day: "numeric", month: "short", timeZone: "Asia/Dubai" });
}

async function fetchByIds<Row>(
  supabase: ReturnType<typeof createServerSupabaseClient>, table: string, columns: string, field: string, ids: string[],
) {
  const rows: Row[] = [];
  for (let offset = 0; offset < ids.length; offset += ID_BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + ID_BATCH_SIZE);
    const pageRows = await fetchAllPages<Row>(async (from, to) => {
      const { data, error } = await supabase
        .from(table).select(columns).in(field, chunk).order("id", { ascending: true }).range(from, to);
      return { data: (data || []) as Row[], error };
    }, PAGE_SIZE);
    rows.push(...pageRows);
  }
  return rows;
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { session, errorResponse } = await readAppSession(supabase);
  if (!session) return errorResponse!;
  if (!canAccessReports(session)) return Response.json({ error: "Forbidden." }, { status: 403 });

  const body = await request.json().catch(() => null);
  let range: ReturnType<typeof parseDubaiRange>;
  try {
    range = parseDubaiRange(body?.startDate, body?.endDate);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid date range." }, { status: 400 });
  }

  const clinicId = String(body?.clinicId || "").trim() || null;
  const categoryFilter = String(body?.category || "").trim();
  const serviceIdFilter = String(body?.serviceId || "").trim();

  try {
    const receipts = await fetchAllPages<ReceiptRow>((from, to) => {
      let query = supabase.from("receipts")
        .select("id, clinic_id, patient_id, created_at, transaction_type")
        .gte("created_at", range.startIso).lt("created_at", range.endIso)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
      if (clinicId) query = query.eq("clinic_id", clinicId);
      return query;
    }, PAGE_SIZE);

    const validReceipts = receipts.filter((receipt) => String(receipt.transaction_type || "regular") !== "plan_summary");
    const receiptMap = new Map(validReceipts.map((receipt) => [receipt.id, receipt]));
    const items = await fetchByIds<ReceiptItemRow>(supabase, "receipt_items",
      "id, receipt_id, service_id, quantity, price, original_price, total, service_name_snapshot, taxable_amount",
      "receipt_id", validReceipts.map((receipt) => receipt.id));
    const serviceIds = [...new Set(items.map((item) => item.service_id).filter(Boolean))];
    const services = await fetchByIds<ServiceRow>(supabase, "services", "id, name, display_name, category, category_id", "id", serviceIds);
    const serviceMap = new Map(services.map((service) => [service.id, service]));
    const refundItems = await fetchByIds<RefundItemRow>(supabase, "refund_items",
      "id, receipt_item_id, amount, refunded_treatment_amount", "receipt_item_id", items.map((item) => item.id));

    const refundMinorByItem = new Map<string, number>();
    for (const refund of refundItems) {
      if (!refund.receipt_item_id) continue;
      const treatment = refund.refunded_treatment_amount ?? refund.amount ?? 0;
      refundMinorByItem.set(refund.receipt_item_id, (refundMinorByItem.get(refund.receipt_item_id) || 0) + toMinorUnits(Number(treatment)));
    }

    const granularity: "day" | "month" = range.days <= 92 ? "day" : "month";
    const aggregates = new Map<string, ServiceAccumulator>();
    let legacyPricingRows = 0;

    for (const item of items) {
      const receipt = receiptMap.get(item.receipt_id);
      if (!receipt) continue;
      const service = serviceMap.get(item.service_id);
      const category = String(service?.category || service?.category_id || "Uncategorized").trim() || "Uncategorized";
      if (categoryFilter && category !== categoryFilter) continue;
      if (serviceIdFilter && item.service_id !== serviceIdFilter) continue;

      const quantity = Math.max(1, Number(item.quantity || 1));
      const chargedMinor = toMinorUnits(Number(item.taxable_amount ?? item.total ?? (Number(item.price || 0) * quantity)));
      if (item.taxable_amount == null) legacyPricingRows += 1;
      const grossMinor = toMinorUnits(Number(item.original_price ?? item.price ?? 0) * quantity);
      const safeGrossMinor = Math.max(grossMinor, chargedMinor);
      const refundMinor = Math.min(chargedMinor, refundMinorByItem.get(item.id) || 0);
      const day = new Date(receipt.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
      const bucket = granularity === "day" ? day : day.slice(0, 7);
      const name = String(item.service_name_snapshot || service?.display_name || service?.name || "Unknown Service");
      const aggregate = aggregates.get(item.service_id) || {
        id: item.service_id, name, category, quantity: 0, grossMinor: 0, discountMinor: 0,
        refundMinor: 0, patientIds: new Set<string>(), trendMinor: new Map<string, number>(),
      };
      aggregate.quantity += quantity;
      aggregate.grossMinor += safeGrossMinor;
      aggregate.discountMinor += Math.max(0, safeGrossMinor - chargedMinor);
      aggregate.refundMinor += refundMinor;
      if (receipt.patient_id) aggregate.patientIds.add(receipt.patient_id);
      aggregate.trendMinor.set(bucket, (aggregate.trendMinor.get(bucket) || 0) + chargedMinor - refundMinor);
      aggregates.set(item.service_id, aggregate);
    }

    const totalNetMinor = [...aggregates.values()].reduce(
      (sum, service) => sum + Math.max(0, service.grossMinor - service.discountMinor - service.refundMinor), 0);
    const rows = [...aggregates.values()].map((service) => {
      const netMinor = Math.max(0, service.grossMinor - service.discountMinor - service.refundMinor);
      return {
        id: service.id, name: service.name, category: service.category, quantity: service.quantity,
        uniquePatients: service.patientIds.size, grossSales: fromMinorUnits(service.grossMinor),
        discounts: fromMinorUnits(service.discountMinor), refunds: fromMinorUnits(service.refundMinor),
        netRevenue: fromMinorUnits(netMinor), revenueShare: totalNetMinor > 0 ? (netMinor / totalNetMinor) * 100 : 0,
        averageRevenuePerSale: service.quantity > 0 ? fromMinorUnits(Math.round(netMinor / service.quantity)) : 0,
      };
    }).sort((left, right) => right.netRevenue - left.netRevenue || left.name.localeCompare(right.name))
      .map((row, index) => ({ ...row, rank: index + 1 }));

    const categoryMap = new Map<string, number>();
    for (const row of rows) categoryMap.set(row.category, (categoryMap.get(row.category) || 0) + toMinorUnits(row.netRevenue));
    const selected = serviceIdFilter ? aggregates.get(serviceIdFilter) : null;
    const trend = selected ? [...selected.trendMinor.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, label: trendLabel(key, granularity), revenue: fromMinorUnits(value) })) : [];
    const allServiceOptions = services.map((service) => ({
      id: service.id, name: String(service.display_name || service.name || "Unknown Service"),
      category: String(service.category || service.category_id || "Uncategorized").trim() || "Uncategorized",
    })).sort((left, right) => left.name.localeCompare(right.name));
    const categories = [...new Set(allServiceOptions.map((service) => service.category))].sort();
    const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);

    return Response.json({
      meta: { startDate: range.start, endDate: range.end, clinicId, granularity, legacyPricingRows },
      summary: {
        totalServiceRevenue: fromMinorUnits(totalNetMinor), topRevenueService: rows[0] || null,
        servicesSold: rows.length, quantitySold: totalQuantity,
        averageRevenuePerServiceSale: totalQuantity > 0 ? fromMinorUnits(Math.round(totalNetMinor / totalQuantity)) : 0,
      },
      services: rows, categories, serviceOptions: allServiceOptions,
      categoryRevenue: [...categoryMap.entries()].map(([category, minor]) => ({ category, revenue: fromMinorUnits(minor) }))
        .sort((left, right) => right.revenue - left.revenue),
      trend,
    });
  } catch (error) {
    console.error("Service performance report error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load service performance." }, { status: 500 });
  }
}
