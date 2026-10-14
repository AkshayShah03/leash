import { decide, type Decision } from './decision';
import type { IntentCheck } from './intent';
import type { PayPalApi } from './paypal/api';
import { PayPalError } from './paypal/client';
import { evaluatePolicy } from './policy';
import type { ProposalPatch, Store } from './store';
import type { Actor, LedgerEvent, Mandate, Proposal, ProposalInput, ProposalStatus } from './types';

export class LeashError extends Error {
  constructor(
    public code: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

export interface LeashDeps {
  store: Store;
  paypal: PayPalApi;
  intent: IntentCheck;
  now?: () => Date;
  onEvent?: (e: LedgerEvent) => void;
}

function summarize(d: Decision): string {
  if (d.outcome === 'auto_approved' && d.intent) return `intent ${d.intent.score.toFixed(2)}: ${d.intent.reason}`;
  return d.reasons.join('; ');
}

/** Ambiguous failures (5xx, network) may have moved money; declines, validation and an incomplete capture are definitive. */
function isRetryableChargeError(e: unknown): boolean {
  if (e instanceof PayPalError) return e.status >= 500;
  return !(e instanceof Error && e.message.startsWith('Capture not completed'));
}

export class Leash {
  private refunding = new Set<string>();

  constructor(private d: LeashDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  private mandate(id: string): Mandate {
    const m = this.d.store.getMandate(id);
    if (!m) throw new LeashError('not_found', `Mandate ${id} not found`);
    return m;
  }

  private proposal(id: string): Proposal {
    const p = this.d.store.getProposal(id);
    if (!p) throw new LeashError('not_found', `Proposal ${id} not found`);
    return p;
  }

  private event(p: Proposal, status: ProposalStatus, actor: Actor, detail: string): void {
    const e = this.d.store.appendEvent({
      proposalId: p.id, mandateId: p.mandateId, status, actor, detail, at: this.now().toISOString(),
    });
    try {
      this.d.onEvent?.(e);
    } catch (err) {
      console.error('Leash onEvent listener threw', err);
    }
  }

  private transition(p: Proposal, status: ProposalStatus, actor: Actor, detail: string, patch: ProposalPatch = {}): Proposal {
    const updated = this.d.store.updateProposal(p.id, { ...patch, status });
    this.event(updated, status, actor, detail);
    return updated;
  }

  /** Synchronous re-check + commit: no await between reading spend and marking the proposal committed. */
  private commit(m: Mandate, p: Proposal, status: 'auto_approved' | 'human_approved', actor: Actor, detail: string, patch: ProposalPatch): Proposal {
    const rule = evaluatePolicy(m, p.input, this.d.store.spendHistory(m.id, this.now(), p.id));
    if (!rule.ok) {
      return this.transition(p, 'denied', 'policy', `Re-check failed: ${rule.reasons.join('; ')}`, { reasons: rule.reasons });
    }
    return this.transition(p, status, actor, detail, { ...patch, committedAt: p.committedAt ?? this.now().toISOString() });
  }

  async propose(mandateId: string, input: ProposalInput): Promise<Proposal> {
    const m = this.mandate(mandateId);
    const p = this.d.store.createProposal(mandateId, input, this.now());
    this.event(p, 'proposed', 'agent', `${input.title} from ${input.merchant}`);

    const rule = evaluatePolicy(m, input, this.d.store.spendHistory(mandateId, this.now(), p.id));
    const decision = await decide(rule, () => this.d.intent(m, input), m.reviewThreshold);
    const patch: ProposalPatch = { reasons: decision.reasons, intent: decision.intent };

    if (decision.outcome !== 'auto_approved') {
      return this.transition(p, decision.outcome, rule.ok ? 'intent' : 'policy', summarize(decision), patch);
    }
    const committed = this.commit(this.mandate(mandateId), p, 'auto_approved', 'intent', summarize(decision), patch);
    return committed.status === 'auto_approved' ? this.execute(committed) : committed;
  }

  async approve(proposalId: string): Promise<Proposal> {
    const p = this.proposal(proposalId);
    if (p.status !== 'pending_human') throw new LeashError('conflict', `Proposal is ${p.status}, not pending_human`);
    const committed = this.commit(this.mandate(p.mandateId), p, 'human_approved', 'owner', 'Approved by owner', {});
    return committed.status === 'human_approved' ? this.execute(committed) : committed;
  }

  deny(proposalId: string, reason = 'no reason given'): Proposal {
    const p = this.proposal(proposalId);
    if (p.status !== 'pending_human') throw new LeashError('conflict', `Proposal is ${p.status}, not pending_human`);
    const text = `Denied by owner: ${reason}`;
    return this.transition(p, 'denied', 'owner', text, { reasons: [text] });
  }

  async refund(proposalId: string): Promise<Proposal> {
    const p = this.proposal(proposalId);
    if ((p.status !== 'captured' && p.status !== 'tracked') || !p.paypal.captureId) {
      throw new LeashError('conflict', `Proposal is ${p.status}; only captured purchases can be refunded`);
    }
    if (this.refunding.has(p.id)) throw new LeashError('conflict', 'Refund already in progress');
    this.refunding.add(p.id);
    try {
      const r = await this.d.paypal.refundCapture(p.paypal.captureId, `refund-${p.id}`);
      return this.transition(p, 'refunded', 'owner', `Refund ${r.refundId} ${r.status}`, { paypal: { refundId: r.refundId } });
    } finally {
      this.refunding.delete(p.id);
    }
  }

  private async execute(p: Proposal): Promise<Proposal> {
    const m = this.mandate(p.mandateId);
    if (!m.vaultId) {
      const reason = 'PayPal is not connected for this mandate';
      return this.transition(p, 'failed', 'system', reason, { reasons: [reason] });
    }

    const args = {
      vaultId: m.vaultId,
      amountCents: p.input.priceCents,
      currency: p.input.currency,
      description: p.input.title,
      referenceId: p.id,
      requestId: `order-${p.id}`,
    };
    let charge: { orderId: string; captureId: string };
    try {
      charge = await this.d.paypal.chargeVaulted(args);
    } catch (first) {
      if (!isRetryableChargeError(first)) {
        const reason = (first as Error).message;
        return this.transition(p, 'failed', 'paypal', reason, { reasons: [reason] });
      }
      const firstMessage = (first as Error).message;
      // Same request id: PayPal idempotency returns the original result if the first attempt went through.
      try {
        charge = await this.d.paypal.chargeVaulted(args);
      } catch (second) {
        const reason = `PayPal outcome unknown after retry (${(second as Error).message}); check the PayPal dashboard for order reference ${p.id}`;
        return this.transition(p, 'failed', 'paypal', reason, { reasons: [reason] });
      }
      this.event(this.proposal(p.id), this.proposal(p.id).status, 'paypal', `Charge retried after: ${firstMessage}`);
    }
    const { orderId, captureId } = charge;
    const charged = this.transition(p, 'captured', 'paypal', `Order ${orderId}, capture ${captureId}`, {
      paypal: { orderId, captureId },
    });

    const trackingNumber = `LEASH${p.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    try {
      await this.d.paypal.addTracking({ orderId, captureId, trackingNumber, carrier: 'USPS' });
    } catch (e) {
      this.event(charged, 'captured', 'paypal', `Tracking not attached: ${(e as Error).message}`);
      return charged;
    }
    const current = this.proposal(p.id);
    if (current.status !== 'captured') {
      this.event(current, current.status, 'paypal', `Tracking ${trackingNumber} attached after status changed to ${current.status}`);
      return current;
    }
    return this.transition(current, 'tracked', 'paypal', `Tracking ${trackingNumber} (USPS)`, { paypal: { ...current.paypal, trackingNumber } });
  }
}
