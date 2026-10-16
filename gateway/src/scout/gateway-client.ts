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
  /** Per-request timeout. Default 45 s: a propose can take ~15 s for the AI check plus PayPal time. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;

/** Agent-side HTTP client. Holds only the agent key; never the owner key. */
export class GatewayClient {
  private readonly baseUrl: string;
  private readonly agentKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: GatewayClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.agentKey = opts.agentKey;
    this.fetchFn = opts.fetch ?? fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    let res: Response;
    let text: string;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await res.text();
    } catch (e) {
      // Covers refused connections, DNS failures, and AbortError/TimeoutError from the signal.
      const message = e instanceof Error ? e.message : String(e);
      throw new GatewayError(0, `gateway unreachable: ${message}`);
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      const err = parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as { error: unknown }).error : undefined;
      const message = typeof err === 'string' && err ? err : text || res.statusText || `HTTP ${res.status}`;
      throw new GatewayError(res.status, message);
    }
    if (parsed === undefined) throw new GatewayError(res.status, 'invalid JSON from gateway');
    return parsed as T;
  }
}
