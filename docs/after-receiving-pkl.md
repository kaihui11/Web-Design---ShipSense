# Ingesting a New `shipsense_website_bundle.pkl`

Checklist for pushing a freshly-trained model's `.pkl` export into Supabase. See [data-pipeline.md](data-pipeline.md) for the overall flow and [data-schema.md](data-schema.md) for the exact `.pkl` contract.

---

## 1. Sanity-check the file before ingesting

Confirm it matches the `ShipSenseWebsiteBundle` contract `pkl_to_json.py` expects.

First install what the *pickle* needs, which is more than the script imports:

```bash
pip install pandas joblib xgboost
```

The bundle stores the trained fee/oil/fx regressors next to the forecast, so `joblib.load()` has to
import `xgboost` to rebuild them before any of the DataFrames are reachable. Without it the load
fails with `ModuleNotFoundError: No module named 'xgboost'` — the stub trick below only covers the
exporting notebook's own module, never third-party ones.

```bash
python -c "
import sys, types, joblib

# The exporting notebook's module name has changed between exports, so stub
# whatever it asks for rather than assuming __main__ (same trick as pkl_to_json.py).
def stub(name):
    m = types.ModuleType(name)
    m.__getattr__ = lambda attr: type(attr, (), {})
    sys.modules[name] = m

stub('shipsense_new_output_bundle')

b = joblib.load('path/to/shipsense_website_bundle.pkl')
print('bundle class:', type(b).__module__ + '.' + type(b).__name__)
print('attributes:', list(vars(b).keys()))
print('forecast_90d rows:', len(b.forecast_90d))
print('forecast_90d columns:', list(b.forecast_90d.columns))
print('history rows:', len(b.history))
"
```

If this raises `ModuleNotFoundError: No module named '<something>'`, the notebook exported from a namespace neither this snippet nor `pkl_to_json.py` has seen — add it to the `stub(...)` call here. The script itself self-heals for any module name containing "shipsense".

Check `forecast_90d columns` against the table in [data-schema.md](data-schema.md) — especially `Forecast_Date`, `Forecasted_Shipping_Fee`, `Forecasted_Crude_Oil`, `Forecasted_Exchange_Rate`, which are the columns `pkl_to_json.py` actually reads.

## 2. Confirm your Supabase project is set up

See [supabase/README.md](../supabase/README.md) if you haven't already: create the project, run `supabase/schema.sql`, and collect the Project URL + service_role key.

## 3. Run the real ingest

```bash
SUPABASE_URL="https://xxxxxxxx.supabase.co" \
SUPABASE_SERVICE_KEY="<service_role key>" \
python scripts/pkl_to_json.py path/to/shipsense_website_bundle.pkl
```

Expect `Ingest response [200/201]` for both the forecast POST and the historical upsert. If `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` are left unset, the script just prints what it would have posted — nothing reaches the frontend until Supabase is configured, since both tabs read Supabase directly with no other data source.

Pushing the `.pkl` to GitHub instead of running this locally triggers the same thing automatically via `.github/workflows/update-forecast-pkl.yml`.

## 4. Verify end-to-end

```bash
curl "https://xxxxxxxx.supabase.co/rest/v1/snapshots?kind=eq.forecast&select=payload&order=id.desc&limit=1" \
  -H "apikey: <anon key>"
```

Should return the new forecast. Then reload the frontend (`python -m http.server 8080` in `frontend/`) and confirm the Forecast tab's chart/table/calendar show the new values.

## 5. Historical Data tab data source

The Executive Dashboard's Historical tab reads Supabase's `historical_data` table only (upserted by `pkl_to_json.py` from the pkl's `history` DataFrame), same rule as the Forecast tab. If the table is empty, the tab simply shows no data — see `frontend/exec-data.js`.

`history` carries `shipping_fee`/`crude_oil`/`exchange_rate` plus GDP/inflation split by origin (North Europe) and destination (US) — `GPR`/`TPU` are dropped during ingest and never shown, since the model has no forecast counterpart for them and showing historical-only values for 2 of 6 macro variables was more confusing than useful (see `docs/data-schema.md`).
