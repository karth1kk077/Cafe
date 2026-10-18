// All monetary math in integer minor units (paise). Never use floats for money.
export function rupeesToMinor(rupees: number | string): number {
  const n = typeof rupees === "string" ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) throw new Error("Invalid money value");
  return Math.round(n * 100);
}

export function minorToRupees(minor: number): number {
  return minor / 100;
}

export function formatMoney(minor: number, currency = "INR"): string {
  const value = minorToRupees(minor).toFixed(2);
  const symbol = currency === "INR" ? "\u20b9" : "";
  return `${symbol}${value}`;
}

// Apply tax in basis points, round half-up to nearest minor unit.
export function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
}

export function sumMinor(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// Round a total to nearest whole rupee when enabled (returns rounding delta in minor).
export function computeRounding(totalMinor: number, enabled: boolean): number {
  if (!enabled) return 0;
  const rounded = Math.round(totalMinor / 100) * 100;
  return rounded - totalMinor;
}
