import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/policy';
import { mandate, proposal } from './fakes';

const fresh = { monthSpentCents: 0, ordersToday: 0 };
const reasonsOf = (r: ReturnType<typeof evaluatePolicy>) => (r.ok ? [] : r.reasons);

describe('evaluatePolicy', () => {
  it('passes a compliant proposal', () => {
    expect(evaluatePolicy(mandate(), proposal(), fresh)).toEqual({ ok: true });
  });

  it('allows a price exactly at the cap and exactly using the remaining budget', () => {
    const m = mandate({ perOrderCapCents: 6000, monthlyBudgetCents: 15000 });
    expect(evaluatePolicy(m, proposal({ priceCents: 6000 }), { monthSpentCents: 9000, ordersToday: 0 })).toEqual({ ok: true });
  });

  it('denies above the per-order cap', () => {
    expect(reasonsOf(evaluatePolicy(mandate(), proposal({ priceCents: 7200 }), fresh))).toContain(
      'Price $72.00 exceeds per-order cap $60.00',
    );
  });

  it('denies when the remaining monthly budget is too small', () => {
    const r = evaluatePolicy(mandate(), proposal({ priceCents: 5400 }), { monthSpentCents: 12000, ordersToday: 0 });
    expect(reasonsOf(r)).toContain('Price $54.00 exceeds remaining monthly budget $30.00');
  });

  it('reports $0.00 remaining when already over budget', () => {
    const r = evaluatePolicy(mandate(), proposal({ priceCents: 100 }), { monthSpentCents: 20000, ordersToday: 0 });
    expect(reasonsOf(r)).toContain('Price $1.00 exceeds remaining monthly budget $0.00');
  });

  it('matches categories case- and whitespace-insensitively', () => {
    expect(evaluatePolicy(mandate(), proposal({ category: '  OFFICE supplies ' }), fresh)).toEqual({ ok: true });
    expect(reasonsOf(evaluatePolicy(mandate(), proposal({ category: 'Gaming' }), fresh))).toContain(
      'Category "Gaming" is not in the allowed categories',
    );
  });

  it('allows any category when the allowlist is empty', () => {
    expect(evaluatePolicy(mandate({ allowedCategories: [] }), proposal({ category: 'Gaming' }), fresh)).toEqual({ ok: true });
  });

  it('enforces merchant block and allow lists', () => {
    expect(reasonsOf(evaluatePolicy(mandate({ blockedMerchants: ['SHOP.example.com'] }), proposal(), fresh))).toContain(
      'Merchant "shop.example.com" is blocked',
    );
    expect(reasonsOf(evaluatePolicy(mandate({ allowedMerchants: ['other.com'] }), proposal(), fresh))).toContain(
      'Merchant "shop.example.com" is not in the allowed merchants',
    );
  });

  it('enforces the daily order limit', () => {
    expect(reasonsOf(evaluatePolicy(mandate({ maxOrdersPerDay: 2 }), proposal(), { monthSpentCents: 0, ordersToday: 2 }))).toContain(
      'Daily order limit of 2 reached',
    );
  });

  it('denies currency mismatches', () => {
    expect(reasonsOf(evaluatePolicy(mandate(), proposal({ currency: 'EUR' }), fresh))).toContain(
      'Currency EUR does not match mandate currency USD',
    );
  });

  it('denies invalid prices without evaluating money rules', () => {
    for (const priceCents of [0, -5, 12.5, Number.NaN]) {
      expect(evaluatePolicy(mandate(), proposal({ priceCents }), fresh)).toEqual({
        ok: false,
        reasons: ['Price must be a positive whole number of cents'],
      });
    }
  });

  it('collects every violated rule', () => {
    const r = evaluatePolicy(mandate(), proposal({ priceCents: 99900, category: 'Gaming' }), fresh);
    expect(reasonsOf(r)).toHaveLength(3); // cap, budget, category
  });
});

describe('merchant normalization', () => {
  it.each(['https://www.evil.com/', 'EVIL.COM.', 'www.evil.com:443/path', 'http://evil.com?x=1', 'evil.com#frag', 'evil.com..'])(
    'blocked evil.com denies variant %s',
    (variant) => {
      const r = evaluatePolicy(mandate({ blockedMerchants: ['evil.com'] }), proposal({ merchant: variant }), fresh);
      expect(reasonsOf(r)).toContain(`Merchant "${variant}" is blocked`);
    },
  );

  it('allowed shop.example.com accepts a full URL variant', () => {
    const m = mandate({ allowedMerchants: ['shop.example.com'] });
    expect(evaluatePolicy(m, proposal({ merchant: 'https://www.Shop.Example.com/item/1' }), fresh)).toEqual({ ok: true });
  });

  it('fails closed on non-finite mandate or history numbers', () => {
    const r = evaluatePolicy(mandate({ monthlyBudgetCents: NaN }), proposal(), fresh);
    expect(reasonsOf(r)).toEqual(['Mandate or spend data is invalid']);
    expect(reasonsOf(evaluatePolicy(mandate(), proposal(), { monthSpentCents: NaN, ordersToday: 0 }))).toEqual([
      'Mandate or spend data is invalid',
    ]);
    expect(reasonsOf(evaluatePolicy(mandate({ maxOrdersPerDay: Infinity }), proposal(), fresh))).toEqual([
      'Mandate or spend data is invalid',
    ]);
  });
});
