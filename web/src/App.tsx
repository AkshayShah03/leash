import { useCallback, useEffect, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './lib/api';
import { safeHref } from './lib/format';
import { useLedgerEvents } from './lib/sse';
import type { Proposal, PublicMandate } from './lib/types';
import Sidebar, { type Tab } from './components/Sidebar';
import BudgetCard from './components/BudgetCard';
import Login from './pages/Login';
import Chat from './pages/Chat';
import Approvals from './pages/Approvals';
import Ledger from './pages/Ledger';
import Rules from './pages/Rules';

type Gate = 'loading' | 'login' | 'app' | 'unreachable';

const REFETCH_DEBOUNCE_MS = 150;
const SESSION_EXPIRED = 'Your session expired — unlock again.';

function Shell({ onLogout, onUnauthorized }: { onLogout: () => void; onUnauthorized: () => void }) {
  const [tab, setTab] = useState<Tab>('chat');
  const [mandates, setMandates] = useState<PublicMandate[] | null>(null);
  const [mandateId, setMandateId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const seq = useRef({ mandates: 0, proposals: 0 });

  const loadMandates = useCallback(async () => {
    const n = ++seq.current.mandates;
    try {
      const list = await api.listMandates();
      if (n !== seq.current.mandates) return; // a newer request superseded this one
      setMandates(list);
      setLoadError(false);
      setMandateId((cur) => (cur && list.some((m) => m.id === cur) ? cur : list.length ? list[0].id : null));
      if (list.length === 0) setTab('rules');
    } catch {
      setLoadError(true);
    }
  }, []);

  const activeId = useRef<string | null>(null);
  activeId.current = mandateId;

  useEffect(() => { setProposals([]); }, [mandateId]);

  const loadProposals = useCallback(async () => {
    if (!mandateId) return;
    const n = ++seq.current.proposals;
    try {
      const list = await api.listProposals(mandateId);
      if (n !== seq.current.proposals) return; // a newer request superseded this one
      if (activeId.current === mandateId) setProposals(list);
    } catch {
      // keep previous list; next event retries
    }
  }, [mandateId]);

  useEffect(() => { void loadMandates(); }, [loadMandates]);
  useEffect(() => { void loadProposals(); }, [loadProposals]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has('connected')) setToast('PayPal connected');
    else if (q.get('connect') === 'cancelled') setToast('Connection cancelled');
    else return;
    window.history.replaceState(null, '', window.location.pathname);
    if (q.has('connected')) void loadMandates();
  }, [loadMandates]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEvent = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      debounce.current = null;
      void loadProposals();
      void loadMandates();
    }, REFETCH_DEBOUNCE_MS);
  }, [loadProposals, loadMandates]);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const checking = useRef(false);
  const onStreamError = useCallback(() => {
    if (checking.current) return;
    checking.current = true;
    api.session().then(
      (ok) => { if (!ok) onUnauthorized(); },
      () => { /* server unreachable; EventSource keeps retrying */ },
    ).finally(() => { checking.current = false; });
  }, [onUnauthorized]);
  const { connected } = useLedgerEvents(mandateId, onEvent, onStreamError);

  const mandate = mandates?.find((m) => m.id === mandateId) ?? null;
  const pending = proposals.filter((p) => p.status === 'pending_human').length;

  async function connect() {
    if (!mandate) return;
    setConnecting(true);
    try {
      const { approveUrl } = await api.connect(mandate.id);
      const href = safeHref(approveUrl);
      if (href) window.location.assign(href);
      else setToast('Could not start PayPal connection');
    } catch {
      setToast('Could not start PayPal connection');
    } finally {
      setConnecting(false);
    }
  }

  const creating = mandates !== null && mandates.length === 0;
  const activeTab: Tab = creating ? 'rules' : tab;

  return (
    <div className="shell">
      <Sidebar
        tab={activeTab}
        onTab={setTab}
        pending={pending}
        mandates={mandates ?? []}
        mandateId={mandateId}
        onMandate={(id) => { setProposals([]); setMandateId(id); }}
        onLogout={onLogout}
      />
      <div className="main">
        <header className="topbar">
          <h1 className="topbar__title">{activeTab[0].toUpperCase() + activeTab.slice(1)}</h1>
          <span className="live" title={connected ? 'Receiving live updates' : 'Not connected to live updates'}>
            <span className={`dot ${connected ? 'dot--on' : ''}`} aria-hidden="true" />
            {connected ? 'Live' : 'Offline'}
          </span>
        </header>
        {loadError && <p role="alert" className="notice">Could not load your spending rules. Check the gateway and refresh.</p>}
        {mandate && <BudgetCard mandate={mandate} proposals={proposals} onConnect={connect} connecting={connecting} />}
        <main className="content">
          {mandateId && (
            <div hidden={activeTab !== 'chat'}>
              <Chat
                key={mandateId}
                mandateId={mandateId}
                liveProposals={proposals}
                onProposalsChanged={() => { void loadProposals(); }}
                onReviewApprovals={() => setTab('approvals')}
              />
            </div>
          )}
          {activeTab === 'approvals' && <Approvals proposals={proposals} onChanged={() => { void loadProposals(); }} onToast={setToast} />}
          {activeTab === 'ledger' && mandateId && <Ledger key={mandateId} mandateId={mandateId} proposals={proposals} onChanged={() => { void loadProposals(); }} onToast={setToast} />}
          {activeTab === 'rules' && <Rules
              key={creating ? 'new' : mandate?.id ?? 'none'}
              mandate={mandate}
              creating={creating}
              onSaved={(m, kind) => {
                setToast(kind === 'created' ? 'Spending rules created' : 'Rules saved');
                if (kind === 'created') setMandateId(m.id);
                void loadMandates();
              }}
              onConnect={connect}
              connecting={connecting}
            />}
        </main>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export default function App() {
  const [gate, setGate] = useState<Gate>('loading');

  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const expire = useCallback(() => { setNotice(SESSION_EXPIRED); setGate('login'); }, []);
  useEffect(() => {
    setUnauthorizedHandler(expire);
    return () => setUnauthorizedHandler(null);
  }, [expire]);

  useEffect(() => {
    let live = true;
    api.session().then(
      (ok) => { if (live) setGate(ok ? 'app' : 'login'); },
      () => { if (live) setGate('unreachable'); },
    );
    return () => { live = false; };
  }, [attempt]);

  function retry() {
    setGate('loading');
    setAttempt((n) => n + 1);
  }

  async function logout() {
    try { await api.logout(); } catch { /* cookie may already be gone */ }
    setNotice(null);
    setGate('login');
  }

  if (gate === 'loading') return <div className="boot" role="status" aria-label="Loading" />;
  if (gate === 'unreachable') {
    return (
      <main className="login">
        <div className="login__card" role="alert">
          <h1 className="login__brand">Leash</h1>
          <p className="login__tag">Can't reach the Leash server</p>
          <button type="button" className="btn btn--primary" onClick={retry}>Retry</button>
        </div>
      </main>
    );
  }
  if (gate === 'login') return <Login notice={notice} onSuccess={() => { setNotice(null); setGate('app'); }} />;
  return <Shell onLogout={logout} onUnauthorized={expire} />;
}
