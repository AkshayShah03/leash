import type { Store } from './store';
import type { Mandate, MandateInput } from './types';

export const DEMO_RULES: MandateInput = {
  goal: 'Keep my home office stocked',
  currency: 'USD',
  perOrderCapCents: 6000,
  monthlyBudgetCents: 15000,
  allowedCategories: ['Input Devices', 'Office Supplies', 'Computer Accessories', 'Headphones', 'Audio'],
  allowedMerchants: null,
  blockedMerchants: [],
  maxOrdersPerDay: 25,
  reviewThreshold: 0.8,
};

/** Creates (in a single write) the demo rules (connected to vaultId, if given) only when the store has no mandates. */
export function seedDemo(store: Store, opts: { vaultId?: string }): Mandate | null {
  if (store.listMandates().length > 0) return null;
  return store.createMandate({ ...DEMO_RULES, allowedCategories: [...DEMO_RULES.allowedCategories] }, { vaultId: opts.vaultId });
}
