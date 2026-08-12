-- ShipSense Supabase (Postgres) schema
--
-- Three tables, three different shapes on purpose:
--   snapshots       — ML forecast blob (JSONB). Replaced wholesale on
--                      each ingest, never queried by field — a blob fits.
--   quote_requests  — client quotes staff generate. Needs per-row
--                      updates/filtering/sorting — real columns, not JSONB.
--   historical_data — real daily macro actuals from the ML notebook.
--                      One row per day, queried by date range.

-- snapshots: one row per ingested forecast snapshot. The frontend
-- contract (see docs/data-schema.md) is stored verbatim as JSONB and
-- returned as-is to the frontend via the Supabase REST API — no
-- per-field columns to keep this in sync with an ML pipeline that is
-- still evolving.
create table if not exists snapshots (
    id           bigint generated always as identity primary key,
    kind         text        not null,        -- e.g. 'forecast'
    generated_at timestamptz not null,
    payload      jsonb       not null,
    created_at   timestamptz not null default now()
);

create index if not exists idx_snapshots_kind_created
    on snapshots (kind, created_at);

-- Row Level Security: the frontend reads with the public "anon" key, so
-- only SELECT is allowed for anyone. Inserts are done by
-- scripts/pkl_to_json.py using the "service_role" key, which bypasses
-- RLS entirely — no insert policy needed (and none is added, so the
-- anon key can never write).
alter table snapshots enable row level security;

-- create policy has no IF NOT EXISTS in Postgres, so drop-then-create
-- keeps this file safely re-runnable (e.g. after adding new tables below).
drop policy if exists "Public read access" on snapshots;
create policy "Public read access"
    on snapshots
    for select
    using (true);

-- ---------------------------------------------------------------------
-- quote_requests: one row per client quote a staff member has generated
-- from the New Forecast page (see frontend/app.js). This is real
-- business data (company names, fees, decisions). Login/signup is now
-- backed by real Supabase Auth (see docs/business-logic.md), but other
-- REST calls in app.js still authenticate with the public anon key
-- rather than the signed-in user's session token, so RLS here isn't yet
-- scoped to individual users: anyone with the (already-public) anon key
-- can read/write all rows, same as any logged-in staff member could
-- today. Tighten these policies to require auth.uid() once app.js's
-- Supabase calls are switched to the authenticated session token.
create table if not exists quote_requests (
    id            bigint generated always as identity primary key,
    company       text        not null,
    pic           text        not null,
    route         text        not null,        -- route id, e.g. 'ne-usec' (see ROUTES in app.js)
    isd_date      date        not null,         -- intended ship date
    containers    integer     not null,
    isd_fee       numeric     not null,         -- forecasted fee/FEU on isd_date
    low_date      date        not null,         -- date of lowest fee in the +/-5 day window
    low_fee       numeric     not null,
    client_date   date        not null,         -- date quoted to the client (defaults to low_date)
    status        text        not null default 'Pending'
                  check (status in ('Pending', 'Confirmed', 'Cancelled')),
    decision_date date,                         -- set when status becomes 'Confirmed'
    -- Issued-quotation fields. Null until the user presses "Generate
    -- Quotation" on the Client Quote Preview; set together at that moment
    -- and immutable from then on (see the trigger below). A quotation is
    -- a price the client was actually given, so a later forecast run must
    -- never move it -- re-quoting creates a new row with a new reference.
    quote_ref     text,                         -- e.g. 'SSQ-20260808-0042'
    issued_at     timestamptz,
    valid_until   timestamptz,
    quoted_fee    numeric,                      -- fee/FEU on client_date, frozen at issue
    quoted_price  numeric,                      -- quoted_fee * containers * markup, frozen at issue
    forecast_generated_at timestamptz,          -- snapshots.generated_at the price was priced from
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- Migration for tables created before quotations were lockable.
-- Safe to re-run.
alter table quote_requests add column if not exists quote_ref text;
alter table quote_requests add column if not exists issued_at timestamptz;
alter table quote_requests add column if not exists valid_until timestamptz;
alter table quote_requests add column if not exists quoted_fee numeric;
alter table quote_requests add column if not exists quoted_price numeric;
alter table quote_requests add column if not exists forecast_generated_at timestamptz;

-- References are only assigned on issue, so the uniqueness rule has to
-- skip the not-yet-issued rows rather than treat their nulls as values.
create unique index if not exists idx_quote_requests_ref
    on quote_requests (quote_ref) where quote_ref is not null;

create index if not exists idx_quote_requests_created
    on quote_requests (created_at desc);

alter table quote_requests enable row level security;

drop policy if exists "Public read access" on quote_requests;
create policy "Public read access"
    on quote_requests
    for select
    using (true);

drop policy if exists "Public insert access" on quote_requests;
create policy "Public insert access"
    on quote_requests
    for insert
    with check (true);

drop policy if exists "Public update access" on quote_requests;
create policy "Public update access"
    on quote_requests
    for update
    using (true)
    with check (true);

-- Delete. Deliberately narrower than the policies above: a request may be
-- removed only while it is still Pending -- that is, while no client
-- decision has been recorded against it. Once a client has Confirmed or
-- Cancelled, the row is the record of a decision that actually happened and
-- deleting it would erase business history, so those are permanent.
--
-- Note this permits deleting an *issued* quotation that is still awaiting a
-- client response (withdrawing a quote before it is answered). The issue
-- lock in enforce_quote_status_transition() stops an issued quotation being
-- silently re-priced; it was never meant to stop a still-open request being
-- withdrawn outright. Restricting deletion to never-issued rows instead
-- would make the operation unreachable in practice, since opening the Client
-- Quote Preview issues the quotation immediately (see docs/business-logic.md).
drop policy if exists "Delete pending requests" on quote_requests;
create policy "Delete pending requests"
    on quote_requests
    for delete
    using (status = 'Pending');

-- The policy above already filters what the anon key can delete, but a
-- policy failure deletes zero rows silently rather than reporting why. This
-- trigger turns the same rule into an explicit error, and also covers the
-- service_role key, which bypasses RLS entirely.
create or replace function enforce_quote_delete_rules()
returns trigger as $$
begin
    if old.status <> 'Pending' then
        raise exception
            'quote_requests: record % is % — a recorded client decision is permanent and cannot be deleted',
            old.id, old.status;
    end if;
    return old;
end;
$$ language plpgsql;

drop trigger if exists quote_requests_delete_guard on quote_requests;
create trigger quote_requests_delete_guard
    before delete on quote_requests
    for each row
    execute function enforce_quote_delete_rules();

-- Field validity: these mirror checks app.js already does in the UI
-- (see handleForecast()'s containers < 1 guard), but the anon key can
-- write to this table directly over PostgREST, bypassing app.js
-- entirely, so they're re-declared here as the enforced version.
-- ADD CONSTRAINT has no IF NOT EXISTS, so check pg_constraint first to
-- keep this file safely re-runnable.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'quote_requests_containers_positive'
    ) then
        alter table quote_requests
            add constraint quote_requests_containers_positive check (containers > 0);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'quote_requests_isd_fee_positive'
    ) then
        alter table quote_requests
            add constraint quote_requests_isd_fee_positive check (isd_fee > 0);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'quote_requests_low_fee_positive'
    ) then
        alter table quote_requests
            add constraint quote_requests_low_fee_positive check (low_fee > 0);
    end if;

    -- decision_date is only meaningful once a client has confirmed
    -- (see docs/business-logic.md: "decision_date ... set when status
    -- becomes 'Confirmed'"). Keep it consistent regardless of who's
    -- writing the row.
    if not exists (
        select 1 from pg_constraint where conname = 'quote_requests_decision_date_matches_status'
    ) then
        alter table quote_requests
            add constraint quote_requests_decision_date_matches_status
            check (
                (status = 'Confirmed' and decision_date is not null)
                or (status <> 'Confirmed' and decision_date is null)
            );
    end if;

    -- A quotation is issued as one atomic act: either none of the issue
    -- fields are set (still a working preview) or all of them are. A row
    -- with, say, a price but no valid_until would be a quote nobody can
    -- tell the expiry of.
    if not exists (
        select 1 from pg_constraint where conname = 'quote_requests_issue_fields_together'
    ) then
        alter table quote_requests
            add constraint quote_requests_issue_fields_together
            check (
                (issued_at is null and valid_until is null and quote_ref is null
                 and quoted_fee is null and quoted_price is null)
                or
                (issued_at is not null and valid_until is not null and quote_ref is not null
                 and quoted_fee is not null and quoted_price is not null
                 and valid_until > issued_at and quoted_fee > 0 and quoted_price > 0)
            );
    end if;
end $$;

-- Status transitions: Pending -> Confirmed or Pending -> Cancelled only.
-- Once a decision is recorded it's final (see docs/business-logic.md:
-- "No transition back from Confirmed" / "Cancellation is irreversible")
-- -- app.js enforces this by disabling the UI after a decision, but that's
-- advisory: the anon key can UPDATE any row over PostgREST regardless of
-- what buttons are disabled client-side. A CHECK constraint can't see the
-- previous row, so this needs a trigger.
create or replace function enforce_quote_status_transition()
returns trigger as $$
begin
    if old.status <> 'Pending' then
        raise exception
            'quote_requests: record % is % and can no longer be modified',
            old.id, old.status;
    end if;

    if new.status <> old.status and new.status not in ('Confirmed', 'Cancelled') then
        raise exception
            'quote_requests: invalid status transition % -> % for record %',
            old.status, new.status, old.id;
    end if;

    -- Quotation lock: once issued, the quoted price and everything it was
    -- derived from is frozen for good -- not merely until valid_until, since
    -- an expired quotation is still a record of what the client was told.
    -- Re-quoting from a newer forecast inserts a new row (new reference);
    -- it never rewrites this one. Only the decision fields stay writable.
    if old.issued_at is not null and (
           new.quote_ref             is distinct from old.quote_ref
        or new.issued_at             is distinct from old.issued_at
        or new.valid_until           is distinct from old.valid_until
        or new.quoted_fee            is distinct from old.quoted_fee
        or new.quoted_price          is distinct from old.quoted_price
        or new.forecast_generated_at is distinct from old.forecast_generated_at
        or new.client_date           is distinct from old.client_date
        or new.containers            is distinct from old.containers
        or new.isd_date              is distinct from old.isd_date
        or new.isd_fee               is distinct from old.isd_fee
        or new.low_date              is distinct from old.low_date
        or new.low_fee               is distinct from old.low_fee
        or new.route                 is distinct from old.route
        or new.company               is distinct from old.company
        or new.pic                   is distinct from old.pic
    ) then
        raise exception
            'quote_requests: quotation % (record %) is issued and its terms are locked',
            old.quote_ref, old.id;
    end if;

    -- Reference format is the frontend's to choose (it stamps the issue
    -- date in the user's own timezone), but a direct PostgREST write that
    -- issues a quote without one still has to end up with a usable
    -- reference, so fall back to a UTC-dated one.
    if new.issued_at is not null and new.quote_ref is null then
        new.quote_ref := 'SSQ-' || to_char(new.issued_at at time zone 'UTC', 'YYYYMMDD')
                         || '-' || lpad(old.id::text, 4, '0');
    end if;

    return new;
end;
$$ language plpgsql;

drop trigger if exists quote_requests_status_transition on quote_requests;
create trigger quote_requests_status_transition
    before update on quote_requests
    for each row
    execute function enforce_quote_status_transition();

-- ---------------------------------------------------------------------
-- historical_data: real daily macro/shipping-fee actuals from the ML
-- notebook's `history` DataFrame (see scripts/pkl_to_json.py), one row
-- per calendar day. Powers the Executive Dashboard's Historical tab,
-- replacing the synthetic Brownian-bridge placeholder that was used
-- when this table was empty. Read-only from the frontend (anon key);
-- only scripts/pkl_to_json.py (service_role) writes to it.
create table if not exists historical_data (
    date                   date    primary key,
    shipping_fee           numeric not null,
    crude_oil              numeric,
    exchange_rate          numeric,
    gdp_origin             numeric,   -- GDP_NE — North Europe, the origin market
    gdp_destination        numeric,   -- GDP_US — the destination market
    inflation_origin       numeric,   -- Inflation_NE
    inflation_destination  numeric    -- Inflation_US
);

-- Migration for tables created before origin/destination were split out:
-- North Europe (origin) and the US (destination) differ in economy size,
-- currency, and policy, so averaging them into one gdp/inflation number
-- hid which side of the route was actually driving a change. Safe to
-- re-run: no-ops once the rename below has already happened.
alter table historical_data add column if not exists gdp_origin numeric;
alter table historical_data add column if not exists gdp_destination numeric;
alter table historical_data add column if not exists inflation_origin numeric;
alter table historical_data add column if not exists inflation_destination numeric;
alter table historical_data drop column if exists gdp;
alter table historical_data drop column if exists inflation;

alter table historical_data enable row level security;

drop policy if exists "Public read access" on historical_data;
create policy "Public read access"
    on historical_data
    for select
    using (true);
