import type { Mandate, ProposalInput } from '../src/types';

export function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: 'm-1',
    goal: 'Keep my home office stocked',
    currency: 'USD',
    perOrderCapCents: 6000,
    monthlyBudgetCents: 15000,
    allowedCategories: ['office supplies', 'computer peripherals'],
    allowedMerchants: null,
    blockedMerchants: [],
    maxOrdersPerDay: 5,
    reviewThreshold: 0.8,
    vaultId: 'VAULT-1',
    setupTokenId: null,
    ...overrides,
  };
}

export function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    title: 'Logitech Ergo K860 Ergonomic Keyboard',
    description: 'Split, curved ergonomic wireless keyboard.',
    category: 'Computer Peripherals',
    merchant: 'shop.example.com',
    priceCents: 5400,
    currency: 'USD',
    userRequest: 'I need an ergonomic keyboard',
    ...overrides,
  };
}
