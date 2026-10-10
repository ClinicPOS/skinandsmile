export function getTreatmentPlanCompletedVisitCount(
  recordedVisitCount: number,
  _hasImportedVisit?: boolean
): number {
  // A clinic file identifies the patient; it is not a completed visit.
  // Historical visits already have their own saved rows.
  return Math.max(0, Math.trunc(Number(recordedVisitCount) || 0));
}

export function hasReachedTreatmentPlanVisitLimit(
  totalVisits: number | null | undefined,
  completedVisits: number
): boolean {
  if (totalVisits == null) return false;
  const normalizedTotal = Math.max(0, Math.trunc(Number(totalVisits) || 0));
  const normalizedCompleted = Math.max(0, Math.trunc(Number(completedVisits) || 0));
  return normalizedCompleted >= normalizedTotal;
}

export function canAddTreatmentPlanVisit(
  totalVisits: number | null | undefined,
  completedVisits: number
): boolean {
  return !hasReachedTreatmentPlanVisitLimit(totalVisits, completedVisits);
}
