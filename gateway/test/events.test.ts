import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/events';
const ev = (mandateId: string, seq = 1) => ({ seq, proposalId: 'p', mandateId, status: 'proposed' as const, actor: 'agent' as const, detail: 'd', at: 't' });

describe('EventBus', () => {
  it('delivers only to subscribers of the same mandate and supports unsubscribe', () => {
    const bus = new EventBus();
    const a = vi.fn(); const b = vi.fn();
    const unA = bus.subscribe('m1', a); bus.subscribe('m2', b);
    bus.publish(ev('m1'));
    expect(a).toHaveBeenCalledTimes(1); expect(b).not.toHaveBeenCalled();
    unA(); bus.publish(ev('m1', 2));
    expect(a).toHaveBeenCalledTimes(1);
  });
  it('isolates a throwing listener', () => {
    const bus = new EventBus();
    const ok = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.subscribe('m1', () => { throw new Error('boom'); }); bus.subscribe('m1', ok);
    expect(() => bus.publish(ev('m1'))).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });
  it('unsubscribe is idempotent and never evicts a newer subscriber', () => {
    const bus = new EventBus();
    const a = vi.fn(); const b = vi.fn();
    const unA = bus.subscribe('m1', a);
    unA();
    bus.subscribe('m1', b);
    unA();
    bus.publish(ev('m1'));
    expect(b).toHaveBeenCalledTimes(1);
  });
});
