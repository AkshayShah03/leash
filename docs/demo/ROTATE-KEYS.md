# Rotate keys before going public

No values belong in this file. Put new values only in `gateway/.env` or the Render dashboard, never in chat or git.

| Secret | Where | What to do |
|---|---|---|
| `OPENROUTER_API_KEY` | openrouter.ai keys | Create a new key with a monthly spend limit, then delete the old key. |
| `PAYPAL_CLIENT_SECRET` | developer.paypal.com, your sandbox app | Regenerate the secret in the SAME app. The vault id (`DEMO_VAULT_ID`) is tied to that app; a new app needs `npm run spike` again. |
| `CHANNEL3_API_KEY` | Channel3 dashboard | Create a new key, delete the old one. |
| Sandbox Personal account password | developer.paypal.com > Sandbox Accounts | Set a new password via View/edit account. |
| `LEASH_UI_PASSCODE` | `.env` / Render | `openssl rand -base64 12` |
| `LEASH_SESSION_SECRET` | `.env` / Render | `openssl rand -hex 32` (invalidates existing sessions) |
| `LEASH_AGENT_KEY`, `LEASH_OWNER_KEY` | Render generates them | Locally, use two different random values in `gateway/.env`. |

After rotating: restart the gateway, log in, and run one purchase and refund to confirm.
