export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

export class PayPalError extends Error {
  constructor(
    public status: number,
    public debugId: string | undefined,
    public body: unknown,
  ) {
    super(
      `PayPal API error ${status}${debugId ? ` (debug_id ${debugId})` : ''}: ${JSON.stringify(body).slice(0, 500)}`,
    );
  }
}

type Json = Record<string, any>;

export class PayPalClient {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private cfg: PayPalConfig,
    private fetchFn: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.token;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await this.fetchFn(`${this.cfg.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = (await res.json()) as Json;
    if (!res.ok) throw new PayPalError(res.status, body.debug_id, body);
    this.cached = {
      token: body.access_token,
      expiresAt: this.now() + (body.expires_in - 60) * 1000,
    };
    return body.access_token;
  }

  async request<T = Json>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    opts: { body?: unknown; requestId?: string } = {},
  ): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (opts.requestId) headers['PayPal-Request-Id'] = opts.requestId;
    const res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as Json) : {};
    if (!res.ok) throw new PayPalError(res.status, body.debug_id, body);
    return body as T;
  }
}
