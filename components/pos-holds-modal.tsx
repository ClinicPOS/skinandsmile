"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { PosHold, PosHoldService } from "../lib/types";

type HoldWithServices = PosHold & { services: PosHoldService[] };

function formatWaitingTime(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hrs}h ${remainingMins}m`;
}

export function PosHoldsModal({
  isOpen,
  onClose,
  clinicId,
  onResume,
}: {
  isOpen: boolean;
  onClose: () => void;
  clinicId: string | null;
  onResume: (hold: HoldWithServices) => void;
}) {
  const [holds, setHolds] = useState<HoldWithServices[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  async function loadHolds() {
    if (!clinicId) return;
    setLoading(true);
    try {
      let q = supabase
        .from("pos_holds")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: true });

      if (statusFilter === "active") {
        q = q.in("status", ["Waiting", "In Treatment", "Ready to Pay"]);
      } else if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }

      const { data: holdsData, error } = await q;
      if (error) { console.error(error); return; }

      const holdIds = (holdsData || []).map((h: any) => h.id);
      let servicesData: PosHoldService[] = [];
      if (holdIds.length > 0) {
        const { data: svc } = await supabase
          .from("pos_hold_services")
          .select("*")
          .in("hold_id", holdIds)
          .order("created_at", { ascending: true });
        servicesData = (svc || []) as PosHoldService[];
      }

      const result: HoldWithServices[] = (holdsData || []).map((h: any) => ({
        ...h,
        services: servicesData.filter((s) => s.hold_id === h.id),
      }));
      setHolds(result);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) loadHolds();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, clinicId, statusFilter]);

  async function updateStatus(holdId: string, status: PosHold["status"]) {
    await supabase.from("pos_holds").update({ status, updated_at: new Date().toISOString() }).eq("id", holdId);
    await loadHolds();
  }

  async function cancelHold(holdId: string) {
    if (!cancelReason.trim()) { alert("Please enter a cancellation reason."); return; }
    await supabase.from("pos_holds").update({ status: "Cancelled", cancel_reason: cancelReason.trim(), updated_at: new Date().toISOString() }).eq("id", holdId);
    setCancellingId(null);
    setCancelReason("");
    await loadHolds();
  }

  if (!isOpen) return null;

  const statusColors: Record<string, string> = {
    Waiting: "bg-amber-100 text-amber-800",
    "In Treatment": "bg-blue-100 text-blue-800",
    "Ready to Pay": "bg-emerald-100 text-emerald-800",
    Cancelled: "bg-slate-100 text-slate-500",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-teal-100 bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-teal-100 bg-white px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Held Transactions</h2>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-600">×</button>
        </div>

        <div className="flex gap-2 border-b border-slate-100 px-6 py-3">
          {["active", "all", "Waiting", "In Treatment", "Ready to Pay", "Cancelled"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${statusFilter === f ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {f === "active" ? "Active" : f}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-center text-sm text-slate-400">Loading…</p>
          ) : holds.length === 0 ? (
            <p className="text-center text-sm text-slate-400">No held transactions found.</p>
          ) : (
            <div className="space-y-4">
              {holds.map((hold) => (
                <div key={hold.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-900">{hold.patient_name}</p>
                        {hold.patient_file_no && (
                          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">#{hold.patient_file_no}</span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors[hold.status] || ""}`}>{hold.status}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Waiting {formatWaitingTime(hold.created_at)} · {hold.services.length} service{hold.services.length !== 1 ? "s" : ""}
                        {hold.services.length > 0 && ` · AED ${hold.services.reduce((s, sv) => s + sv.price * sv.quantity, 0).toFixed(2)}`}
                      </p>
                      {hold.services.length > 0 && (
                        <p className="mt-1 text-xs text-slate-600">
                          {hold.services.map((s) => {
                            const teethStr = s.teeth?.length > 0 ? ` (Tooth #${s.teeth.join(", #")})` : "";
                            return s.service_name + teethStr;
                          }).join(" · ")}
                        </p>
                      )}
                      {hold.notes && <p className="mt-1 text-xs italic text-slate-500">Note: {hold.notes}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {hold.status !== "Cancelled" && (
                        <>
                          {hold.status === "Waiting" && (
                            <button onClick={() => updateStatus(hold.id, "In Treatment")} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                              In Treatment
                            </button>
                          )}
                          {(hold.status === "In Treatment") && (
                            <button onClick={() => updateStatus(hold.id, "Ready to Pay")} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                              Ready to Pay
                            </button>
                          )}
                          <button
                            onClick={() => onResume(hold)}
                            className="rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500"
                          >
                            Resume
                          </button>
                          {cancellingId === hold.id ? (
                            <div className="flex gap-2">
                              <input
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                placeholder="Reason for cancellation"
                                className="rounded-xl border border-slate-200 px-2 py-1 text-xs outline-none"
                              />
                              <button onClick={() => cancelHold(hold.id)} className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500">Confirm</button>
                              <button onClick={() => { setCancellingId(null); setCancelReason(""); }} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">Abort</button>
                            </div>
                          ) : (
                            <button onClick={() => setCancellingId(hold.id)} className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">
                              Cancel
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    Created {new Date(hold.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
