// Live smoke for Scout. Run `npm run smoke:scout` to create + connect a mandate,
// approve in PayPal, then `npm run smoke:scout -- <mandateId>` to chat.
import { randomUUID } from 'node:crypto';
import type { ScoutTurnResult } from '../src/scout/agent';

const base = (process.env.PUBLIC_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const ownerKey = process.env.LEASH_OWNER_KEY;
if (!ownerKey) throw new Error('LEASH_OWNER_KEY must be set');

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${ownerKey}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

const mandateId = process.argv[2];

if (!mandateId) {
  const m = await api<{ id: string }>('POST', '/api/mandates', {
    goal: 'Keep my home office stocked',
    perOrderCapCents: 6000,
    monthlyBudgetCents: 15000,
    allowedCategories: ['Input Devices', 'Office Supplies', 'Computer Accessories'],
  });
  const { approveUrl } = await api<{ approveUrl: string }>('POST', `/api/mandates/${m.id}/connect`);
  console.log(`Mandate: ${m.id}`);
  console.log(`Approve with the sandbox Personal account:\n${approveUrl}`);
  console.log(`Then run: npm run smoke:scout -- ${m.id}`);
} else {
  const conversationId = `smoke-${randomUUID()}`;
  const prompts = [
    'I need an ergonomic keyboard under $60',
    'also grab a nice desk lamp around $70',
    'get me a gaming headset',
  ];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const seen = new Map<string, { id: string; title: string; status: string }>();
  for (const prompt of prompts) {
    messages.push({ role: 'user', content: prompt });
    console.log(`\n> ${prompt}`);
    const r = await api<ScoutTurnResult>('POST', '/api/scout/chat', { mandateId, conversationId, messages: [...messages] });
    messages.push({ role: 'assistant', content: r.text });
    console.log(`Scout: ${r.text}`);
    console.log(`Products: ${r.products.length}`);
    for (const p of r.proposals) {
      seen.set(p.id, { id: p.id, title: p.input.title, status: p.status });
      console.log(`Proposal: ${p.input.title} [${p.status}] intent=${p.intent?.score ?? 'n/a'} reasons=${p.reasons.join('; ') || '-'}`);
    }
  }
  for (const s of seen.values()) {
    if (s.status === 'captured' || s.status === 'tracked') {
      const refunded = await api<{ status: string }>('POST', `/api/proposals/${s.id}/refund`);
      console.log(`Refunded ${s.title}: ${refunded.status}`);
    }
  }
}
