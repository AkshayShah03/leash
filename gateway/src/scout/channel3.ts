const DEFAULT_BASE_URL = 'https://api.trychannel3.com/v1';
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 10;
const MAX_DESCRIPTION_CHARS = 1000;
const MAX_ERROR_CHARS = 300;

export interface ProductOffer {
  domain: string;
  priceCents: number;
  currency: string;
  availability: string;
  condition: string | null;
  url: string;
}

export interface ProductSummary {
  id: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  description: string;
  category: string;
  categoryPath: string[];
  offers: ProductOffer[];
}

export class Channel3Error extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'Channel3Error';
    this.status = status;
  }
}

interface RawImage {
  url: string;
  cleaned_url?: string | null;
  is_main_image?: boolean;
}

interface RawOffer {
  url: string;
  domain: string;
  price: { price: number | null; currency: string; compare_at_price?: number | null } | null;
  availability: string;
  condition: string | null;
}

interface RawProduct {
  id: string;
  title: string;
  description: string | null;
  brands?: Array<{ id: string; name: string }> | null;
  images?: RawImage[] | null;
  category?: {
    slug: string;
    title: string;
    path?: Array<{ slug: string; title: string }> | null;
  } | null;
  key_features?: string[] | null;
  offers?: RawOffer[] | null;
}

interface RawSearchResponse {
  products: RawProduct[];
  next_page_token: string | null;
}

function normalise(raw: RawProduct): ProductSummary {
  const images = raw.images ?? [];
  const mainImage = images.find((img) => img.is_main_image) ?? images[0];
  const imageUrl = mainImage ? (mainImage.cleaned_url ?? mainImage.url) : null;
  const description = (raw.description ?? (raw.key_features ?? []).join('. ')).trim().slice(0, MAX_DESCRIPTION_CHARS);

  const offers: ProductOffer[] = [];
  for (const offer of raw.offers ?? []) {
    const price = offer.price?.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) continue;
    offers.push({
      domain: offer.domain,
      priceCents: Math.round(price * 100),
      currency: offer.price?.currency ?? '',
      availability: offer.availability,
      condition: offer.condition ?? null,
      url: offer.url,
    });
  }

  return {
    id: raw.id,
    title: raw.title,
    brand: raw.brands?.[0]?.name ?? null,
    imageUrl,
    description,
    category: raw.category?.title ?? 'uncategorized',
    categoryPath: (raw.category?.path ?? []).map((p) => p.title),
    offers,
  };
}

export class Channel3Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  async search(
    query: string,
    opts: { maxPriceCents?: number; limit?: number } = {},
  ): Promise<ProductSummary[]> {
    const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const filters: Record<string, unknown> = { availability: ['InStock'] };
    if (opts.maxPriceCents !== undefined) {
      filters.price = { max_price: opts.maxPriceCents / 100 };
    }
    const body = await this.request<RawSearchResponse>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit, filters }),
    });
    return body.products.map(normalise);
  }

  async getProduct(id: string): Promise<ProductSummary> {
    const raw = await this.request<RawProduct>(`/products/${encodeURIComponent(id)}`, { method: 'GET' });
    return normalise(raw);
  }

  private async request<T>(path: string, init: { method: string; body?: string }): Promise<T> {
    const headers: Record<string, string> = { 'x-api-key': this.apiKey, accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Channel3Error(res.status, text.slice(0, MAX_ERROR_CHARS));
    }
    return (await res.json()) as T;
  }
}
