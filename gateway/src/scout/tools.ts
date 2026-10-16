import { tool } from 'ai';
import { z } from 'zod';
import type { Proposal, ProposalInput } from '../types';
import { Channel3Error, type Channel3Client, type ProductSummary } from './channel3';
import { GatewayError, type GatewayClient } from './gateway-client';

const MAX_PRODUCTS = 6;

export interface ScoutContext {
  mandateId: string;
  conversationId: string;
  /** Latest user chat message, provided by the server (never by the model). */
  userRequest: string;
  channel3: Pick<Channel3Client, 'search' | 'getProduct'>;
  gateway: Pick<GatewayClient, 'getMandate' | 'propose' | 'listProposals'>;
  seen: Map<string, ProductSummary>;
  /** Every proposal id the gateway returned this turn, so a later failure can still surface them. */
  proposedIds: string[];
}

function normaliseDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

function findOffer(product: ProductSummary, merchantDomain: string) {
  const wanted = normaliseDomain(merchantDomain);
  return product.offers.find(
    (o) => o.availability === 'InStock' && !!o.domain && !!o.url && normaliseDomain(o.domain) === wanted,
  );
}

/** Every purchase field comes from Channel3 data or the server-provided user request. */
export function buildProposalInput(
  product: ProductSummary,
  merchantDomain: string,
  userRequest: string,
): ProposalInput {
  const offer = findOffer(product, merchantDomain);
  if (!offer) throw new Error(`No in-stock offer from ${merchantDomain}`);
  return {
    title: product.title,
    description: product.description,
    category: product.category,
    categoryPath: product.categoryPath,
    merchant: normaliseDomain(offer.domain),
    priceCents: offer.priceCents,
    currency: offer.currency,
    productUrl: offer.url,
    userRequest,
  };
}

const usd = (cents: number) => cents / 100;
const NO_OFFER = 'No in-stock offer from ';
const UNKNOWN_RESULT =
  'The result is unknown — the purchase may still complete. Check the approvals inbox or ledger before trying again.';

/** Short, safe error text for the model; the full error is logged server-side. */
function toolError(e: unknown, where: 'search' | 'lookup' | 'other' = 'other'): { error: string } {
  console.error('[scout] tool error:', e);
  if (where === 'lookup') {
    return e instanceof Channel3Error && e.status === 404
      ? { error: 'That product could not be found' }
      : { error: 'Product search is unavailable right now' };
  }
  if (e instanceof Channel3Error) return { error: 'Product search is unavailable right now' };
  if (e instanceof GatewayError) {
    return {
      error: e.status === 0 ? 'The payment gateway is unreachable right now' : `The gateway rejected the request (HTTP ${e.status})`,
    };
  }
  if (e instanceof Error && e.message.startsWith(NO_OFFER)) return { error: e.message };
  return { error: 'Something went wrong' };
}

export function makeScoutTools(ctx: ScoutContext) {
  const search_products = tool({
    description: 'Search for products to buy. Returns up to 6 products with merchant offers and USD prices.',
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      maxPriceUsd: z.number().positive().optional(),
    }),
    execute: async ({ query, maxPriceUsd }) => {
      try {
        const opts: { maxPriceCents?: number; limit: number } = { limit: MAX_PRODUCTS };
        if (maxPriceUsd !== undefined) opts.maxPriceCents = Math.round(maxPriceUsd * 100);
        const found = (await ctx.channel3.search(query, opts)).slice(0, MAX_PRODUCTS);
        for (const p of found) ctx.seen.set(p.id, p);
        return {
          products: found.map((p) => ({
            id: p.id,
            title: p.title,
            brand: p.brand,
            imageUrl: p.imageUrl,
            category: p.category,
            offers: p.offers.map((o) => ({ merchant: o.domain, priceUsd: usd(o.priceCents), url: o.url })),
          })),
        };
      } catch (e) {
        return toolError(e);
      }
    },
  });

  const propose_purchase = tool({
    description:
      'Propose buying one product from one merchant. The gateway decides: approved/tracked, needs owner approval, or denied. Price and details are filled in by the server. Proposing the same product from the same merchant again in one conversation returns the earlier proposal instead of buying again.',
    inputSchema: z.object({ productId: z.string().min(1), merchantDomain: z.string().min(1) }),
    execute: async ({ productId, merchantDomain }) => {
      try {
        let product = ctx.seen.get(productId);
        if (!product) {
          try {
            product = await ctx.channel3.getProduct(productId);
          } catch (e) {
            return toolError(e, 'lookup');
          }
        }
        ctx.seen.set(product.id, product);
        const input = buildProposalInput(product, merchantDomain, ctx.userRequest);
        const key = `scout:${ctx.conversationId}:${product.id}:${input.merchant}`;
        const proposal: Proposal = await ctx.gateway.propose(ctx.mandateId, input, key);
        ctx.proposedIds.push(proposal.id);
        return {
          status: proposal.status,
          reasons: proposal.reasons,
          intent: proposal.intent,
          proposalId: proposal.id,
          priceUsd: usd(input.priceCents),
          merchant: input.merchant,
          title: input.title,
          ...(proposal.status === 'proposed' ? { note: 'still processing' } : {}),
        };
      } catch (e) {
        if (e instanceof GatewayError && e.status === 0) {
          console.error('[scout] tool error:', e);
          return { error: UNKNOWN_RESULT };
        }
        return toolError(e);
      }
    },
  });

  const check_budget = tool({
    description: "Show the owner's mandate: goal, per-order cap, monthly budget, allowed categories.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const m = await ctx.gateway.getMandate(ctx.mandateId);
        return {
          goal: m.goal,
          perOrderCapUsd: usd(m.perOrderCapCents),
          monthlyBudgetUsd: usd(m.monthlyBudgetCents),
          allowedCategories: m.allowedCategories,
          connected: m.connected,
        };
      } catch (e) {
        return toolError(e);
      }
    },
  });

  return { search_products, propose_purchase, check_budget };
}
