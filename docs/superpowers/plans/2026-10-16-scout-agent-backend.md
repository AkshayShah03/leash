# Scout Agent + Gateway Prereqs Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scout, a shopping agent that searches real products (Channel3) and buys through Leash using only the agent key, plus the gateway features the web UI needs (proposal reads, idempotent proposals, live events, owner browser session).

**Architecture:** Everything stays in the single `gateway/` Node service. New gateway endpoints are added to `src/http.ts`. Scout lives in `src/scout/`: a Channel3 client, an HTTP `GatewayClient` that holds only the agent key, tools whose purchase fields are filled **server-side from Channel3 data** (never from LLM output), and a tool-calling loop on the OpenRouter open model. Scout's chat endpoint is mounted on the same Hono app but talks to the gateway over HTTP (loopback) with the agent key, so the trust boundary is real. Plan 3 adds the React/AG Grid UI served by this service.

**Tech Stack:** existing (Node ≥22.13, TS 7, Vitest 4, Hono 4 + @hono/node-server 2, zod 4, ai@7, @openrouter/ai-sdk-provider 3). `hono/streaming` for SSE. `ai/test` `MockLanguageModelV4` only if a task asks for it.

**Spec:** `docs/superpowers/specs/2026-10-13-leash-design.md` (§3.7 Scout, §3.8 UI, §5 honesty)

## Global Constraints

- Agent-reported fields are untrusted. Scout's `propose_purchase` tool accepts only `productId` and `merchantDomain`; title, description, category, merchant, price and URL are filled from Channel3 data server-side; `userRequest` is the user's latest chat message, never LLM text.
- The agent key can only propose and read. Owner actions require the owner key **or** a valid owner session cookie. The browser never receives either key.
- Money is integer cents. Channel3 prices are decimal (`offer.price.price`, e.g. `59.99`) → convert once with `Math.round(x * 100)`.
- Every new mutating endpoint is idempotent where retries are plausible (`Idempotency-Key` on proposals).
- Channel3 base URL `https://api.trychannel3.com/v1`, auth header `x-api-key`, search `POST /search` body `{ query, limit, filters: { price: { max_price } } }`, detail `GET /products/{id}`. Response: `products[]` with `id, title, description, brands[{name}], images[{url, cleaned_url, is_main_image}], category{slug,title,path[{slug,title}]}, key_features[], offers[{url, domain, price{price, currency}, availability, condition}]`.
- Default model `LEASH_MODEL` (moonshotai/kimi-k3) via OpenRouter; Scout uses the same model id unless `SCOUT_MODEL` is set.
- PayPal sandbox only; purchases are paid to the project's sandbox merchant at the Channel3 listed price (spec §5).
- All commands run from `gateway/` unless stated otherwise. Existing tests must stay green.

## File Structure

```
gateway/src/
  types.ts            + ProposalInput.categoryPath?: string[]
  policy.ts           category check also matches categoryPath entries
  store.ts            + idempotency_key column, listProposals(), findByIdempotencyKey()
  leash.ts            propose(mandateId, input, opts?: { idempotencyKey?: string })
  events.ts   (new)   EventBus: publish(LedgerEvent), subscribe(mandateId, fn) → unsubscribe
  session.ts  (new)   signSession / verifySession (HMAC cookie), SESSION_COOKIE
  http.ts             + GET /api/proposals, GET /api/proposals/:id, Idempotency-Key,
                        GET /api/events (SSE), POST/DELETE /api/session, cookie → owner,
                        POST /api/scout/chat (mounted from scout)
  server.ts           wires EventBus, session secret, Scout
  scout/
    channel3.ts  (new) Channel3Client.search / .getProduct → ProductSummary
    gateway-client.ts (new) GatewayClient (agent key): getMandate, propose, listProposals
    tools.ts     (new) makeScoutTools(ctx) → { search_products, propose_purchase, check_budget }
    agent.ts     (new) runScoutTurn(deps, { mandateId, conversationId, messages })
gateway/scripts/smoke-scout.ts (new)  live: real Kimi + Channel3 + PayPal through HTTP
gateway/test/  category-path, proposals-read, events, session, channel3, gateway-client, scout-tools, scout-chat tests
```

---

### Task 1: Category path matching

**Why:** Channel3 categories are trees (`Electronics › … › Input Devices › Keyboards`). A mandate allowing "Input Devices" or "Electronics" must accept a keyboard.

**Files:** Modify `src/types.ts`, `src/policy.ts`, `src/http.ts` (proposalInputSchema). Test: `test/policy.test.ts` (append).

**Interfaces:** Produces `ProposalInput.categoryPath?: string[]` (titles or slugs of ancestors, root first). Policy passes the category rule if `category` **or any `categoryPath` entry** matches an allowed category (same `norm`: trim + lowercase). Additionally treat `-` and `_` as spaces when comparing, so slug `input-devices` matches title `Input Devices`.

- [ ] **Step 1: Failing tests** (append to `test/policy.test.ts`)

```ts
describe('category path', () => {
  const fresh = { monthSpentCents: 0, ordersToday: 0 };
  it('accepts when an ancestor category is allowed', () => {
    const r = evaluatePolicy(
      mandate({ allowedCategories: ['Input Devices'] }),
      proposal({ category: 'keyboards', categoryPath: ['Electronics', 'Computer Components', 'Input Devices', 'Keyboards'] }),
      fresh,
    );
    expect(r).toEqual({ ok: true });
  });
  it('matches slugs against titles', () => {
    const r = evaluatePolicy(
      mandate({ allowedCategories: ['computer components'] }),
      proposal({ category: 'keyboards', categoryPath: ['electronics', 'computer-components', 'input-devices'] }),
      fresh,
    );
    expect(r).toEqual({ ok: true });
  });
  it('still denies when neither category nor path is allowed', () => {
    const r = evaluatePolicy(
      mandate({ allowedCategories: ['office supplies'] }),
      proposal({ category: 'headphones', categoryPath: ['Electronics', 'Audio', 'Headphones'] }),
      fresh,
    );
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run test/policy.test.ts` → the first two FAIL (typecheck may also flag `categoryPath`).
- [ ] **Step 3: Implement.** In `types.ts` add `categoryPath?: string[];` to `ProposalInput`. In `policy.ts` change the category normaliser to `const normCat = (s: string) => s.trim().toLowerCase().replace(/[-_]+/g, ' ');` and the rule to:

```ts
const candidates = [p.category, ...(p.categoryPath ?? [])].map(normCat);
if (m.allowedCategories.length > 0 && !m.allowedCategories.map(normCat).some((a) => candidates.includes(a))) {
  reasons.push(`Category "${p.category}" is not in the allowed categories`);
}
```
In `http.ts` `proposalInputSchema` add `categoryPath: z.array(z.string().min(1).max(100)).max(10).optional(),`.
- [ ] **Step 4:** `npx vitest run && npm run typecheck` → all PASS.
- [ ] **Step 5:** Commit `feat(gateway): allow categories by ancestor path`.

---

### Task 2: Proposal reads + idempotent proposals

**Files:** Modify `src/store.ts`, `src/leash.ts`, `src/http.ts`. Tests: `test/store.test.ts`, `test/leash.test.ts`, `test/http.test.ts` (append).

**Interfaces:**
- `Store.listProposals(mandateId: string, status?: ProposalStatus): Proposal[]` newest first (`ORDER BY created_at DESC, rowid DESC`).
- `Store.findByIdempotencyKey(mandateId: string, key: string): Proposal | undefined`.
- `Store.createProposal(mandateId, input, at, idempotencyKey?: string)` — persists into new nullable column `idempotency_key TEXT` with `CREATE UNIQUE INDEX IF NOT EXISTS proposals_idem ON proposals (mandate_id, idempotency_key) WHERE idempotency_key IS NOT NULL`; add the column with the same PRAGMA/ALTER pattern used for `committed_at`.
- `Leash.propose(mandateId, input, opts: { idempotencyKey?: string } = {})` — if a proposal with that key exists for the mandate, return it unchanged (no new event, no intent call, no charge). The lookup + create must be synchronous (no await between them).
- HTTP:
  - `POST /api/mandates/:id/proposals` reads optional header `Idempotency-Key` (1–200 chars, else 400) → returns **201** for new, **200** for replay (compare returned `createdAt`/id: replay when `findByIdempotencyKey` hit before calling propose).
  - `GET /api/proposals?mandate=ID[&status=pending_human]` (agent, owner) → `Proposal[]`; `mandate` required (400 if missing); `status` validated against the ProposalStatus list.
  - `GET /api/proposals/:id` (agent, owner) → `Proposal` or 404.

- [ ] **Step 1: Failing tests.**

`test/leash.test.ts`:
```ts
describe('idempotent propose', () => {
  it('returns the same proposal for a repeated key without re-charging', async () => {
    const { leash, m, paypal, statuses } = setup();
    const a = await leash.propose(m.id, proposal(), { idempotencyKey: 'k1' });
    const b = await leash.propose(m.id, proposal(), { idempotencyKey: 'k1' });
    expect(b.id).toBe(a.id);
    expect(paypal.charges).toHaveLength(1);
    expect(statuses().filter((s) => s === 'proposed')).toHaveLength(1);
  });
  it('concurrent proposals with the same key create one proposal', async () => {
    const { leash, m, paypal } = setup();
    const [a, b] = await Promise.all([
      leash.propose(m.id, proposal(), { idempotencyKey: 'k2' }),
      leash.propose(m.id, proposal(), { idempotencyKey: 'k2' }),
    ]);
    expect(b.id).toBe(a.id);
    expect(paypal.charges).toHaveLength(1);
  });
});
```
(The concurrent case: the second call finds the first's row synchronously and returns it immediately — its status may still be `proposed`; assert only ids and charge count.)

`test/store.test.ts`:
```ts
it('lists proposals newest first, optionally by status', () => {
  const { store, m } = setup();
  const a = store.createProposal(m.id, proposal({ title: 'A' }), new Date('2026-10-20T10:00:00Z'));
  const b = store.createProposal(m.id, proposal({ title: 'B' }), new Date('2026-10-20T11:00:00Z'));
  store.updateProposal(a.id, { status: 'pending_human' });
  expect(store.listProposals(m.id).map((p) => p.input.title)).toEqual(['B', 'A']);
  expect(store.listProposals(m.id, 'pending_human').map((p) => p.id)).toEqual([a.id]);
  expect(store.listProposals('other')).toEqual([]);
  expect(b.id).toBeTruthy();
});
it('finds proposals by idempotency key per mandate', () => {
  const { store, m } = setup();
  const p = store.createProposal(m.id, proposal(), new Date(), 'key-1');
  expect(store.findByIdempotencyKey(m.id, 'key-1')?.id).toBe(p.id);
  expect(store.findByIdempotencyKey('other', 'key-1')).toBeUndefined();
  expect(() => store.createProposal(m.id, proposal(), new Date(), 'key-1')).toThrow();
});
```

`test/http.test.ts`:
```ts
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
```
(If the existing `call` helper's return type needs `json(): Promise<any>`, reuse it as the file already does.)

- [ ] **Step 2:** Run the three test files → new tests FAIL.
- [ ] **Step 3: Implement** per Interfaces. In `Leash.propose`, at the very top (before any `await`): `if (opts.idempotencyKey) { const existing = this.d.store.findByIdempotencyKey(mandateId, opts.idempotencyKey); if (existing) return existing; }` then pass the key to `createProposal`. In `http.ts` compute `const replay = key ? d.store.findByIdempotencyKey(id, key) : undefined; if (replay) return c.json(replay, 200);` before calling propose.
- [ ] **Step 4:** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(gateway): proposal list/get endpoints and Idempotency-Key on proposals`.

---

### Task 3: Live ledger events (SSE)

**Files:** Create `src/events.ts`; modify `src/http.ts` (AppDeps gets `events: EventBus`), `src/server.ts`. Test: `test/events.test.ts`; update `test/http.test.ts` setup to pass an `EventBus` and wire `onEvent: bus.publish` into its `Leash`.

**Interfaces:**
```ts
export class EventBus {
  publish(e: LedgerEvent): void;                       // sync fan-out; a throwing listener is isolated (console.error)
  subscribe(mandateId: string, fn: (e: LedgerEvent) => void): () => void;
}
```
`GET /api/events?mandate=ID` (agent, owner; `mandate` required → 400) streams Server-Sent Events via `streamSSE` from `hono/streaming`: first an `event: ready` with `data: {}`; then each matching ledger event as `event: ledger`, `data: JSON.stringify(e)`; a `ping` comment-equivalent (`event: ping`) every 25 s; unsubscribe on abort.

- [ ] **Step 1: Failing tests.** `test/events.test.ts`:
```ts
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
});
```
Append to `test/http.test.ts`:
```ts
it('streams ledger events over SSE', async () => {
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
  await readUntil('event: ready');
  await s.call('POST', `/api/mandates/${m.id}/proposals`, AGENT, proposal());
  await readUntil('"status":"tracked"');
  expect(text).toContain('event: ledger');
  await reader.cancel();
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `src/events.ts`:
```ts
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
```
Route in `http.ts`:
```ts
import { streamSSE } from 'hono/streaming';
// ...
app.get('/api/events', allow('agent', 'owner'), (c) => {
  const mandateId = c.req.query('mandate');
  if (!mandateId) return c.json({ error: 'mandate query parameter is required' }, 400);
  requireMandate(mandateId);
  return streamSSE(c, async (stream) => {
    const queue: LedgerEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = d.events.subscribe(mandateId, (e) => { queue.push(e); wake?.(); });
    stream.onAbort(unsubscribe);
    await stream.writeSSE({ event: 'ready', data: '{}' });
    while (!stream.aborted) {
      while (queue.length) await stream.writeSSE({ event: 'ledger', data: JSON.stringify(queue.shift()) });
      await new Promise<void>((r) => { wake = r; setTimeout(r, 25_000); });
      wake = null;
      if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
    }
    unsubscribe();
  });
});
```
`server.ts`: `const events = new EventBus();` pass `onEvent: (e) => events.publish(e)` to `Leash` and `events` to `createApp`.
- [ ] **Step 4:** `npx vitest run && npm run typecheck` → PASS (the SSE test must finish without hanging; if it hangs, the cancel path is wrong).
- [ ] **Step 5:** Commit `feat(gateway): live ledger events over SSE`.

---

### Task 4: Owner browser session

**Why:** The UI needs owner powers without shipping the owner key to the browser.

**Files:** Create `src/session.ts`; modify `src/http.ts`, `src/server.ts`, `.env.example`. Test: `test/session.test.ts`, append `test/http.test.ts`.

**Interfaces:**
```ts
export const SESSION_COOKIE = 'leash_owner';
export function signSession(secret: string, now: number, ttlMs?: number): string; // `${expiresAtMs}.${hmacHex}`; default ttl 12h
export function verifySession(secret: string, token: string | undefined, now: number): boolean;
```
HMAC-SHA256 over the `expiresAtMs` string; compare with `timingSafeEqual`; reject malformed, expired, or wrong-signature tokens.
AppDeps gains `session: { passcode: string; secret: string }`.
- `POST /api/session` body `{ passcode }` → constant-time compare with `d.session.passcode`; on success set cookie `leash_owner=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` (+ `Secure` when `d.publicUrl` starts with `https://`) and return `{ ok: true }`; on failure 401 `{ error: 'invalid_passcode' }`.
- `DELETE /api/session` clears the cookie (Max-Age=0).
- `roleOf` becomes: Bearer owner key → owner; Bearer agent key → agent; else valid session cookie → owner; else null. A Bearer header that matches neither key returns null even if a cookie is present.
- Owner-only mutating requests authenticated **by cookie** must also carry header `x-leash-csrf: 1` (simple custom-header CSRF guard; SameSite=Strict is the main defence) → otherwise 403.
`server.ts`: `LEASH_UI_PASSCODE` (required, ≥8 chars) and `LEASH_SESSION_SECRET` (required, ≥32 chars). `.env.example` documents both. Add both to the local `.env` with generated values (the controller does this; implementers must not create or edit `.env`).

- [ ] **Step 1: Failing tests.** `test/session.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../src/session';
const S = 'x'.repeat(32);
describe('session tokens', () => {
  it('round-trips and expires', () => {
    const t = signSession(S, 1000, 5000);
    expect(verifySession(S, t, 2000)).toBe(true);
    expect(verifySession(S, t, 7000)).toBe(false);
  });
  it('rejects tampering, wrong secret and junk', () => {
    const t = signSession(S, 1000, 5000);
    const [exp, sig] = t.split('.');
    expect(verifySession(S, `${Number(exp) + 1}.${sig}`, 2000)).toBe(false);
    expect(verifySession('y'.repeat(32), t, 2000)).toBe(false);
    for (const junk of [undefined, '', 'abc', '1.2.3', '.']) expect(verifySession(S, junk, 2000)).toBe(false);
  });
});
```
Append to `test/http.test.ts` (setup passes `session: { passcode: 'demo-pass', secret: 's'.repeat(32) }`):
```ts
describe('owner session', () => {
  it('logs in with the passcode and acts as owner with the CSRF header', async () => {
    const s = setup();
    const bad = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'nope' }) });
    expect(bad.status).toBe(401);
    const ok = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'demo-pass' }) });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    const jar = cookie.split(';')[0];
    const create = (extra: Record<string, string>) =>
      s.app.request('/api/mandates', { method: 'POST', headers: { cookie: jar, 'content-type': 'application/json', ...extra }, body: JSON.stringify(mandateBody) });
    expect((await create({})).status).toBe(403);
    expect((await create({ 'x-leash-csrf': '1' })).status).toBe(201);
    const read = await s.app.request('/api/ledger', { headers: { cookie: jar } });
    expect(read.status).toBe(200);
  });
  it('a wrong bearer key is rejected even with a valid cookie', async () => {
    const s = setup();
    const ok = await s.app.request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: 'demo-pass' }) });
    const jar = ok.headers.get('set-cookie')!.split(';')[0];
    const res = await s.app.request('/api/ledger', { headers: { cookie: jar, authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `src/session.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'leash_owner';
const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('hex');

export function signSession(secret: string, now: number, ttlMs = 12 * 60 * 60 * 1000): string {
  const exp = String(now + ttlMs);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySession(secret: string, token: string | undefined, now: number): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return false;
  const expected = Buffer.from(mac(secret, parts[0]), 'hex');
  const given = Buffer.from(parts[1], 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given) && Number(parts[0]) > now;
}
```
In `http.ts`, use `getCookie`/`setCookie`/`deleteCookie` from `hono/cookie`. Restructure the auth middleware to compute `{ role, via: 'bearer' | 'cookie' }`; for owner-only routes with `via === 'cookie'` and method ≠ GET, require `c.req.header('x-leash-csrf') === '1'`.
- [ ] **Step 4:** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(gateway): owner browser session with HMAC cookie and CSRF header`.

---

### Task 5: Channel3 client

**Files:** Create `src/scout/channel3.ts`. Test: `test/channel3.test.ts`.

**Interfaces:**
```ts
export interface ProductOffer { domain: string; priceCents: number; currency: string; availability: string; condition: string | null; url: string }
export interface ProductSummary {
  id: string; title: string; brand: string | null; imageUrl: string | null;
  description: string;            // description ?? key_features.join('. '), trimmed to 1000 chars
  category: string;               // category.title ?? 'uncategorized'
  categoryPath: string[];         // category.path[].title (root first)
  offers: ProductOffer[];         // only offers with numeric price; priceCents = Math.round(price.price * 100)
}
export class Channel3Error extends Error { constructor(public status: number, message: string) }
export class Channel3Client {
  constructor(opts: { apiKey: string; baseUrl?: string; fetch?: typeof fetch });
  search(query: string, opts?: { maxPriceCents?: number; limit?: number }): Promise<ProductSummary[]>; // limit default 6, max 10; filters.availability ['InStock']
  getProduct(id: string): Promise<ProductSummary>;
}
```
Image: prefer main image's `cleaned_url ?? url`, else first image.

- [ ] **Step 1: Failing test** `test/channel3.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Channel3Client, Channel3Error } from '../src/scout/channel3';

const raw = {
  id: '1MzmS6B', title: 'ergonomic Keyboard', description: null,
  brands: [{ id: 'PTdM', name: 'Adesso' }],
  images: [{ url: 'https://img/1.jpg', cleaned_url: 'https://img/1c.png', is_main_image: true }],
  category: { slug: 'keyboards', title: 'Keyboards', path: [{ slug: 'electronics', title: 'Electronics' }, { slug: 'input-devices', title: 'Input Devices' }] },
  key_features: ['Ergonomic design', 'Integrated palm rest'],
  offers: [
    { url: 'https://buy/1', domain: 'adesso.com', price: { price: 59.99, compare_at_price: null, currency: 'USD' }, availability: 'InStock', condition: 'new' },
    { url: 'https://buy/2', domain: 'bad.com', price: { price: null, currency: 'USD' }, availability: 'InStock', condition: 'new' },
  ],
};

function fake(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe('Channel3Client', () => {
  it('searches with key, price filter and in-stock filter, and normalises products', async () => {
    const { fn, calls } = fake(200, { products: [raw], next_page_token: null });
    const c = new Channel3Client({ apiKey: 'c3', fetch: fn });
    const [p] = await c.search('ergonomic keyboard', { maxPriceCents: 6000 });
    expect(calls[0].url).toBe('https://api.trychannel3.com/v1/search');
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('c3');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      query: 'ergonomic keyboard', limit: 6,
      filters: { price: { max_price: 60 }, availability: ['InStock'] },
    });
    expect(p).toEqual({
      id: '1MzmS6B', title: 'ergonomic Keyboard', brand: 'Adesso', imageUrl: 'https://img/1c.png',
      description: 'Ergonomic design. Integrated palm rest',
      category: 'Keyboards', categoryPath: ['Electronics', 'Input Devices'],
      offers: [{ domain: 'adesso.com', priceCents: 5999, currency: 'USD', availability: 'InStock', condition: 'new', url: 'https://buy/1' }],
    });
  });
  it('gets a product by id', async () => {
    const { fn, calls } = fake(200, raw);
    const p = await new Channel3Client({ apiKey: 'c3', fetch: fn }).getProduct('1MzmS6B');
    expect(calls[0].url).toBe('https://api.trychannel3.com/v1/products/1MzmS6B');
    expect(p.offers[0].priceCents).toBe(5999);
  });
  it('throws Channel3Error with status on failure', async () => {
    const { fn } = fake(401, { detail: 'bad key' });
    await expect(new Channel3Client({ apiKey: 'x', fetch: fn }).search('a')).rejects.toMatchObject({ status: 401 });
    await expect(new Channel3Client({ apiKey: 'x', fetch: fn }).search('a')).rejects.toBeInstanceOf(Channel3Error);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `src/scout/channel3.ts` to satisfy the interface and test (use `encodeURIComponent` for the id path segment; `max_price` = `maxPriceCents / 100`; omit `price` filter when no max; non-2xx → `Channel3Error(status, text.slice(0, 300))`).
- [ ] **Step 4:** `npx vitest run test/channel3.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(scout): Channel3 product search client`.

---

### Task 6: Agent-side gateway client

**Files:** Create `src/scout/gateway-client.ts`. Test: `test/gateway-client.test.ts`.

**Interfaces:**
```ts
export interface PublicMandate { id: string; goal: string; currency: string; perOrderCapCents: number; monthlyBudgetCents: number; allowedCategories: string[]; connected: boolean }
export class GatewayError extends Error { constructor(public status: number, message: string) }
export class GatewayClient {
  constructor(opts: { baseUrl: string; agentKey: string; fetch?: typeof fetch });
  getMandate(id: string): Promise<PublicMandate>;
  propose(mandateId: string, input: ProposalInput, idempotencyKey: string): Promise<Proposal>;
  listProposals(mandateId: string): Promise<Proposal[]>;
}
```
Sends `authorization: Bearer <agentKey>`; `propose` sends `Idempotency-Key`; non-2xx → `GatewayError(status, body.error ?? text)`.

- [ ] **Step 1: Failing test** — use the real `createApp` with in-memory `Store`, `FakePayPal`, stub intent, and pass `fetch: (url, init) => app.request(String(url).replace('http://gw', ''), init)` so the client is tested against the real HTTP layer:
```ts
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
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(scout): agent-side gateway client`.

---

### Task 7: Scout tools and agent loop

**Files:** Create `src/scout/tools.ts`, `src/scout/agent.ts`. Test: `test/scout-tools.test.ts`.

**Interfaces:**
```ts
// tools.ts
export interface ScoutContext {
  mandateId: string;
  conversationId: string;
  userRequest: string;                  // latest user chat message (server-provided)
  channel3: Pick<Channel3Client, 'search' | 'getProduct'>;
  gateway: Pick<GatewayClient, 'getMandate' | 'propose' | 'listProposals'>;
  seen: Map<string, ProductSummary>;    // products returned this turn/conversation
}
export function makeScoutTools(ctx: ScoutContext): {
  search_products: Tool;   // input { query: string (1..200), maxPriceUsd?: number (>0) } → { products: Array<{ id, title, brand, imageUrl, category, offers: Array<{ merchant, priceUsd, url }> }> } (max 6; records into ctx.seen)
  propose_purchase: Tool;  // input { productId: string, merchantDomain: string } → { status, reasons, intent, proposalId, priceUsd, merchant, title }
  check_budget: Tool;      // input {} → { goal, perOrderCapUsd, monthlyBudgetUsd, allowedCategories, connected }
};
export function buildProposalInput(product: ProductSummary, merchantDomain: string, userRequest: string): ProposalInput; // throws if the merchant has no offer
// agent.ts
export interface ScoutTurnResult { text: string; products: ProductSummary[]; proposals: Proposal[] }
export async function runScoutTurn(
  deps: { model: LanguageModel; channel3: ScoutContext['channel3']; gateway: ScoutContext['gateway'] },
  args: { mandateId: string; conversationId: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> },
): Promise<ScoutTurnResult>;
```
Rules:
- `propose_purchase` resolves the product from `ctx.seen`, else `ctx.channel3.getProduct(productId)`; builds input with `buildProposalInput` (title, description, `category`, `categoryPath`, `merchant = offer.domain`, `priceCents = offer.priceCents`, `currency = offer.currency`, `productUrl = offer.url`, `userRequest = ctx.userRequest`); idempotency key = `scout:${conversationId}:${productId}:${merchantDomain}`.
- `buildProposalInput` normalises `merchantDomain` (lowercase, strip `www.`) when matching offers.
- Tool `execute` functions never throw to the model: wrap errors and return `{ error: message }`.
- `runScoutTurn`: `userRequest` = content of the last `user` message (throw if none); system prompt (constant `SCOUT_SYSTEM`) tells the model: it shops for the owner within their mandate; always `check_budget` once before proposing; search first; propose at most one item per user request unless asked; it cannot approve, override or retry denied purchases; explain denials and pending approvals plainly; never claim a purchase happened unless the tool returned `captured` or `tracked`. Use `generateText({ model, system, messages, tools, stopWhen: stepCountIs(6), maxOutputTokens: 1500 })`. Collect `products` from all `search_products` results and `proposals` (fetch `gateway.listProposals` filtered to ids returned by `propose_purchase` this turn) for the UI.

- [ ] **Step 1: Failing tests** `test/scout-tools.test.ts` (tools only; the loop is verified live in Task 8):
```ts
import { describe, expect, it, vi } from 'vitest';
import { buildProposalInput, makeScoutTools, type ScoutContext } from '../src/scout/tools';
import type { ProductSummary } from '../src/scout/channel3';

const kb: ProductSummary = {
  id: 'P1', title: 'Ergo Keyboard', brand: 'Adesso', imageUrl: null, description: 'Ergonomic',
  category: 'Keyboards', categoryPath: ['Electronics', 'Input Devices'],
  offers: [{ domain: 'adesso.com', priceCents: 5999, currency: 'USD', availability: 'InStock', condition: 'new', url: 'https://buy/1' }],
};

function ctx(over: Partial<ScoutContext> = {}): ScoutContext {
  return {
    mandateId: 'm1', conversationId: 'c1', userRequest: 'I need an ergonomic keyboard',
    channel3: { search: vi.fn(async () => [kb]), getProduct: vi.fn(async () => kb) },
    gateway: {
      getMandate: vi.fn(async () => ({ id: 'm1', goal: 'office', currency: 'USD', perOrderCapCents: 6000, monthlyBudgetCents: 15000, allowedCategories: ['input devices'], connected: true })),
      propose: vi.fn(async (_m: string, input: any) => ({ id: 'prop-1', status: 'tracked', reasons: [], intent: { score: 0.95, reason: 'ok' }, input } as any)),
      listProposals: vi.fn(async () => []),
    },
    seen: new Map(),
    ...over,
  };
}
const exec = (t: any, input: unknown) => t.execute(input, { toolCallId: 't', messages: [] });

describe('buildProposalInput', () => {
  it('fills every purchase field from Channel3 data and the server-side user request', () => {
    expect(buildProposalInput(kb, 'WWW.Adesso.com', 'I need an ergonomic keyboard')).toEqual({
      title: 'Ergo Keyboard', description: 'Ergonomic', category: 'Keyboards', categoryPath: ['Electronics', 'Input Devices'],
      merchant: 'adesso.com', priceCents: 5999, currency: 'USD', productUrl: 'https://buy/1',
      userRequest: 'I need an ergonomic keyboard',
    });
  });
  it('rejects a merchant with no offer', () => {
    expect(() => buildProposalInput(kb, 'evil.com', 'x')).toThrow('No offer from evil.com');
  });
});

describe('scout tools', () => {
  it('search_products converts the USD cap to cents and remembers products', async () => {
    const c = ctx();
    const out = await exec(makeScoutTools(c).search_products, { query: 'ergonomic keyboard', maxPriceUsd: 60 });
    expect(c.channel3.search).toHaveBeenCalledWith('ergonomic keyboard', { maxPriceCents: 6000, limit: 6 });
    expect(out.products[0]).toMatchObject({ id: 'P1', offers: [{ merchant: 'adesso.com', priceUsd: 59.99 }] });
    expect(c.seen.get('P1')).toBe(kb);
  });
  it('propose_purchase sends server-built input with a stable idempotency key; LLM cannot set price', async () => {
    const c = ctx();
    c.seen.set('P1', kb);
    const out = await exec(makeScoutTools(c).propose_purchase, { productId: 'P1', merchantDomain: 'adesso.com', priceCents: 1 } as any);
    expect(c.gateway.propose).toHaveBeenCalledWith('m1', expect.objectContaining({ priceCents: 5999, merchant: 'adesso.com' }), 'scout:c1:P1:adesso.com');
    expect(out).toMatchObject({ status: 'tracked', proposalId: 'prop-1', priceUsd: 59.99 });
  });
  it('propose_purchase fetches unseen products and returns errors instead of throwing', async () => {
    const c = ctx({ channel3: { search: vi.fn(), getProduct: vi.fn(async () => { throw new Error('not found'); }) } as any });
    const out = await exec(makeScoutTools(c).propose_purchase, { productId: 'NOPE', merchantDomain: 'x.com' });
    expect(out).toEqual({ error: 'not found' });
  });
  it('check_budget reports limits in dollars', async () => {
    const out = await exec(makeScoutTools(ctx()).check_budget, {});
    expect(out).toEqual({ goal: 'office', perOrderCapUsd: 60, monthlyBudgetUsd: 150, allowedCategories: ['input devices'], connected: true });
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `tools.ts` with `tool({ description, inputSchema: z.object(...), execute })` from `ai` (zod schemas; `propose_purchase` schema has exactly `productId` and `merchantDomain` — extra keys are ignored by using the parsed input only). Implement `agent.ts` as specified (import `generateText`, `stepCountIs`, `type LanguageModel` from `ai`).
- [ ] **Step 4:** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(scout): tools with server-side purchase fields and agent loop`.

---

### Task 8: Scout chat endpoint, wiring, live smoke

**Files:** Create `src/scout/route.ts`; modify `src/http.ts` (mount), `src/server.ts`; create `scripts/smoke-scout.ts`; add `"smoke:scout": "tsx --env-file=.env scripts/smoke-scout.ts"` to package.json; `.env.example` gains `GATEWAY_INTERNAL_URL` (default `http://127.0.0.1:${PORT}`) and optional `SCOUT_MODEL`. Test: `test/scout-chat.test.ts`.

**Interfaces:**
- `createScoutRoute(runTurn: (args) => Promise<ScoutTurnResult>): Hono` mounted by `createApp` at `/api/scout` when `AppDeps.scout` is provided (optional dep so existing tests don't change).
- `POST /api/scout/chat` — **owner only** (bearer or session+CSRF; the human chats with Scout; Scout itself acts with the agent key) body `{ mandateId: string, conversationId: string (1..100), messages: Array<{ role: 'user'|'assistant', content: string (1..4000) }> (1..40) }` → `200 ScoutTurnResult`; 400 on invalid body; errors from the model → 502 `{ error: 'scout_unavailable' }` (log details).
- `server.ts`: build `Channel3Client` (`CHANNEL3_API_KEY` required), `GatewayClient({ baseUrl: GATEWAY_INTERNAL_URL, agentKey })`, model `createOpenRouter(...).chat(SCOUT_MODEL || LEASH_MODEL || DEFAULT_MODEL)`; pass `scout: (args) => runScoutTurn(deps, args)`.

- [ ] **Step 1: Failing test** `test/scout-chat.test.ts`: build the app as in `test/gateway-client.test.ts` plus `scout: vi.fn(async (args) => ({ text: 'Found it', products: [], proposals: [] }))`; assert:
  - agent bearer → 403; owner bearer → 200 with `{ text: 'Found it' }` and the stub received `{ mandateId, conversationId, messages }`;
  - invalid body (no messages) → 400;
  - stub throws → 502 `{ error: 'scout_unavailable' }` (spy on console.error).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement route + mounting + server wiring.
- [ ] **Step 4:** `npx vitest run && npm run typecheck` → PASS.
- [ ] **Step 5: Live smoke (controller runs; needs `.env` and `npm run dev` running).** `scripts/smoke-scout.ts` uses the owner bearer key against `PUBLIC_URL`. Two-step, like the spike:
  - `npm run smoke:scout` → creates a mandate (`goal: 'Keep my home office stocked'`, cap $60, budget $150, allowed `['Input Devices','Office Supplies','Computer Accessories']`), calls `/connect`, prints the approve URL and the mandate id. The human approves with the sandbox Personal account; PayPal redirects to `PUBLIC_URL/paypal/return?mandate=…`, which completes the vault on the running server.
  - `npm run smoke:scout -- <mandateId>` → sends three cumulative chat turns ("I need an ergonomic keyboard under $60", "also grab a nice desk lamp around $70", "get me a gaming headset") to `/api/scout/chat` and prints per turn: reply text, product count, proposal statuses + reasons, then refunds any captured proposal.
  - Expected: keyboard → captured/tracked; lamp → denied (cap) or not proposed with an explanation; headset → pending_human or denied by category.
- [ ] **Step 6:** Commit `feat(scout): chat endpoint, server wiring, live smoke script`.

---

## Out of scope (Plan 3: Web UI; Plan 4: Ship)

- Plan 3: React + AG Grid UI built with Vite and served statically by the gateway: passcode login, chat with product comparison grid, approval inbox (SSE), ledger grid with refund, mandate editor + Connect PayPal.
- Plan 4: Render deploy, demo seed, judge walkthrough README, video script, Devpost text notes, key rotation checklist, optional MCP endpoint.
