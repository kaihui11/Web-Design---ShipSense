"""
Convert ShipSense ML output .pkl -> a plain SQL seed file.

The sibling `pkl_to_json.py` is the real pipeline: it POSTs to Supabase's
REST API and needs the `service_role` key. This script answers a different
question — "how do I fill a brand-new Supabase project in one paste?" — and
so writes SQL to a file instead. No key, no network, nothing secret.

That distinction matters beyond convenience: setting up a fresh project is
exactly the moment when the service_role key has not been wired up yet, and
handing it around to solve a one-off setup problem is how it ends up
somewhere it shouldn't be. Generating SQL keeps the key out of the loop
entirely.

The output covers all three tables:
    snapshots       one forecast snapshot (the JSONB payload, verbatim)
    historical_data every historical day, upserted on `date`
    quote_requests  a handful of sample records, one per lifecycle stage, so
                    a fresh install has something to show on the Forecast
                    History page rather than an empty table

Usage:
    python scripts/pkl_to_seed_sql.py shipsense_website_bundle.pkl
    # writes supabase/seed.sql

Run it after supabase/schema.sql, never before — the seed assumes the
tables, constraints and triggers already exist.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Reuse the real pipeline's loaders rather than re-deriving the bundle
# format here. Two readers of the same .pkl that can drift apart is one
# reader too many.
sys.path.insert(0, str(Path(__file__).parent))
from pkl_to_json import build_forecast_json, build_historical_rows, load_bundle  # noqa: E402

ROOT = Path(__file__).parent.parent
OUT_PATH = ROOT / "supabase" / "seed.sql"

MARKUP = 1.20
QUOTE_VALIDITY_HOURS = 48


def sql_str(value) -> str:
    """Single-quoted SQL literal, or NULL."""
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def build_quote_rows(forecast: list, generated_at: str) -> list:
    """Sample quote_requests rows, one per lifecycle stage.

    These exist so the Forecast History page has something to demonstrate on
    a fresh install: the Edit/Cancel/Delete buttons each appear on a
    different subset of rows, and with an empty table none of that is
    visible. Dates are taken from the forecast itself so every row lands
    inside the selectable range rather than pointing at a day the app has no
    prediction for.
    """
    if len(forecast) < 30:
        return []

    def at(i):
        """ISD row plus the cheapest day in its ±5 window.

        The window minimum is computed the same way handleForecast() does in
        app.js, rather than just grabbing a nearby index. Picking an
        arbitrary neighbour can hand back a "lowest nearby fee" that is
        dearer than the selected date — which is not a stale number, it is an
        impossible one, and it would be on screen in the first table anyone
        looks at.
        """
        row = forecast[i]
        window = forecast[max(0, i - 5):i + 6]
        low = min(window, key=lambda d: float(d["f"]))
        return row["date"], float(row["f"]), low["date"], float(low["f"])

    isd_a, fee_a, low_a, lfee_a = at(5)
    isd_b, fee_b, low_b, lfee_b = at(12)
    isd_c, fee_c, low_c, lfee_c = at(20)
    isd_d, fee_d, low_d, lfee_d = at(26)

    issued = datetime.strptime(generated_at[:10], "%Y-%m-%d")
    valid = issued + timedelta(hours=QUOTE_VALIDITY_HOURS)
    stamp = f"{issued:%Y-%m-%dT%H:%M:%SZ}"
    valid_stamp = f"{valid:%Y-%m-%dT%H:%M:%SZ}"
    ref_day = f"{issued:%Y%m%d}"

    return [
        # Pending, never issued — fully mutable: Edit, Cancel and Delete all
        # available. This is the row that demonstrates Update.
        dict(company="Global Marine Sdn Bhd", pic="Ahmad Rizal", isd=isd_a,
             containers=10, isd_fee=fee_a, low_date=low_a, low_fee=lfee_a,
             client_date=isd_a, status="Pending", decision=None,
             ref=None, issued_at=None, valid_until=None,
             quoted_fee=None, quoted_price=None, forecast_at=None),
        # Pending, never issued — a second draft, so Delete can be shown
        # without spending the Edit demo row.
        dict(company="Nusantara Freight Bhd", pic="Siti Nurhaliza", isd=isd_b,
             containers=25, isd_fee=fee_b, low_date=low_b, low_fee=lfee_b,
             client_date=isd_b, status="Pending", decision=None,
             ref=None, issued_at=None, valid_until=None,
             quoted_fee=None, quoted_price=None, forecast_at=None),
        # Pending, issued — price locked, so no Edit, but still withdrawable.
        dict(company="Pacific Rim Logistics", pic="Chen Wei Ming", isd=isd_c,
             containers=15, isd_fee=fee_c, low_date=low_c, low_fee=lfee_c,
             client_date=low_c, status="Pending", decision=None,
             ref=f"SSQ-{ref_day}-0003", issued_at=stamp, valid_until=valid_stamp,
             quoted_fee=lfee_c, quoted_price=round(lfee_c * 15 * MARKUP, 2),
             forecast_at=generated_at),
        # Confirmed — the client agreed. Read-only, permanently.
        dict(company="Atlantic Cargo Services", pic="Michael Tan", isd=isd_d,
             containers=40, isd_fee=fee_d, low_date=low_d, low_fee=lfee_d,
             client_date=low_d, status="Confirmed", decision=low_d,
             ref=f"SSQ-{ref_day}-0004", issued_at=stamp, valid_until=valid_stamp,
             quoted_fee=lfee_d, quoted_price=round(lfee_d * 40 * MARKUP, 2),
             forecast_at=generated_at),
        # Cancelled — the client declined. Also read-only. decision_date must
        # stay NULL here: the schema's check constraint ties a decision_date
        # to Confirmed specifically, not to "any decision".
        dict(company="Northern Star Shipping", pic="Aisyah Rahman", isd=isd_b,
             containers=8, isd_fee=fee_b, low_date=low_b, low_fee=lfee_b,
             client_date=isd_b, status="Cancelled", decision=None,
             ref=None, issued_at=None, valid_until=None,
             quoted_fee=None, quoted_price=None, forecast_at=None),
    ]


def render(bundle) -> str:
    payload = build_forecast_json(bundle)
    historical = build_historical_rows(bundle)
    generated_at = payload["generated_at"]
    forecast = payload["forecast"]

    import json

    lines = [
        "-- ShipSense seed data — generated by scripts/pkl_to_seed_sql.py",
        "-- Source: shipsense_website_bundle.pkl",
        f"-- Forecast run: {generated_at}  ({len(forecast)} forecast days,"
        f" {len(historical)} historical days)",
        "--",
        "-- Run supabase/schema.sql FIRST. This file assumes the tables,",
        "-- constraints and triggers already exist.",
        "--",
        "-- Safe to re-run: the forecast snapshot for a given run day is",
        "-- replaced rather than duplicated (mirroring pkl_to_json.py),",
        "-- historical days upsert on their primary key, and the sample",
        "-- quote records are only inserted when that table is empty.",
        "",
        "begin;",
        "",
        "-- ── snapshots ────────────────────────────────────────────────",
        "-- One row per run day, matching find_existing_forecast_id() in",
        "-- pkl_to_json.py: same day means same run, so replace rather than",
        "-- accumulate rows the frontend would never serve.",
        f"delete from snapshots where kind = 'forecast'",
        f"  and generated_at >= '{generated_at[:10]}T00:00:00Z'::timestamptz",
        f"  and generated_at <  '{generated_at[:10]}T00:00:00Z'::timestamptz + interval '1 day';",
        "",
        "insert into snapshots (kind, generated_at, payload) values (",
        f"  'forecast', '{generated_at}',",
        "  $seed$" + json.dumps(payload, separators=(",", ":")) + "$seed$::jsonb",
        ");",
        "",
        "-- ── historical_data ──────────────────────────────────────────",
    ]

    cols = ("date", "shipping_fee", "crude_oil", "exchange_rate", "gdp_origin",
            "gdp_destination", "inflation_origin", "inflation_destination")

    if historical:
        lines.append(f"insert into historical_data ({', '.join(cols)}) values")
        values = []
        for row in historical:
            cells = [sql_str(row["date"])] + [
                ("NULL" if row.get(c) is None else str(row[c])) for c in cols[1:]
            ]
            values.append("  (" + ", ".join(cells) + ")")
        lines.append(",\n".join(values))
        lines.append("on conflict (date) do update set")
        lines.append(",\n".join(
            f"  {c} = excluded.{c}" for c in cols[1:]
        ) + ";")
        lines.append("")

    quotes = build_quote_rows(forecast, generated_at)
    if quotes:
        lines += [
            "-- ── quote_requests (sample records) ──────────────────────────",
            "-- Guarded so a re-run never duplicates them, and so real quotes",
            "-- created through the app are never joined by demo data.",
            "do $$",
            "begin",
            "if not exists (select 1 from quote_requests) then",
            "  insert into quote_requests (",
            "    company, pic, route, isd_date, containers, isd_fee,",
            "    low_date, low_fee, client_date, status, decision_date,",
            "    quote_ref, issued_at, valid_until, quoted_fee, quoted_price,",
            "    forecast_generated_at",
            "  ) values",
        ]
        rows = []
        for q in quotes:
            rows.append(
                "    (" + ", ".join([
                    sql_str(q["company"]), sql_str(q["pic"]), "'ne-usec'",
                    sql_str(q["isd"]), str(q["containers"]),
                    str(round(q["isd_fee"], 2)),
                    sql_str(q["low_date"]), str(round(q["low_fee"], 2)),
                    sql_str(q["client_date"]), sql_str(q["status"]),
                    sql_str(q["decision"]), sql_str(q["ref"]),
                    sql_str(q["issued_at"]), sql_str(q["valid_until"]),
                    "NULL" if q["quoted_fee"] is None else str(round(q["quoted_fee"], 2)),
                    "NULL" if q["quoted_price"] is None else str(q["quoted_price"]),
                    sql_str(q["forecast_at"]),
                ]) + ")"
            )
        lines.append(",\n".join(rows) + ";")
        lines += ["end if;", "end $$;", ""]

    lines += ["commit;", ""]
    return "\n".join(lines)


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/pkl_to_seed_sql.py path/to/bundle.pkl")
        sys.exit(1)

    pkl_path = Path(sys.argv[1])
    print(f"Loading {pkl_path}...")
    bundle = load_bundle(pkl_path)

    sql = render(bundle)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(sql, encoding="utf-8")

    kb = len(sql.encode("utf-8")) / 1024
    print(f"Wrote {OUT_PATH} ({kb:.0f} KB)")
    print("Paste it into the Supabase SQL editor AFTER running schema.sql.")


if __name__ == "__main__":
    main()
