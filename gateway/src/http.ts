import { timingSafeEqual } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { Leash, LeashError } from './leash';
import type { VaultApi } from './paypal/api';
import type { Store } from './store';
import type { Mandate, ProposalStatus } from './types';

export const mandateInputSchema = z.object({
  goal: z.string().min(1).max(500),
  currency: z.literal('USD').default('USD'),
  perOrderCapCents: z.number().int().positive(),
  monthlyBudgetCents: z.number().int().positive(),
  allowedCategories: z.array(z.string().min(1)).default([]),
  allowedMerchants: z.array(z.string().min(1)).nullable().default(null),
  blockedMerchants: z.array(z.string().min(1)).default([]),
  maxOrdersPerDay: z.number().int().positive().default(5),
  reviewThreshold: z.number().min(0).max(1).default(0.8),
});

export const proposalInputSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).default(''),
  category: z.string().min(1).max(100),
  categoryPath: z.array(z.string().min(1).max(100)).max(10).optional(),
  merchant: z.string().min(1).max(200),
  priceCents: z.number().int().positive(),
  currency: z.string().length(3),
  productUrl: z.string().url().optional(),
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
  keys: { agent: string; owner: string };
  publicUrl: string;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function publicMandate(m: Mandate) {
  const { vaultId, setupTokenId: _setup, ...rest } = m;
  return { ...rest, connected: vaultId !== null };
}

export function createApp(d: AppDeps) {
  const app = new Hono();

  const roleOf = (header: string | undefined): Role | null => {
    const key = header?.replace(/^Bearer /, '');
    if (!key) return null;
    if (safeEqual(key, d.keys.owner)) return 'owner';
    if (safeEqual(key, d.keys.agent)) return 'agent';
    return null;
  };

  const allow =
    (...roles: Role[]): MiddlewareHandler =>
    async (c, next) => {
      const role = roleOf(c.req.header('authorization'));
      if (!role) return c.json({ error: 'unauthorized' }, 401);
      if (!roles.includes(role)) return c.json({ error: 'forbidden' }, 403);
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

  app.post('/api/mandates', allow('owner'), async (c) => {
    const m = d.store.createMandate(mandateInputSchema.parse(await c.req.json()));
    return c.json(publicMandate(m), 201);
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
    if (c.req.query('cancelled')) return c.html('<p>PayPal connection cancelled. You can close this tab.</p>');
    if (!m.setupTokenId) throw new LeashError('conflict', 'No pending PayPal connection for this mandate');
    const { vaultId } = await d.vault.createPaymentToken(m.setupTokenId);
    d.store.updateMandate(m.id, { vaultId, setupTokenId: null });
    return c.html('<p>PayPal connected. You can close this tab.</p>');
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

  return app;
}
