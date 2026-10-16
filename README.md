# Leash

**Agents need a leash before they get a wallet.**

Leash is a trust layer between AI agents and PayPal. Agents can only *propose* purchases. Leash enforces spending rules the agent cannot override, runs an AI intent check that can only make decisions stricter, sends edge cases to a human, executes approved purchases with a vaulted PayPal wallet, and records every step in an append-only ledger.

> Status: Plans 1-3 done: gateway, Scout shopping agent, and web UI. Deployment and demo polish are next.

## How it works

1. **Mandate** — the owner sets a goal and hard limits (per-order cap, monthly budget, categories, merchants, daily orders) and connects PayPal once (PayPal Vault).
2. **Policy engine** — deterministic rules; a denial is final.
3. **AI intent check** — an open-weight model (Kimi K3 by default, via OpenRouter) scores how well the product matches the goal and request. Product text is fenced as untrusted data. A low score sends the purchase to the owner; it can never approve something the rules denied.
4. **Execution** — PayPal Orders v2 charge on the vaulted wallet, shipment tracking, one-click refunds. Every call is idempotent (`PayPal-Request-Id`).
5. **Roles** — the agent key can only propose and read; approve/deny/refund/connect need the owner key.

## Sandbox note

Leash runs entirely on the PayPal **sandbox**. Purchases are paid to the project's own sandbox merchant account; no real money moves.

## Run it

Requirements: Node >= 22.13, a PayPal developer sandbox app with Vault ("save payment methods") enabled, an OpenRouter API key, a Channel3 API key.

```bash
cd web && npm install && npm run build     # builds the UI the gateway serves
cd ../gateway && npm install
cp .env.example .env
```

Fill in `gateway/.env`:

- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`: sandbox app credentials
- `OPENROUTER_API_KEY` and `CHANNEL3_API_KEY`
- `LEASH_AGENT_KEY` and `LEASH_OWNER_KEY`: must be changed from the `change-me-*` placeholders and differ from each other, or the server refuses to start
- `LEASH_UI_PASSCODE`: random, at least 8 chars (`openssl rand -base64 12`)
- `LEASH_SESSION_SECRET`: at least 32 chars (`openssl rand -hex 32`)

```bash
npm run dev    # gateway + UI on http://localhost:8787
```

Open http://localhost:8787 and log in with the passcode. Create spending rules, then **Connect PayPal** with a sandbox *Personal* account:

1. Go to developer.paypal.com, then Testing Tools, then Sandbox Accounts, then Create account, and choose **Personal**.
2. Set its password via the account's View/edit account.
3. New sandbox accounts can take a few minutes to activate.

Other gateway scripts: `npm test` (unit tests), `npm run test:e2e` (real sandbox propose, capture, track, refund; needs `PAYPAL_VAULT_ID` from `npm run spike`), `npm run build:web`.

## Develop the UI

Run `npm run dev` in `gateway/` and in `web/`. Vite serves the UI on http://localhost:5173 with hot reload and proxies `/api` and `/paypal` to the gateway. Web checks: `npm test`, `npm run typecheck`, `npm run build`.

## AI tools used

- **Kimi K3 (Moonshot AI, open weights) via OpenRouter + Vercel AI SDK**: the purchase intent check (JSON-schema structured output) and Scout's tool-calling shopping agent. Swap models with `LEASH_MODEL` (and `SCOUT_MODEL` for Scout).
- **Channel3**: product search for Scout.

## Credits

UI style adapted from the "FinTech UI kit | Free (Community)" by together on Figma Community. Not affiliated with PayPal.

## License

MIT
