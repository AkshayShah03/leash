// Mirrors gateway/src/types.ts, gateway/src/scout/{channel3,agent}.ts and the
// publicMandate shape in gateway/src/http.ts.

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
  reviewThreshold: number;
}

/** Mandate as returned by the API: no vault fields, plus `connected`. */
export interface PublicMandate extends Mandate {
  connected: boolean;
}

export type MandateInput = Omit<Mandate, 'id'>;

export type ProposalStatus =
  | 'proposed'
  | 'auto_approved'
  | 'pending_human'
  | 'denied'
  | 'human_approved'
  | 'captured'
  | 'tracked'
  | 'refunded'
  | 'failed';

export type Actor = 'agent' | 'owner' | 'policy' | 'intent' | 'paypal' | 'system';

export interface ProposalInput {
  title: string;
  description: string;
  category: string;
  categoryPath?: string[];
  merchant: string;
  priceCents: number;
  currency: string;
  productUrl?: string;
  userRequest: string;
}

export interface IntentVerdict {
  score: number;
  reason: string;
}

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

export interface ScoutTurnResult {
  text: string;
  products: ProductSummary[];
  proposals: Proposal[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  mandateId: string;
  conversationId: string;
  messages: ChatMessage[];
}
