# ShipSense — Supabase Backend

Supabase (hosted Postgres) is the backend for this app, serving everything to the frontend via Supabase's built-in REST API (PostgREST) — no custom server to write or host. Four tables, four different shapes on purpose:

| Table | Shape | Why |
|---|---|---|
| `snapshots` | JSONB blob | ML forecast output. Replaced wholesale on each ingest, never queried by field — a blob fits. |
| `quote_requests` | Relational columns | Client quotes staff generate from the New Forecast page. Needs per-row updates (status changes), filtering, and sorting — a blob doesn't fit this. |
| `historical_data` | Relational columns | Real daily macro/shipping-fee actuals from the ML notebook's `history` DataFrame. One row per day, queried by date range. |
| `contact_messages` | Relational columns | Enquiries from the public Contact page. The only table written by strangers rather than staff, and the only one the anon key **cannot read back** — see below. |

See [docs/data-pipeline.md](../docs/data-pipeline.md) for the ingest pipeline and [docs/data-schema.md](../docs/data-schema.md) for the full field-by-field contract.

**Status (2026-08-12): all four tables live** on project `uioqmeulbvsnqfvtdmzt`. `snapshots` and `historical_data` are populated from the real `shipsense_website_bundle.pkl` — a 90-day forecast (run of 2026-08-07) plus 2,149 days of historical actuals, contiguous with the forecast start. `quote_requests` carries five sample records from `seed.sql`, one per lifecycle stage, alongside whatever real quotes the app has since created.

**Real login, still-open data.** The login/signup screens in `frontend/index.html` + `frontend/app.js` use real Supabase Auth (email + password, `@goodfortune.com` accounts only — see `ALLOWED_EMAIL_DOMAIN` in `app.js`), gated behind a Supabase project with **Auth → Providers → Email** enabled. Emails there are the only gate on who can sign up/in — for defense in depth, also restrict allowed domains in the Supabase dashboard (Auth → Providers → Email → allowed domains), since a client-side check alone doesn't stop someone calling the Auth API directly. That said, every REST call in `app.js` (`quote_requests`, `snapshots`, `historical_data`) still authenticates with the public **anon key**, not the signed-in user's session token, so `quote_requests` (real business data: company names, fees, decisions) remains readable **and writable** by anyone holding the anon key regardless of login state. Tightening this — switching those `fetch()` calls to send the user's session `access_token` and scoping RLS policies on `quote_requests` in `schema.sql` to `auth.role() = 'authenticated'` — is a follow-up, not yet done.

## Setup

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is enough).
2. **Run the schema.** Project dashboard → SQL Editor → paste the full contents of `supabase/schema.sql` → Run. This creates all three tables, enables Row Level Security, and adds the policies. The file is safe to re-run any time (idempotent `create table if not exists` / `drop policy if exists` + `create policy`) — useful after pulling schema changes.
3. **Seed the data.** SQL Editor → paste `supabase/seed.sql` → Run. This fills `snapshots` and `historical_data` from the ML bundle and adds five sample `quote_requests` rows, one per lifecycle stage, so the Forecast History page has something to show on a fresh install. Regenerate it from a newer bundle with:

   ```bash
   python scripts/pkl_to_seed_sql.py shipsense_website_bundle.pkl
   ```

   This is the no-key path to a populated database — see "Wire up ingestion" below for the pipeline that does the same job with the service_role key. Order matters: schema first, seed second.
4. **Enable email auth.** Auth → Providers → Email → enable. Turn **Confirm email off** if accounts need to work the moment they are created; leave it on if you would rather every address be verified first. This is a real trade-off, not a formality — with confirmation on, anyone signing up needs inbox access before they can log in.
5. **Collect your keys** from Project Settings → API:
   - **Project URL** — e.g. `https://xxxxxxxx.supabase.co`
   - **anon / public key** — safe to embed in frontend code; RLS restricts `snapshots`/`historical_data` to read-only, allows full read/write on `quote_requests` (see "No real authentication" above), and allows insert-but-not-select on `contact_messages`
   - **service_role key** — secret, bypasses RLS, used only by the ingest script server-side. Never commit it or put it in frontend code.

## Wire up the frontend

In [frontend/supabase-config.js](../frontend/supabase-config.js), set:

```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = '<anon key>';
```

One file, read by every script the app loads: `app.js`, `exec-data.js` and `contact-form.js`. Leaving either constant blank breaks the app entirely — the Executive Dashboard's Forecast and Historical Data tabs, and Forecast History/quote persistence, all read and write Supabase directly with no other data source — see `app.js`/`exec-data.js`.

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

# Contact messages — this one SHOULD fail with a 401/permission error.
# The anon key may insert enquiries and must not be able to read them back.
curl "https://xxxxxxxx.supabase.co/rest/v1/contact_messages?select=*" -H "apikey: <anon key>"
```

Read the enquiry inbox from the Supabase dashboard (Table Editor → `contact_messages`), which authenticates as `service_role` and bypasses RLS.

## Files

| File | Role |
|---|---|
| `schema.sql` | Creates all four tables, enables RLS, adds policies, field constraints and the update/delete guard triggers. Safe to re-run. |
| `seed.sql` | Generated by `scripts/pkl_to_seed_sql.py`. Fills `snapshots`, `historical_data` and sample `quote_requests` in one paste. Run after `schema.sql`. Safe to re-run. `contact_messages` is not seeded — it starts empty and fills from the live Contact page. |
