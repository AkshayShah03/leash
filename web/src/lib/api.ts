import type {
  ChatRequest,
  LedgerEvent,
  MandateInput,
  Proposal,
  ProposalStatus,
  PublicMandate,
  ScoutTurnResult,
} from './types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, code?: string) {
    super(code ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized: (() => void) | null = null;
/** Registers the app-wide handler called when any API call (except the session endpoints) returns 401. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-leash-csrf'] = '1';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let code: string | undefined;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string') code = data.error;
    } catch {
      // non-JSON error body
    }
    if (res.status === 401 && path !== '/api/session') onUnauthorized?.();
    throw new ApiError(res.status, code);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

export const api = {
  async session(): Promise<boolean> {
    try {
      await request('GET', '/api/session');
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return false;
      throw e;
    }
  },
  async login(passcode: string): Promise<void> {
    await request('POST', '/api/session', { passcode });
  },
  async logout(): Promise<void> {
    await request('DELETE', '/api/session');
  },
  listMandates: () => request<PublicMandate[]>('GET', '/api/mandates'),
  getMandate: (id: string) => request<PublicMandate>('GET', `/api/mandates/${enc(id)}`),
  createMandate: (input: MandateInput) => request<PublicMandate>('POST', '/api/mandates', input),
  updateMandate: (id: string, patch: Partial<MandateInput>) =>
    request<PublicMandate>('PATCH', `/api/mandates/${enc(id)}`, patch),
  connect: (id: string) => request<{ approveUrl: string }>('POST', `/api/mandates/${enc(id)}/connect`, {}),
  listProposals: (mandateId: string, status?: ProposalStatus) =>
    request<Proposal[]>(
      'GET',
      `/api/proposals?mandate=${enc(mandateId)}${status ? `&status=${enc(status)}` : ''}`,
    ),
  approve: (id: string) => request<Proposal>('POST', `/api/proposals/${enc(id)}/approve`, {}),
  deny: (id: string, reason?: string) => request<Proposal>('POST', `/api/proposals/${enc(id)}/deny`, { reason }),
  refund: (id: string) => request<Proposal>('POST', `/api/proposals/${enc(id)}/refund`, {}),
  ledger: (mandateId: string) => request<LedgerEvent[]>('GET', `/api/ledger?mandate=${enc(mandateId)}`),
  chat: (body: ChatRequest) => request<ScoutTurnResult>('POST', '/api/scout/chat', body),
};
