export type Currency = 'USD';

export interface Mandate {
  id: string;
  goal: string;
  currency: Currency;
  perOrderCapCents: number;
  monthlyBudgetCents: number;
  allowedCategories: string[]; // empty = any category
  allowedMerchants: string[] | null; // null = any merchant
  blockedMerchants: string[];
  maxOrdersPerDay: number;
  reviewThreshold: number; // intent score below this needs a human
  vaultId: string | null; // PayPal payment token; gateway-only
  setupTokenId: string | null; // pending vault setup; gateway-only
}

export type MandateInput = Omit<Mandate, 'id' | 'vaultId' | 'setupTokenId'>;

export interface ProposalInput {
  title: string;
  description: string;
  category: string;
  merchant: string;
  priceCents: number;
  currency: string;
  productUrl?: string;
  userRequest: string;
}

export interface SpendHistory {
  monthSpentCents: number;
  ordersToday: number;
}

export type RuleResult = { ok: true } | { ok: false; reasons: string[] };

export interface IntentVerdict {
  score: number;
  reason: string;
}

export type Outcome = 'auto_approved' | 'pending_human' | 'denied';

export type ProposalStatus =
  | 'proposed'
  | Outcome
  | 'human_approved'
  | 'captured'
  | 'tracked'
  | 'refunded'
  | 'failed';

export type Actor = 'agent' | 'owner' | 'policy' | 'intent' | 'paypal' | 'system';

export interface PayPalRefs {
  orderId?: string;
  captureId?: string;
  refundId?: string;
  trackingNumber?: string;
}

export interface Proposal {
  id: string;
  mandateId: string;
  input: ProposalInput;
  status: ProposalStatus;
  reasons: string[];
  intent: IntentVerdict | null;
  paypal: PayPalRefs;
  createdAt: string;
  /** Set once, when the proposal first becomes auto_approved/human_approved. */
  committedAt: string | null;
}

export interface LedgerEvent {
  seq: number;
  proposalId: string;
  mandateId: string;
  status: ProposalStatus;
  actor: Actor;
  detail: string;
  at: string;
}
