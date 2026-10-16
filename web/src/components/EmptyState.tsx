import type { ReactNode } from 'react';

export default function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon" aria-hidden="true">{icon}</div>}
      <h2 className="empty__title">{title}</h2>
      {children && <p className="empty__body">{children}</p>}
    </div>
  );
}
