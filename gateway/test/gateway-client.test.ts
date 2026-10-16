import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http';
import { EventBus } from '../src/events';
import { Leash } from '../src/leash';
import { Store } from '../src/store';
import { GatewayClient, GatewayError } from '../src/scout/gateway-client';
import { FakePayPal, mandate, proposal } from './fakes';

function setup() {
  const store = new Store();
  const events = new EventBus();
  const leash = new Leash({ store, paypal: new FakePayPal(), intent: async () => ({ score: 0.95, reason: 'ok' }), onEvent: (e) => events.publish(e) });
  const app = createApp({
    leash, store, events,
    vault: { createSetupToken: async () => ({ id: 'ST', approveUrl: 'u' }), createPaymentToken: async () => ({ vaultId: 'V' }) },
    keys: { agent: 'agent-key', owner: 'owner-key' }, publicUrl: 'http://gw',
    session: { passcode: 'demo-pass', secret: 's'.repeat(32) },
  });
  const { id: _i, vaultId: _v, setupTokenId: _s, ...input } = mandate();
  const m = store.updateMandate(store.createMandate(input).id, { vaultId: 'V' });
  const client = new GatewayClient({ baseUrl: 'http://gw', agentKey: 'agent-key', fetch: ((url, init) => app.request(String(url).replace('http://gw', ''), init)) as typeof fetch });
  return { client, m };
}

describe('GatewayClient', () => {
  it('reads the public mandate (no vault fields)', async () => {
    const { client, m } = setup();
    const pm = await client.getMandate(m.id);
    expect(pm).toMatchObject({ id: m.id, connected: true });
    expect(pm).not.toHaveProperty('vaultId');
  });
  it('proposes idempotently and lists', async () => {
    const { client, m } = setup();
    const a = await client.propose(m.id, proposal(), 'k1');
    const b = await client.propose(m.id, proposal(), 'k1');
    expect(b.id).toBe(a.id);
    expect((await client.listProposals(m.id)).map((p) => p.id)).toEqual([a.id]);
  });
  it('surfaces gateway errors with status', async () => {
    const { client } = setup();
    await expect(client.getMandate('nope')).rejects.toMatchObject({ status: 404 });
    await expect(client.getMandate('nope')).rejects.toBeInstanceOf(GatewayError);
  });
});
