# Data Schema Reference

---

## `shipsense_website_bundle.pkl` → Supabase (current pipeline)

Produced by an external Colab training notebook (not tracked in this repo), consumed by `scripts/pkl_to_json.py`. The `.pkl` is a `joblib.dump()`'d instance of a `ShipSenseWebsiteBundle` class that only exists in the exporting notebook — which namespace has varied between exports (`__main__` originally, `shipsense_new_output_bundle` as of the 2026-08-07 export). `pkl_to_json.py` doesn't hard-code that name: it registers a `__main__` placeholder and then stubs whatever shipsense-ish module the pickle asks for, retrying until it loads, since only the instance `__dict__` matters here and never the class body. A missing third-party module (xgboost, sklearn) still raises. Its attributes:

| Attribute | Type | Contents |
|---|---|---|
| `as_of_date` | `pandas.Timestamp` | Date the model/forecast was generated |
| `history` | `DataFrame` | One row per historical day — see `historical_data` table below |
| `forecast_90d` | `DataFrame` | 90 rows — see `forecast` payload below |
| `fee_model` / `oil_model` / `fx_model` | `xgboost.sklearn.XGBRegressor` | One fitted model per forecast target (not consumed by `pkl_to_json.py`) |
| `fee_features` / `oil_features` / `fx_features` | `list` | Feature names used by the matching model |
| `metrics` | `dict` | `validation_20` / `hold_out_10`, each holding R2/RMSE/MAE/MAPE/n per target — passed through as `model_summary` |
| `meta` | `dict` | Training run metadata (selected model, split, sources, leakage flags) |

Before the 2026-08-07 export there was a single `model` / `features` pair, back when only the shipping fee was modelled directly. Nothing in the ingest path reads either name, so the rename was contract-neutral.

**`forecast_90d` DataFrame columns actually read:**

| Column | Description |
|---|---|
| `Forecast_Date` | Forecast date |
| `Forecasted_Shipping_Fee` | Central forecast, USD/FEU |
| `Forecasted_Crude_Oil` | Forecasted WTI oil price input for that day |
| `Forecasted_Exchange_Rate` | Forecasted USD/EUR FX rate input for that day |

The DataFrame also carries `Lower_90_*` / `Upper_90_*` interval bounds for each of the three targets (`..._Shipping_Fee`, `..._Crude_Oil`, `..._Exchange_Rate`). These are **not** read — the frontend has never rendered forecast intervals. Earlier exports carried a single unsuffixed `Lower_90` / `Upper_90` pair covering the fee only.

GDP/Inflation/GPR/TPU are **not** in `forecast_90d` — the model doesn't forecast them per day, only `history` has them (as historical actuals). The Executive Dashboard shows real forecasted `wti`/`usdEur`, but placeholders GDP/Inflation (held constant) and doesn't show GPR/TPU at all for the forecast horizon.

**`snapshots` table payload shape** (what `pkl_to_json.py` POSTs, `kind='forecast'`):

```json
{
  "generated_at": "2026-09-03T00:00:00Z",
  "forecast": [
    { "date": "2026-06-06", "f": 2310.53, "wti": 80.24, "usdEur": 0.8694 }
  ],
  "model_summary": { "...": "..." }
}
```

| JSON key | Source |
|---|---|
| `date` | `Forecast_Date` |
| `f` | `Forecasted_Shipping_Fee` |
| `wti` | `Forecasted_Crude_Oil` — consumed by the Executive Dashboard's macro trend/tables |
| `usdEur` | `Forecasted_Exchange_Rate` — consumed by the Executive Dashboard's macro trend/tables |
| `model_summary` | passthrough of `metrics`, for reference/debugging — not currently rendered anywhere in the frontend |

The Forecast tab (`frontend/exec-data.js`, `frontend/app.js`) reads this `snapshots` row directly over PostgREST — it is the only data source for that tab.

**One row per run day.** `pkl_to_json.py` looks for an existing `kind='forecast'` snapshot generated on the same day and `PATCH`es it, inserting only when there is none. Re-ingesting a bundle therefore updates its row instead of appending. The match is by day, not exact timestamp, to mirror `dedupeRuns()` in `app.js` — the frontend only ever serves the newest run per day, so anything finer would persist rows no page can reach.

Rows written before this behaviour existed are still there (ids 4–9 as of 2026-08-09, covering two run days), which is why `dedupeRuns()` stays in the frontend rather than being retired. Note that these legacy duplicates are not all identical: the 2026-07-30 run was re-exported with different numbers under the same date, so collapsing them discards a genuinely distinct payload — deliberately, since the newest export for a given day is the one that counts.

---

## `historical_data` table (Supabase)

Ingested by `scripts/pkl_to_json.py` from the pkl bundle's `history` DataFrame (real daily actuals). Powers the Executive Dashboard's Historical tab, which reads this table only (`frontend/exec-data.js`).

| Column | Source | Notes |
|---|---|---|
| `date` | `Date` | Primary key — upserted on re-ingest, so re-running the script updates rather than duplicates |
| `shipping_fee` | `Shipping_Fee` | |
| `crude_oil` | `Crude_Oil` | Mapped to `wti` in the frontend's row shape |
| `exchange_rate` | `Exchange_Rate` | Mapped to `usdEur` |
| `gdp_origin` | `GDP_NE` | North Europe = origin market |
| `gdp_destination` | `GDP_US` | US = destination market |
| `inflation_origin` | `Inflation_NE` | North Europe |
| `inflation_destination` | `Inflation_US` | US |

Origin/destination are kept separate rather than averaged — North Europe and the US differ in economy size, currency, and policy, and a mean can hide one side moving while the other doesn't (e.g. NE inflation rising while US inflation falls would net out to "stable"). Decision-makers need to see which side of the route is driving a change.

GDP/inflation are annual figures — the same value repeats for every day within a given year in `history`. Flat year-long stretches on the Historical tab are expected for these four columns, not a data or ingest bug.

`GPR`/`TPU` from `history` are **not** ingested — the dashboard dropped these variables entirely, since the model has no forecast counterpart for them and showing historical-only values for two of six macro variables was more confusing than useful.

Public read-only via the anon key; only `scripts/pkl_to_json.py` (service_role) writes to it. When `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` are unset, the script just prints what it would have posted — nothing reaches the frontend (see `docs/after-receiving-pkl.md`).

---

## `quote_requests` table (Supabase)

One row per client quote a staff member generates from the New Forecast page (`frontend/app.js`). Unlike `snapshots`/`historical_data`, this is **not** populated by the ingest pipeline — it's written directly by the frontend using the anon key, both on insert (auto-saved as `Pending` the first time a Client Quote page is opened) and on update (when a staff member records the client's decision, or cancels).

| Column | camelCase field in `app.js` | Notes |
|---|---|---|
| `id` | `id` | Server-generated (`bigint identity`), replacing the old client-generated `genId()` string |
| `company` | `company` | |
| `pic` | `pic` | Free-text "person in charge" — not tied to any login identity (no real auth exists) |
| `route` | `route` | Route id, e.g. `ne-usec` — see `ROUTES` in `app.js` |
| `isd_date` | `isdDate` | Intended ship date |
| `containers` | `containers` | |
| `isd_fee` | `isdFee` | Forecasted fee/FEU on `isd_date` |
| `low_date` / `low_fee` | `lowDate` / `lowFee` | Lowest fee within the ±5 day window around `isd_date` |
| `client_date` | `clientDate` | Date actually quoted to the client (defaults to `low_date`) |
| `status` | `status` | `Pending` / `Confirmed` / `Cancelled` |
| `decision_date` | `decision` | Set when `status` becomes `Confirmed` |
| `quote_ref` | `quoteRef` | `SSQ-YYYYMMDD-####`. Null until issued; unique among issued rows |
| `issued_at` / `valid_until` | `issuedAt` / `validUntil` | Issue timestamp and the end of the 48-hour validity window |
| `quoted_fee` / `quoted_price` | `quotedFee` / `quotedPrice` | Fee/FEU on `client_date` and the total quoted price, frozen at issue |
| `forecast_generated_at` | `forecastGeneratedAt` | `snapshots.generated_at` of the run the price was taken from |
| `created_at` / `updated_at` | `ts` (derived) | `ts` is formatted client-side from `created_at`, not stored separately |

The last five columns are null while a quote is still a working preview, and are written together the moment the Client Quote preview opens on a still-pending record. From then on a database trigger rejects any change to them or to the figures behind them — a newer forecast run can't move a price a client has already been given. Re-quoting inserts a new row (see `docs/business-logic.md`).

Login is now backed by real Supabase Auth (see `docs/business-logic.md`), but other REST calls still use the public anon key rather than the signed-in user's session token, so RLS on this table allows any holder of the anon key to read/insert/update all rows. This is real business data (company names, fees), so tighten these policies to require `auth.uid()` once app.js's Supabase calls are switched to the authenticated session token.
