import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http';
import { EventBus } from '../src/events';
import { Leash } from '../src/leash';
import { Store } from '../src/store';
import { GatewayClient, GatewayError } from '../src/scout/gateway-client';
import { FakePayPal, mandate, proposal } from './fakes';

function setup(agentKey = 'agent-key') {
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
  const client = new GatewayClient({ baseUrl: 'http://gw', agentKey, fetch: ((url, init) => app.request(String(url).replace('http://gw', ''), init)) as typeof fetch });
  return { client, m };
}

/** Client whose fetch is a stub; the gateway app is not involved. */
function stubClient(stub: (url: string, init?: RequestInit) => Promise<Response>, timeoutMs?: number) {
  return new GatewayClient({ baseUrl: 'http://gw', agentKey: 'agent-key', timeoutMs, fetch: stub as unknown as typeof fetch });
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
  it('creates two proposals when idempotency keys differ', async () => {
    const { client, m } = setup();
    const a = await client.propose(m.id, proposal(), 'k1');
    const b = await client.propose(m.id, proposal(), 'k2');
    expect(b.id).not.toBe(a.id);
    expect((await client.listProposals(m.id)).map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
  });
  it('surfaces gateway errors with status', async () => {
    const { client } = setup();
    await expect(client.getMandate('nope')).rejects.toMatchObject({ status: 404 });
    await expect(client.getMandate('nope')).rejects.toBeInstanceOf(GatewayError);
  });
  it('rejects a wrong agent key with 401', async () => {
    const { client, m } = setup('wrong-key');
    await expect(client.getMandate(m.id)).rejects.toMatchObject({ status: 401 });
    await expect(client.getMandate(m.id)).rejects.toBeInstanceOf(GatewayError);
  });

  // Fix 1: timeout
  it('aborts a hung request after timeoutMs with GatewayError status 0', async () => {
    const hangUntilAborted = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    const client = stubClient(hangUntilAborted, 30);
    const err = await client.getMandate('m1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err).toMatchObject({ status: 0 });
    expect((err as Error).message).toMatch(/^gateway unreachable: /);
  });

  // Fix 2: network errors
  it('wraps a thrown fetch error as GatewayError status 0', async () => {
    const client = stubClient(async () => { throw new TypeError('fetch failed'); });
    await expect(client.getMandate('m1')).rejects.toMatchObject({
      status: 0,
      message: 'gateway unreachable: fetch failed',
    });
    await expect(client.getMandate('m1')).rejects.toBeInstanceOf(GatewayError);
  });

  // Fix 3: empty error body
  it('falls back to HTTP <status> when an error body is empty', async () => {
    const client = stubClient(async () => new Response('', { status: 502 }));
    await expect(client.getMandate('m1')).rejects.toMatchObject({ status: 502, message: 'HTTP 502' });
  });

  // Fix 4: 2xx with empty or non-JSON body
  it('throws invalid JSON for a 2xx with an empty body', async () => {
    const client = stubClient(async () => new Response('', { status: 200 }));
    await expect(client.getMandate('m1')).rejects.toMatchObject({ status: 200, message: 'invalid JSON from gateway' });
  });
  it('throws invalid JSON for a 2xx with a non-JSON body', async () => {
    const client = stubClient(async () => new Response('<html>oops</html>', { status: 200 }));
    await expect(client.getMandate('m1')).rejects.toMatchObject({ status: 200, message: 'invalid JSON from gateway' });
  });

  // Fix 5: default fetch is bound to globalThis
  it('uses the global fetch with globalThis as receiver when no fetch is injected', async () => {
    globalThis.fetch = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify({ id: 'm1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    } as typeof fetch;
    const client = new GatewayClient({ baseUrl: 'http://gw', agentKey: 'agent-key' });
    await expect(client.getMandate('m1')).resolves.toEqual({ id: 'm1' });
  });
});
