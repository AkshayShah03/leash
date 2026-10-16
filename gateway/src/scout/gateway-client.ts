import type { Proposal, ProposalInput } from '../types';

/** Mandate as the agent may see it: no PayPal vault or setup-token fields. */
export interface PublicMandate {
  id: string;
  goal: string;
  currency: string;
  perOrderCapCents: number;
  monthlyBudgetCents: number;
  allowedCategories: string[];
  connected: boolean;
}

export class GatewayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface GatewayClientOptions {
  baseUrl: string;
  agentKey: string;
  fetch?: typeof fetch;
}

/** Agent-side HTTP client. Holds only the agent key; never the owner key. */
export class GatewayClient {
  private readonly baseUrl: string;
  private readonly agentKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: GatewayClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.agentKey = opts.agentKey;
    this.fetchFn = opts.fetch ?? fetch;
  }

  getMandate(id: string): Promise<PublicMandate> {
    return this.request<PublicMandate>('GET', `/api/mandates/${encodeURIComponent(id)}`);
  }

  propose(mandateId: string, input: ProposalInput, idempotencyKey: string): Promise<Proposal> {
    return this.request<Proposal>(
      'POST',
      `/api/mandates/${encodeURIComponent(mandateId)}/proposals`,
      input,
      { 'idempotency-key': idempotencyKey },
    );
  }

  listProposals(mandateId: string): Promise<Proposal[]> {
    return this.request<Proposal[]>('GET', `/api/proposals?mandate=${encodeURIComponent(mandateId)}`);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.agentKey}`, ...extraHeaders };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      const err = parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as { error: unknown }).error : undefined;
      throw new GatewayError(res.status, typeof err === 'string' ? err : text);
    }
    return parsed as T;
  }
}
