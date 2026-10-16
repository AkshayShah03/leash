import { MessageSquare, ShieldCheck, ReceiptText, SlidersHorizontal, LogOut } from 'lucide-react';
import type { ComponentType } from 'react';
import type { PublicMandate } from '../lib/types';

export type Tab = 'chat' | 'approvals' | 'ledger' | 'rules';

const ITEMS: { tab: Tab; label: string; Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }[] = [
  { tab: 'chat', label: 'Chat', Icon: MessageSquare },
  { tab: 'approvals', label: 'Approvals', Icon: ShieldCheck },
  { tab: 'ledger', label: 'Ledger', Icon: ReceiptText },
  { tab: 'rules', label: 'Rules', Icon: SlidersHorizontal },
];

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  pending: number;
  mandates: PublicMandate[];
  mandateId: string | null;
  onMandate: (id: string) => void;
  onLogout: () => void;
}

export default function Sidebar({ tab, onTab, pending, mandates, mandateId, onMandate, onLogout }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">Leash</div>
      <nav className="sidebar__nav" aria-label="Main">
        {ITEMS.map(({ tab: t, label, Icon }) => (
          <button
            key={t}
            type="button"
            className={`nav-item ${tab === t ? 'nav-item--active' : ''}`}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => onTab(t)}
          >
            <Icon size={18} aria-hidden />
            <span>{label}</span>
            {t === 'approvals' && pending > 0 && (
              <span className="badge" aria-label={`${pending} pending`}>{pending}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar__foot">
        {mandates.length > 1 && (
          <select
            className="sidebar__select"
            aria-label="Spending rules"
            value={mandateId ?? ''}
            onChange={(e) => onMandate(e.target.value)}
          >
            {mandates.map((m) => (
              <option key={m.id} value={m.id}>{m.goal}</option>
            ))}
          </select>
        )}
        <span className="pill">Sandbox mode</span>
        <button type="button" className="nav-item nav-item--quiet" onClick={onLogout}>
          <LogOut size={18} aria-hidden />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}
