# Leash

**Agents need a leash before they get a wallet.**

Leash is a trust layer between AI agents and PayPal. Agents can only *propose* purchases. Leash enforces spending rules the agent cannot override, runs an AI intent check that can only make decisions stricter, sends edge cases to a human, executes approved purchases from a vaulted PayPal wallet, and records every step in an append-only ledger.

Built for the PayPal AI Hackathon. Sandbox only; not affiliated with PayPal.

## Try it in 30 seconds

Open the hosted demo: `https://<your-service>.onrender.com` (passcode: given in the Devpost submission). On a free instance the first request can take about a minute to wake.

Ask the Chat page for:

1. **"I need an ergonomic keyboard under $60"** — passes the rules and the AI check, so it is **bought** (sandbox order, capture, tracking). Refund it from the Ledger.
2. **"Get me a desk lamp"** — **blocked by the rules** because the category is not in the allowed list. The AI check never runs.
3. **Run `npm run demo:attack -- <rules id>`** (from `gateway/`, pointing at your instance): a compromised agent tries a prompt-injected listing; the AI check scores it 10% and it appears in **Approvals** for you to deny.
4. The same script also tries an over-cap item, a disallowed category, and approving its own purchase. All are refused (denied / 403); nothing is charged.

## Screenshots

<table>
  <tr>
    <td><img src="docs/screenshots/chat-bought.jpg" alt="Chat: a purchase approved and bought"></td>
    <td><img src="docs/screenshots/approvals-flagged.jpg" alt="Approvals: a purchase flagged for the owner"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/ledger-audit.jpg" alt="Ledger: every step of every purchase"></td>
    <td><img src="docs/screenshots/rules.jpg" alt="Rules: spending limits and PayPal connection"></td>
  </tr>
</table>

## How it works

```mermaid
flowchart LR
  B[Browser UI] <--> G
  subgraph G[Leash gateway]
    direction TB
    R[1. Rules engine<br/>deterministic, final] --> A[2. AI intent check<br/>can only tighten]
    A --> O[3. Owner approval<br/>edge cases]
    O --> X[4. PayPal execution]
    L[(Append-only ledger)]
  end
  S[Scout agent<br/>agent key: propose and read only] -- propose --> G
  S <--> C3[Channel3<br/>product data]
  B <--> S
  X <--> P[PayPal sandbox<br/>Vault / Orders / Refunds / Tracking]
```

The owner sets spending rules once and connects PayPal. The Scout agent searches products (Channel3) and calls `propose_purchase` on the gateway with its agent key. Each proposal then goes through:

1. **Rules** (`gateway/src/policy.ts`): currency, per-order cap, remaining monthly budget, allowed categories, blocked/allowed merchants, daily order limit. Any failure is a denial, and the AI check is skipped.
2. **AI intent check** (`intent.ts`, `intent-llm.ts`, `decision.ts`): scores 0 to 1 how well the product matches the owner's goal and the request. At or above the review threshold the purchase is auto-approved; below it, or if the check errors or times out, it goes to the owner.
3. **Owner approval**: the owner approves or denies in the Approvals page. Approval re-runs the rules before committing.
4. **Execution** (`leash.ts`, `paypal/api.ts`): charge, capture, shipment tracking. Refunds are owner-only.

## Trust model

- **The agent can only propose.** The agent key can create proposals and read; approve, deny, refund and connect PayPal require the owner key or a UI session (`allow('owner')` in `http.ts`).
- **Rules are final.** A rule denial is returned without calling the model, and the commit step re-checks the rules synchronously before any money moves.
- **AI can only tighten.** The intent verdict can turn an auto-approval into a human review; it has no path to override a denial (`decision.ts`).
- **Owner approves edge cases.** Low scores and unavailable intent checks become `pending_human`.
- **Every step is in the ledger.** Each state change appends an event with actor (agent, policy, intent, owner, paypal, system) and detail. The store only inserts and reads events; there is no update or delete path.
- **Prompt-injection fencing.** Product text is JSON-encoded inside `<untrusted_product>` and the agent's reported request inside `<agent_reported_request>`; the system prompt tells the model never to follow either, and the owner's goal wins on conflict. Scout's prompt also treats tool results as data.
- **Idempotency.** Proposals accept an idempotency key; PayPal calls send a stable `PayPal-Request-Id` (`order-<proposalId>`, `refund-<proposalId>`), so a retry after an ambiguous failure returns the original result instead of charging twice. A refund already in progress is rejected.

## PayPal integration

All calls are in `gateway/src/paypal/api.ts` against the sandbox API:

- **Vault**: setup tokens (`POST /v3/vault/setup-tokens`) and payment tokens (`/v3/vault/payment-tokens`) so the owner approves the wallet once.
- **Orders v2**: create an order with `payment_source.paypal.vault_id` (`/v2/checkout/orders`), then capture it.
- **Shipment tracking**: `POST /v2/checkout/orders/{id}/track` after capture.
- **Refunds**: `POST /v2/payments/captures/{id}/refund`.
- **Idempotency**: `PayPal-Request-Id` on order and refund calls.

## AI tools used

- **Kimi K3 (Moonshot AI, open weights) via OpenRouter + Vercel AI SDK**: the purchase intent check (JSON-schema structured output) and Scout's tool-calling shopping agent (`search_products`, `propose_purchase`, `check_budget`). Default model is `moonshotai/kimi-k3`; swap with `LEASH_MODEL` (and `SCOUT_MODEL` for Scout).
- **Channel3**: product search and offers for Scout.

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

Other gateway scripts: `npm test`, `npm run test:e2e`, `npm run seed`, `npm run build:web` (see Tests below).

## Develop the UI

Run `npm run dev` in `gateway/` and in `web/`. Vite serves the UI on http://localhost:5173 with hot reload and proxies `/api` and `/paypal` to the gateway. Web checks: `npm test`, `npm run typecheck`, `npm run build`.

## Deploy to Render

The repo ships a Render Blueprint (`render.yaml`): one web service that builds the UI, installs the gateway and serves everything from the gateway. `.node-version` pins Node 22 (the gateway needs >= 22.13 for `node:sqlite`).

1. Push the repo to GitHub, then in Render choose **New > Blueprint** and select it.
2. Render prompts for the secret values. Enter them in the Render dashboard only, never in git:
   - `PUBLIC_URL`: the service's **https** `onrender.com` URL (e.g. `https://leash.onrender.com`). It is used for the secure session cookie and the PayPal return URLs. If you don't know it yet, deploy once, then set it under Environment and redeploy.
   - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: sandbox app credentials.
   - `DEMO_VAULT_ID`: a sandbox PayPal vault id, from `npm run spike` or from a Connect PayPal flow in the UI. With `DEMO_SEED=1` the demo rules are created, already connected to it, whenever the database is empty.
   - `OPENROUTER_API_KEY`, `CHANNEL3_API_KEY`.
   - `LEASH_UI_PASSCODE`: at least 8 chars.
3. `LEASH_AGENT_KEY`, `LEASH_OWNER_KEY` and `LEASH_SESSION_SECRET` are generated by Render (find them under Environment).
4. Render health-checks `/healthz`. SQLite lives on the 1 GB disk at `/var/data/leash.db`.

Run a **single instance** only: live events are held in memory, so scaling out breaks the live updates (and Render does not allow scaling a service that has a disk).

**Free-tier alternative (no disk):** persistent disks need a paid instance. On the free plan, remove the `disk:` block, set `plan: free`, `LEASH_DB_PATH=/tmp/leash.db` and keep `DEMO_SEED=1`. The database resets on every restart or redeploy (the demo rules are re-seeded), and the instance sleeps when idle, so the first request after a pause takes about a minute.

## Tests

- Gateway: `cd gateway && npm test` runs 207 tests (1 skipped, the live sandbox e2e) across 18 files: rules, decision, intent prompt/fencing, ledger, auth/roles, security headers and path traversal, PayPal client and API, Scout tools, seed.
- Web: `cd web && npm test` runs 129 tests across 16 files. Also `npm run typecheck` and `npm run build`.
- Live sandbox e2e: `cd gateway && npm run test:e2e` performs a real propose, capture, track and refund against the PayPal sandbox. It needs sandbox credentials in `.env` and `PAYPAL_VAULT_ID` from `npm run spike`.

## Sandbox and honesty note

Leash runs entirely on the PayPal **sandbox**. Every order, capture, refund, denial and approval shown is real in the sandbox; purchases are paid to the project's own sandbox merchant at the Channel3 listed price, and nothing ships. No real money moves. The shipment tracking number is generated by Leash, not a carrier.

## Credits

UI style adapted from the "FinTech UI kit | Free (Community)" by together on Figma Community. Not affiliated with PayPal.

## License

MIT
