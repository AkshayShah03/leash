import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/http';
import { EventBus } from '../src/events';
import { Leash } from '../src/leash';
import { Store } from '../src/store';
import type { ScoutTurnResult } from '../src/scout/agent';
import { FakePayPal } from './fakes';

function setup(scout: (args: any) => Promise<ScoutTurnResult>) {
  const store = new Store();
  const events = new EventBus();
  const leash = new Leash({ store, paypal: new FakePayPal(), intent: async () => ({ score: 0.95, reason: 'ok' }), onEvent: (e) => events.publish(e) });
  return createApp({
    leash, store, events,
    vault: { createSetupToken: async () => ({ id: 'ST', approveUrl: 'u' }), createPaymentToken: async () => ({ vaultId: 'V' }) },
    keys: { agent: 'agent-key', owner: 'owner-key' }, publicUrl: 'http://gw',
    session: { passcode: 'demo-pass', secret: 's'.repeat(32) },
    scout,
  });
}

const body = { mandateId: 'm-1', conversationId: 'c-1', messages: [{ role: 'user', content: 'keyboard please' }] };
const post = (app: ReturnType<typeof setup>, key: string | null, b: unknown) =>
  app.request('/api/scout/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(b),
  });

describe('POST /api/scout/chat', () => {
  it('rejects unauthenticated and agent callers, accepts owner', async () => {
    const stub = vi.fn(async (_a: unknown) => ({ text: 'Found it', products: [], proposals: [] }));
    const app = setup(stub);
    expect((await post(app, null, body)).status).toBe(401);
    expect((await post(app, 'agent-key', body)).status).toBe(403);
    expect(stub).not.toHaveBeenCalled();
    const res = await post(app, 'owner-key', body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: 'Found it' });
    expect(stub).toHaveBeenCalledWith(body);
  });
  it('requires CSRF header for cookie sessions', async () => {
    const app = setup(async () => ({ text: 'x', products: [], proposals: [] }));
    const login = await app.request('/api/session', { method: 'POST', body: JSON.stringify({ passcode: 'demo-pass' }), headers: { 'content-type': 'application/json' } });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const h = { 'content-type': 'application/json', cookie };
    expect((await app.request('/api/scout/chat', { method: 'POST', headers: h, body: JSON.stringify(body) })).status).toBe(403);
    expect((await app.request('/api/scout/chat', { method: 'POST', headers: { ...h, 'x-leash-csrf': '1' }, body: JSON.stringify(body) })).status).toBe(200);
  });
  it('400 on invalid body', async () => {
    const app = setup(async () => ({ text: 'x', products: [], proposals: [] }));
    expect((await post(app, 'owner-key', { mandateId: 'm-1', conversationId: 'c-1' })).status).toBe(400);
    expect((await post(app, 'owner-key', { ...body, messages: [] })).status).toBe(400);
  });
  it('502 scout_unavailable when the turn throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = setup(async () => { throw new Error('provider down'); });
    const res = await post(app, 'owner-key', body);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'scout_unavailable' });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
