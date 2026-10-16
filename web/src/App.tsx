import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
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

function Shell({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('chat');
  const [mandates, setMandates] = useState<PublicMandate[] | null>(null);
  const [mandateId, setMandateId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadMandates = useCallback(async () => {
    try {
      const list = await api.listMandates();
      setMandates(list);
      setLoadError(false);
      setMandateId((cur) => (cur && list.some((m) => m.id === cur) ? cur : list.length ? list[list.length - 1].id : null));
      if (list.length === 0) setTab('rules');
    } catch {
      setLoadError(true);
    }
  }, []);

  const loadProposals = useCallback(async () => {
    if (!mandateId) return;
    try {
      setProposals(await api.listProposals(mandateId));
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

  const onEvent = useCallback(() => {
    void loadProposals();
    void loadMandates();
  }, [loadProposals, loadMandates]);
  const { connected } = useLedgerEvents(mandateId, onEvent);

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
        onMandate={setMandateId}
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
        {loadError && <p role="alert" className="notice">Could not load your mandates. Check the gateway and refresh.</p>}
        {mandate && <BudgetCard mandate={mandate} proposals={proposals} onConnect={connect} connecting={connecting} />}
        <main className="content">
          {activeTab === 'chat' && <Chat />}
          {activeTab === 'approvals' && <Approvals />}
          {activeTab === 'ledger' && <Ledger />}
          {activeTab === 'rules' && <Rules
              key={creating ? 'new' : mandate?.id ?? 'none'}
              mandate={mandate}
              creating={creating}
              onSaved={(m, kind) => {
                setToast(kind === 'created' ? 'Mandate created' : 'Rules saved');
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
  if (gate === 'login') return <Login onSuccess={() => setGate('app')} />;
  return <Shell onLogout={logout} />;
}
