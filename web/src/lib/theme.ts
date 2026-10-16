import { useSyncExternalStore } from 'react';

export function readIsDark(): boolean {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function subscribe(cb: () => void): () => void {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  mq?.addEventListener?.('change', cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    mq?.removeEventListener?.('change', cb);
    mo.disconnect();
  };
}

/** True when the app renders dark: explicit data-theme wins, else the OS preference. Updates live. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, readIsDark, () => false);
}
