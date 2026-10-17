# Devpost notes for Leash

Bullet notes for each Devpost field. These are raw notes; write the final prose yourself.

## Inspiration
- Agentic commerce is arriving: agents that browse, compare and buy. Today the choice is "give the agent your card" or "approve every click".
- An LLM can be prompt-injected by a product page, can misread a request, or can be fully hijacked. It should never be the thing that decides whether money moves.
- Idea: treat the agent like a new employee with a corporate card: it proposes, policy decides, a human signs off on edge cases, everything is audited.
- Personal angle (fill in): why you'd want an agent to restock your own desk/office, and why you wouldn't hand it your PayPal.

## What it does
- Leash is a trust layer between AI agents and PayPal. Agents can only **propose** purchases.
- Owner sets rules once: goal, per-order cap, monthly budget, allowed categories, merchant allow/block lists, orders per day, review threshold. Connects PayPal once (sandbox vault).
- Each proposal goes: **rules engine** (deterministic, final) → **AI intent check** (Kimi K3; can only tighten) → **owner approval** for edge cases → **PayPal execution** (order, capture, tracking) → **append-only ledger**.
- Scout: a shopping agent that searches real products via Channel3, compares them in a grid, and proposes with an agent key that cannot approve, refund or connect PayPal.
- Price, merchant and title are filled server-side from Channel3 data, never from model output.
- One-click refunds from the ledger; live updates over SSE.
- Demo outcomes (all real sandbox): keyboard under $60 → bought ($59.99, AI match 100%); desk lamp → blocked by category; off-goal item → flagged → owner denies; compromised-agent script → denied / 403.

## How we built it
- Gateway: TypeScript, Hono, Node 22 `node:sqlite` (SQLite), append-only events table (insert/read only).
- Rules engine `policy.ts`, decision logic `decision.ts` (AI verdict can only move approve → review), intent check `intent.ts` / `intent-llm.ts`.
- AI: Vercel AI SDK + OpenRouter, default `moonshotai/kimi-k3` (open weights); JSON-schema structured output for the intent verdict; tool-calling loop for Scout.
- PayPal sandbox REST: Vault v3 setup tokens + payment tokens, Orders v2 with `payment_source.paypal.vault_id`, capture, `/track`, capture refunds, `PayPal-Request-Id` idempotency (`order-<id>`, `refund-<id>`).
- Scout tools: `search_products`, `propose_purchase`, `check_budget`; Channel3 client with fail-safe price normalisation.
- Web: React + Vite, AG Grid (product comparison, ledger), SSE for live ledger, passcode login with signed session cookie.
- Security: separate agent and owner keys (`allow('owner')`), prompt-injection fencing, Hono `secureHeaders` CSP, path traversal tests.
- Deploy: Render Blueprint (`render.yaml`), single web service, SQLite on persistent disk, `/healthz`, env-gated demo seed with a pre-connected sandbox vault.
- Tests: 207 gateway + 129 web tests, plus a live sandbox e2e (propose, capture, track, refund).

## Challenges we ran into
- **Open-model structured output:** Kimi K3 via OpenRouter needed JSON-schema output, capped output tokens and a 15 s timeout for open-model latency; any error or timeout falls back to owner review (fail closed). Credits ran out mid-tuning more than once.
- **PayPal vault sandbox setup:** enabling Vault on the sandbox app, setup token → buyer approval → payment token flow, sandbox Personal accounts that take minutes to activate; split the spike script into start/finish steps because it couldn't use interactive stdin.
- **Prompt-injection fencing:** product text and the agent-reported request both come from untrusted sources; JSON-encoded them inside `<untrusted_product>` / `<agent_reported_request>` tags, owner goal wins on conflict, Scout treats tool results as data.
- **Race-safe budget commits:** two proposals at once could both pass the budget check; commit step re-runs rules synchronously before any money moves; refund races and capture persistence fixed in a hardening pass.
- **AG Grid module trimming:** switched from `AllCommunityModule` to only the modules used to cut bundle size, broke a grid, had to register the missing modules back.
- **SameSite cookie on PayPal redirect:** a strict session cookie was dropped on the cross-site return from PayPal, logging the owner out mid-connect; fixed with `SameSite=Lax`.
- Getting a reliable "AI flags it" demo case: a gaming headset is (correctly) approved because it matches the request; needed tuning (see SCENARIOS.md).

## Accomplishments that we're proud of
- Real money path end to end in the sandbox: vault, order, capture, tracking, refund, with idempotency.
- The trust model holds even against a hijacked agent holding a real key (attack script: all denied, 403 on self-approval).
- The AI is useful but structurally unable to loosen a decision.
- Every state change is in an append-only ledger with actor and reason.
- Runs on an open-weight model.
- Hosted demo judges can use without their own PayPal sandbox login.

## What we learned
- Put the LLM on the "suggest" side of the boundary and keep money decisions deterministic.
- Fail closed: model errors and timeouts become human review, not approval.
- PayPal idempotency headers make retries after ambiguous failures safe.
- Server-side filling of price/merchant/title removes a whole class of hallucination and injection bugs.
- Open-weight models are good enough for tool calling and scoring, with care around output format and latency.

## What's next for Leash
- **MCP endpoint** so any agent (Claude Desktop, other MCP clients) can shop under a leash.
- **Multi-user**: multiple owners, households/teams, per-agent keys.
- **Real merchants** via PayPal Store Sync / Agentic Commerce Protocol (ACP) instead of a single sandbox merchant.
- **Budgets per category** (and per merchant), not just one monthly budget.
- (Optional) notifications for pending approvals; spending reports from the ledger.

## Built with (tags)
typescript, node.js, hono, sqlite, react, vite, ag-grid, paypal, paypal-rest-api, openrouter, kimi, vercel-ai-sdk, channel3, render, server-sent-events, vitest

## Tools used and how (required field)
- **Kimi K3 (Moonshot AI, open weights), `moonshotai/kimi-k3`, via OpenRouter**:
  - Intent check: scores 0–1 how well a proposed product matches the owner's goal and the request; JSON-schema structured output; below threshold, error or timeout → owner review. Can only tighten.
  - Scout: tool-calling shopping agent (`search_products`, `propose_purchase`, `check_budget`).
  - Swappable with `LEASH_MODEL` / `SCOUT_MODEL`.
- **Vercel AI SDK**: model calls, structured output, tool loop.
- **PayPal sandbox REST APIs**: Vault v3 (setup + payment tokens), Orders v2 with `vault_id`, capture, shipment tracking, refunds, `PayPal-Request-Id`.
- **Channel3 API**: product search and offers (real titles, prices, merchants, images).
- **AG Grid Community**: product comparison grid and ledger grid (filters, styled rows, totals).
- **Render**: Blueprint deploy, persistent disk for SQLite, health check.
- **AI coding assistant**: say honestly how you used one during development (e.g. Claude Code for planning, implementation and reviews), if the rules ask for it.
- UI style adapted from the "FinTech UI kit | Free (Community)" on Figma Community (credit).

## Try it
- Hosted demo: `<RENDER_URL>` (e.g. `https://<service>.onrender.com`)
- Passcode: `<DEMO_PASSCODE>` (put it only in the Devpost "Try it" field / judges' notes; not in the repo or video)
- Sandbox only: every purchase is a real PayPal sandbox transaction to the project's sandbox merchant; no real money; nothing ships; tracking number is generated by Leash.
- The demo rules come pre-connected to a sandbox PayPal vault, so judges don't need a PayPal login.
- Free/cold instance note if applicable: first request may take about a minute.
- Suggested prompts: keyboard under $60 (bought), desk lamp (blocked), `<AI-flag prompt from docs/demo/SCENARIOS.md>` (flagged), then Ledger → Refund.
- Run locally: README "Run it"; attack script `npm run demo:attack` in `gateway/`.

## Prizes to select
- **Best Use of Agentic Commerce**
  - An agent that actually finds and buys real products, with the controls that make letting it do so safe.
  - Propose-only agent key, rules, AI check, owner approval: a pattern any agent can plug into.
- **Best Use of PayPal + AI**
  - Deep PayPal use: Vault, Orders v2 with vault_id, capture, tracking, refunds, idempotency, all live in the sandbox.
  - AI sits next to PayPal as a check that can only tighten, never as the one moving money.
- **Most Impactful**
  - Addresses the core blocker for agentic payments: trust. Users and merchants need limits and an audit trail before agents can spend.
  - Honest: it's a sandbox prototype with one merchant; impact depends on real-merchant integration (see What's next).
- **Best Demo Delivery**
  - Four clear beats (bought, blocked, flagged → denied, hijacked → 403), all real, plus a hosted demo judges can try with a passcode.
  - Video under 3 minutes with a hook in the first 15 seconds.
- **Best Use of AG Grid**
  - Product comparison grid in chat and the ledger grid with filters, row styling and live updates over SSE.
  - Honest: uses Community modules only, trimmed to what's used; not an advanced Enterprise showcase.
- **Best Use of Channel3**
  - Scout's search runs on Channel3; price, merchant and title for every purchase are filled server-side from Channel3 data, not from the model.
  - Fail-safe price normalisation; unknown products reject cleanly.
- **Best Use of Render**
  - One-click Render Blueprint: build, persistent disk for SQLite, health check, generated secrets, env-gated demo seed.
  - Honest: a single web service; nothing exotic beyond the Blueprint and disk.

## Judging rubric self-check
| Requirement | Evidence |
|---|---|
| Public repo | GitHub repo `<REPO_URL>` (make public only after secrets are rotated, user go-ahead) |
| Open-source license visible in About | `LICENSE` (MIT); confirm GitHub detects it and shows it in About |
| Setup + run instructions | README "Run it", "Deploy to Render", "Tests" |
| Functional demo | Hosted URL `<RENDER_URL>` + passcode; local run instructions; `npm run demo:attack` |
| Text description | Devpost fields from these notes; README intro, How it works, Trust model |
| Tools section naming the AI model and how it's used | README "AI tools used"; Devpost "Tools used and how" (Kimi K3 via OpenRouter) |
| Video < 3 min, public, no unlicensed music/marks | `docs/demo/VIDEO.md` (2:50); YouTube `<VIDEO_URL>` Public; silence or YouTube Audio Library; no PayPal logo |
| Sandbox honesty | README "Sandbox and honesty note"; UI "Sandbox mode"; said in video |
| No secrets | Keys rotated before going public; none in repo, screenshots or video |
