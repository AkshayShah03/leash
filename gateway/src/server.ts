import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadPayPalConfig } from './config';
import { EventBus } from './events';
import { createApp } from './http';
import { makeIntentChecker } from './intent';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { DEFAULT_MODEL, llmGenerate } from './intent-llm';
import { Leash } from './leash';
import { PayPalRest } from './paypal/api';
import { PayPalClient } from './paypal/client';
import { runScoutTurn } from './scout/agent';
import { Channel3Client } from './scout/channel3';
import { GatewayClient } from './scout/gateway-client';
import { seedDemo } from './seed';
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
if (uiPasscode === ownerKey || uiPasscode === agentKey) throw new Error('LEASH_UI_PASSCODE must differ from LEASH_OWNER_KEY and LEASH_AGENT_KEY');
if (uiPasscode.length < 8) throw new Error('LEASH_UI_PASSCODE must be at least 8 characters');
if (sessionSecret.length < 32) throw new Error('LEASH_SESSION_SECRET must be at least 32 characters (e.g. `openssl rand -hex 32`)');

const port = Number(process.env.PORT || 8787);
const paypal = new PayPalRest(new PayPalClient(loadPayPalConfig()));
const store = new Store(process.env.LEASH_DB_PATH || 'leash.db');
if (process.env.DEMO_SEED === '1' && seedDemo(store, { vaultId: process.env.DEMO_VAULT_ID || undefined })) console.log('Demo rules seeded');
const events = new EventBus();
const leash = new Leash({ store, paypal, intent: makeIntentChecker(llmGenerate(), 15_000), onEvent: (e) => events.publish(e) });
const scoutDeps = {
  model: createOpenRouter({ apiKey: required('OPENROUTER_API_KEY') }).chat(process.env.SCOUT_MODEL || process.env.LEASH_MODEL || DEFAULT_MODEL),
  channel3: new Channel3Client({ apiKey: required('CHANNEL3_API_KEY') }),
  gateway: new GatewayClient({ baseUrl: process.env.GATEWAY_INTERNAL_URL || `http://127.0.0.1:${port}`, agentKey }),
};
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
const webRoot = existsSync(join(webDist, 'index.html')) ? webDist : undefined;
const app = createApp({
  leash,
  store,
  vault: paypal,
  events,
  keys: { agent: agentKey, owner: ownerKey },
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}`,
  session: { passcode: uiPasscode, secret: sessionSecret },
  webRoot,
  scout: (args) => runScoutTurn(scoutDeps, args),
});

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => console.log(`Leash gateway listening on http://localhost:${info.port}`));
