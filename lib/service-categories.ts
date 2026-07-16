// Legacy keyword-based grouping for the aesthetic clinic, used before services
// had a real `category` column. Kept as a fallback for uncategorized services
// and as a source of category suggestions in the Backend.
export function getAestheticServiceCategory(serviceName: string): string | null {
  const name = serviceName.toLowerCase();

  // Facial Services
  if (name.includes("hydrafacial") || name.includes("bb glow") || name.includes("deep facial") || name.includes("clarifying")) {
    return "Facial Services";
  }

  // Hyperpigmentation Treatment
  if (name.includes("acne") || name.includes("mesotherapy") || name.includes("co2 fractional") || name.includes("green peel") || name.includes("prp treatment")) {
    return "Hyperpigmentation Treatment";
  }

  // Hair Laser Removal
  if (name.includes("upper lip") || name.includes("underarm") || name.includes("half legs") || name.includes("half arms") || name.includes("full face") || name.includes("beard") || name.includes("bikini") || name.includes("full legs")) {
    return "Hair Laser Removal";
  }

  return null;
}

// The category a service effectively belongs to: the saved column wins,
// otherwise the legacy keyword match, otherwise null (uncategorized).
export function effectiveServiceCategory(service: { name?: string | null; category?: string | null }): string | null {
  const saved = String(service.category || "").trim();
  if (saved) return saved;
  return getAestheticServiceCategory(String(service.name || ""));
}
