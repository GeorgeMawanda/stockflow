# StockFlow API

Multi-tenant inventory, credit (Nsasula) and Mobile Money reconciliation backend for Ugandan wholesalers, hardware shops and schools.

**Stack:** Node 20+, Fastify, PostgreSQL, Zod, JWT. All money is integer UGX.

## Run
```bash
docker compose up -d
cp .env.example .env        # set JWT_SECRET
npm install
npm run migrate
npm run dev
npm test
```

## API (all `/api/*` need `Authorization: Bearer <token>`)
| Method | Path | Purpose |
|---|---|---|
| POST | /auth/register | `{business,email,password}` creates tenant and owner |
| POST | /auth/login | returns token |
| GET/POST | /api/items | list / create stock |
| POST | /api/items/:id/restock | `{qty}` |
| GET | /api/items/low-stock | items at or below alert level |
| GET | /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD | tenant-scoped UGX sales, collections, stock and credit report (up to 367 days) |
| POST | /api/assistant/suggestions | `{from,to,question?}` built-in and optional aggregate-only AI business suggestions |
| POST | /api/sales | `{customer?,lines:[{itemId,qty}],paid?,method,ref?}`; `paid:0` = credit |
| GET | /api/credit | customers who owe, oldest first |
| POST | /api/payments | pay down a customer's debt (oldest sale first) |
| POST | /api/payments/mobile-money/match | paste a MoMo SMS, get parsed data and likely payer |

## Design decisions
- **Tenant isolation:** every query filters by `tenant_id` from the signed JWT.
- **No overselling:** sale rows lock stock with `SELECT ... FOR UPDATE` in one transaction; prices are read server-side.
- **Idempotent payments:** a Mobile Money ID can only be applied once per tenant.

## Subscription billing (Flutterwave)
- New businesses get a **14-day free trial**. After it ends (and no paid period remains) write requests return **402**; reads and exports keep working.
- Plans (UGX per 30 days): Starter 20,000, Growth 50,000. Edit `PLANS` in `src/billing.js`.
- `GET /api/billing/status` shows plan and expiry. `POST /api/billing/checkout {plan}` returns a Flutterwave link (Mobile Money Uganda or card).
- In the Flutterwave dashboard, set the webhook URL to `https://YOUR-DOMAIN/webhooks/flutterwave` and the secret hash to `FLW_WEBHOOK_HASH`.
- The webhook re-verifies each charge with Flutterwave (status, UGX, amount, reference) and is idempotent per transaction id.
- Test with Flutterwave test keys first. Existing databases: re-run `npm run migrate` (it is safe to repeat).

## Frontend (web/)
React + Vite. In dev it proxies `/api` and `/auth` to the API on port 3000.
```bash
cd web && npm install && npm run dev      # http://localhost:5173
npm run build                             # static files in web/dist
```
Deploy `web/dist` behind the same domain as the API (for example nginx routes `/api`, `/auth`, `/webhooks` to Node and everything else to `dist`).

The workspace includes a business profile for the business name, Uganda district and local mobile number. Owners can add a business logo and product photos from Settings and Stock. Images are resized in the browser and limited to 512 KB each; image bytes and media types are stored in PostgreSQL and served only through authenticated, tenant-scoped routes. Existing databases pick up the image and profile columns when `npm run migrate` is rerun.

### Reports and business assistant

The Reports screen provides date-filtered UGX sales and collections, estimated gross profit, payment-method totals, top products, current stock valuations, and outstanding customer credit. Use **Print / Save PDF** for a paper/PDF report or **Download CSV** for a spreadsheet. Reports cover up to 367 days. Estimated gross profit is before operating expenses; collections are grouped by payment date and open credit is current.

The in-app assistant always provides built-in, cash-conscious stock, sales, credit and payment suggestions. To enable optional OpenAI-compatible suggestions, set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` in the server environment; `AI_TIMEOUT_MS` is optional. Without both a key and model, no external AI request is made. When enabled, the assistant sends aggregate report figures and the question entered in the assistant—not customer names, phone numbers, raw payment messages, or product names. Avoid entering personal or confidential details in the assistant question. If the AI provider cannot respond, the UI identifies the problem and shows the built-in suggestions instead.

### Product-fit benchmarks

These are representative product patterns, not a feature-by-feature audit or a claim that every provider is available in Uganda:

| Benchmark | Useful perspective | Local fit in StockFlow |
|---|---|---|
| [Shopify POS](https://www.shopify.com/pos) | Keep product, inventory, sales and customer records connected. | Use one inventory and sales record for the shop; do not require an online storefront to record a walk-in sale. |
| [Square POS](https://squareup.com/us/en/point-of-sale) | Bring checkout, payment capture, inventory and customer information into one POS workflow. | Retain a quick counter flow that accepts cash and records MTN MoMo or Airtel Money without requiring Square hardware. |
| [Zoho Inventory](https://www.zoho.com/inventory/features/) | Make item management and stock tracking easy to scan. | Keep stock alerts and optional product photos, but compress and lazy-load photos to reduce mobile-data use. |
| [Odoo Inventory](https://www.odoo.com/app/inventory) | Inventory workflows can grow into deeper warehouse and tracking systems. | Keep the everyday stock, credit and payment screens simple; avoid forcing warehouse setup on a small shop. |

For Uganda, the practical baseline is UGX amounts, local phone formats and optional district details, cash plus MTN/Airtel Money, and room to record customer credit. These choices complement the benchmarks rather than assuming international card hardware or a continuous online-sales workflow.

## SMS reminders (Africa's Talking)
- Manual: `POST /api/credit/:customerId/remind`.
- Automatic on Render: set `REMINDERS_ENABLED=true`. Once a day, customers whose oldest debt is over 7 days old get one SMS, at most once per 7 days, for active subscriptions only. Every attempt is logged in `reminder_log`. An advisory lock stops multiple instances from double-sending.
- Automatic on Vercel: set `REMINDERS_ENABLED=true` and a strong `CRON_SECRET`, then add this to `vercel.json` to schedule `/internal/cron/reminders` daily at 06:00 UTC:
  ```json
  "crons": [{ "path": "/internal/cron/reminders", "schedule": "0 6 * * *" }]
  ```
  The endpoint requires `Authorization: Bearer <CRON_SECRET>`.
- Use `AT_USERNAME=sandbox` while testing.

## Tests and CI
`npm test` runs unit tests, plus integration tests when `DATABASE_URL_TEST` points at an empty Postgres database. GitHub Actions (`.github/workflows/ci.yml`) runs both and builds the frontend.

## Production hosting (Vercel)

The repository configures two Vercel services: `stockflow` (Fastify API) and `web` (Vite frontend). The API is routed publicly under `/api/*`, `/auth/*`, `/webhooks/*`, `/health`, and `/internal/*`; all other paths, including `/billing/done`, go to the frontend. Neither service calls the other server-side: the browser uses same-origin API URLs, so no service binding is needed. PostgreSQL must be hosted separately; Vercel does not provision the database for this project.

1. Push this project to a Git provider connected to Vercel and import it with the repository root as the project root. Vercel uses `vercel.json` to deploy both services on the same origin.
2. Create a managed PostgreSQL database that supports serverless connections and configure its pooled `DATABASE_URL` in the Vercel project. Also set `JWT_SECRET` to a long random secret and `TRUST_PROXY_HOPS=1`.
3. Apply the schema once to that database by running `npm run migrate` from a trusted machine with the production `DATABASE_URL` configured. Migrations are deliberately not run automatically during Vercel builds.
4. Set `APP_URL` to the deployment's public HTTPS origin for Flutterwave checkout redirects. Add optional `FLW_SECRET_KEY` and `FLW_WEBHOOK_HASH` for billing, `AT_USERNAME` and `AT_API_KEY` for SMS, and `AI_API_KEY` plus `AI_MODEL` for external AI suggestions. Configure the Flutterwave webhook at `https://YOUR-DOMAIN/webhooks/flutterwave`.
5. Keep `REMINDERS_ENABLED` false unless SMS reminders are intended. To enable daily reminders, also configure `CRON_SECRET` and add the Vercel Cron described above. Vercel cron availability and schedule limits depend on the selected plan.
6. After deployment, check `/health` returns `{"ok":true}`, then test registration/login, inventory writes, image uploads, Flutterwave callbacks (if enabled), and billing redirects before accepting real business data.

Do not put database credentials or provider secrets in source control. Vercel Functions use a one-connection PostgreSQL pool per instance; use the connection-pooling URL recommended by your database provider and review its connection limits, backups, and recovery options.

## Production hosting (Render)

The repository includes a Render Blueprint in `render.yaml`. To deploy:

1. Push this project to a Git provider supported by Render; this workspace itself is not connected to a Git remote.
2. In Render, create a **New Blueprint Instance** for the repository and review the service/database plans, region, and current pricing before confirming. The blueprint provisions a Node web service and PostgreSQL 16 in Frankfurt; Frankfurt is the recommended starting point, not a latency guarantee for every Ugandan network.
3. Wait for the build and pre-deploy migration to finish, then open the service URL and confirm `/health` returns `{"ok":true}`. The Node service serves the built React frontend and API from the same origin.
4. Add a custom domain and configure `APP_URL` to its public HTTPS origin if using one. Without `APP_URL`, billing checkout uses Render's `RENDER_EXTERNAL_URL`.
5. Add optional secrets in the Render dashboard, never in source control: `FLW_SECRET_KEY` and `FLW_WEBHOOK_HASH` for paid billing; `AT_USERNAME` and `AT_API_KEY` to enable SMS reminders; and `AI_API_KEY` plus `AI_MODEL` for external AI suggestions. Configure the Flutterwave webhook to `https://YOUR-DOMAIN/webhooks/flutterwave`. Reminders remain disabled unless `REMINDERS_ENABLED=true`.

Render generates `JWT_SECRET` and supplies the managed database connection. Schema migrations run as a pre-deploy step; do not run local migration commands against production unless intentionally targeting that database. Before accepting real business data, select an appropriate paid database plan, confirm backup/retention settings, test recovery, and keep provider credentials and database access restricted. Hosting is not complete until a Git remote is connected and a successful deployment is verified.
