import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { formatTime, formatUsd, statusLabel } from '../lib/format';
import { FILTERS, actorLabel, eventsFor, ledgerTotals, matchesFilter, type LedgerFilter } from '../lib/ledger';
import type { LedgerEvent, Proposal } from '../lib/types';
import EmptyState from '../components/EmptyState';

const LedgerGrid = lazy(() => import('../components/LedgerGrid'));

interface Props {
  mandateId: string;
  proposals: Proposal[];
  onChanged: () => void;
  onToast: (msg: string) => void;
}

export default function Ledger({ mandateId, proposals, onChanged, onToast }: Props) {
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const trailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    api.ledger(mandateId).then(
      (list) => { if (live) { setEvents(list); setEventsError(false); setLoaded(true); } },
      () => { if (live) { setEventsError(true); setLoaded(true); } /* keep previous events; next change retries */ },
    );
    return () => { live = false; };
  }, [mandateId, proposals]);

  const totals = useMemo(() => ledgerTotals(proposals), [proposals]);
  const visible = useMemo(() => proposals.filter((p) => matchesFilter(p, filter)), [proposals, filter]);
  const selected = proposals.find((p) => p.id === selectedId) ?? null;
  const trail = selected ? eventsFor(events, selected.id) : [];

  useEffect(() => {
    if (!selectedId) return;
    const el = trailRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Defer so the grid's own post-click redraw/focus handling doesn't steal focus back.
    const t = setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [selectedId]);

  if (proposals.length === 0) {
    if (!loaded) return <div className="grid-loading" role="status">Loading ledger…</div>;
    return (
      <EmptyState icon={<ScrollText size={32} />} title="No purchases yet">
        Every decision Scout and your rules make will be recorded here.
      </EmptyState>
    );
  }

  return (
    <div className="ledger">
      <section className="ltotals" aria-label="Totals">
        <div className="ltotal"><span className="ltotal__label">Bought this month (completed)</span><strong className="ltotal__value">{formatUsd(totals.boughtCents)}</strong></div>
        <div className="ltotal"><span className="ltotal__label">Denied</span><strong className="ltotal__value">{totals.deniedCount}</strong></div>
        <div className="ltotal"><span className="ltotal__label">Refunded</span><strong className="ltotal__value">{formatUsd(totals.refundedCents)}</strong></div>
      </section>

      <div className="lbar" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`lfilter ${filter === f.id ? 'lfilter--on' : ''}`}
            aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="lnone">Nothing matches this filter.</p>
      ) : (
        <Suspense fallback={<div className="grid-loading" role="status">Loading ledger…</div>}>
          <LedgerGrid proposals={visible} events={events} selectedId={selectedId} onSelect={setSelectedId} onChanged={onChanged} onToast={onToast} />
        </Suspense>
      )}
      <p className="lhint">Select a row to see its audit trail.</p>

      {selected && (
        <section ref={trailRef} className="ltrail" aria-label={`Audit trail for ${selected.input.title}`}>
          <div className="ltrail__head">
            <h2 ref={headingRef} tabIndex={-1} className="ltrail__title">Audit trail · {selected.input.title}</h2>
            <button type="button" className="btn btn--ghost lrefund__btn" onClick={() => setSelectedId(null)}>Close</button>
          </div>
          {eventsError && trail.length === 0 ? (
            <p className="lnone lnotice" role="alert">Couldn't load the audit trail</p>
          ) : trail.length === 0 ? (
            <p className="lnone">No events recorded.</p>
          ) : (
            <ol className="ltrail__list">
              {trail.map((e) => (
                <li key={e.seq} className="ltrail__item">
                  <time className="ltrail__time" dateTime={e.at}>{formatTime(e.at, true)}</time>
                  <span className="ltrail__status">{statusLabel(e.status)}</span>
                  <span className="ltrail__actor">{actorLabel(e.actor)}</span>
                  <span className="ltrail__detail">{e.detail}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
