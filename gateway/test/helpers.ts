export interface FakeResponse {
  status: number;
  body: unknown;
}

export function fakeFetch(responses: FakeResponse[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected fetch to ${String(url)}`);
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { fn, calls };
}

export const TOKEN_RESPONSE = { status: 200, body: { access_token: 'tok-1', expires_in: 3600 } };
