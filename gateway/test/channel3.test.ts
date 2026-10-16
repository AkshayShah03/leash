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
