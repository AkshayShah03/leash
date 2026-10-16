import { createHash, timingSafeEqual } from 'node:crypto';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { EventBus } from './events';
import { Leash, LeashError } from './leash';
import type { VaultApi } from './paypal/api';
import { createScoutRoute, type RunScoutTurn } from './scout/route';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from './session';
import type { Store } from './store';
import type { LedgerEvent, Mandate, ProposalStatus } from './types';

const mandateFields = {
  goal: z.string().min(1).max(500),
  currency: z.literal('USD'),
  perOrderCapCents: z.number().int().positive(),
  monthlyBudgetCents: z.number().int().positive(),
  allowedCategories: z.array(z.string().min(1)),
  allowedMerchants: z.array(z.string().min(1)).nullable(),
  blockedMerchants: z.array(z.string().min(1)),
  maxOrdersPerDay: z.number().int().positive(),
  reviewThreshold: z.number().min(0).max(1),
};

export const mandateInputSchema = z.object({
  ...mandateFields,
  currency: mandateFields.currency.default('USD'),
  allowedCategories: mandateFields.allowedCategories.default([]),
  allowedMerchants: mandateFields.allowedMerchants.default(null),
  blockedMerchants: mandateFields.blockedMerchants.default([]),
  maxOrdersPerDay: mandateFields.maxOrdersPerDay.default(5),
  reviewThreshold: mandateFields.reviewThreshold.default(0.8),
});

/** Same validators as the input schema, but no defaults: an omitted field must stay omitted. */
export const mandatePatchSchema = z
  .object({
    goal: mandateFields.goal.optional(),
    currency: mandateFields.currency.optional(),
    perOrderCapCents: mandateFields.perOrderCapCents.optional(),
    monthlyBudgetCents: mandateFields.monthlyBudgetCents.optional(),
    allowedCategories: mandateFields.allowedCategories.optional(),
    allowedMerchants: mandateFields.allowedMerchants.optional(),
    blockedMerchants: mandateFields.blockedMerchants.optional(),
    maxOrdersPerDay: mandateFields.maxOrdersPerDay.optional(),
    reviewThreshold: mandateFields.reviewThreshold.optional(),
  })
  .strict();

const CAP_EXCEEDS_BUDGET = 'perOrderCapCents must not exceed monthlyBudgetCents';

export const proposalInputSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).default(''),
  category: z.string().min(1).max(100),
  categoryPath: z.array(z.string().min(1).max(100)).max(10).optional(),
  merchant: z.string().min(1).max(200),
  priceCents: z.number().int().positive(),
  currency: z.string().length(3),
  productUrl: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'productUrl must be http(s)').optional(),
  userRequest: z.string().min(1).max(1000),
});

const PROPOSAL_STATUSES = [
  'proposed', 'auto_approved', 'pending_human', 'denied', 'human_approved', 'captured', 'tracked', 'refunded', 'failed',
] as const satisfies readonly ProposalStatus[];

type Role = 'agent' | 'owner';

export interface AppDeps {
  leash: Leash;
  store: Store;
  vault: VaultApi;
  events: EventBus;
  keys: { agent: string; owner: string };
  publicUrl: string;
  session: { passcode: string; secret: string; failureDelayMs?: number };
  /** Scout chat turn runner; when absent, /api/scout is not mounted. */
  scout?: RunScoutTurn;
  /** Built SPA directory; when set, non-API GETs are served from it with an index.html fallback. */
  webRoot?: string;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const sha256 = (v: string) => createHash('sha256').update(v).digest();

function publicMandate(m: Mandate) {
  const { vaultId, setupTokenId: _setup, ...rest } = m;
  return { ...rest, connected: vaultId !== null };
}

export function createApp(d: AppDeps) {
  const app = new Hono();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'https:', 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  app.get('/healthz', (c) => c.json({ ok: true })); // unauthenticated liveness probe for Render

  const authOf = (c: Context): { role: Role; via: 'bearer' | 'cookie' } | null => {
    const header = c.req.header('authorization');
    if (header) {
      const key = header.replace(/^Bearer /, '');
      if (!key) return null;
      if (safeEqual(key, d.keys.owner)) return { role: 'owner', via: 'bearer' };
      if (safeEqual(key, d.keys.agent)) return { role: 'agent', via: 'bearer' };
      return null;
    }
    if (verifySession(d.session.secret, getCookie(c, SESSION_COOKIE), Date.now())) return { role: 'owner', via: 'cookie' };
    return null;
  };

  const allow =
    (...roles: Role[]): MiddlewareHandler =>
    async (c, next) => {
      const auth = authOf(c);
      if (!auth) return c.json({ error: 'unauthorized' }, 401);
      if (!roles.includes(auth.role)) return c.json({ error: 'forbidden' }, 403);
      if (auth.via === 'cookie' && c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-leash-csrf') !== '1')
        return c.json({ error: 'csrf_required' }, 403);
      await next();
    };

  const requireMandate = (id: string): Mandate => {
    const m = d.store.getMandate(id);
    if (!m) throw new LeashError('not_found', `Mandate ${id} not found`);
    return m;
  };

  app.onError((err, c) => {
    if (err instanceof LeashError) return c.json({ error: err.message }, err.code === 'not_found' ? 404 : 409);
    if (err instanceof z.ZodError) return c.json({ error: 'invalid_request', issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  app.post('/api/session', async (c) => {
    const { passcode } = z.object({ passcode: z.string().max(500) }).parse(await c.req.json());
    if (!timingSafeEqual(sha256(passcode), sha256(d.session.passcode))) {
      await new Promise((r) => setTimeout(r, d.session.failureDelayMs ?? 500));
      return c.json({ error: 'invalid_passcode' }, 401);
    }
    setCookie(c, SESSION_COOKIE, signSession(d.session.secret, Date.now()), {
      httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_MS / 1000, secure: d.publicUrl.startsWith('https://'),
    });
    return c.json({ ok: true });
  });

  // Reports auth state, so it is deliberately not behind allow().
  app.get('/api/session', (c) => {
    if (authOf(c)?.role === 'owner') return c.json({ owner: true });
    return c.json({ owner: false }, 401);
  });

  app.delete('/api/session', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.post('/api/mandates', allow('owner'), async (c) => {
    const input = mandateInputSchema.parse(await c.req.json());
    if (input.perOrderCapCents > input.monthlyBudgetCents) return c.json({ error: CAP_EXCEEDS_BUDGET }, 400);
    const m = d.store.createMandate(input);
    return c.json(publicMandate(m), 201);
  });

  app.get('/api/mandates', allow('owner'), (c) => c.json(d.store.listMandates().map(publicMandate)));

  app.patch('/api/mandates/:id', allow('owner'), async (c) => {
    const id = c.req.param('id');
    const parsed = mandatePatchSchema.parse(await c.req.json());
    const patch = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)) as typeof parsed;
    if (Object.keys(patch).length === 0) return c.json({ error: 'patch must include at least one field' }, 400);
    const current = requireMandate(id);
    const cap = patch.perOrderCapCents ?? current.perOrderCapCents;
    const budget = patch.monthlyBudgetCents ?? current.monthlyBudgetCents;
    if (cap > budget) return c.json({ error: CAP_EXCEEDS_BUDGET }, 400);
    return c.json(publicMandate(d.store.updateMandateRules(id, patch)));
  });

  app.get('/api/mandates/:id', allow('agent', 'owner'), (c) => c.json(publicMandate(requireMandate(c.req.param('id')))));

  app.post('/api/mandates/:id/connect', allow('owner'), async (c) => {
    const m = requireMandate(c.req.param('id'));
    const returnUrl = `${d.publicUrl}/paypal/return?mandate=${m.id}`;
    const setup = await d.vault.createSetupToken({ returnUrl, cancelUrl: `${returnUrl}&cancelled=1` });
    d.store.updateMandate(m.id, { setupTokenId: setup.id });
    return c.json({ approveUrl: setup.approveUrl });
  });

  app.get('/paypal/return', async (c) => {
    const m = requireMandate(c.req.query('mandate') ?? '');
    if (c.req.query('cancelled')) return c.redirect('/?connect=cancelled', 302);
    if (!m.setupTokenId) throw new LeashError('conflict', 'No pending PayPal connection for this mandate');
    const { vaultId } = await d.vault.createPaymentToken(m.setupTokenId);
    d.store.updateMandate(m.id, { vaultId, setupTokenId: null });
    return c.redirect(`/?connected=${encodeURIComponent(m.id)}`, 302);
  });

  app.post('/api/mandates/:id/proposals', allow('agent', 'owner'), async (c) => {
    const id = c.req.param('id');
    const key = z.string().min(1).max(200).optional().parse(c.req.header('idempotency-key'));
    const input = proposalInputSchema.parse(await c.req.json());
    const replay = key ? d.store.findByIdempotencyKey(id, key) : undefined;
    if (replay) return c.json(replay, 200);
    const p = await d.leash.propose(id, input, { idempotencyKey: key });
    return c.json(p, 201);
  });

  app.get('/api/proposals', allow('agent', 'owner'), (c) => {
    const { mandate, status } = z
      .object({ mandate: z.string().min(1), status: z.enum(PROPOSAL_STATUSES).optional() })
      .parse({ mandate: c.req.query('mandate'), status: c.req.query('status') });
    return c.json(d.store.listProposals(mandate, status));
  });

  app.get('/api/proposals/:id', allow('agent', 'owner'), (c) => {
    const p = d.store.getProposal(c.req.param('id'));
    if (!p) throw new LeashError('not_found', `Proposal ${c.req.param('id')} not found`);
    return c.json(p);
  });

  app.post('/api/proposals/:id/approve', allow('owner'), async (c) => c.json(await d.leash.approve(c.req.param('id'))));

  app.post('/api/proposals/:id/deny', allow('owner'), async (c) => {
    const body = z.object({ reason: z.string().max(300).optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(d.leash.deny(c.req.param('id'), body.reason));
  });

  app.post('/api/proposals/:id/refund', allow('owner'), async (c) => c.json(await d.leash.refund(c.req.param('id'))));

  app.get('/api/ledger', allow('agent', 'owner'), (c) => c.json(d.store.listEvents(c.req.query('mandate'))));

  app.get('/api/events', allow('agent', 'owner'), (c) => {
    const mandateId = c.req.query('mandate');
    if (!mandateId) return c.json({ error: 'mandate query parameter is required' }, 400);
    requireMandate(mandateId);
    return streamSSE(c, async (stream) => {
      const queue: LedgerEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = d.events.subscribe(mandateId, (e) => { queue.push(e); wake?.(); });
      stream.onAbort(() => { unsubscribe(); wake?.(); });
      try {
        await stream.writeSSE({ event: 'ready', data: '{}' });
        while (!stream.aborted) {
          while (queue.length) await stream.writeSSE({ event: 'ledger', data: JSON.stringify(queue.shift()) });
          if (stream.aborted) break;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, 25_000);
            function done() { clearTimeout(timer); wake = null; resolve(); }
            wake = done;
          });
          if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  if (d.scout) {
    app.use('/api/scout/*', allow('owner'));
    app.route('/api/scout', createScoutRoute(d.scout, requireMandate));
  }

  if (d.webRoot) {
    const root = d.webRoot;
    const isServerPath = (p: string) => p === '/api' || p.startsWith('/api/') || p === '/paypal' || p.startsWith('/paypal/');
    const isAssetLike = (p: string) => (p.split('/').pop() ?? '').includes('.');
    // Never serve dotfiles or traversal segments, even if one ends up inside webRoot.
    const isHidden = (p: string) => {
      let decoded = p;
      try { decoded = decodeURIComponent(p); } catch { return true; }
      return decoded.split(/[\\/]/).some((seg) => seg.startsWith('.'));
    };
    app.get('*', async (c, next) => (isHidden(c.req.path) ? c.json({ error: 'not_found' }, 404) : next()));
    const files = serveStatic({ root });
    const index = serveStatic({ root, rewriteRequestPath: () => '/index.html' });
    app.get('*', async (c, next) => (isServerPath(c.req.path) ? next() : files(c, next)));
    app.get('*', async (c, next) => (isServerPath(c.req.path) || isAssetLike(c.req.path) ? next() : index(c, next)));
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
