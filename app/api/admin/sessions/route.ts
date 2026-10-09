import { createServerSupabaseClient, ensureManagerSession, readAppSession } from "../../../../lib/api-session";
import { loadManagedSessions, redactManagedSession, sessionManagementId } from "../../../../lib/session-management";
import { sessionStorageFetch } from "../../../../lib/session-storage";

export const dynamic = "force-dynamic";

async function authorize() {
  const { session, errorResponse } = await readAppSession(createServerSupabaseClient());
  if (errorResponse || !session) return errorResponse!;
  return ensureManagerSession(session);
}

export async function GET() {
  const forbidden = await authorize();
  if (forbidden) return forbidden;
  try {
    const rows = await loadManagedSessions();
    return Response.json({ sessions: await Promise.all(rows.map(redactManagedSession)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Sessions could not be loaded." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const forbidden = await authorize();
  if (forbidden) return forbidden;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string" || !/^[a-f0-9]{64}$/.test(body.id) || Object.keys(body).some(key => key !== "id")) {
    return Response.json({ error: "A valid session reference is required." }, { status: 400 });
  }
  try {
    const rows = await loadManagedSessions();
    for (const row of rows) {
      if (await sessionManagementId(row.token) !== body.id) continue;
      const response = await sessionStorageFetch(`?token=eq.${encodeURIComponent(row.token)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Revocation failed.");
      return Response.json({ revoked: true });
    }
    return Response.json({ error: "Session no longer exists." }, { status: 404 });
  } catch {
    return Response.json({ error: "Session could not be revoked." }, { status: 503 });
  }
}
