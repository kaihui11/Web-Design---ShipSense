# ShipSense — Frontend User Flow & Page-by-Page Logic

> **Purpose:** Presentation reference document. Explains what each page does, how a user flows through the app, and the logic behind every screen. Intended for someone who needs to understand the system end-to-end without reading the code.

---

## What is ShipSense?

ShipSense is an **internal logistics cost-forecasting web application** built for freight/shipping analysts. It uses an ML model (XGBoost) trained on macroeconomic data to predict daily ocean freight rates for the next 90 days. The frontend gives analysts a structured workflow to:

1. Request a shipping fee forecast for a specific date and route
2. See the cheapest nearby booking window
3. Present a client-facing quotation with a 20% markup
4. Record the client's decision
5. Review the full history of past forecasts
6. Monitor the macro freight market trend at an executive level
7. Reason about how a move in the exchange rate would push the forecast around

---

## System Architecture (Overview)

```
[ML Pipeline — GitHub Actions]
  XGBoost model trained on macro data
  → POSTs 90 days of daily rates into Supabase's snapshots table
          │
          ▼
[Frontend — Static SPA]
  index.html + style.css + app.js
  Loads the latest forecast snapshot from Supabase on page load
  Stores forecast history in Supabase's quote_requests table
          │
          ▼
[7 Views — Single Page Application]
  All views exist in the DOM simultaneously.
  navigateTo(viewId) shows/hides them.
```

**No custom backend server.** The app is a static SPA that talks directly to Supabase's PostgREST API for forecast data, historical actuals, and quote history — see [docs/data-pipeline.md](data-pipeline.md). None of these have any other data source; if Supabase is unreachable or unconfigured, the affected page/tab simply has no data.

---

## App-Wide Flow

```
User opens the app
        │
        ▼
[ Page 1: Login ]
  Enter email + password → Sign In
        │
        ▼
[ Page 2: New Forecast ]  ←──────────── (can return to edit)
  Fill in: ISD date, containers, company, PIC
  Click → "Forecast Estimated Shipping Fee"
        │
        ▼
[ Page 4: Client Quote Preview ]  ←── landed on automatically
  Quotation issued on arrival: reference, validity window, locked price
  See quoted price (fee + 20% markup)
  Select client's preferred date
  Record decision (Confirmed / Pending)
  Export PDF if needed
        │
        ├──▶ [ Page 3: Forecast Result ]  ←── sidebar, any time
        │       ±5 day rate grid, selected vs. cheapest date, saving,
        │       day-on-day forecast revision — all internal, never quoted
        │
        ▼  (auto-saved to history on first open)
[ Page 5: Forecast History ]  ←── accessible any time from sidebar
  View, filter, cancel past records

[ Page 6: Executive Dashboard ]  ←── accessible any time from sidebar
  90-day macro view, chart, booking calendar, stress monitor

[ Page 7: Market Impact ]  ←── accessible any time from sidebar
  Exchange-rate scenario slider vs the 90-day forecast. Illustrative only
```

---

## Page 1 — Login

### What the user sees

A split-screen login page:
- **Left panel:** ShipSense branding, animated world-map route arcs, and three feature highlights (ML-Powered Forecasting, Operational Intelligence, Secure & Enterprise-Grade).
- **Right panel:** A sign-in form (email, password, "Forgot password?" link) with a toggle to a sign-up form (full name, email, password, confirm password) for users who don't yet have an account. There is no "Remember me" — the app never keeps a user signed in, so offering it would be a promise it doesn't keep.

### User Flow

1. User opens `index.html` in a browser.
2. The app immediately fetches the latest forecast snapshot from Supabase in the background (populating the 90-day rate data). **Every visit starts here** — sessions are not persisted, so there is no auto-login and no way to land on the workspace without entering credentials. The Login button stays disabled until the forecast data has loaded.
3. A first-time user clicks "Create one" to switch to the sign-up form, enters their name, `@goodfortune.com` email, and password (8+ characters, confirmed), and clicks **Create account**. Depending on the project's email-confirmation setting, this either logs them straight in or asks them to confirm via email first.
4. A returning user types their `@goodfortune.com` email and password and clicks **Login**.
5. If valid → the login screen disappears; the main app (sidebar + pages) slides in; the user lands on **New Forecast**.
6. If invalid → a red error banner appears with the reason (wrong domain, wrong credentials, passwords not matching, etc.).

### Logic

```
handleLogin(event):
  email, password = input values
  email must end with "@goodfortune.com"

  if invalid → show error banner, stop
  sbClient.auth.signInWithPassword({ email, password })
  if error   → show error banner, stop
  if success →
    state.user = returned user
    hide #view-login
    show #view-app
    set ISD date picker default = today's date
    navigateTo('new-forecast')

handleSignup(event):
  name, email, password, passwordConfirm = input values
  email must end with "@goodfortune.com"; password ≥ 8 chars; password === passwordConfirm

  if invalid → show error banner, stop
  sbClient.auth.signUp({ email, password, options: { data: { full_name: name } } })
  if error            → show error banner, stop
  if session returned → complete login immediately (same as handleLogin's success path)
  else                → show "check your email to confirm" success banner
```

> **Note on sessions:** the Supabase client is created with `persistSession: false` and `autoRefreshToken: false`, so no token is ever written to browser storage and a refresh always returns to the login form. Tokens left behind by earlier builds are cleared on load. A signup that returns a session still logs in immediately — that follows an explicit **Create account** press, not a restore.

> **Note:** Real authentication via Supabase Auth, gated to `@goodfortune.com` emails. See `supabase/README.md` for the caveat that other Supabase REST calls in `app.js` (e.g. `quote_requests`) still use the public anon key rather than the signed-in user's session token.

### Why this matters for the presentation

This page establishes that ShipSense is an **internal tool for authorized users only** — not a public-facing product. The branding on the left communicates the value proposition before the user even logs in.

---

## Page 2 — New Forecast

### What the user sees

A clean form card titled **"Enter Shipment Details"** with five fields:

| Field | Type | Notes |
|---|---|---|
| Selected Route | Read-only display | Fixed to "North Europe → US East Coast" |
| Intended Ship Date (ISD) | Date picker | Defaults to today's date |
| Number of Containers (FEU) | Number input | Default 10, min 1, max 500 |
| Company Name | Text input | e.g. "Global Marine Sdn Bhd" |
| Person in Charge (PIC) | Text input | e.g. "Ahmad Rizal" |

At the bottom: a prominent **"Forecast Estimated Shipping Fee"** button.

### User Flow

1. User arrives here after login (or clicks "New Forecast" in the sidebar).
2. The route is already locked — only NE→USEC is modelled (the ML data is for this lane).
3. User picks the date they plan to ship.
4. User enters how many containers they need.
5. User fills in the client's company name and their own name (used for records).
6. User clicks the blue forecast button.
7. App runs the forecast calculation and navigates straight to **Client Quote Preview**, where the quotation is issued on arrival. Naming a company and a PIC is already the decision to quote them, so nothing further is asked for. **Forecast Result** holds the internal working behind the number and stays one click away in the sidebar.

### Logic

```
handleForecast():
  routeId    = 'ne-usec'  (always fixed — only lane with ML data)
  isdDate    = user's chosen date
  containers = integer
  company    = string (for record-keeping)
  pic        = string (for record-keeping)

  data = FORECAST_DATA  (90-day array, each row: date, f, wti, usdEur)
         scaled by route multiplier (ne-usec scale = 1.00, so unchanged)

  isdRow = data row whose date matches isdDate
           (if date not in range → nearest available date used)

  isdIdx   = position of isdRow in array
  dayWindow = data[isdIdx−5 ... isdIdx+5]  (up to 11 days)

  lowestRow = the row in dayWindow with the minimum forecasted fee (f)

  state.currentForecast = {
    routeId, isdDate, containers, company, pic,
    isdRow, lowestRow, dayWindow,
    allData: full 90-day data,
    clientDate: isdRow.date   (the date the client asked for;
                               the lowest nearby date is shown as an
                               option but never applied automatically)
  }

  → navigateTo('client-quote')
```

**What is `route.scale`?**
The `ROUTES` config in `app.js` carries a `scale` field (currently `1.00` for the only supported route, NE→USEC) as a hook for scaling other lanes' rates off the NE→USEC ML forecast in the future. Only NE→USEC is wired up today.

---

## Page 3 — Forecast Result

Reached from the sidebar rather than in sequence: generating a forecast lands on the Client Quote. This page is the internal working behind that quote — the window it was picked from and how the prediction has moved — and none of it is client-facing.

### What the user sees

A results page with three main sections:

**1. Summary bar (top):** Route name | Selected ISD | Quantity (FEU)

**2. Day Grid:** A horizontal card strip showing ±5 days around the selected ISD (up to 11 cards). Each card shows:
- Day of week (Mon/Tue/…)
- Date
- Forecasted fee in USD

  - The selected ISD card is **highlighted blue** with "(Selected)" label.
  - The cheapest day in the window gets a **green "Lowest" badge**.

**3. Three summary metric cards:**
- **Selected ISD** (blue): the date chosen, total fee for all containers
- **Lowest Nearby Fee** (green): the cheapest date found in ±5 days, total fee
- **Flexible Saving** (purple/orange): the difference in USD and as a percentage — "how much you save if you shift the booking date"

**Action buttons:**
- **"Edit Forecast Input"** → goes back to New Forecast (preserves nothing — user re-enters)
- **"Prepare Client Quote"** → goes to Client Quote Preview

### Logic

```
renderForecastResult():
  cf = state.currentForecast

  Render summary bar → cf.routeId, cf.isdDate, cf.containers

  Render day grid:
    for each day in cf.dayWindow:
      if day.date === cf.isdDate  → card class = "selected" (blue)
      if day.date === cf.lowestRow.date AND not ISD → class += "lowest" (green badge)
      display: dow, date, fee (per FEU, not total)

  Summary cards:
    isdTotal = cf.isdRow.f × cf.containers
    lowTotal = cf.lowestRow.f × cf.containers

    Selected ISD card → isdTotal
    Lowest card       → lowTotal
    Saving card       → isdTotal − lowTotal, as USD and as %
```

For the baseline 90-day forecast (Jun–Sep 2026), all days are classified as **Low** — no shocks are modelled in this run.

### Why this matters for the presentation

This page is the core **decision support output**. The analyst sees immediately: "If I ship on my intended date, it costs X. If I shift by a day or two, it costs Y — saving Z." This allows them to go back to the client with a data-backed recommendation rather than a guess.

---

## Page 4 — Client Quote Preview

### What the user sees

The analyst's **client-facing pricing workspace**. This is where the internal shipping fee gets converted into a quoted price.

**Top section:**
- Same summary bar (Route | ISD | Quantity)
- **Quotation document block** (`#quote-doc`) — before issue, a grey "Quotation not yet generated / Draft" note; after issue, the quotation reference, date & time issued, valid-until, the quoted price, and the validity statement (*"For shipment on …, priced from market information of … and held for 48 hours from issue. Rates may be revised after that."* — the shipment date is the client's selected date, so it follows the date picker; the market-information date is the forecast run the price came from and only moves when a newer run is ingested; the expiry is stated as a duration rather than repeating the Valid Until timestamp shown above it) with a green **Valid** or red **Expired** badge
- Blue info banner: *"Client quotation price is calculated as estimated shipping fee + 20% markup."*

**Three KPI cards:**
| Card | Content |
|---|---|
| Selected ISD Quote (blue) | Total quote for the ISD date — the date being quoted by default |
| Lowest Nearby Quote (green) | Total quote for the cheapest date, captioned *"available if the client prefers"*. Advisory only |
| Potential Client Saving (orange) | What the client would save *if* they moved to that date |

**Comparison Table:**
Side-by-side comparison of ISD vs Lowest Nearby Date:
- Estimated Shipping Fee (raw cost)
- Client Quotation Price (with markup)
- 20% Markup Amount
- Cost Difference (shipping-fee gap vs the ISD baseline)
- Potential Saving (quotation-price gap vs the ISD baseline)

**Client Date Panel:**
- A calendar picker restricted to dates present in the 90-day forecast range (`initClientDateCalendar`/`renderClientDateCalendar`) — dates outside the forecast render disabled. **It is never locked**: the shipping date is the client's decision, so it stays usable before and after a quotation is issued. It opens on the client's requested ISD, with the lowest nearby date marked as an option
- Shows: Estimated Shipping Fee, 20% Markup, **Client Quotation Price** (live update as the user picks a date; frozen once issued)
- **"Generate New Quotation"** button → only appears once an issued quote has expired
- **"Record Client Choice"** button → opens a modal (disabled until issued)
- **"Export Quote (PDF)"** button → prints the issued quotation (disabled until issued)
- **Decision Status** indicator showing: Pending / Confirmed / Cancelled

### User Flow

1. User lands here directly from "Forecast Estimated Shipping Fee" — there is no intermediate click.
2. The quote opens on the client's requested ISD, with the lowest-nearby comparison shown beside it as an option to offer.
3. **On first open**, a "Pending" history record is automatically created in Supabase's `quote_requests` table, so the quote is tracked even if the analyst closes without recording a decision.
4. **Immediately after**, that record is issued (`issueQuotationFor()`): the reference, issue time, 48-hour validity window and price are stamped on before any figure is drawn. A later forecast run no longer moves this price. If the write fails, the page still renders on live figures and offers a retry in the quotation document.
5. User discusses the quote with the client.
6. If the client wants a different date, the picker still works: confirming the change issues a **new** quotation for the new date (`requoteForDate()`), with its own reference and validity period. The previous quotation stays in History exactly as issued.
7. User clicks **"Record Client Choice"** → a modal appears.
8. User picks **Confirmed** (client accepted) or **Pending** (still deciding).
9. The decision is saved to Supabase, updating the existing Pending record.
10. Optionally: user clicks **"Export Quote (PDF)"** to print the issued quotation.
11. If the validity period lapses before a decision, the quote shows an **Expired** badge and **"Generate New Quotation"** creates a fresh record — new reference, priced from the latest forecast. The expired quote stays in History as issued.

### Logic — Pricing Formula

```
shipping_fee           = forecastedRate (f) × containers
markup_amount          = shipping_fee × 0.20
client_quotation_price = shipping_fee × 1.20   (i.e., fee × MARKUP where MARKUP = 1.20)
```

This 20% markup is a **fixed internal business rule** — it is hardcoded as `const MARKUP = 1.20` and applies uniformly to all quotes.

### Logic — Auto-save on First Open

```
if cf.pendingId is null (first time this quote is opened):
  create pendingEntry = {
    id: server-generated (Supabase),
    company, pic, route, isdDate, containers,
    isdFee, lowDate, lowFee,
    clientDate: cf.clientDate (defaults to the requested ISD),
    status: 'Pending',
    decision: null
  }
  insert into quote_requests
  set cf.pendingId = pendingEntry.id   ← prevents creating duplicates
```

### Logic — PDF Export

```
exportQuotePDF():
  Build a clean HTML layout in the hidden #print-overlay div:
    - ShipSense header with logo
    - Route, Company, PIC, Client Selected Date, Containers
    - Total Quotation Price (large, blue)
    - Generated timestamp
  Call window.print()
  After print dialog closes, hide the overlay
```

### Why this matters for the presentation

This is the **commercial interface** of the system. It bridges the ML output (a raw forecasted rate) into an actionable business document: a client quote. The 20% markup bakes in the company's margin, and the side-by-side ISD-vs-lowest-nearby comparison gives the analyst a concrete talking point when presenting the price to the client.

---

## Page 5 — Forecast History

### What the user sees

A full-width data table showing all past forecast records, with filter controls at the top and a row per record.

**Filter bar:**
- Date (from) — date input
- Company / PIC — free-text search
- Route — free-text search (matches against the route label)
- Status (Pending / Confirmed / Cancelled) — dropdown
- **"Clear Filter"** button

**Table columns:**
| Column | Description |
|---|---|
| Date Generated | When the forecast was created (date + time) |
| Company / PIC | Client company name and analyst name |
| Route | Origin → Destination |
| Shipment | ISD date, container quantity |
| Fee Comparison | ISD rate vs. Lowest rate (per FEU) |
| Client Decision | Confirmed date + quote total, or "–" if pending |
| Status | Pill badge: Pending (yellow) / Confirmed (green) / Cancelled (red) |
| Action | "View" always shown; "Cancel" shown only for Pending records |

### User Flow

1. User clicks **"Forecast History"** in the sidebar at any time.
2. Table loads with all records from Supabase's `quote_requests` table.
3. User applies filters to find a specific client or date range.
4. User clicks **"View"** → navigates to the Client Quote page for that record (reconstructed from the history row), rather than creating a new one.
5. For Pending records: user can click **"Cancel"** → a confirmation dialog appears → if confirmed, status changes to Cancelled (irreversible).

### Forecast Revisions tab

A second tab beside Quotations, showing how the prediction for one fixed shipment date moved across every forecast run (`renderRevisionHistory()`) — a table of run-by-run changes, plus a line chart once there are three or more runs.

**The date filter fills itself in** (`seedRevisionFilters()`). Opening the tab seeds the route and date from the forecast or quotation currently in hand — the ISD the user just forecast, or the one on the record they opened with "View" — so the trail is already on screen instead of an empty picker with a "select a date" note under it.

A date the user types themselves always wins, and keeps winning across navigation: only the value seeding last wrote is ever replaced, which is what lets the tab follow along when the selected forecast moves to a different ISD.

### Logic — Data

```
HISTORY_DATA = Supabase quote_requests rows (initHistory())
```

### Logic — Filters

```
applyHistoryFilters():
  filter by company/PIC substring (case-insensitive)
  filter by exact route match
  filter by exact status match
  render matching rows in #history-tbody

  If no match → show "No records found." row
```

### Logic — Cancel

```
cancelHistory(id):
  find record by id in HISTORY_DATA
  if status !== 'Pending' → do nothing
  show confirm dialog
  if confirmed:
    updateHistoryRecord(id, { status: 'Cancelled', decision: null })
      → PATCH quote_requests
    re-render table
    if this record matches the currently open quote:
      update Client Quote page status display to "Cancelled"
      disable the "Record Client Choice" button
```

### Why this matters for the presentation

This page gives the team an **operational audit trail**. Every forecast ever run is recorded, with its outcome. Managers can see which clients confirmed, which are still deciding, and review the fee that was quoted. It also demonstrates the persistence layer — data survives browser refresh and is shared across devices when Supabase is configured.

---

## Page 6 — Executive Dashboard

The dashboard has two tabs: **Forecast** and **Historical Data** (`switchExecTab()` in `app.js`, panels rendered by `frontend/exec-dashboard-panels.js` via `window.ExecPanels.onTabShown(tab)`). Both are read-only, macro-level views for **managers**, not the per-quote workflow of Pages 2–5.

### Forecast tab — what the user sees

**Context chips:**
- Route — a `<select>` that currently only lists NE→USEC (the only ML-forecasted lane; the Executive Dashboard doesn't scale other routes the way New Forecast does)
- Selected Date — read-only display of the currently picked ISD (shared with New Forecast's ISD via `localStorage` key `ss_isd`)
- "View Forecast for Date" — a date input to pick/change the selected ISD
- "Clear" button — clears the selected ISD

**Three KPI cards:**
| KPI | What it shows |
|---|---|
| Predicted Shipping Fee | Forecasted fee for the selected ISD (or "—" if none selected) |
| Lowest Fee Window | Median fee of the cheapest 7-day rolling window in the forecast |
| Highest Fee Window | Median fee of the most expensive 7-day rolling window |

**Shipping Cost Trend & Forecast chart** (hand-rolled inline SVG, no charting library):
- With no ISD selected: 90 days of historical actuals (solid) + 90 days of forecast (dashed), with the cheapest/most expensive 7-day window shaded green/red
- With an ISD selected: zooms to the 5 days before/after it, marking the selected date and the lowest-fee day in that window

**Daily Forecast Table:** all 90 forecast rows (Date, Predicted Fee, Crude Oil WTI, USD/EUR Exchange Rate, Label), with a date filter to jump to/highlight a specific row; selecting an ISD auto-scrolls to its ±5-day window.

**Shipping Fee Calendar:** each forecast row placed on its true calendar weekday (weekends blank, since the forecast only has business days) — either the ±5-day window around a selected ISD, or the full 90 days with the lowest/highest windows shaded.

**Selected Macro Variable Trend chart + slicer:** a second SVG chart plotting the forecasted WTI/USD-EUR series (normalized to an index) with buttons to view all variables together or isolate one.

### Historical Data tab — what the user sees

A trend chart and a table over the real historical actuals, sourced strictly from Supabase's `historical_data` table (see [data-pipeline.md](data-pipeline.md)), each with independent Clear/Month/Year granularity toggles and a year/month picker.

### User Flow

1. User clicks **"Executive Dashboard"** in the sidebar → lands on the Forecast tab.
2. User optionally picks a date via "View Forecast for Date" to zoom the chart/table/calendar to that ISD's ±5-day window; this also feeds New Forecast's ISD field if visited next.
3. User reads the three KPI cards for an instant summary.
4. User switches the macro slicer to inspect WTI or USD/EUR individually.
5. User switches to the Historical Data tab and adjusts granularity (Clear / Month / Year) to inspect actuals over different periods.

### Logic — KPI Calculations

```
renderKpis(selectedISD):
  if selectedISD:
    Predicted Shipping Fee = data.forecast row matching selectedISD, .shipping_fee

  stats = ExecData.rollingWindowStats(data.forecast, 7)  ← 7-day rolling median windows
  Lowest Fee Window  = stats.lowest  (median, date range)
  Highest Fee Window = stats.highest (median, date range)
```

### Logic — Trend Chart

`renderForecastTrendChart()` (in `exec-dashboard-panels.js`) draws an SVG line chart directly — no Chart.js/D3. It plots the historical+forecast series (or the ISD-zoomed window), shading the lowest/highest 7-day windows or marking the selected ISD, depending on whether a date is selected.

### Logic — Shipping Fee Calendar

`renderFeeCalendar()` walks every real calendar day from the Sunday on/before the first row to the Saturday on/after the last row, placing each forecast row on its true weekday and leaving blank cells for weekends/gaps — rather than packing rows 7-per-row, which would drift the alignment since the forecast only contains business days.

### Why this matters for the presentation

This page is aimed at **decision-makers who need a strategic view**, not a single booking decision. It answers: "What does the next 3 months look like overall? When is the best time to book across our entire shipment schedule? How do the macro drivers (oil, FX) behind the forecast compare historically?" It transforms the ML model output into an executive briefing tool.

---

## Page 7 — Market Impact

Rendered by `frontend/market-impact.js` (`window.MarketImpact.render()`, called from `navigateTo`), using the shared `ss-*` card/chart components. It re-renders on every visit rather than initialising once, so a newer forecast run is simulated against instead of a stale one.

### What the user sees

- **Three KPI cards:** Scenario Exchange Rate (USD per 1 EUR), 90-Day Average Shipping Fee under that scenario, and Change vs Forecast (% and USD per FEU). A positive change reads green and a negative one red — market convention. Note this is the *opposite* of the revision arrows on Forecast Result, which read a rising freight cost as bad news for the buyer.
- **Scenario Control card:** the selected rate in large type, a slider spanning the exchange rate's own 90-day forecast range, and `Low / Base / High` presets — the forecast's minimum, average and maximum projected rate. Low and High are therefore values the model actually projects, not hypothetical shocks.
- **Comparison chart:** the model's 90-day fee forecast (muted blue) against the scenario series (red or green by direction), with a hover crosshair giving both values and the gap for any day.

### Logic

```
rows        = scaledData(FIXED_ROUTE)          ← the same 90-day forecast every other page uses
displayFx   = 1 / row.usdEur                   ← payload stores EUR per USD; page works in USD per EUR
baseFx      = mean(displayFx)                  ← the forecast's own average rate
baseFee     = mean(row.f)

slider      spans min(displayFx) .. max(displayFx)      ← the forecast's own projected FX range
factor      = (selectedFx / baseFx) ^ ELASTICITY        ← ELASTICITY = 1.8, ASSUMED
scenario[i] = forecast[i] × factor                      ← one scalar factor, applied to every day
```

Because the slider is bounded by the forecast's own FX range, the travel is small: on the 2026-08-07 run that range is 1.1400–1.1545 (1.3% end to end), giving a fee response of −0.56% at Low and +1.72% at High. That is the honest consequence of using projected rather than hypothetical rates — if a wider swing is wanted for demonstration, widen the range or raise `ELASTICITY`, and say which was done.

At the base rate the factor is exactly 1 and the two series coincide. Because the slider carries a 4-decimal value it never lands exactly on `baseFx`, so `snapToPreset()` pulls a value already displaying as a preset back onto that preset's exact rate — otherwise the base case renders as "+0.01%, USD 0 per FEU more" against a forecast it is meant to equal.

### What this page is **not**

The ML pipeline produces **one** central path. It does not answer "what is the fee if the exchange rate is X", and nothing in the ingested data does either. The bundle carries the fitted `fee_model`, but the recursive multi-step procedure around it — the *"residual XGB + jump-aware shrink"* and the damping flagged as `meta.oil_fx_damped_recursive` — lives only in the training notebook, and `scripts/pkl_to_json.py` unpickles the bundle through a stub class, so the models arrive without their methods.

Rebuilding that recursion was attempted and rejected: on the published oil/FX paths it ran to 6,445 USD/FEU against the published 3,119, and its response to an FX shock was non-monotonic (−10% → +2.4%, +5% → −25.0%), with day 1 unable to respond at all since `Exchange_Rate_l1` on the first forecast day comes from history rather than the shocked path.

Fitting an elasticity from the actuals instead was also measured, and is barely better supported (2,149 days):

| Specification | β | R² |
|---|---|---|
| `dln(fee) ~ dln(fx)` | −0.106 | 0.0005 (p = 0.28) |
| 60-day changes | +1.994 | 0.066 |
| `ln` levels (both series non-stationary) | +4.336 | 0.152 |
| Kendall τ | +0.229 | — |

The relationship is weak, horizon-dependent and unstable in sign — consistent with [ml-model.md](ml-model.md) putting FX in the "~6% combined" bucket against inflation's ~86%. So `ELASTICITY` is an openly-labelled assumption rather than a fitted value dressed up as one. **The page is for reasoning about direction and rough scale; it is not a prediction and must not be used to price a client quote.**

If a genuinely model-driven version is ever wanted, the clean route is the training notebook re-running *its own* forecast function over a grid of FX multipliers and storing the result on the bundle, which `pkl_to_json.py` would then ingest as a new `snapshots` kind.

### Why this matters for the presentation

It shows the system can be interrogated — "what if the euro strengthens 10%?" — rather than only producing a single number. It also demonstrates knowing the difference between what the model actually establishes and what is being assumed on top of it, and saying so on the screen rather than in a footnote.

---

## Data Flow Summary

```
Supabase snapshots.payload (kind='forecast')
  └── FORECAST_DATA = array of 90 daily rows
        Each row:  { date, f, wti, usdEur }
                      │    │   │      │
                      │    │   │      └── Forecasted USD/EUR exchange rate
                      │    │   └───────── Forecasted crude oil (WTI) price
                      │    └───────────── Forecasted rate (USD/FEU)  ← main value used
                      └────────────────── ISO date string "YYYY-MM-DD"

scaledData(routeId):
  multiplies f by route.scale
  → used by New Forecast, Forecast Result, Client Quote, Forecast History
    and Market Impact
    (the Executive Dashboard reads its own Supabase-backed data via
    exec-data.js instead, and only ever shows the fixed NE→USEC route)

state.currentForecast:
  carries the current forecast session between Page 2 → 3 → 4
  cleared on logout

HISTORY_DATA:
  array of forecast records from Supabase's quote_requests table
  persists across page refreshes and browser sessions
```

---

## Key Business Rules

| Rule | Value | Where Applied |
|---|---|---|
| Markup on shipping fee | 20% | Client Quote Preview, History table |
| Nearby window for cheapest date | ±5 days from ISD | New Forecast → Forecast Result |
| ML route | North Europe → US East Coast only | New Forecast (locked), Executive Dashboard |
| Login/signup email restriction | must end with `@goodfortune.com` | Login |
| Signup password rule | password ≥ 8 chars AND matches confirm field | Login |
| History auto-save timing | On first open of Client Quote Preview | Client Quote Preview |
| Scenario elasticity (assumed, not fitted) | 1.8 | Market Impact |
| Scenario slider range | the exchange rate's own 90-day forecast range (Low/Base/High) | Market Impact |

---

## Glossary

| Term | Definition |
|---|---|
| **ISD** | Intended Ship Date — the date the client wants to ship |
| **FEU** | Forty-foot Equivalent Unit — standard 40ft shipping container |
| **Forecasted Rate (f)** | The ML model's predicted shipping fee in USD per FEU for a given date |
| **Markup** | 20% added to the raw shipping fee to produce the client-facing quote |
| **Lowest Nearby Fee** | The cheapest forecasted rate within ±5 days of the ISD |
| **Cost Pressure** | % change in rate from Day 1 to Day N of a forecast horizon |
| **OLS Trend** | Ordinary Least Squares — a straight line fit to the forecast data showing direction |
| **Vine Copula** | Statistical method (used in ML pipeline) to measure how macro variables co-move |
| **NE→USEC** | North Europe to US East Coast — the primary ML-modelled trade lane |
