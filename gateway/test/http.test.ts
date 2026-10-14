import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http';
import { Leash } from '../src/leash';
import { Store } from '../src/store';
import type { VaultApi } from '../src/paypal/api';
import { FakePayPal, proposal } from './fakes';

const AGENT = 'Bearer agent-key';
const OWNER = 'Bearer owner-key';

function setup() {
  const store = new Store();
  const paypal = new FakePayPal();
  const leash = new Leash({ store, paypal, intent: async () => ({ score: 0.95, reason: 'ok' }) });
  const vault: VaultApi = {
    createSetupToken: async (a) => ({ id: 'ST-1', approveUrl: `https://pp/approve?return=${encodeURIComponent(a.returnUrl)}` }),
    createPaymentToken: async (id) => ({ vaultId: `VAULT-for-${id}` }),
  };
  const app = createApp({ leash, store, vault, keys: { agent: 'agent-key', owner: 'owner-key' }, publicUrl: 'https://leash.test' });
  // TS 7's lib types Response.json() as Promise<unknown>; the tests read arbitrary JSON bodies.
  type Res = Omit<Response, 'json'> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const call = (method: string, path: string, auth?: string, body?: unknown): Promise<Res> | Res =>
    app.request(path, {
      method,
      headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, store, call };
}

const mandateBody = {
  goal: 'Keep my home office stocked',
  perOrderCapCents: 6000,
  monthlyBudgetCents: 15000,
  allowedCategories: ['office supplies', 'computer peripherals'],
};

async function connectedMandate(s: ReturnType<typeof setup>) {
  const m = await (await s.call('POST', '/api/mandates', OWNER, mandateBody)).json();
  await s.call('POST', `/api/mandates/${m.id}/connect`, OWNER);
  await s.call('GET', `/paypal/return?mandate=${m.id}`);
  return m as { id: string };
}

describe('HTTP API', () => {
  it('rejects missing or unknown keys', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/ledger')).status).toBe(401);
    expect((await call('GET', '/api/ledger', 'Bearer wrong')).status).toBe(401);
  });

  it('owner creates a mandate with defaults; nobody sees vault fields', async () => {
    const { call } = setup();
    const res = await call('POST', '/api/mandates', OWNER, mandateBody);
    expect(res.status).toBe(201);
    const m = await res.json();
    expect(m).toMatchObject({ ...mandateBody, currency: 'USD', maxOrdersPerDay: 5, reviewThreshold: 0.8, connected: false });
    expect(m).not.toHaveProperty('vaultId');
    expect(m).not.toHaveProperty('setupTokenId');
    const asAgent = await (await call('GET', `/api/mandates/${m.id}`, AGENT)).json();
    expect(asAgent).not.toHaveProperty('vaultId');
  });

  it('validates request bodies', async () => {
    const { call } = setup();
    const res = await call('POST', '/api/mandates', OWNER, { ...mandateBody, perOrderCapCents: 12.5 });
    expect(res.status).toBe(400);
  });

  it('agent cannot create mandates, connect PayPal, approve, deny or refund', async () => {
    const s = setup();
    const m = await connectedMandate(s);
    expect((await s.call('POST', '/api/mandates', AGENT, mandateBody)).status).toBe(403);
    expect((await s.call('POST', `/api/mandates/${m.id}/connect`, AGENT)).status).toBe(403);
    for (const action of ['approve', 'deny', 'refund']) {
      expect((await s.call('POST', `/api/proposals/any/${action}`, AGENT)).status).toBe(403);
    }
  });

  it('connect flow stores the vault id from the PayPal return', async () => {
    const s = setup();
    const m = await (await s.call('POST', '/api/mandates', OWNER, mandateBody)).json();
    const { approveUrl } = await (await s.call('POST', `/api/mandates/${m.id}/connect`, OWNER)).json();
    expect(approveUrl).toContain(encodeURIComponent(`https://leash.test/paypal/return?mandate=${m.id}`));
    const ret = await s.call('GET', `/paypal/return?mandate=${m.id}`);
    expect(ret.status).toBe(200);
    expect(await ret.text()).toContain('PayPal connected');
    expect(s.store.getMandate(m.id)).toMatchObject({ vaultId: 'VAULT-for-ST-1', setupTokenId: null });
    expect((await (await s.call('GET', `/api/mandates/${m.id}`, AGENT)).json()).connected).toBe(true);
  });

  it('PayPal return without a pending setup token is rejected', async () => {
    const s = setup();
    const m = await (await s.call('POST', '/api/mandates', OWNER, mandateBody)).json();
    expect((await s.call('GET', `/paypal/return?mandate=${m.id}`)).status).toBe(409);
  });

  it('agent proposes; owner refunds; ledger is visible to both', async () => {
    const s = setup();
    const m = await connectedMandate(s);
    const res = await s.call('POST', `/api/mandates/${m.id}/proposals`, AGENT, proposal());
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p.status).toBe('tracked');
    const refunded = await (await s.call('POST', `/api/proposals/${p.id}/refund`, OWNER)).json();
    expect(refunded.status).toBe('refunded');
    const ledger = await (await s.call('GET', `/api/ledger?mandate=${m.id}`, AGENT)).json();
    expect(ledger.map((e: { status: string }) => e.status)).toEqual(['proposed', 'auto_approved', 'captured', 'tracked', 'refunded']);
  });

  it('maps service errors to 404 / 409', async () => {
    const s = setup();
    const m = await connectedMandate(s);
    expect((await s.call('POST', '/api/proposals/nope/approve', OWNER)).status).toBe(404);
    const p = await (await s.call('POST', `/api/mandates/${m.id}/proposals`, AGENT, proposal())).json();
    expect((await s.call('POST', `/api/proposals/${p.id}/approve`, OWNER)).status).toBe(409);
    expect((await s.call('POST', '/api/mandates/nope/proposals', AGENT, proposal())).status).toBe(404);
  });
});
