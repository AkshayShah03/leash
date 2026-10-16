import { describe, expect, it } from 'vitest';
import { SESSION_TTL_MS } from '../src/session';
import { createApp } from '../src/http';
import { EventBus } from '../src/events';
import { Leash } from '../src/leash';
import { Store } from '../src/store';
import type { VaultApi } from '../src/paypal/api';
import { FakePayPal, proposal } from './fakes';

const AGENT = 'Bearer agent-key';
const OWNER = 'Bearer owner-key';

function setup(failureDelayMs = 0) {
  const store = new Store();
  const paypal = new FakePayPal();
  const bus = new EventBus();
  const leash = new Leash({ store, paypal, intent: async () => ({ score: 0.95, reason: 'ok' }), onEvent: (e) => bus.publish(e) });
  const vault: VaultApi = {
    createSetupToken: async (a) => ({ id: 'ST-1', approveUrl: `https://pp/approve?return=${encodeURIComponent(a.returnUrl)}` }),
    createPaymentToken: async (id) => ({ vaultId: `VAULT-for-${id}` }),
  };
  const app = createApp({ leash, store, vault, events: bus, keys: { agent: 'agent-key', owner: 'owner-key' }, publicUrl: 'https://leash.test', session: { passcode: 'demo-pass', secret: 's'.repeat(32), failureDelayMs } });
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

  it.each(['javascript:alert(1)', 'data:text/html,x'])('rejects non-http(s) productUrl %s with 400', async (productUrl) => {
    const s = setup();
    const m = await connectedMandate(s);
    const res = await s.call('POST', `/api/mandates/${m.id}/proposals`, AGENT, { ...proposal(), productUrl });
    expect(res.status).toBe(400);
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

  it('returns 400 invalid_json for a malformed JSON body', async () => {
    const s = setup();
    const res = await s.app.request('/api/mandates', {
      method: 'POST',
      headers: { authorization: OWNER, 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('lists and fetches proposals; replays idempotent proposals with 200', async () => {
    const s = setup();
    const m = await connectedMandate(s);
    const post = (key?: string) =>
      s.app.request(`/api/mandates/${m.id}/proposals`, {
        method: 'POST',
        headers: { authorization: AGENT, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
        body: JSON.stringify(proposal()),
      });
    const first = await post('idem-1');
    expect(first.status).toBe(201);
    const p = (await first.json()) as { id: string };
    const again = await post('idem-1');
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(p.id);
    const list = (await (await s.call('GET', `/api/proposals?mandate=${m.id}`, AGENT)).json()) as Array<{ id: string }>;
    expect(list.map((x) => x.id)).toEqual([p.id]);
    expect((await s.call('GET', `/api/proposals/${p.id}`, AGENT)).status).toBe(200);
    expect((await s.call('GET', '/api/proposals/nope', AGENT)).status).toBe(404);
    expect((await s.call('GET', '/api/proposals', AGENT)).status).toBe(400);
  });
});

describe('SSE', () => {
  it('streams ledger events over SSE', { timeout: 5000 }, async () => {
    const s = setup();
    const m = await connectedMandate(s);
    const res = await s.app.request(`/api/events?mandate=${m.id}`, { headers: { authorization: AGENT } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); }
    };
    try {
      await readUntil('event: ready');
      await s.call('POST', `/api/mandates/${m.id}/proposals`, AGENT, proposal());
      await readUntil('"status":"tracked"');
      expect(text).toContain('event: ledger');
    } finally {
      await reader.cancel();
    }
  });

  it('requires the mandate query parameter and auth', async () => {
    const s = setup();
    expect((await s.call('GET', '/api/events', AGENT)).status).toBe(400);
    expect((await s.call('GET', '/api/events?mandate=x')).status).toBe(401);
  });
});

describe('owner session', () => {
  it('logs in with the passcode and acts as owner with the CSRF header', async () => {
    const s = setup();
    const bad = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'nope' }) });
    expect(bad.status).toBe(401);
    const ok = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'demo-pass' }) });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    const jar = cookie.split(';')[0];
    const create = (extra: Record<string, string>) =>
      s.app.request('/api/mandates', { method: 'POST', headers: { cookie: jar, 'content-type': 'application/json', ...extra }, body: JSON.stringify(mandateBody) });
    expect((await create({})).status).toBe(403);
    expect((await create({ 'x-leash-csrf': '1' })).status).toBe(201);
    const read = await s.app.request('/api/ledger', { headers: { cookie: jar } });
    expect(read.status).toBe(200);
  });
  it('requires the CSRF header on cookie-authenticated proposals too', async () => {
    const s = setup();
    const m = await connectedMandate(s);
    const ok = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'demo-pass' }) });
    const jar = ok.headers.get('set-cookie')!.split(';')[0];
    const post = (extra: Record<string, string>) =>
      s.app.request(`/api/mandates/${m.id}/proposals`, { method: 'POST', headers: { cookie: jar, 'content-type': 'application/json', ...extra }, body: JSON.stringify(proposal()) });
    expect((await post({})).status).toBe(403);
    expect((await post({ 'x-leash-csrf': '1' })).status).toBe(201);
  });
  it('delays a wrong passcode by failureDelayMs', async () => {
    const s = setup(50);
    const t0 = Date.now();
    const bad = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'nope' }) });
    expect(bad.status).toBe(401);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
  });
  it('derives cookie Max-Age from SESSION_TTL_MS', async () => {
    const s = setup();
    const ok = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'demo-pass' }) });
    expect(ok.headers.get('set-cookie')).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
  });
  it('a wrong bearer key is rejected even with a valid cookie', async () => {
    const s = setup();
    const ok = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'demo-pass' }) });
    const jar = ok.headers.get('set-cookie')!.split(';')[0];
    const res = await s.app.request('/api/ledger', { headers: { cookie: jar, authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
  });
  it('bearer owner needs no CSRF header; DELETE clears the cookie', async () => {
    const s = setup();
    expect((await s.call('POST', '/api/mandates', OWNER, mandateBody)).status).toBe(201);
    const res = await s.app.request('/api/session', { method: 'DELETE' });
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
