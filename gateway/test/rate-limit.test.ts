import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http';
import { EventBus } from '../src/events';
import { Leash } from '../src/leash';
import { Store } from '../src/store';
import { FakePayPal } from './fakes';

function setup() {
  const store = new Store();
  const m = store.createMandate({ goal: 'g', currency: 'USD', perOrderCapCents: 6000, monthlyBudgetCents: 15000, allowedCategories: [], allowedMerchants: null, blockedMerchants: [], maxOrdersPerDay: 5, reviewThreshold: 0.8 });
  const events = new EventBus();
  const leash = new Leash({ store, paypal: new FakePayPal(), intent: async () => ({ score: 0.95, reason: 'ok' }), onEvent: (e) => events.publish(e) });
  const app = createApp({
    leash, store, events,
    vault: { createSetupToken: async () => ({ id: 'ST', approveUrl: 'u' }), createPaymentToken: async () => ({ vaultId: 'V' }) },
    keys: { agent: 'agent-key', owner: 'owner-key' }, publicUrl: 'http://gw',
    session: { passcode: 'demo-pass', secret: 's'.repeat(32), failureDelayMs: 0 },
    scout: async () => ({ text: 'x', products: [], proposals: [] }),
    rateLimits: { session: { max: 2, windowMs: 60_000 }, scoutChat: { max: 2, windowMs: 60_000 } },
  });
  return { app, mandateId: m.id };
}

const json = { 'content-type': 'application/json' };

describe('rate limiting', () => {
  it('limits POST /api/session per client IP', async () => {
    const { app } = setup();
    const login = (ip: string) =>
      app.request('/api/session', { method: 'POST', headers: { ...json, 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify({ passcode: 'wrong' }) });
    expect((await login('1.1.1.1')).status).toBe(401);
    expect((await login('1.1.1.1')).status).toBe(401);
    const res = await login('1.1.1.1');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await login('2.2.2.2')).status).toBe(401);
  });

  it('limits POST /api/scout/chat per client IP', async () => {
    const { app, mandateId } = setup();
    const chat = (ip: string) =>
      app.request('/api/scout/chat', {
        method: 'POST',
        headers: { ...json, authorization: 'Bearer owner-key', 'x-forwarded-for': ip },
        body: JSON.stringify({ mandateId, conversationId: 'c', messages: [{ role: 'user', content: 'hi' }] }),
      });
    expect((await chat('1.1.1.1')).status).toBe(200);
    expect((await chat('1.1.1.1')).status).toBe(200);
    const res = await chat('1.1.1.1');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect((await chat('2.2.2.2')).status).toBe(200);
  });

  it('does not count unauthenticated scout calls against the limit', async () => {
    const { app } = setup();
    for (let i = 0; i < 4; i++) {
      const r = await app.request('/api/scout/chat', { method: 'POST', headers: { ...json, 'x-forwarded-for': '3.3.3.3' }, body: '{}' });
      expect(r.status).toBe(401);
    }
  });
});
