// Send only edits, avoiding a second save for an unchanged patient at checkout.
export function patientDetailChanges(saved: Record<string, unknown> | undefined, values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).filter(([field, value]) => !saved || (saved[field] ?? '') !== value));
}
