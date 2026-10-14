# Leash

**Agents need a leash before they get a wallet.**

Leash is a trust layer between AI agents and PayPal. Agents can only *propose* purchases. Leash enforces spending rules the agent cannot override, runs an AI intent check that can only make decisions stricter, sends edge cases to a human, executes approved purchases with a vaulted PayPal wallet, and records every step in an append-only ledger.

> Status: gateway core (Plan 1). Scout shopping agent and web UI are in progress.

## How it works

1. **Mandate** — the owner sets a goal and hard limits (per-order cap, monthly budget, categories, merchants, daily orders) and connects PayPal once (PayPal Vault).
2. **Policy engine** — deterministic rules; a denial is final.
3. **AI intent check** — Claude scores how well the product matches the goal and request. Product text is fenced as untrusted data. A low score sends the purchase to the owner; it can never approve something the rules denied.
4. **Execution** — PayPal Orders v2 charge on the vaulted wallet, shipment tracking, one-click refunds. Every call is idempotent (`PayPal-Request-Id`).
5. **Roles** — the agent key can only propose and read; approve/deny/refund/connect need the owner key.

## Sandbox note

Leash runs entirely on the PayPal **sandbox**. Purchases are paid to the project's own sandbox merchant account; no real money moves.

## Run it

Requirements: Node ≥ 22.13, a PayPal developer sandbox app with Vault ("save payment methods") enabled, an Anthropic API key.

```bash
cd gateway
cp .env.example .env   # fill in PayPal + Anthropic credentials
# LEASH_AGENT_KEY and LEASH_OWNER_KEY must be changed from the placeholders
# (change-me-*) and must differ from each other; the server refuses to start otherwise.
npm install
npm test               # unit tests
npm run spike          # one-time: approve a vault with a sandbox personal account; prints PAYPAL_VAULT_ID
npm run test:e2e       # real sandbox propose → capture → track → refund
npm run dev            # gateway on http://localhost:8787
```

## AI tools used

- **Claude (Anthropic) via Vercel AI SDK** — purchase intent check with structured output.

## License

MIT
