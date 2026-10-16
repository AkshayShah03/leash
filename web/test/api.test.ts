import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/lib/api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: url as string, init: init as RequestInit, headers: new Headers(init.headers) };
};

describe('api', () => {
  it('GET sends credentials but no csrf header', async () => {
    fetchMock.mockImplementation(async () => json([]));
    await api.listMandates();
    const { url, init, headers } = lastCall();
    expect(url).toBe('/api/mandates');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
    expect(headers.has('x-leash-csrf')).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it('POST, PATCH, DELETE send the csrf header', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await api.login('pw');
    let c = lastCall();
    expect(c.init.method).toBe('POST');
    expect(c.headers.get('x-leash-csrf')).toBe('1');
    expect(c.headers.get('content-type')).toBe('application/json');
    expect(c.init.credentials).toBe('same-origin');
    expect(JSON.parse(c.init.body as string)).toEqual({ passcode: 'pw' });

    await api.updateMandate('m1', { goal: 'x' });
    c = lastCall();
    expect(c.init.method).toBe('PATCH');
    expect(c.url).toBe('/api/mandates/m1');
    expect(c.headers.get('x-leash-csrf')).toBe('1');

    await api.logout();
    c = lastCall();
    expect(c.init.method).toBe('DELETE');
    expect(c.url).toBe('/api/session');
    expect(c.headers.get('x-leash-csrf')).toBe('1');
  });

  it('maps JSON errors to ApiError', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'conflict_thing' }, 409));
    const err = await api.approve('p1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('conflict_thing');
    expect(err.message).toBe('conflict_thing');
  });

  it('handles non-JSON error bodies', async () => {
    fetchMock.mockImplementation(async () => new Response('bad gateway', { status: 502 }));
    const err = await api.chat({ mandateId: 'm', conversationId: 'c', messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
  });

  it('login maps 401 to invalid_passcode', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'invalid_passcode' }, 401));
    const err = await api.login('nope').catch((e) => e);
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_passcode');
  });

  it('session() is true on 200 and false on 401', async () => {
    fetchMock.mockResolvedValueOnce(json({ owner: true }));
    expect(await api.session()).toBe(true);
    fetchMock.mockResolvedValueOnce(json({ owner: false }, 401));
    expect(await api.session()).toBe(false);
  });

  it('session() rethrows non-401 errors', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'internal_error' }, 500));
    await expect(api.session()).rejects.toBeInstanceOf(ApiError);
  });

  it('builds proposal, ledger and connect requests', async () => {
    fetchMock.mockImplementation(async () => json([]));
    await api.listProposals('m 1', 'pending_human');
    expect(lastCall().url).toBe('/api/proposals?mandate=m%201&status=pending_human');
    await api.listProposals('m1');
    expect(lastCall().url).toBe('/api/proposals?mandate=m1');
    await api.ledger('m1');
    expect(lastCall().url).toBe('/api/ledger?mandate=m1');
    await api.deny('p1', 'no');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ reason: 'no' });
    expect(lastCall().url).toBe('/api/proposals/p1/deny');
    await api.refund('p1');
    expect(lastCall().url).toBe('/api/proposals/p1/refund');
    fetchMock.mockImplementation(async () => json({ approveUrl: 'https://x' }));
    expect(await api.connect('m1')).toEqual({ approveUrl: 'https://x' });
    expect(lastCall().url).toBe('/api/mandates/m1/connect');
  });

  it('tolerates an empty 2xx body', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
  });
});
