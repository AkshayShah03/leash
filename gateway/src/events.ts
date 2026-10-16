import type { LedgerEvent } from './types';

export class EventBus {
  private subs = new Map<string, Set<(e: LedgerEvent) => void>>();

  publish(e: LedgerEvent): void {
    for (const fn of this.subs.get(e.mandateId) ?? []) {
      try { fn(e); } catch (err) { console.error('event listener failed', err); }
    }
  }

  subscribe(mandateId: string, fn: (e: LedgerEvent) => void): () => void {
    const set = this.subs.get(mandateId) ?? new Set();
    set.add(fn);
    this.subs.set(mandateId, set);
    return () => { set.delete(fn); if (set.size === 0) this.subs.delete(mandateId); };
  }
}
