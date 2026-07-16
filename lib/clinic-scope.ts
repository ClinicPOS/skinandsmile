export type ClinicScopedReceipt = {
  receptionist_id?: string | null;
};

export type ClinicScopedReceptionist = {
  id: string;
  clinic_id?: string | null;
};

export function receptionistIdsForClinic(
  receptionists: ClinicScopedReceptionist[],
  clinicId: string | null | undefined
): string[] {
  if (!clinicId) return receptionists.map((r) => r.id);
  return receptionists.filter((r) => r.clinic_id === clinicId).map((r) => r.id);
}

export function scopeReceiptsToClinic<R extends ClinicScopedReceipt>(
  receipts: R[],
  receptionists: ClinicScopedReceptionist[],
  clinicId: string | null | undefined
): R[] {
  if (!clinicId) return receipts;
  const ids = new Set(receptionistIdsForClinic(receptionists, clinicId));
  return receipts.filter((r) => r.receptionist_id != null && ids.has(r.receptionist_id));
}
