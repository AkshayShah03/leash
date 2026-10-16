import { formatUsd } from './money';
import type { Mandate, ProposalInput, RuleResult, SpendHistory } from './types';

const normCat = (s: string) => s.trim().toLowerCase().replace(/[-_]+/g, ' ');

export function normMerchant(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d*$/, '')
    .replace(/^www\./, '')
    .replace(/\.+$/, '');
}

export function evaluatePolicy(m: Mandate, p: ProposalInput, h: SpendHistory): RuleResult {
  if (!Number.isInteger(p.priceCents) || p.priceCents <= 0) {
    return { ok: false, reasons: ['Price must be a positive whole number of cents'] };
  }
  if (![m.perOrderCapCents, m.monthlyBudgetCents, h.monthSpentCents, m.maxOrdersPerDay, h.ordersToday].every(Number.isFinite)) {
    return { ok: false, reasons: ['Mandate or spend data is invalid'] };
  }
  const reasons: string[] = [];

  if (p.currency !== m.currency) {
    reasons.push(`Currency ${p.currency} does not match mandate currency ${m.currency}`);
  }
  if (p.priceCents > m.perOrderCapCents) {
    reasons.push(`Price ${formatUsd(p.priceCents)} exceeds per-order cap ${formatUsd(m.perOrderCapCents)}`);
  }
  const remaining = Math.max(0, m.monthlyBudgetCents - h.monthSpentCents);
  if (p.priceCents > remaining) {
    reasons.push(`Price ${formatUsd(p.priceCents)} exceeds remaining monthly budget ${formatUsd(remaining)}`);
  }
  const candidates = [p.category, ...(p.categoryPath ?? [])].map(normCat);
  if (m.allowedCategories.length > 0 && !m.allowedCategories.map(normCat).some((a) => candidates.includes(a))) {
    reasons.push(`Category "${p.category}" is not in the allowed categories`);
  }
  const merchant = normMerchant(p.merchant);
  if (m.blockedMerchants.map(normMerchant).includes(merchant)) {
    reasons.push(`Merchant "${p.merchant}" is blocked`);
  }
  if (m.allowedMerchants !== null && !m.allowedMerchants.map(normMerchant).includes(merchant)) {
    reasons.push(`Merchant "${p.merchant}" is not in the allowed merchants`);
  }
  if (h.ordersToday >= m.maxOrdersPerDay) {
    reasons.push(`Daily order limit of ${m.maxOrdersPerDay} reached`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
