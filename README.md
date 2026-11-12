# Mandate: an AI buyer that pays with PayPal, on your rules

AI agents can shop now, but nobody hands an agent their wallet. **Mandate** gives a small-business owner an AI purchasing agent that searches, compares and pays through **PayPal**, but only inside a *mandate*: a weekly budget, a per-order cap, an auto-approve limit, and allowed categories and merchants.

- Orders under the auto-approve limit are **authorized and captured** right away.
- Orders over the limit are **authorized and held** by PayPal until the owner taps *Approve* (capture) or *Reject* (void).
- Orders that break a rule are **blocked before PayPal is ever called**.
- Something arrived broken? Ask the agent, and it issues a **PayPal refund**.
- Every step goes into an **audit log**, with the rule that decided it.

> Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## How it works

```
Next.js web app ──REST──▶ FastAPI backend ─────────────────────────────┐
 (dashboard, agent chat,    ├─ Agent orchestrator (Claude, tool calling) ├─▶ Anthropic API
  approvals, orders,        ├─ Policy engine (pure Python, unit-tested)  ├─▶ Channel3 product search
  mandates, settings)       ├─ Payments service ─────────────────────────┼─▶ PayPal Orders v2 / Payments v2 / Vault v3
                            ├─ Webhook handler ◀── PayPal webhooks ──────┘
                            └─ Postgres / SQLite: mandates, orders, audit log
```

**The safety design.** Claude plans and explains, but it never moves money itself. The `place_order` tool re-runs the policy engine in code on prices from the catalog (not from the model), so a confused model or a prompt injection in a product title still cannot overspend.

### PayPal integration

| Capability | API | Where |
| --- | --- | --- |
| Save the owner's PayPal wallet once, so the agent pays without a popup | Vault v3 setup tokens and payment tokens | `backend/app/paypal.py` |
| Hold funds at checkout | Orders v2, `intent: AUTHORIZE`, `payment_source.paypal.vault_id` | `create_authorized_order` |
| Pay after the rules or the owner say yes | `POST /v2/payments/authorizations/{id}/capture` | `capture_authorization` |
| Release funds on reject | `POST /v2/payments/authorizations/{id}/void` | `void_authorization` |
| Refunds | `POST /v2/payments/captures/{id}/refund` | `refund_capture` |
| Fallback when no wallet is saved: buyer approves in PayPal | Orders v2 `payer-action` link, then `/authorize` | `authorize_order` |
| Status sync | Webhooks + `verify-webhook-signature` | `/api/webhooks/paypal` |
| Safe retries | `PayPal-Request-Id` idempotency key on every write | everywhere |

### AI tools used

| Tool | How it is used |
| --- | --- |
| **Claude (Anthropic API)**, model set by `ANTHROPIC_MODEL` | The buying agent. It uses tool calling with `search_products`, `check_cart`, `place_order`, `list_recent_orders` and `request_refund`, then explains every decision in plain words. |
| **Channel3** (optional) | Real product search through `POST /v1/search`. Without a key, a built-in demo catalog of café supplies is used. |
| **Render** | Hosting for the API, the web app and Postgres (`render.yaml`). |

## Run it locally

You need Python 3.11+, Node 20+ and an Anthropic API key. PayPal and Channel3 keys are optional: without them the app runs in **mock mode**, with the same flow and simulated PayPal IDs.

```bash
# 1. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add ANTHROPIC_API_KEY, plus PayPal sandbox keys if you have them
uvicorn app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev                   # http://localhost:3000
```

The first page load creates a demo mandate, **Café supplies**: $150 a week, $80 per order, auto-approve up to $25.

### Use the PayPal sandbox

1. At [developer.paypal.com](https://developer.paypal.com), open **Apps & Credentials → Sandbox** and create an app. Copy the client ID and secret into `backend/.env`.
2. In the app's settings, make sure **Vault / Save payment methods** is enabled.
3. Run `python -m scripts.paypal_smoke` from `backend/` to prove the money path (create → approve → authorize → capture → refund).
4. In the web app, go to **Settings → Connect PayPal** and log in as your **sandbox personal (buyer)** account. The agent can now pay on its own.
5. Optional: add a webhook pointing at `https://<your-api>/api/webhooks/paypal` for `PAYMENT.CAPTURE.*` and `PAYMENT.AUTHORIZATION.VOIDED`, and set `PAYPAL_WEBHOOK_ID`.

### Try these with the agent

- "Restock 12 oz cups with lids and a pack of napkins" → paid automatically
- "Our espresso machine's group head is leaking. Buy the part we need." → held for approval
- "Buy noise-cancelling headphones for the counter" → blocked by the mandate
- "The napkins from my last order arrived soaked. Get a refund." → PayPal refund

## Tests

```bash
cd backend && pytest -q
```

The tests cover the policy engine (12 rules) and the end-to-end API flows in mock mode: auto-pay, held approval, approve, reject and void, refund, a blocked category, unknown product ids, the no-vault path and webhooks. A scripted stand-in replaces Claude in these tests.

## Deploy on Render

Push the repo to GitHub, then in Render choose **New → Blueprint** and select it. Fill in the secret env vars. Set `FRONTEND_URL` on the API to the web app's URL, and `NEXT_PUBLIC_API_URL` on the web app to the API's URL.

## Project layout

```
backend/
  app/policy.py     policy engine (pure function)
  app/paypal.py     PayPal REST client + mock mode
  app/agent.py      Claude tool-calling loop
  app/services.py   place / approve / reject / refund orders
  app/catalog.py    Channel3 search + demo catalog
  app/routes/api.py REST API
  tests/            pytest suite
  scripts/paypal_smoke.py
frontend/           Next.js 15 + Tailwind
render.yaml         Render blueprint
```

## License

MIT, see [LICENSE](LICENSE).
