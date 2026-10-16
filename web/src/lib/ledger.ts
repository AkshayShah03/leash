import type { Actor, LedgerEvent, Proposal, ProposalStatus } from './types';

export type LedgerFilter = 'all' | 'bought' | 'needs' | 'blocked' | 'refunded';

export const FILTERS: { id: LedgerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'bought', label: 'Bought' },
  { id: 'needs', label: 'Needs OK' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'refunded', label: 'Refunded' },
];

const FILTER_STATUSES: Record<Exclude<LedgerFilter, 'all'>, ProposalStatus[]> = {
  bought: ['captured', 'tracked'],
  needs: ['pending_human'],
  blocked: ['denied', 'failed'],
  refunded: ['refunded'],
};

export function matchesFilter(p: Proposal, f: LedgerFilter): boolean {
  return f === 'all' || FILTER_STATUSES[f].includes(p.status);
}

export function canRefund(p: Proposal): boolean {
  return p.status === 'captured' || p.status === 'tracked';
}

const ACTORS: Record<Actor, string> = {
  agent: 'Scout',
  policy: 'Rules',
  intent: 'AI check',
  owner: 'You',
  paypal: 'PayPal',
  system: 'System',
};

export function actorLabel(a: Actor): string {
  return ACTORS[a] ?? 'System';
}

export function eventsFor(events: LedgerEvent[], proposalId: string): LedgerEvent[] {
  return events.filter((e) => e.proposalId === proposalId).sort((a, b) => a.seq - b.seq);
}

/** Label for the actor of the proposal's latest ledger event; em dash when none. */
export function decidedBy(events: LedgerEvent[], proposalId: string): string {
  const mine = eventsFor(events, proposalId);
  return mine.length ? actorLabel(mine[mine.length - 1].actor) : '—';
}

export interface Totals {
  boughtCents: number;
  blockedCount: number;
  refundedCents: number;
}

export function ledgerTotals(proposals: Proposal[], now: Date = new Date()): Totals {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const t: Totals = { boughtCents: 0, blockedCount: 0, refundedCents: 0 };
  for (const p of proposals) {
    if (p.status === 'denied' || p.status === 'failed') t.blockedCount += 1;
    else if (p.status === 'refunded') t.refundedCents += p.input.priceCents;
    else if (canRefund(p) && p.committedAt) {
      const d = new Date(p.committedAt);
      if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() === y && d.getUTCMonth() === m) t.boughtCents += p.input.priceCents;
    }
  }
  return t;
}
