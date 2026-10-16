import { serve } from '@hono/node-server';
import { loadPayPalConfig } from './config';
import { EventBus } from './events';
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

const uiPasscode = required('LEASH_UI_PASSCODE');
const sessionSecret = required('LEASH_SESSION_SECRET');
if (uiPasscode.length < 8) throw new Error('LEASH_UI_PASSCODE must be at least 8 characters');
if (sessionSecret.length < 32) throw new Error('LEASH_SESSION_SECRET must be at least 32 characters (e.g. `openssl rand -hex 32`)');

const port = Number(process.env.PORT ?? 8787);
const paypal = new PayPalRest(new PayPalClient(loadPayPalConfig()));
const store = new Store(process.env.LEASH_DB_PATH ?? 'leash.db');
const events = new EventBus();
const leash = new Leash({ store, paypal, intent: makeIntentChecker(llmGenerate(), 15_000), onEvent: (e) => events.publish(e) });
const app = createApp({
  leash,
  store,
  vault: paypal,
  events,
  keys: { agent: agentKey, owner: ownerKey },
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
  session: { passcode: uiPasscode, secret: sessionSecret },
});

serve({ fetch: app.fetch, port }, (info) => console.log(`Leash gateway listening on http://localhost:${info.port}`));
