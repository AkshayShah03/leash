import type { ProposalStatus } from './types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatUsd(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) return '—';
  return usd.format(cents / 100);
}

/** Dollars typed by a user → integer cents, or null if not `^\d+(\.\d{1,2})?$`. */
export function parseUsdToCents(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'progress';

const LABELS: Record<ProposalStatus, string> = {
  tracked: 'Bought · tracking',
  captured: 'Bought',
  auto_approved: 'Paying…',
  human_approved: 'Paying…',
  pending_human: 'Needs your OK',
  denied: 'Blocked',
  refunded: 'Refunded',
  failed: 'Failed',
  proposed: 'Checking…',
};

export function statusLabel(s: ProposalStatus): string {
  return LABELS[s];
}

export function statusTone(s: ProposalStatus): Tone {
  switch (s) {
    case 'tracked':
    case 'captured':
      return 'success';
    case 'pending_human':
      return 'warning';
    case 'denied':
    case 'failed':
      return 'danger';
    case 'refunded':
      return 'neutral';
    default:
      return 'progress';
  }
}

const timeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const timeFmtSec = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

/** ISO timestamp → short local date/time; em dash when unparseable. */
export function formatTime(iso: string, withSeconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (withSeconds ? timeFmtSec : timeFmt).format(d);
}
