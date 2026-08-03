export const AED_MINOR_UNITS = 100;

export function toMinorUnits(value: number): number {
  const normalized = Number(value) || 0;
  return Math.round(normalized * AED_MINOR_UNITS);
}

export function fromMinorUnits(value: number): number {
  return (Number(value) || 0) / AED_MINOR_UNITS;
}

export function roundCurrency(value: number): number {
  return fromMinorUnits(toMinorUnits(value));
}

export function sumMinorUnits(values: number[]): number {
  return values.reduce((sum, value) => sum + Math.trunc(value || 0), 0);
}

export function formatAed(value: number): string {
  return `AED ${roundCurrency(value).toFixed(2)}`;
}
