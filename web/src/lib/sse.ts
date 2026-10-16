import { useEffect, useRef, useState } from 'react';

/** Subscribes to the gateway SSE stream; calls onEvent on `ready` and every `ledger` event. */
export function useLedgerEvents(mandateId: string | null, onEvent: () => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  useEffect(() => { cb.current = onEvent; });

  useEffect(() => {
    if (!mandateId || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events?mandate=' + encodeURIComponent(mandateId));
    const fire = () => cb.current();
    const onReady = () => { setConnected(true); fire(); };
    es.addEventListener('ready', onReady);
    es.addEventListener('ledger', fire);
    es.onerror = () => setConnected(false);
    return () => {
      es.removeEventListener('ready', onReady);
      es.removeEventListener('ledger', fire);
      es.close();
      setConnected(false);
    };
  }, [mandateId]);

  return { connected };
}
