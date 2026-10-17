# Leash demo video script

Target runtime: **2:50** (hard limit for the hackathon is under 3:00). Solo builder, first person singular.
Everything on screen is a real PayPal **sandbox** flow; say "sandbox" out loud at least once.

Exact chat prompts and expected outcomes live in [SCENARIOS.md](SCENARIOS.md). If a prompt there differs from this script, SCENARIOS.md wins.

## Shot list

| # | Time | On screen | Narration (spoken) |
|---|------|-----------|--------------------|
| 1 | 0:00–0:08 | Cold open on the Chat page. Scout's last message shows a **Denied** card; the ledger counter ticks. Quick cut to the terminal: `403 forbidden`. | "This AI agent just tried to spend my money. It couldn't." |
| 2 | 0:08–0:15 | Title card over the app: **Leash: agents need a leash before they get a wallet.** Small "Sandbox mode" label visible. | "I built Leash, a trust layer between AI agents and PayPal. The agent can only propose. Leash decides." |
| 3 | 0:15–0:20 | Simple overlay of the four steps: Rules, AI check, Owner, PayPal (or the README diagram). | "Rules first, then an AI check that can only make things stricter, then me." |
| 4 | 0:20–0:35 | **Rules page.** Goal "Keep my home office stocked", $60 per order, $150 a month, allowed categories (Input Devices, Office Supplies, Computer Accessories, Headphones, Audio), 5 orders a day. | "I set the rules once. Sixty dollars an order, one-fifty a month, office gear only." |
| 5 | 0:35–0:45 | Rules page, PayPal card shows **Connected** (sandbox vault). Optionally a 2-second cut of the PayPal sandbox approval screen recorded earlier (no email visible). | "And I connect PayPal once. The wallet is vaulted. The agent never sees it." |
| 6 | 0:45–0:55 | **Chat page.** Type: "I need an ergonomic keyboard under $60". Scout streams; product cards and the **AG Grid comparison** appear with real Channel3 products. | "Now I ask Scout, my shopping agent, for a keyboard. It searches real products through Channel3." |
| 7 | 0:55–1:08 | Scout proposes the $59.99 keyboard. Card shows rules passed, **AI match 100%**, status **Bought**, PayPal order id, tracking number. | "Price, merchant and title come from Channel3, not from the model. Rules pass, the AI check agrees, and it's bought in the PayPal sandbox." |
| 8 | 1:08–1:15 | Cut to **Ledger**: the new row has already appeared live (SSE), status Bought, $59.99. | "The ledger updated live. Order, capture, tracking." |
| 9 | 1:15–1:30 | Chat: "Get me a desk lamp". Card shows **Denied by rules: category not allowed**. No AI score. | "A desk lamp? Not in my categories. The rules say no, and the AI never even runs. Rules are final." |
| 10 | 1:30–1:45 | Chat: `<AI-flag prompt from docs/demo/SCENARIOS.md>`. The item is in an allowed category and under the cap, but the card shows **Needs approval** with a low AI match score and the model's short reason. | "This one passes every rule. But the AI check sees it doesn't fit my goal, so it can't auto-buy. It comes to me." |
| 11 | 1:45–2:00 | **Approvals page**: the flagged item with score and reason. Click **Deny**. Status flips to Denied; the ledger shows owner as the actor. | "The AI can only tighten, never loosen. I'm the one who decides. Denied." |
| 12 | 2:00–2:10 | Terminal (font 18). Run `npm run demo:attack`. Header line says it holds only the agent key. | "Now say the agent gets hijacked. This script is a compromised agent with the real agent key." |
| 13 | 2:10–2:25 | Output scrolls: $249 monitor **denied** (over cap), console **denied** (category), prompt-injection item **denied / needs approval**, then `POST /approve` with the agent key: **403**. | "Over the cap: denied. Wrong category: denied. A prompt injection in the product text: fenced off. And approving its own purchase: forbidden." |
| 14 | 2:25–2:38 | **Ledger**: filter to the keyboard row, open the event trail (agent → policy → intent → paypal). Click **Refund**; status becomes Refunded, new ledger event appears. | "Every step is in an append-only ledger, who did what and why. And if I change my mind, one click refunds it through PayPal." |
| 15 | 2:38–2:45 | Ledger totals strip: Bought, Blocked, Refunded. Pan out to the full app. | "Every order, denial and refund you saw was real, in the PayPal sandbox." |
| 16 | 2:45–2:50 | End card: **Leash**, repo URL, hosted demo URL. | "Agents need a leash before they get a wallet." |

Total: **2:50**.

### Timing notes
- The hook (beats 1–2) lands before 0:15: the problem (an agent trying to spend), the result (it couldn't), and the product name.
- Beat 1 uses footage from beats 13 and 9; record those first, then cut them into the open.
- If you run long, trim beat 3 (overlay) and beat 15 first. Never drop the sandbox line.
- LLM responses take a few seconds: record in real time, then cut the waiting (jump cut or 2x speed). Don't fake results; only trim dead time.

## Recording checklist

**Before recording**
- [ ] Browser window exactly **1440×900**, light mode, browser zoom **100%**.
- [ ] Hide bookmarks bar and extension icons; use a clean browser profile; close other tabs.
- [ ] Turn on Do Not Disturb; hide the macOS menu bar clock/notifications if possible.
- [ ] Fresh database with `DEMO_SEED=1` (delete the db or use a fresh Render deploy) so the ledger starts empty and the rules are the seeded demo rules.
- [ ] Check OpenRouter credits are topped up (each chat turn uses Kimi K3 for Scout and for the intent check).
- [ ] Pre-run every prompt once (keyboard, desk lamp, AI-flag prompt, attack script) to warm the model and Channel3, and confirm each gives the expected outcome. Then reset the database again.
- [ ] Monthly budget headroom: the keyboard ($59.99) plus any warm-up purchases must fit $150. Reset after warming.
- [ ] Terminal: font size **18**, light theme, clear history, short prompt (no username/hostname if possible). Set `PUBLIC_URL` and `LEASH_AGENT_KEY` beforehand in a hidden way (e.g. sourced from a file), never typed on camera.

**No secrets on screen**
- [ ] No `.env`, API keys, agent/owner keys, passcode, session cookies, or full sandbox emails visible. Type the passcode off camera or start already logged in.
- [ ] No DevTools open. Check the URL bar shows no tokens (PayPal return URLs carry tokens; cut before or after them).
- [ ] Scrub every frame of the final export once before uploading.

**Audio and marks**
- [ ] No copyrighted music. Use silence or a track from the YouTube Audio Library (check its license terms).
- [ ] No PayPal logo or PayPal-style branding in overlays or the end card. Say "PayPal sandbox", not anything implying endorsement.
- [ ] Record narration separately in a quiet room if the live take is noisy.

**Upload**
- [ ] Final length under 3:00 (target 2:50).
- [ ] Upload to YouTube as **Public** (not Unlisted) after the user's explicit go-ahead.
- [ ] Title suggestion: "Leash: a trust layer for AI agents that spend with PayPal (PayPal AI Hackathon)".
- [ ] Alternative title: "Leash: agents need a leash before they get a wallet".
- [ ] Description suggestion:
  - One line: Leash lets AI agents propose purchases; rules, an AI intent check and the owner decide; PayPal sandbox executes; every step is logged.
  - Links: GitHub repo, hosted demo (passcode in the Devpost submission, not in the description).
  - Built with: PayPal sandbox (Vault, Orders v2, Refunds, Tracking), Kimi K3 via OpenRouter, Channel3, AG Grid, Render.
  - "Sandbox only. Not affiliated with PayPal." plus music credit if a track is used.
  - Chapters: 0:00 Hook, 0:20 Rules, 0:45 Bought, 1:15 Blocked, 1:30 AI flag, 2:00 Hijacked agent, 2:25 Ledger + refund.
