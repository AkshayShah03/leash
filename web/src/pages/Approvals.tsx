import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api';
import { humanizeError } from '../lib/errors';
import { formatUsd, safeHref } from '../lib/format';
import type { Proposal } from '../lib/types';
import EmptyState from '../components/EmptyState';
import StatusChip from '../components/StatusChip';

interface Props {
  proposals: Proposal[];
  onChanged: () => void;
  onToast: (msg: string) => void;
}

type OutcomeKind = 'done' | 'blocked' | 'error';
interface Outcome { proposal: Proposal; kind: OutcomeKind; message: string }

const APPROVED_STATUSES = new Set(['human_approved', 'auto_approved', 'captured', 'tracked']);
const REASON_MAX = 300;

function ApprovalCard({ proposal, outcome, leaving, onChanged, onToast, onOutcome, onDismiss }: {
  proposal: Proposal;
  outcome?: Outcome;
  leaving: boolean;
  onChanged: () => void;
  onToast: (msg: string) => void;
  onOutcome: (o: Outcome) => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const { input, intent } = proposal;
  const href = safeHref(input.productUrl);

  async function run(call: () => Promise<Proposal>, okToast: string, isApprove: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await call();
      if (!isApprove || APPROVED_STATUSES.has(res.status)) {
        onToast(okToast);
        onOutcome({ proposal, kind: 'done', message: '' });
      } else if (res.status === 'denied') {
        const why = res.reasons[0] ?? 'policy no longer allows it';
        onOutcome({ proposal, kind: 'blocked', message: `Blocked on re-check: ${why}` });
      } else {
        onOutcome({ proposal, kind: 'error', message: `Could not complete: ${res.reasons[0] ?? res.status}` });
      }
    } catch (e) {
      onOutcome({ proposal, kind: 'error', message: humanizeError(e, { conflict: 'Already decided' }) });
    } finally {
      inFlight.current = false;
      setBusy(false);
      onChanged();
    }
  }

  const failed = outcome && outcome.kind !== 'done';
  return (
    <li className={`acard ${leaving ? 'acard--leaving' : ''}`}>
      <div className="acard__head">
        <div>
          <h3 className="acard__title">{input.title}</h3>
          <p className="acard__merchant">
            {input.merchant}
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" className="acard__link" aria-label={`View ${input.title} (opens in new tab)`}>
                View <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
          </p>
        </div>
        <div className="acard__price">{formatUsd(input.priceCents)}</div>
      </div>

      <blockquote className="acard__ask">You asked: “{input.userRequest}”</blockquote>

      {intent && (
        <div className="acard__ai">
          <Sparkles size={16} aria-hidden="true" />
          <p>
            <strong>AI match {Math.round(intent.score * 100)}%</strong>
            {intent.reason && <> — {intent.reason}</>}
          </p>
        </div>
      )}

      {proposal.reasons.length > 0 && (
        <ul className="acard__reasons" aria-label="Policy notes">
          {proposal.reasons.map((r, i) => (
            <li key={i}><ShieldCheck size={14} aria-hidden="true" />{r}</li>
          ))}
        </ul>
      )}

      {failed ? (
        <div className="acard__result" role="alert">
          {outcome.kind === 'blocked' && <StatusChip status="denied" />}
          <span>{outcome.message}</span>
          <button type="button" className="btn btn--secondary acard__dismiss" onClick={onDismiss}>Dismiss</button>
        </div>
      ) : (
        <>
          {denying && (
            <div className="field">
              <label className="field__label" htmlFor={`reason-${proposal.id}`}>Reason (optional)</label>
              <input id={`reason-${proposal.id}`} value={reason} maxLength={REASON_MAX} disabled={busy}
                onChange={(e) => setReason(e.target.value)} placeholder="Tell Scout why" />
              <span className="field__hint" aria-live="polite">{reason.length}/{REASON_MAX}</span>
            </div>
          )}
          <div className="acard__actions">
            {denying ? (
              <>
                <button type="button" className="btn btn--outline" disabled={busy}
                  onClick={() => void run(() => api.deny(proposal.id, reason.trim() || undefined), 'Denied', false)}>
                  <X size={16} aria-hidden="true" />Confirm deny
                </button>
                <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setDenying(false)}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn--lime" disabled={busy} aria-label={`Approve ${input.title}`}
                  onClick={() => void run(() => api.approve(proposal.id), 'Approved — paying now', true)}>
                  <Check size={16} aria-hidden="true" />Approve
                </button>
                <button type="button" className="btn btn--outline" disabled={busy} aria-label={`Deny ${input.title}`}
                  onClick={() => setDenying(true)}>
                  Deny
                </button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}

export default function Approvals({ proposals, onChanged, onToast }: Props) {
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [leaving, setLeaving] = useState<Record<string, boolean>>({});

  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => { pendingTimers.forEach(clearTimeout); pendingTimers.clear(); };
  }, []);

  const pending = proposals
    .filter((p) => p.status === 'pending_human')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingIds = new Set(pending.map((p) => p.id));
  // Cards that failed inline stay visible even after the refetch removes them from the pending list.
  const kept = Object.values(outcomes)
    .filter((o) => o.kind !== 'done' && !pendingIds.has(o.proposal.id))
    .map((o) => o.proposal);
  const visible = [...pending, ...kept].filter((p) => !(outcomes[p.id]?.kind === 'done' && !leaving[p.id]));

  function handleOutcome(o: Outcome) {
    const id = o.proposal.id;
    if (o.kind === 'done') {
      setLeaving((l) => ({ ...l, [id]: true }));
      setOutcomes((cur) => ({ ...cur, [id]: o }));
      const t = setTimeout(() => {
        timers.current.delete(t);
        setLeaving((l) => { const n = { ...l }; delete n[id]; return n; });
      }, 250);
      timers.current.add(t);
    } else {
      setOutcomes((cur) => ({ ...cur, [id]: o }));
    }
  }

  function dismiss(id: string) {
    setOutcomes((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }

  // Drop finished outcomes once the refetch has removed their proposal from the pending list.
  // Deleting earlier would resurrect a still-pending card if the refetch is slow.
  useEffect(() => {
    setOutcomes((cur) => {
      const stale = Object.keys(cur).filter((id) => cur[id].kind === 'done' && !leaving[id] && !pendingIds.has(id));
      if (stale.length === 0) return cur;
      const n = { ...cur };
      stale.forEach((id) => delete n[id]);
      return n;
    });
  });

  if (visible.length === 0) {
    return (
      <EmptyState icon={<ShieldCheck size={32} />} title="All clear">
        Nothing needs your OK. Scout will ask here when a purchase looks off.
      </EmptyState>
    );
  }

  return (
    <ul className="alist" aria-label="Purchases awaiting approval">
      {visible.map((p) => (
        <ApprovalCard
          key={p.id}
          proposal={p}
          outcome={outcomes[p.id]}
          leaving={!!leaving[p.id]}
          onChanged={onChanged}
          onToast={onToast}
          onOutcome={handleOutcome}
          onDismiss={() => dismiss(p.id)}
        />
      ))}
    </ul>
  );
}
