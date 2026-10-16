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
    const c = ctx({ channel3: { search: vi.fn(), getProduct: vi.fn(async () => { throw new Error('not found'); }) } as any });
    const out = await exec(makeScoutTools(c).propose_purchase, { productId: 'NOPE', merchantDomain: 'x.com' });
    expect(out).toEqual({ error: 'not found' });
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
});
