import { describe, expect, it } from 'vitest';
import { assertCents, formatUsd, toPayPalValue } from '../src/money';

describe('money', () => {
  it('converts cents to PayPal decimal strings', () => {
    expect(toPayPalValue(0)).toBe('0.00');
    expect(toPayPalValue(5)).toBe('0.05');
    expect(toPayPalValue(5400)).toBe('54.00');
    expect(toPayPalValue(123456)).toBe('1234.56');
  });

  it('formats USD', () => {
    expect(formatUsd(7200)).toBe('$72.00');
  });

  it('rejects non-integer or negative cents', () => {
    expect(() => assertCents(1.5)).toThrow('Invalid cents');
    expect(() => assertCents(-1)).toThrow('Invalid cents');
    expect(() => toPayPalValue(Number.NaN)).toThrow('Invalid cents');
  });
});
