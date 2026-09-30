export function getTreatmentPlanCompletedVisitCount(
  recordedVisitCount: number,
  hasImportedVisit: boolean
): number {
  return Math.max(
    Math.max(0, Math.trunc(Number(recordedVisitCount) || 0)),
    hasImportedVisit ? 1 : 0
  );
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
