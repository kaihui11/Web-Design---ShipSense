# Business Logic Reference

All rules encoded in `frontend/app.js`.

---

## Pricing Rules

| Rule | Value | Constant |
|---|---|---|
| Client markup | 20% flat on estimated shipping fee | `MARKUP = 1.20` |
| Shipping fee | `forecastedRate × containers` | Computed in `renderClientQuote()` |
| Client quotation price | `shippingFee × 1.20` | Computed in `renderClientQuote()` |
| Fixed route (New Forecast) | North Europe → US East Coast only | `FIXED_ROUTE = 'ne-usec'` |
| Day window (Forecast Result) | ISD ± 5 calendar days (11 days max) | `handleForecast()` |

The 20% markup is a fixed internal business rule. The analyst sees all three figures (fee, markup, total); the client only sees the quotation price.

---

## Quotation Issue & Locking

The Client Quote Preview has two states:

| State | What it shows | What can change |
|---|---|---|
| **Working** (not yet issued) | Figures recomputed from the latest forecast on every render | Client date picker moves the price freely. Only reached now when the issuing write failed, or on a legacy record whose decision was recorded without a quotation |
| **Issued** | The frozen values stored on the `quote_requests` row | The document itself is fixed — but the date picker stays open, and moving it issues a *new* quotation (below) |

### The shipping date belongs to the client

What is locked is the issued document, never the client's choice:

- **The client date defaults to the requested ISD**, not to the cheapest nearby date. The lowest nearby fee is shown alongside it — as a KPI card, in the comparison table, and marked in the calendar — so the analyst can offer it, but it is never applied on the client's behalf.
- **The date picker is never disabled.** On a working quote it re-prices live. On an issued quote, `selectClientDate()` asks for confirmation and then calls `requoteForDate()`, which inserts a new record for the chosen date and issues it immediately — a new reference with its own validity period. The previous quotation stays on record exactly as issued, satisfying the price lock without freezing the client's decision.
- The confirmation step exists so that browsing dates can't quietly mint a trail of references.
- Once the client's decision is recorded (Confirmed/Cancelled), re-quoting is refused — that record is closed, and a different date needs a new forecast.

- **Opening the preview is the issue moment.** There is no Generate Quotation button: generating a forecast for a named company and PIC navigates straight to the Client Quote page, and `renderClientQuote()` calls `issueQuotationFor()` on any still-Pending record before it draws a figure. That stamps `quote_ref`, `issued_at`, `valid_until`, `quoted_fee`, `quoted_price` and `forecast_generated_at` in a single write, and re-stamps `isd_fee`/`low_date`/`low_fee` to the run the price actually came from.
- Issuing is deliberately kept outside the render body: if the write fails the page still draws on live figures, the quotation document shows *Quotation could not be generated* with a retry, and nothing has been fixed for the client.
- **Validity**: `QUOTE_VALIDITY_HOURS = 48`, counted from the issue timestamp.
- **Reference**: `SSQ-YYYYMMDD-####` — issue date in the user's timezone plus the zero-padded `quote_requests.id`, which is what makes it unique (`quoteRefFor()`). A partial unique index enforces this; a direct PostgREST write that omits the reference gets a UTC-dated one from the schema trigger.
- **The lock is permanent, not just for the validity period.** A newer forecast run never rewrites an issued quotation, and expiry does not unfreeze it — an expired quote is still the record of what the client was told. `schema.sql`'s `enforce_quote_status_transition()` trigger rejects any change to the issued terms, so the lock holds against direct API writes too, not just the disabled UI.
- **After expiry**, the preview keeps showing the issued price with an `Expired` badge and offers **Generate New Quotation** (`regenerateQuotation()`), which inserts a *new* Pending record priced from the latest forecast and gets its own reference. It carries the client's chosen date across rather than jumping to whichever date is now cheapest — re-quoting re-prices the same shipment, it doesn't move it. The expired record is left untouched.
- **Record Client Choice** and **Export Quote (PDF)** are disabled until a quotation is issued — there is no decision to record, and no document to print, before then. Recording a decision stays available after expiry so a client's answer isn't lost to a late data entry.

### What the client never sees

The preview and the PDF carry only the quotation itself (reference, issue and validity timestamps, route, company, PIC, quoted date, quantity, price, validity statement). The previous forecast, the day-on-day revision line, the revision chart and the run-by-run forecast history are internal and stay on the Forecast Result page and the History view.

---

## Market Impact — assumed elasticity

`frontend/market-impact.js` carries one constant with business meaning:

| Rule | Value | Constant |
|---|---|---|
| Fee response to an exchange-rate move | `(selected / base) ^ 1.8` | `ELASTICITY = 1.8` |
| Scenario slider range | the exchange rate's own 90-day forecast range | `Math.min/max` of the forecast FX |

Unlike `MARKUP`, **this is not a business rule the company decided — it is an assumption this page makes**, because the ML pipeline provides no answer to "what is the fee at a different exchange rate" and the fee/FX relationship in the actuals is weak and unstable in sign (β = −0.106, R² = 0.0005 on daily changes; +1.994 on 60-day changes). The page carried an on-screen banner saying so; it was removed on request, so this doc and the header comment in `market-impact.js` are now where that is recorded. The full reasoning — including why re-running the model itself was attempted and rejected — is in [frontend-user-flow.md](frontend-user-flow.md#page-7--market-impact).

**No quotation may be priced from this page.** Quotes are priced only from the forecast, via the rules above.

---

## Risk / Shock Scoring — not implemented

Earlier drafts of this doc described a Risk Level (Low/Medium/High/Extreme) and Cost Surge Probability/Shock Sensitivity table, both derived from an `External Shock Risk Score` (0–100) field. Confirmed (2026-07-18) that none of this was ever actually wired into `frontend/app.js` — zero references to "risk" anywhere in `app.js`, `style.css`, or `index.html`. The current ML pipeline doesn't produce an equivalent score either (see `docs/data-schema.md`), so this section is removed rather than kept as aspirational/inaccurate documentation. If risk scoring becomes a real feature later, document it here once it's actually built.

---

## History & Persistence

- Forecast records live in Supabase's `quote_requests` table (see `supabase/schema.sql`), read/written directly over PostgREST.
- A Pending record is auto-created the first time a Client Quote is opened (`cf.pendingId` prevents duplicate entries within the same session).
- Status transitions: Pending → Confirmed or Pending → Cancelled. No transition back from Confirmed.
- Cancellation is irreversible.
- Re-quoting after expiry adds a row, never edits one — so a client with two quotations has two records with two references.

---

## PDF Export

`exportQuotePDF()` pre-fills a hidden `#print-overlay` div then calls `window.print()`; the overlay is hidden again immediately after. It requires an issued quotation and prints exactly what the preview shows — reference, date/time issued, valid-until, route, company, PIC, quoted date, containers, quotation price and the validity statement — all read from the frozen record rather than the live forecast, so re-exporting later in the validity window produces an identical document.

---

## Authentication

Backed by Supabase Auth (email + password). Sign-up and sign-in are both restricted to `@goodfortune.com` work emails, enforced client-side in `app.js` (`ALLOWED_EMAIL_DOMAIN`) — for defense in depth this should also be restricted in the Supabase dashboard (Auth → Providers → Email → allowed domains). Note that other REST calls in `app.js` still authenticate with the public anon key rather than the signed-in user's session token, so `quote_requests` RLS isn't yet scoped to authenticated users (see `supabase/README.md`).
