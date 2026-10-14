import { serve } from '@hono/node-server';
import { loadPayPalConfig } from './config';
import { createApp } from './http';
import { makeIntentChecker } from './intent';
import { llmGenerate } from './intent-llm';
import { Leash } from './leash';
import { PayPalRest } from './paypal/api';
import { PayPalClient } from './paypal/client';
import { Store } from './store';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (see .env.example)`);
  return v;
}

const agentKey = required('LEASH_AGENT_KEY');
const ownerKey = required('LEASH_OWNER_KEY');
if (agentKey === 'change-me-agent' || ownerKey === 'change-me-owner')
  throw new Error('LEASH_AGENT_KEY / LEASH_OWNER_KEY still have the .env.example placeholder values; set real secrets');
if (agentKey === ownerKey) throw new Error('LEASH_AGENT_KEY and LEASH_OWNER_KEY must differ');

const port = Number(process.env.PORT ?? 8787);
const paypal = new PayPalRest(new PayPalClient(loadPayPalConfig()));
const store = new Store(process.env.LEASH_DB_PATH ?? 'leash.db');
const leash = new Leash({ store, paypal, intent: makeIntentChecker(llmGenerate(), 15_000) });
const app = createApp({
  leash,
  store,
  vault: paypal,
  keys: { agent: agentKey, owner: ownerKey },
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
});

serve({ fetch: app.fetch, port }, (info) => console.log(`Leash gateway listening on http://localhost:${info.port}`));
