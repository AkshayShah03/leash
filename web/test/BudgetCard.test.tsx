import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BudgetCard, { spentThisMonthCents } from '../src/components/BudgetCard';
import type { Proposal, PublicMandate, ProposalStatus } from '../src/lib/types';

const NOW = new Date('2026-10-16T12:00:00Z');
const mandate: PublicMandate = {
  id: 'm1', goal: 'Gifts under budget', currency: 'USD', perOrderCapCents: 5000,
  monthlyBudgetCents: 20000, allowedCategories: [], allowedMerchants: null,
  blockedMerchants: [], maxOrdersPerDay: 3, reviewThreshold: 2500, connected: true,
};
function p(status: ProposalStatus, priceCents: number, committedAt: string | null): Proposal {
  return {
    id: Math.random().toString(), mandateId: 'm1', status, reasons: [], intent: null, paypal: {},
    createdAt: committedAt ?? '2026-10-01T00:00:00Z', committedAt,
    input: { title: 't', description: '', category: 'c', merchant: 'm', priceCents, currency: 'USD', userRequest: '' },
  };
}

describe('spentThisMonthCents', () => {
  it('sums committed statuses in the current UTC month only', () => {
    const list = [
      p('captured', 1000, '2026-10-02T00:00:00Z'),
      p('tracked', 500, '2026-10-31T23:59:59Z'),
      p('auto_approved', 300, '2026-10-05T00:00:00Z'),
      p('human_approved', 200, '2026-10-06T00:00:00Z'),
      p('captured', 9999, '2026-09-30T23:59:59Z'),
      p('captured', 9999, '2026-11-01T00:00:00Z'),
      p('pending_human', 7777, null),
      p('denied', 7777, '2026-10-03T00:00:00Z'),
      p('refunded', 7777, '2026-10-03T00:00:00Z'),
      p('captured', 7777, null),
    ];
    expect(spentThisMonthCents(list, NOW)).toBe(2000);
  });
});

describe('BudgetCard', () => {
  it('shows spent of budget, cap and connection', () => {
    render(<BudgetCard mandate={mandate} proposals={[p('captured', 4000, '2026-10-02T00:00:00Z')]} now={NOW} />);
    expect(screen.getByText(/\$40\.00 spent of \$200\.00 this month/)).toBeTruthy();
    expect(screen.getByText('PayPal connected')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('20');
  });
  it('offers connect when not connected', () => {
    render(<BudgetCard mandate={{ ...mandate, connected: false }} proposals={[]} now={NOW} onConnect={() => {}} />);
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /connect paypal/i })).toBeTruthy();
  });
});
