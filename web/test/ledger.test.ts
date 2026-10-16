import { describe, expect, it } from 'vitest';
import { actorLabel, canRefund, decidedBy, eventsFor, ledgerTotals, matchesFilter } from '../src/lib/ledger';
import type { LedgerEvent, Proposal } from '../src/lib/types';

const p = (id: string, status: Proposal['status'], priceCents = 1000, committedAt: string | null = '2026-10-05T00:00:00Z'): Proposal => ({
  id, mandateId: 'm', status, reasons: [], intent: null, paypal: {}, createdAt: '2026-10-01T00:00:00Z', committedAt,
  input: { title: 't', description: '', category: 'c', merchant: 'm', priceCents, currency: 'USD', userRequest: 'r' },
});
const ev = (seq: number, proposalId: string, actor: LedgerEvent['actor']): LedgerEvent => ({
  seq, proposalId, mandateId: 'm', status: 'captured', actor, detail: 'd', at: '2026-10-05T00:00:00Z',
});

describe('ledger helpers', () => {
  it('maps actors', () => {
    expect([actorLabel('agent'), actorLabel('policy'), actorLabel('intent'), actorLabel('owner'), actorLabel('paypal'), actorLabel('system')])
      .toEqual(['Scout', 'Rules', 'AI check', 'You', 'PayPal', 'System']);
  });
  it('decidedBy uses the latest event by seq, dash when none', () => {
    const events = [ev(5, 'a', 'paypal'), ev(2, 'a', 'agent'), ev(3, 'b', 'owner')];
    expect(decidedBy(events, 'a')).toBe('PayPal');
    expect(decidedBy(events, 'zzz')).toBe('—');
    expect(eventsFor(events, 'a').map((e) => e.seq)).toEqual([2, 5]);
  });
  it('filters', () => {
    expect(matchesFilter(p('1', 'tracked'), 'bought')).toBe(true);
    expect(matchesFilter(p('1', 'denied'), 'bought')).toBe(false);
    expect(matchesFilter(p('1', 'failed'), 'blocked')).toBe(true);
    expect(matchesFilter(p('1', 'pending_human'), 'needs')).toBe(true);
    expect(matchesFilter(p('1', 'refunded'), 'refunded')).toBe(true);
    expect(matchesFilter(p('1', 'proposed'), 'all')).toBe(true);
  });
  it('canRefund only captured/tracked', () => {
    expect(canRefund(p('1', 'captured'))).toBe(true);
    expect(canRefund(p('1', 'tracked'))).toBe(true);
    expect(canRefund(p('1', 'refunded'))).toBe(false);
  });
  it('totals: UTC month, bought only, blocked count, refunded sum', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    const t = ledgerTotals([
      p('1', 'captured', 1000), p('2', 'tracked', 500), p('3', 'captured', 700, '2026-09-30T23:59:59Z'),
      p('4', 'auto_approved', 900), p('5', 'denied'), p('6', 'denied'), p('9', 'failed'), p('7', 'refunded', 2500), p('8', 'refunded', 100),
    ], now);
    expect(t).toEqual({ boughtCents: 1500, blockedCount: 3, refundedCents: 2600 });
  });
});
