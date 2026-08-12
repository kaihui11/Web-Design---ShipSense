# ShipSense — Supabase Backend

Supabase (hosted Postgres) is the backend for this app, serving everything to the frontend via Supabase's built-in REST API (PostgREST) — no custom server to write or host. Three tables, three different shapes on purpose:

| Table | Shape | Why |
|---|---|---|
| `snapshots` | JSONB blob | ML forecast output. Replaced wholesale on each ingest, never queried by field — a blob fits. |
| `quote_requests` | Relational columns | Client quotes staff generate from the New Forecast page. Needs per-row updates (status changes), filtering, and sorting — a blob doesn't fit this. |
| `historical_data` | Relational columns | Real daily macro/shipping-fee actuals from the ML notebook's `history` DataFrame. One row per day, queried by date range. |

See [docs/data-pipeline.md](../docs/data-pipeline.md) for the ingest pipeline and [docs/data-schema.md](../docs/data-schema.md) for the full field-by-field contract.

**Status (2026-08-01): all three tables live.** `snapshots` and `historical_data` are populated from the real `shipsense_website_bundle.pkl` via `scripts/pkl_to_json.py` (90-day forecast + 2,143 days of historical actuals, 2018-01-09 through 2026-07-30, contiguous with the forecast start). `quote_requests` is live and empty, ready to receive real quotes from the New Forecast page.

**Real login, still-open data.** The login/signup pages in `frontend/index.html` + `frontend/app.js` use real Supabase Auth (email + password, `@goodfortune.com` accounts only — see `ALLOWED_EMAIL_DOMAIN` in `app.js`), gated behind a Supabase project with **Auth → Providers → Email** enabled. Emails there are the only gate on who can sign up/in — for defense in depth, also restrict allowed domains in the Supabase dashboard (Auth → Providers → Email → allowed domains), since a client-side check alone doesn't stop someone calling the Auth API directly. That said, every REST call in `app.js` (`quote_requests`, `snapshots`, `historical_data`) still authenticates with the public **anon key**, not the signed-in user's session token, so `quote_requests` (real business data: company names, fees, decisions) remains readable **and writable** by anyone holding the anon key regardless of login state. Tightening this — switching those `fetch()` calls to send the user's session `access_token` and scoping RLS policies on `quote_requests` in `schema.sql` to `auth.role() = 'authenticated'` — is a follow-up, not yet done.

## Setup

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is enough).
2. **Run the schema.** Project dashboard → SQL Editor → paste the full contents of `supabase/schema.sql` → Run. This creates all three tables, enables Row Level Security, and adds the policies. The file is safe to re-run any time (idempotent `create table if not exists` / `drop policy if exists` + `create policy`) — useful after pulling schema changes.
3. **Collect your keys** from Project Settings → API:
   - **Project URL** — e.g. `https://xxxxxxxx.supabase.co`
   - **anon / public key** — safe to embed in frontend code; RLS restricts `snapshots`/`historical_data` to read-only, but allows full read/write on `quote_requests` (see "No real authentication" above)
   - **service_role key** — secret, bypasses RLS, used only by the ingest script server-side. Never commit it or put it in frontend code.

## Wire up the frontend

In [frontend/app.js](../frontend/app.js), set:

```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = '<anon key>';
```

Leaving either blank breaks the app entirely — the Executive Dashboard's Forecast and Historical Data tabs, and Forecast History/quote persistence, all read and write Supabase directly with no other data source — see `app.js`/`exec-data.js`.

## Wire up ingestion

`scripts/pkl_to_json.py` POSTs the forecast snapshot and upserts the historical rows straight to Supabase's REST API using the service role key:

```bash
SUPABASE_URL="https://xxxxxxxx.supabase.co" \
SUPABASE_SERVICE_KEY="<service_role key>" \
python scripts/pkl_to_json.py path/to/shipsense_website_bundle.pkl
```

For automated ingestion on push, set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as GitHub Actions repo secrets — `.github/workflows/update-forecast-pkl.yml` already reads them.

`quote_requests` is never written by this script — it's populated directly by the frontend (anon key) whenever a staff member opens a Client Quote page or records a decision.

## Verify it end-to-end

```bash
# Latest forecast snapshot
curl "https://xxxxxxxx.supabase.co/rest/v1/snapshots?kind=eq.forecast&select=payload&order=id.desc&limit=1" \
  -H "apikey: <anon key>"

# Historical actuals (date range, row count)
curl "https://xxxxxxxx.supabase.co/rest/v1/historical_data?select=date&order=date.asc&limit=1" -H "apikey: <anon key>"
curl "https://xxxxxxxx.supabase.co/rest/v1/historical_data?select=date&order=date.desc&limit=1" -H "apikey: <anon key>"

# Quote requests (empty until staff generate quotes)
curl "https://xxxxxxxx.supabase.co/rest/v1/quote_requests?select=*" -H "apikey: <anon key>"
```

## Files

| File | Role |
|---|---|
| `schema.sql` | Creates all three tables, enables RLS, adds policies. Safe to re-run. |
