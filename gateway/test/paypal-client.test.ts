import { describe, expect, it } from 'vitest';
import { PayPalClient, PayPalError } from '../src/paypal/client';
import { loadPayPalConfig } from '../src/config';
import { TOKEN_RESPONSE, fakeFetch } from './helpers';

const cfg = { clientId: 'id', clientSecret: 'secret', baseUrl: 'https://pp.test' };

describe('PayPalClient', () => {
  it('fetches an OAuth token with basic auth and caches it', async () => {
    const { fn, calls } = fakeFetch([
      TOKEN_RESPONSE,
      { status: 200, body: { ok: 1 } },
      { status: 200, body: { ok: 2 } },
    ]);
    const c = new PayPalClient(cfg, fn);
    await c.request('GET', '/a');
    await c.request('GET', '/b');
    expect(calls.map((x) => x.url)).toEqual([
      'https://pp.test/v1/oauth2/token',
      'https://pp.test/a',
      'https://pp.test/b',
    ]);
    const auth = (calls[0].init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect(calls[0].init.body).toBe('grant_type=client_credentials');
  });

  it('refreshes the token after expiry', async () => {
    let now = 0;
    const { fn, calls } = fakeFetch([
      { status: 200, body: { access_token: 't1', expires_in: 120 } },
      { status: 200, body: {} },
      { status: 200, body: { access_token: 't2', expires_in: 120 } },
      { status: 200, body: {} },
    ]);
    const c = new PayPalClient(cfg, fn, () => now);
    await c.request('GET', '/a');
    now = 61_000; // past expires_in - 60s
    await c.request('GET', '/b');
    expect(calls.filter((x) => x.url.endsWith('/v1/oauth2/token'))).toHaveLength(2);
    expect((calls[3].init.headers as Record<string, string>).Authorization).toBe('Bearer t2');
  });

  it('sends JSON body, bearer token and PayPal-Request-Id', async () => {
    const { fn, calls } = fakeFetch([TOKEN_RESPONSE, { status: 201, body: { id: 'X' } }]);
    const c = new PayPalClient(cfg, fn);
    const res = await c.request<{ id: string }>('POST', '/v2/checkout/orders', {
      body: { a: 1 },
      requestId: 'req-1',
    });
    expect(res.id).toBe('X');
    const h = calls[1].init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok-1');
    expect(h['PayPal-Request-Id']).toBe('req-1');
    expect(h.Prefer).toBe('return=representation');
    expect(calls[1].init.body).toBe('{"a":1}');
  });

  it('throws PayPalError with status and debug_id on failure', async () => {
    const { fn } = fakeFetch([
      TOKEN_RESPONSE,
      { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg-9' } },
    ]);
    const c = new PayPalClient(cfg, fn);
    const err = await c.request('POST', '/x', { body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(422);
    expect(err.debugId).toBe('dbg-9');
  });
});

describe('PayPalClient timeouts', () => {
  // A hung fetch that honours the abort signal rejects with a DOMException (TimeoutError),
  // i.e. a non-PayPalError network error, which Leash treats as retryable.
  const hung = ((_url: unknown, init?: RequestInit) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
    })) as typeof fetch;

  it('aborts a hung OAuth call as a non-PayPalError network error', async () => {
    const err = await new PayPalClient(cfg, hung, Date.now, { timeoutMs: 30 }).accessToken().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PayPalError);
  });

  it('aborts a hung API call as a non-PayPalError network error', async () => {
    let n = 0;
    const fn = ((u: unknown, init?: RequestInit) =>
      n++ === 0 ? Promise.resolve(new Response(JSON.stringify(TOKEN_RESPONSE.body), { status: 200 })) : hung(u as string, init)) as typeof fetch;
    const err = await new PayPalClient(cfg, fn, Date.now, { timeoutMs: 30 }).request('GET', '/a').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PayPalError);
  });
});

describe('loadPayPalConfig', () => {
  it('requires credentials and defaults to sandbox', () => {
    expect(() => loadPayPalConfig({})).toThrow('PAYPAL_CLIENT_ID');
    expect(loadPayPalConfig({ PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b' }).baseUrl).toBe(
      'https://api-m.sandbox.paypal.com',
    );
  });

  describe('non-JSON error bodies', () => {
    const html = () => new Response('<html>Bad Gateway</html>', { status: 502 });

    it('request() rejects with PayPalError(502) on an HTML body', async () => {
      let n = 0;
      const fn = (async () =>
        n++ === 0
          ? new Response(JSON.stringify(TOKEN_RESPONSE.body), { status: 200 })
          : html()) as typeof fetch;
      const err = await new PayPalClient(cfg, fn).request('GET', '/a').catch((e) => e);
      expect(err).toBeInstanceOf(PayPalError);
      expect(err.status).toBe(502);
    });

    it('accessToken() rejects with PayPalError(502) on an HTML body', async () => {
      const fn = (async () => html()) as typeof fetch;
      const err = await new PayPalClient(cfg, fn).accessToken().catch((e) => e);
      expect(err).toBeInstanceOf(PayPalError);
      expect(err.status).toBe(502);
    });

    it('request() throws PayPalError on an ok response with an unparsable body', async () => {
      let n = 0;
      const fn = (async () =>
        n++ === 0
          ? new Response(JSON.stringify(TOKEN_RESPONSE.body), { status: 200 })
          : new Response('not json', { status: 200 })) as typeof fetch;
      const err = await new PayPalClient(cfg, fn).request('GET', '/a').catch((e) => e);
      expect(err).toBeInstanceOf(PayPalError);
    });
  });
});
