export function assertCents(n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid cents: ${n}`);
}

export function toPayPalValue(cents: number): string {
  assertCents(cents);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function formatUsd(cents: number): string {
  return `$${toPayPalValue(cents)}`;
}
