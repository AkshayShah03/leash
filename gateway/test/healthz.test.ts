import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http';
import { EventBus } from '../src/events';
import { Leash } from '../src/leash';
import { Store } from '../src/store';
import { FakePayPal } from './fakes';

describe('GET /healthz', () => {
  it('returns 200 {ok:true} without auth and leaks nothing', async () => {
    const store = new Store();
    const bus = new EventBus();
    const leash = new Leash({ store, paypal: new FakePayPal(), intent: async () => ({ score: 1, reason: 'ok' }), onEvent: (e) => bus.publish(e) });
    const vault = { createSetupToken: async () => ({ id: 'x', approveUrl: 'x' }), createPaymentToken: async () => ({ vaultId: 'x' }) };
    const app = createApp({ leash, store, vault, events: bus, keys: { agent: 'agent-key', owner: 'owner-key' }, publicUrl: 'https://leash.test', session: { passcode: 'demo-pass', secret: 's'.repeat(32) } });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
  });
});
