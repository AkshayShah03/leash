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

function withPrice(price: unknown) {
  return { ...raw, offers: [{ ...raw.offers[0], price: { price, currency: 'USD' } }] };
}

function fakeText(status: number, text: string) {
  const fn = (async () => new Response(text, { status })) as typeof fetch;
  return { fn };
}

describe('Channel3Client price normalisation', () => {
  it.each([
    [59.99, 5999],
    [1.005, 101],
    [19.999, 2000],
  ])('converts price %s to %i cents', async (price, cents) => {
    const { fn } = fake(200, { products: [withPrice(price)], next_page_token: null });
    const [p] = await new Channel3Client({ apiKey: 'k', fetch: fn }).search('q');
    expect(p.offers[0].priceCents).toBe(cents);
  });

  it.each([0, -5, NaN, null])('skips offer with price %s', async (price) => {
    const { fn } = fake(200, { products: [withPrice(price)], next_page_token: null });
    const [p] = await new Channel3Client({ apiKey: 'k', fetch: fn }).search('q');
    expect(p.offers).toEqual([]);
  });
});

describe('Channel3Client input validation', () => {
  it.each([
    [0, 1],
    [99, 10],
    [2.5, 6],
    [NaN, 6],
  ])('limit %s is sent as %i', async (limit, expected) => {
    const { fn, calls } = fake(200, { products: [], next_page_token: null });
    await new Channel3Client({ apiKey: 'k', fetch: fn }).search('q', { limit });
    expect(JSON.parse(String(calls[0].init.body)).limit).toBe(expected);
  });

  it.each([-1, 0, 1.5, NaN])('maxPriceCents %s throws', async (maxPriceCents) => {
    const { fn, calls } = fake(200, { products: [], next_page_token: null });
    await expect(new Channel3Client({ apiKey: 'k', fetch: fn }).search('q', { maxPriceCents }))
      .rejects.toThrow('maxPriceCents must be a positive integer');
    expect(calls).toHaveLength(0);
  });
});

describe('Channel3Client response parsing', () => {
  it('throws Channel3Error on a 200 with a non-JSON body', async () => {
    const { fn } = fakeText(200, '<html>oops</html>');
    const err = await new Channel3Client({ apiKey: 'k', fetch: fn }).search('q').catch((e) => e);
    expect(err).toBeInstanceOf(Channel3Error);
    expect(err).toMatchObject({ status: 200, message: 'Unexpected response from Channel3' });
  });

  it('throws Channel3Error on a 200 with no products array', async () => {
    const { fn } = fake(200, { next_page_token: null });
    await expect(new Channel3Client({ apiKey: 'k', fetch: fn }).search('q'))
      .rejects.toMatchObject({ status: 200, message: 'Unexpected response from Channel3' });
  });

  it('returns [] when products is empty', async () => {
    const { fn } = fake(200, { products: [], next_page_token: null });
    expect(await new Channel3Client({ apiKey: 'k', fetch: fn }).search('q')).toEqual([]);
  });
});

describe('Channel3Client description and ids', () => {
  it('falls back to key_features when description is an empty string', async () => {
    const { fn } = fake(200, { ...raw, description: '   ' });
    const p = await new Channel3Client({ apiKey: 'k', fetch: fn }).getProduct('x');
    expect(p.description).toBe('Ergonomic design. Integrated palm rest');
  });

  it('percent-encodes product ids', async () => {
    const { fn, calls } = fake(200, raw);
    await new Channel3Client({ apiKey: 'k', fetch: fn }).getProduct('a/b?');
    expect(calls[0].url).toBe('https://api.trychannel3.com/v1/products/a%2Fb%3F');
  });
});
