import { generateText, stepCountIs, type LanguageModel } from 'ai';
import type { Proposal } from '../types';
import type { ProductSummary } from './channel3';
import { makeScoutTools, type ScoutContext } from './tools';

const MAX_UI_PRODUCTS = 12;

export const SCOUT_SYSTEM = `You are Scout, a shopping agent that buys on behalf of the owner, strictly within their mandate.
- Call check_budget once before proposing any purchase.
- Search first with search_products, then propose with propose_purchase using a product id and merchant domain from the results.
- Propose at most one item per user request unless the user explicitly asks for more.
- You cannot approve, override, or retry denied purchases. If a purchase is denied, explain why plainly and do not try to work around it.
- If a purchase needs approval, say plainly that it is waiting for the owner.
- Never claim a purchase happened unless propose_purchase returned status "captured" or "tracked".`;

export interface ScoutTurnResult {
  text: string;
  products: ProductSummary[];
  proposals: Proposal[];
}

export async function runScoutTurn(
  deps: { model: LanguageModel; channel3: ScoutContext['channel3']; gateway: ScoutContext['gateway'] },
  args: {
    mandateId: string;
    conversationId: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  },
): Promise<ScoutTurnResult> {
  const lastUser = [...args.messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error('No user message');

  const ctx: ScoutContext = {
    mandateId: args.mandateId,
    conversationId: args.conversationId,
    userRequest: lastUser.content,
    channel3: deps.channel3,
    gateway: deps.gateway,
    seen: new Map(),
  };

  const result = await generateText({
    model: deps.model,
    system: SCOUT_SYSTEM,
    messages: args.messages,
    tools: makeScoutTools(ctx),
    stopWhen: stepCountIs(6),
    maxOutputTokens: 1500,
  });

  const products = new Map<string, ProductSummary>();
  const proposalIds = new Set<string>();
  for (const step of result.steps) {
    for (const r of step.toolResults) {
      const out = r.output as Record<string, unknown> | null;
      if (!out || typeof out !== 'object') continue;
      if (r.toolName === 'search_products' && Array.isArray(out.products)) {
        for (const p of out.products as Array<{ id: string }>) {
          const full = ctx.seen.get(p.id);
          if (full && products.size < MAX_UI_PRODUCTS) products.set(full.id, full);
        }
      } else if (r.toolName === 'propose_purchase' && typeof out.proposalId === 'string') {
        proposalIds.add(out.proposalId);
      }
    }
  }

  let proposals: Proposal[] = [];
  if (proposalIds.size > 0) {
    proposals = (await deps.gateway.listProposals(args.mandateId)).filter((p) => proposalIds.has(p.id));
  }
  return { text: result.text, products: [...products.values()], proposals };
}
