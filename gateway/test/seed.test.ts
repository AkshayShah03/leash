import { describe, expect, it } from 'vitest';
import { DEMO_RULES, seedDemo } from '../src/seed';
import { Store } from '../src/store';

describe('seedDemo', () => {
  it('seeds the demo rules into an empty store', () => {
    const store = new Store();
    const m = seedDemo(store, {});
    expect(m).not.toBeNull();
    expect(m).toMatchObject({ ...DEMO_RULES, vaultId: null });
    expect(store.listMandates()).toHaveLength(1);
  });

  it('has the documented demo values', () => {
    expect(DEMO_RULES).toEqual({
      goal: 'Keep my home office stocked', currency: 'USD', perOrderCapCents: 6000, monthlyBudgetCents: 15000,
      allowedCategories: ['Input Devices', 'Office Supplies', 'Computer Accessories', 'Headphones', 'Audio'],
      allowedMerchants: null, blockedMerchants: [], maxOrdersPerDay: 5, reviewThreshold: 0.8,
    });
  });

  it('applies the vault id when given', () => {
    const store = new Store();
    const m = seedDemo(store, { vaultId: 'VAULT-1' });
    expect(m?.vaultId).toBe('VAULT-1');
    expect(store.getMandate(m!.id)?.vaultId).toBe('VAULT-1');
  });

  it('does nothing when a mandate already exists, and is idempotent', () => {
    const store = new Store();
    const existing = store.createMandate({ ...DEMO_RULES, goal: 'mine' });
    expect(seedDemo(store, { vaultId: 'V' })).toBeNull();
    expect(store.listMandates()).toEqual([existing]);
    const s2 = new Store();
    expect(seedDemo(s2, {})).not.toBeNull();
    expect(seedDemo(s2, {})).toBeNull();
    expect(s2.listMandates()).toHaveLength(1);
  });
});
