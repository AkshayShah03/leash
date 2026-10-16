import { Link2 } from 'lucide-react';
import { formatUsd } from '../lib/format';
import type { Proposal, ProposalStatus, PublicMandate } from '../lib/types';

const COUNTED: ProposalStatus[] = ['captured', 'tracked', 'auto_approved', 'human_approved'];

export function spentThisMonthCents(proposals: Proposal[], now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let total = 0;
  for (const p of proposals) {
    if (!COUNTED.includes(p.status) || !p.committedAt) continue;
    const d = new Date(p.committedAt);
    if (Number.isNaN(d.getTime())) continue;
    if (d.getUTCFullYear() === y && d.getUTCMonth() === m) total += p.input.priceCents;
  }
  return total;
}

interface Props {
  mandate: PublicMandate;
  proposals: Proposal[];
  now?: Date;
  onConnect?: () => void;
  connecting?: boolean;
}

export default function BudgetCard({ mandate, proposals, now, onConnect, connecting }: Props) {
  const spent = spentThisMonthCents(proposals, now);
  const budget = mandate.monthlyBudgetCents;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  return (
    <section className="budget" aria-label="Monthly budget">
      <p className="budget__goal">{mandate.goal}</p>
      <p className="budget__amount">
        <strong>{formatUsd(spent)} spent of {formatUsd(budget)} this month</strong>
      </p>
      <div
        className="budget__bar"
        role="progressbar"
        aria-label="Monthly budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="budget__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="budget__meta">
        <span>Per-order cap {formatUsd(mandate.perOrderCapCents)}</span>
        <span className="budget__conn">
          <span className={`dot ${mandate.connected ? 'dot--on' : ''}`} aria-hidden="true" />
          {mandate.connected ? 'PayPal connected' : 'Not connected'}
        </span>
      </div>
      {!mandate.connected && onConnect && (
        <button type="button" className="btn btn--lime" onClick={onConnect} disabled={connecting}>
          <Link2 size={16} aria-hidden="true" /> Connect PayPal
        </button>
      )}
    </section>
  );
}
