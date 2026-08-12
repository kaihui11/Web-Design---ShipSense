"""
Convert ShipSense ML output .pkl -> forecast payload -> POST to Supabase.

Matches the real notebook export as of the `shipsense_website_bundle.pkl`
export (2026-07-30). Unlike the earlier `model_output.pkl` exports, this is
not a plain dict — it's pickled as an instance of a `ShipSenseWebsiteBundle`
class that only exists in the exporting notebook's `__main__` namespace. A
placeholder class is registered below purely so `pickle`/`joblib` can
resolve the class reference (`find_class("__main__", "ShipSenseWebsiteBundle")`)
and rebuild the instance's `__dict__` — its attributes are:
    as_of_date    pandas.Timestamp — date the model/forecast was generated
    history       DataFrame, one row per historical day: Date, Shipping_Fee,
                  Crude_Oil, Exchange_Rate, GPR, TPU, Inflation_US,
                  Inflation_NE, GDP_US, GDP_NE — ingested into the
                  `historical_data` table, see below
    forecast_90d  DataFrame, 90 rows: Forecast_Date, Forecasted_Shipping_Fee,
                  Lower_90, Upper_90, Forecasted_Crude_Oil,
                  Forecasted_Exchange_Rate
    model         fitted xgboost.sklearn.XGBRegressor (not consumed here)
    features      list of feature names used by `model`
    metrics       dict of validation/hold-out R2/RMSE/MAE
    meta          training run metadata (GAN augmentation, split, etc.)

`date`/`f`/`wti`/`usdEur` are consumed by the frontend (app.js/exec-data.js)
— `Lower_90`/`Upper_90` are dropped rather than carried through as unused
`b`/`w` fields. GDP/Inflation/GPR/TPU are NOT in `forecast_90d` — the model
doesn't forecast them per day (only `history` has them, as historicals),
so the dashboard still placeholders GDP/Inflation for the forecast horizon.
`metrics` is still passed through as `model_summary`, though the frontend
never reads it either.

`history` powers the Executive Dashboard's Historical tab (via the
`historical_data` table) — see docs/data-schema.md for the full column
mapping. GPR/TPU are dropped (never shown — dashboard has no forecast
counterpart for them). GDP/Inflation are kept as separate origin (North
Europe/NE) and destination (US) values rather than averaged — the two
economies differ in size/currency/policy, and a mean can mask one side
moving while the other doesn't.

Usage:
    python scripts/pkl_to_json.py path/to/shipsense_website_bundle.pkl

Env vars (backend is Supabase — see supabase/README.md):
    SUPABASE_URL          e.g. https://xxxxxxxx.supabase.co
    SUPABASE_SERVICE_KEY  service_role key (bypasses RLS) — never the anon key

Both the Forecast and Historical tabs read Supabase only —
SUPABASE_URL/SUPABASE_SERVICE_KEY must be set for this script to have
any effect. If they're unset, it just prints what it would have posted.
"""
import json
import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).parent.parent


class ShipSenseWebsiteBundle:
    """Placeholder so pickle can resolve the notebook's bundle class."""


def _stub_module(name: str):
    """Register an empty module that hands out placeholder classes on demand.

    The notebook has exported the bundle from more than one namespace over
    time (`__main__`, then `shipsense_new_output_bundle`), and only the
    instance `__dict__` matters here — never the class body.
    """
    module = types.ModuleType(name)
    module.__getattr__ = lambda attr: type(attr, (), {"__module__": name})
    sys.modules[name] = module
    return module


def load_bundle(pkl_path: Path):
    import joblib

    sys.modules["__main__"].ShipSenseWebsiteBundle = ShipSenseWebsiteBundle

    # Retry rather than hard-coding the exporting module's name: each retry
    # stubs exactly one missing shipsense-ish module and tries again. A
    # missing third-party module (xgboost, sklearn, ...) is a real problem
    # and still raises.
    while True:
        try:
            bundle = joblib.load(pkl_path)
            break
        except ModuleNotFoundError as exc:
            missing = exc.name or ""
            if "shipsense" not in missing.lower() or missing in sys.modules:
                raise
            print(f"note: stubbing pickled bundle module {missing!r}")
            _stub_module(missing)

    if not hasattr(bundle, "forecast_90d"):
        raise ValueError(
            f"pkl missing 'forecast_90d' attribute — update load_bundle() to "
            f"match the actual notebook export structure. Got attributes: "
            f"{list(vars(bundle).keys())}"
        )
    return bundle


def build_historical_rows(bundle) -> list:
    return [
        {
            "date": str(row["Date"])[:10],
            "shipping_fee": round(float(row["Shipping_Fee"]), 2),
            "crude_oil": round(float(row["Crude_Oil"]), 2),
            "exchange_rate": round(float(row["Exchange_Rate"]), 4),
            # North Europe is the origin market, the US the destination —
            # kept separate rather than averaged (see docs/data-schema.md):
            # the two economies differ in size/currency/policy, and a mean
            # can mask one side moving while the other doesn't.
            "gdp_origin": round(float(row["GDP_NE"]), 4),
            "gdp_destination": round(float(row["GDP_US"]), 4),
            "inflation_origin": round(float(row["Inflation_NE"]), 4),
            "inflation_destination": round(float(row["Inflation_US"]), 4),
        }
        for row in bundle.history.to_dict("records")
    ]


def build_forecast_json(bundle) -> dict:
    forecast = [
        {
            "date": str(row["Forecast_Date"])[:10],
            "f": round(float(row["Forecasted_Shipping_Fee"]), 2),
            "wti": round(float(row["Forecasted_Crude_Oil"]), 2),
            "usdEur": round(float(row["Forecasted_Exchange_Rate"]), 4),
        }
        for row in bundle.forecast_90d.to_dict("records")
    ]

    generated_at = bundle.as_of_date.strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "generated_at": generated_at,
        "forecast": forecast,
        "model_summary": bundle.metrics,
    }


def _snapshot_headers() -> dict:
    service_key = os.environ["SUPABASE_SERVICE_KEY"]
    return {
        "Content-Type": "application/json",
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }


def find_existing_forecast_id(generated_at: str):
    """Newest forecast snapshot generated on the same day, if any.

    Matched by day rather than exact timestamp to mirror the frontend, which
    collapses runs per `generated_at` day (`dedupeRuns` in app.js). Matching
    the exact timestamp instead would let two same-day exports with different
    clock times both persist, and the newer one would silently hide the older
    — a row that exists, is served by no page, and confuses the next person
    to read the table.
    """
    import urllib.parse
    import urllib.request
    from datetime import datetime, timedelta

    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    day = datetime.strptime(generated_at[:10], "%Y-%m-%d")
    next_day = day + timedelta(days=1)

    query = urllib.parse.urlencode({
        "kind": "eq.forecast",
        "generated_at": f"gte.{day:%Y-%m-%d}T00:00:00Z",
        "select": "id",
        "order": "id.desc",
        "limit": "1",
    })
    # urlencode takes one value per key, but the upper bound needs a second
    # generated_at filter — PostgREST ANDs repeated params.
    query += f"&generated_at=lt.{next_day:%Y-%m-%d}T00:00:00Z"

    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/snapshots?{query}",
        method="GET",
        headers=_snapshot_headers(),
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        rows = json.loads(resp.read())
    return rows[0]["id"] if rows else None


def post_to_supabase(payload: dict) -> None:
    """Write the forecast snapshot, one row per run day.

    Re-ingesting a bundle updates that day's row instead of appending a new
    one. The workflow re-runs on any .pkl push to main, so appending meant the
    table grew a row per push while the frontend only ever served the newest.
    """
    import urllib.request

    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    generated_at = payload["generated_at"]
    existing_id = find_existing_forecast_id(generated_at)

    body = json.dumps({
        "kind": "forecast",
        "generated_at": generated_at,
        "payload": payload,
    }).encode("utf-8")

    if existing_id is None:
        url = f"{supabase_url}/rest/v1/snapshots"
        method, action = "POST", "inserted"
    else:
        url = f"{supabase_url}/rest/v1/snapshots?id=eq.{existing_id}"
        method, action = "PATCH", f"updated id {existing_id}"

    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={**_snapshot_headers(), "Prefer": "return=minimal"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"Ingest response [{resp.status}] ({action}, run {generated_at[:10]})")


def post_historical_to_supabase(rows: list) -> None:
    import urllib.request

    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_KEY"]

    body = json.dumps(rows).encode("utf-8")

    # Upsert on `date` (the primary key) so re-running ingestion after a
    # notebook re-run updates existing days instead of erroring on the
    # duplicate-key conflict a plain insert would hit.
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/historical_data?on_conflict=date",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"Historical ingest response [{resp.status}] ({len(rows)} rows)")


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/pkl_to_json.py path/to/model_output.pkl")
        sys.exit(1)

    pkl_path = Path(sys.argv[1])
    print(f"Loading {pkl_path}...")
    bundle = load_bundle(pkl_path)
    payload = build_forecast_json(bundle)
    print(f"Built {len(payload['forecast'])} forecast rows")
    historical_rows = build_historical_rows(bundle)
    print(f"Built {len(historical_rows)} historical rows")

    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"):
        post_to_supabase(payload)
        post_historical_to_supabase(historical_rows)
    else:
        print("SUPABASE_URL/SUPABASE_SERVICE_KEY not set — nothing posted")
        print(json.dumps(payload, indent=2)[:2000])


if __name__ == "__main__":
    main()
