import { describe, expect, it, vi } from 'vitest';
import { buildProposalInput, makeScoutTools, type ScoutContext } from '../src/scout/tools';
import { Channel3Error, type ProductSummary } from '../src/scout/channel3';
import { GatewayError } from '../src/scout/gateway-client';

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
    expect(() => buildProposalInput(kb, 'evil.com', 'x')).toThrow('No in-stock offer from evil.com');
  });
  it('rejects out-of-stock offers and offers missing a url', () => {
    const oos = { ...kb, offers: [{ ...kb.offers[0]!, availability: 'OutOfStock' }] };
    expect(() => buildProposalInput(oos, 'adesso.com', 'x')).toThrow('No in-stock offer from adesso.com');
    const nourl = { ...kb, offers: [{ ...kb.offers[0]!, url: '' }] };
    expect(() => buildProposalInput(nourl, 'adesso.com', 'x')).toThrow('No in-stock offer from adesso.com');
  });
  it('passes the offer currency through', () => {
    const eur = { ...kb, offers: [{ ...kb.offers[0]!, currency: 'EUR' }] };
    expect(buildProposalInput(eur, 'adesso.com', 'x').currency).toBe('EUR');
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
  it('propose_purchase flags a still-proposed replay instead of inventing a status', async () => {
    const c = ctx();
    c.seen.set('P1', kb);
    (c.gateway.propose as any).mockResolvedValueOnce({ id: 'prop-1', status: 'proposed', reasons: [], intent: null, input: {} });
    const out = await exec(makeScoutTools(c).propose_purchase, { productId: 'P1', merchantDomain: 'adesso.com' });
    expect(out).toMatchObject({ status: 'proposed', note: 'still processing' });
  });
  it('propose_purchase fetches unseen products and returns errors instead of throwing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = ctx({ channel3: { search: vi.fn(), getProduct: vi.fn(async () => { throw new Error('not found'); }) } as any });
    const out = await exec(makeScoutTools(c).propose_purchase, { productId: 'NOPE', merchantDomain: 'x.com' });
    expect(out).toEqual({ error: 'That product could not be found' });
    spy.mockRestore();
  });
  it('propose_purchase uses the canonical product id and normalised domain in the idempotency key', async () => {
    const c = ctx();
    c.seen.set('P1', kb);
    const t = makeScoutTools(c).propose_purchase;
    await exec(t, { productId: 'P1', merchantDomain: 'WWW.Adesso.com' });
    await exec(t, { productId: 'P1', merchantDomain: 'adesso.com' });
    const keys = (c.gateway.propose as any).mock.calls.map((k: any[]) => k[2]);
    expect(keys).toEqual(['scout:c1:P1:adesso.com', 'scout:c1:P1:adesso.com']);
  });
  it('maps errors to generic messages and logs the full error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secret = 'sk-secret internal detail';
    const run = async (over: Partial<ScoutContext>, tool: 'search_products' | 'propose_purchase' | 'check_budget', input: any) => {
      const c = ctx(over);
      return exec((makeScoutTools(c) as any)[tool], input);
    };
    const boom = (e: Error) => async () => { throw e; };
    expect(await run({ channel3: { search: boom(new Channel3Error(500, secret)), getProduct: vi.fn() } as any }, 'search_products', { query: 'k' }))
      .toEqual({ error: 'Product search is unavailable right now' });
    expect(await run({ channel3: { search: vi.fn(), getProduct: boom(new Channel3Error(404, secret)) } as any }, 'propose_purchase', { productId: 'Z', merchantDomain: 'a.com' }))
      .toEqual({ error: 'That product could not be found' });
    const gw = (e: Error) => ({ getMandate: boom(e), propose: boom(e), listProposals: vi.fn() }) as any;
    expect(await run({ gateway: gw(new GatewayError(0, secret)) }, 'check_budget', {}))
      .toEqual({ error: 'The payment gateway is unreachable right now' });
    expect(await run({ gateway: gw(new GatewayError(403, secret)) }, 'check_budget', {}))
      .toEqual({ error: 'The gateway rejected the request (HTTP 403)' });
    expect(await run({ gateway: gw(new Error(secret)) }, 'check_budget', {}))
      .toEqual({ error: 'Something went wrong' });
    const seen = new Map([['P1', kb]]);
    expect(await run({ seen, gateway: gw(new GatewayError(409, secret)) }, 'propose_purchase', { productId: 'P1', merchantDomain: 'adesso.com' }))
      .toEqual({ error: 'The gateway rejected the request (HTTP 409)' });
    expect(await run({ seen: new Map([['P1', kb]]) }, 'propose_purchase', { productId: 'P1', merchantDomain: 'evil.com' }))
      .toEqual({ error: 'No in-stock offer from evil.com' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('check_budget reports limits in dollars', async () => {
    const out = await exec(makeScoutTools(ctx()).check_budget, {});
    expect(out).toEqual({ goal: 'office', perOrderCapUsd: 60, monthlyBudgetUsd: 150, allowedCategories: ['input devices'], connected: true });
  });
});

describe('runScoutTurn', () => {
  it('runs search -> propose -> final text and returns UI products and proposals', async () => {
    const { MockLanguageModelV4 } = await import('ai/test');
    const { runScoutTurn } = await import('../src/scout/agent');
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const call = (id: string, name: string, input: object) => ({
      content: [{ type: 'tool-call' as const, toolCallId: id, toolName: name, input: JSON.stringify(input) }],
      finishReason: { unified: 'tool-calls' as const, raw: undefined },
      usage, warnings: [],
    });
    const model = new MockLanguageModelV4({
      doGenerate: [
        call('a', 'search_products', { query: 'keyboard' }),
        call('b', 'propose_purchase', { productId: 'P1', merchantDomain: 'adesso.com' }),
        {
          content: [{ type: 'text' as const, text: 'Bought it.' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage, warnings: [],
        },
      ],
    });
    const c = ctx();
    (c.gateway.listProposals as any).mockResolvedValue([{ id: 'prop-1' }, { id: 'other' }]);
    const out = await runScoutTurn(
      { model, channel3: c.channel3, gateway: c.gateway },
      { mandateId: 'm1', conversationId: 'c1', messages: [{ role: 'user', content: 'need a keyboard' }] },
    );
    expect(out.text).toBe('Bought it.');
    expect(out.products).toEqual([kb]);
    expect(out.proposals).toEqual([{ id: 'prop-1' }]);
    expect(c.gateway.propose).toHaveBeenCalledWith('m1', expect.objectContaining({ userRequest: 'need a keyboard' }), 'scout:c1:P1:adesso.com');
  });
  const mkModel = async () => {
    const { MockLanguageModelV4 } = await import('ai/test');
    return new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      }),
    });
  };
  it('caps history to the last 20 messages', async () => {
    const { runScoutTurn } = await import('../src/scout/agent');
    const model = await mkModel();
    const c = ctx();
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `m${i}` }));
    await runScoutTurn({ model, channel3: c.channel3, gateway: c.gateway }, { mandateId: 'm1', conversationId: 'c1', messages });
    const prompt = (model.doGenerateCalls[0] as any).prompt.filter((m: any) => m.role !== 'system');
    expect(prompt.length).toBeLessThanOrEqual(20);
  });
  it('bounds userRequest to 1000 chars', async () => {
    const { MockLanguageModelV4 } = await import('ai/test');
    const { runScoutTurn } = await import('../src/scout/agent');
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const model = new MockLanguageModelV4({
      doGenerate: [
        { content: [{ type: 'tool-call' as const, toolCallId: 'b', toolName: 'propose_purchase', input: JSON.stringify({ productId: 'P1', merchantDomain: 'adesso.com' }) }], finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] },
        { content: [{ type: 'text' as const, text: 'done' }], finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] },
      ],
    });
    const c = ctx();
    c.seen.set('P1', kb);
    await runScoutTurn({ model, channel3: c.channel3, gateway: c.gateway }, { mandateId: 'm1', conversationId: 'c1', messages: [{ role: 'user', content: 'x'.repeat(1500) }] });
    const input = (c.gateway.propose as any).mock.calls[0][1];
    expect(input.userRequest).toHaveLength(1000);
  });
});
