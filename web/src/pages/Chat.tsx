import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, MessageSquarePlus, Sparkles } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { formatUsd } from '../lib/format';
import type { ChatMessage, ProductSummary, Proposal } from '../lib/types';
import ScoutText from '../components/ScoutText';
import ProductCard from '../components/ProductCard';
import StatusChip from '../components/StatusChip';

const SUGGESTIONS = [
  'I need an ergonomic keyboard under $60',
  'Find a USB-C hub for my laptop',
  'Get me a headset for work calls',
];
const ProductGrid = lazy(() => import('../components/ProductGrid'));
const MAX_LEN = 4000;

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  products?: ProductSummary[];
  proposals?: Proposal[];
  error?: boolean;
  retryable?: boolean;
}

interface Props {
  mandateId: string;
  liveProposals?: Proposal[];
  onProposalsChanged: () => void;
  onReviewApprovals: () => void;
}

function windowed(h: ChatMessage[]): ChatMessage[] {
  const w = h.slice(-20);
  const i = w.findIndex((m) => m.role === 'user');
  return i === -1 ? [] : w.slice(i);
}

function ProposalCard({ p, onReview }: { p: Proposal; onReview: () => void }) {
  const score = p.intent ? Math.round(p.intent.score * 100) : null;
  return (
    <div className="rcard">
      <div className="rcard__top">
        <h4 className="rcard__title">{p.input.title}</h4>
        <StatusChip status={p.status} />
      </div>
      <p className="rcard__meta">
        <strong>{formatUsd(p.input.priceCents)}</strong>
        <span> from {p.input.merchant}</span>
        {score !== null && <span className="rcard__score">AI match {score}%</span>}
      </p>
      {p.reasons.length > 0 && (
        <ul className="rcard__reasons">
          {p.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {p.status === 'pending_human' && (
        <button type="button" className="btn btn--primary rcard__btn" onClick={onReview}>Review in Approvals</button>
      )}
    </div>
  );
}

function Products({ products }: { products: ProductSummary[] }) {
  const [table, setTable] = useState(false);
  return (
    <div className="products">
      <div className="prow" role="list" aria-label="Products found">
        {products.map((p) => <div role="listitem" key={p.id}><ProductCard product={p} /></div>)}
      </div>
      <button type="button" className="linkbtn" aria-expanded={table} onClick={() => setTable((t) => !t)}>
        {table ? 'Hide table' : 'Compare in table'}
      </button>
      {table && (
        <Suspense fallback={<div className="grid-loading">Loading table…</div>}>
          <ProductGrid products={products} />
        </Suspense>
      )}
    </div>
  );
}

export default function Chat({ mandateId, liveProposals = [], onProposalsChanged, onReviewApprovals }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const history = useRef<ChatMessage[]>([]);
  const nextId = useRef(1);
  const gen = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const lastSent = useRef('');
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasBusy = useRef(false);

  useEffect(() => {
    if (wasBusy.current && !busy) inputRef.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    if (turns.length === 0) return;
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  async function send(text: string, retry = false) {
    const content = text.trim();
    if (!content || busy || inFlight.current || content.length > MAX_LEN) return;
    inFlight.current = true;
    const my = gen.current;
    lastSent.current = content;
    if (!retry) {
      history.current = [...history.current, { role: 'user', content }];
      setTurns((t) => [...t, { id: nextId.current++, role: 'user', text: content }]);
      setDraft('');
    } else {
      setTurns((t) => t.filter((x) => !x.error));
    }
    setBusy(true);
    try {
      const res = await api.chat({ mandateId, conversationId, messages: windowed(history.current) });
      if (my !== gen.current) return;
      history.current = [...history.current, { role: 'assistant', content: res.text || '(no reply)' }];
      setTurns((t) => [...t, { id: nextId.current++, role: 'assistant', text: res.text || '(no reply)', products: res.products, proposals: res.proposals }]);
    } catch (e) {
      if (my !== gen.current) return;
      const msg =
        e instanceof ApiError && e.status === 502
          ? 'Scout is unavailable right now. Try again in a moment.'
          : e instanceof ApiError && e.status === 404
            ? 'These spending rules no longer exist. Pick another set of rules.'
            : e instanceof ApiError
              ? 'That message could not be sent.'
              : 'Could not reach the server.';
      const retryable = !(e instanceof ApiError) || e.status === 502;
      setTurns((t) => [...t, { id: nextId.current++, role: 'assistant', text: msg, error: true, retryable }]);
    } finally {
      if (my === gen.current) {
        inFlight.current = false;
        setBusy(false);
      }
      onProposalsChanged();
    }
  }

  function newChat() {
    gen.current++;
    history.current = [];
    setTurns([]);
    setDraft('');
    inFlight.current = false;
    setBusy(false);
    setConversationId(crypto.randomUUID());
    inputRef.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  return (
    <section className="chat" aria-label="Chat with Scout">
      <div className="chat__scroll">
        <div className="chat__col">
          {turns.length > 0 && (
            <div className="chat__head">
              <button type="button" className="linkbtn" onClick={newChat}>
                <MessageSquarePlus size={16} aria-hidden="true" /> New chat
              </button>
            </div>
          )}
          {turns.length === 0 && (
            <div className="chat__hero">
              <span className="chat__spark" aria-hidden="true"><Sparkles size={26} /></span>
              <h2>What should Scout find for you?</h2>
              <p>Scout searches stores, checks every pick against your spending rules, and asks before anything risky.</p>
              <div className="chat__chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="suggest" disabled={busy} onClick={() => void send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          <div className="msgs" role="log" aria-live="polite" aria-label="Conversation">
            {turns.map((t) =>
              t.role === 'user' ? (
                <div key={t.id} className="msg msg--user"><div className="bubble">{t.text}</div></div>
              ) : (
                <div key={t.id} className="msg msg--scout">
                  <div className={`scard ${t.error ? 'scard--error' : ''}`} role={t.error ? 'alert' : undefined}>
                    <span className="scard__label">Scout</span>
                    {t.error ? <p>{t.text}</p> : <ScoutText text={t.text} />}
                    {t.error && t.retryable && (
                      <button type="button" className="linkbtn" disabled={busy} onClick={() => void send(lastSent.current, true)}>Retry</button>
                    )}
                  </div>
                  {t.products && t.products.length > 0 && <Products products={t.products} />}
                  {t.proposals && t.proposals.length > 0 && (
                    <div className="rlist">
                      {t.proposals.map((p) => <ProposalCard key={p.id} p={liveProposals.find((x) => x.id === p.id) ?? p} onReview={onReviewApprovals} />)}
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && (
              <div className="msg msg--scout">
                <div className="scard scard--typing" role="status">
                  <span className="typing" aria-hidden="true"><i /><i /><i /></span>
                  Scout is searching and checking your rules…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>
      <form
        className="composer"
        onSubmit={(e) => { e.preventDefault(); void send(draft); }}
      >
        <div className="composer__box">
          <label htmlFor="chat-input" className="sr-only">Message Scout</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={2}
            value={draft}
            maxLength={MAX_LEN}
            disabled={busy}
            placeholder="Ask Scout to find something to buy"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="composer__bar">
            <span className="composer__count" aria-live="off">{draft.length}/{MAX_LEN}</span>
            <button type="submit" className="send" aria-label="Send message" disabled={busy || !draft.trim()}>
              <ArrowUp size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
