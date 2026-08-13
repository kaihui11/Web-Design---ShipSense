# Assessment Mapping — BAA3114 Final Assessment

> **What this file is for.** The report has to quote and explain real code. This maps every
> requirement in the assessment brief to the exact file and line that satisfies it, so writing a
> section means opening one file at one line rather than searching nine thousand lines for it.
>
> Line numbers are accurate as of the commit that removed the Forecast Revisions view. They
> move when code moves — if a reference looks wrong, search for the function name instead, which
> is stable.

---

## 1. Website components listed in the brief

The brief lists ten components. All ten live in one file, `frontend/index.html`, and all of them
except the login screen itself are reached after signing in — see §5 for why that changed.

| # | Brief component | Where it lives | Notes |
|---|---|---|---|
| 1 | Login and Register page — secure user authentication | Login [`index.html:111`](../frontend/index.html#L111) → [`app.js:392`](../frontend/app.js#L392) `handleLogin()`<br>Register [`index.html:154`](../frontend/index.html#L154) → [`app.js:429`](../frontend/app.js#L429) `handleSignup()` | Real Supabase Auth, not a mock check. Register takes name, email, password, confirm-password |
| 2 | Header / Navigation — consistent across all pages | Sidebar [`index.html:228`](../frontend/index.html#L228), nav [`:246`](../frontend/index.html#L246), top header [`:314`](../frontend/index.html#L314) | One menu, present on every page. Nine destinations in four labelled groups |
| 3 | Home page — overview of the system | [`index.html:341`](../frontend/index.html#L341) — hero `:343`, stat band `:400`, "what it does" `:429`, "how it works" `:517`, lane `:557` | |
| 4 | About page — purpose and objectives | [`index.html:630`](../frontend/index.html#L630) — company `:648`, model `:691`, limits `:789`, rules `:863` | `:789` "What ShipSense does not claim" is unusually strong material for the report |
| 5 | Entry page — form for entering user details | [`index.html:978`](../frontend/index.html#L978) Company Name + Person in Charge | One form serves items 5 and 6 — see the note below |
| 6 | Monitoring Data Entry page — form for entering data | [`index.html:928`](../frontend/index.html#L928) → [`app.js:556`](../frontend/app.js#L556) `handleForecast()` | Route, Intended Ship Date, container count |
| 7 | Monitoring Records Display page — table of records | [`index.html:1249`](../frontend/index.html#L1249) → [`app.js:1626`](../frontend/app.js#L1626) `applyHistoryFilters()` | 8-column table + 4 filters |
| 8 | Monitoring Record Modify page — update and delete | Update: [`index.html:1884`](../frontend/index.html#L1884) modal → [`app.js:1776`](../frontend/app.js#L1776) `openEditModal()` / [`:1801`](../frontend/app.js#L1801) `saveEditRecord()`<br>Delete: [`app.js:1870`](../frontend/app.js#L1870) `deleteHistory()` → [`:138`](../frontend/app.js#L138) `deleteHistoryRecord()` | Both reached from the row they act on, inside Forecast History |
| 9 | Dashboard page — summary of key indicators | [`index.html:1304`](../frontend/index.html#L1304) → [`exec-dashboard-panels.js:503`](../frontend/exec-dashboard-panels.js#L503) `renderKpis()` | KPIs, trend chart, calendar, daily table |
| 10 | Contact / Help page — support information | Help [`index.html:1587`](../frontend/index.html#L1587), contact details `:1664`, form `:1742` → [`contact-form.js:198`](../frontend/contact-form.js#L198) submit | Five `<details>` answers plus a form that writes to `contact_messages` |

**Items 5 and 6 are one screen.** The brief separates "user details" from "monitoring data", and a
freight quote needs both before it means anything: a rate with no company against it cannot be
quoted, and a company with no ship date has nothing to price. Splitting them into two pages would
put a Continue button between two halves of one thought and give the user somewhere to abandon.
So **New Forecast** collects both, in that order — Route / ISD / containers first, then Company and
PIC — and `handleForecast()` validates all five fields together
([`app.js:556`](../frontend/app.js#L556)). Worth stating plainly in the report rather than hoping
nobody notices the count.

**Item 8 is a modal, not a separate route.** Update and delete are opened from the record they
act on, in the records table, because an edit screen reached from a menu would need the user to
re-find the row they were already looking at. The functions behind it are as separable as any
page — see §2.

---

## 2. CRUD evidence — the core requirement

The brief's CRUD table maps one-to-one onto `quote_requests`:

| Operation | Required behaviour | UI entry point | Function | HTTP |
|---|---|---|---|---|
| **Create** | User can add a new record | "Save Forecast Record" on Client Quote | [`app.js:1092`](../frontend/app.js#L1092) `saveForecastRecord()` → [`:64`](../frontend/app.js#L64) `insertHistoryRecord()` | `POST /rest/v1/quote_requests` |
| **Read** | User can view stored records | Forecast History table | [`app.js:1626`](../frontend/app.js#L1626) `applyHistoryFilters()` → [`:53`](../frontend/app.js#L53) `initHistory()` | `GET /rest/v1/quote_requests` |
| **Update** | User can edit and save a record | Edit button → modal → Save Changes | [`app.js:1801`](../frontend/app.js#L1801) `saveEditRecord()` → [`:87`](../frontend/app.js#L87) `updateHistoryRecord()` | `PATCH /rest/v1/quote_requests?id=eq.N` |
| **Delete** | User can delete a record | Delete button → confirm dialog | [`app.js:1870`](../frontend/app.js#L1870) `deleteHistory()` → [`:138`](../frontend/app.js#L138) `deleteHistoryRecord()` | `DELETE /rest/v1/quote_requests?id=eq.N` |

A second entity, `contact_messages`, demonstrates **Create** from the Contact / Help page
([`contact-form.js:181`](../frontend/contact-form.js#L181) `postMessage()`) — useful if the report
wants to show CRUD across two tables rather than one. It is also the one write in the system that
goes to a different table with a different shape, which makes it a cleaner contrast than a second
`quote_requests` insert would be.

### The point worth making in the report

Every rule above is enforced **in the database, not in the buttons**. The UI disables what a
record does not allow, but the anon key can call the REST API directly and bypass the UI
entirely — so the same rules are declared again in [`supabase/schema.sql`](../supabase/schema.sql):

| Rule | Where | Line |
|---|---|---|
| Delete only while Pending | `"Delete pending requests"` RLS policy | [`schema.sql:136`](../supabase/schema.sql#L136) |
| Same rule, with a readable error | `enforce_quote_delete_rules()` trigger | [`schema.sql:145`](../supabase/schema.sql#L145) |
| Issued quotations are immutable | `enforce_quote_status_transition()` trigger | [`schema.sql:234`](../supabase/schema.sql#L234) |
| Status transitions Pending → Confirmed/Cancelled only | same trigger | [`schema.sql:234`](../supabase/schema.sql#L234) |

§3 of [`test-plan.md`](test-plan.md) contains the captured proof that these hold against a direct
API call. That is the single strongest piece of evidence in the project.

---

## 3. JavaScript interactivity required by §3.3

| Required | Implementation | Line |
|---|---|---|
| Form validation | `handleForecast()` — 5 required fields + date range | [`app.js:556`](../frontend/app.js#L556) |
| | `saveEditRecord()` — re-validates on save, not just on type | [`app.js:1801`](../frontend/app.js#L1801) |
| | `handleSignup()` — domain, length, confirmation match | [`app.js:429`](../frontend/app.js#L429) |
| | `validateField()` — per-field Contact / Help validation | [`contact-form.js:115`](../frontend/contact-form.js#L115) |
| Navigation menus | `navigateTo()` — the router every page in the system goes through | [`app.js:215`](../frontend/app.js#L215) |
| | `toggleSidebar()` — the same menu as an off-canvas drawer on narrow screens | [`app.js:279`](../frontend/app.js#L279) |
| | `scrollToSection()` — Home's "See how it works" in-page jump | [`app.js:262`](../frontend/app.js#L262) |
| Confirmation prompts | `openConfirm()` — custom modal, replaced native `confirm()` | [`app.js:1541`](../frontend/app.js#L1541) |
| | used by delete `:1885`, cancel `:1749` | |
| CRUD functions | see §2 | |

**Worth explaining in the report:** `openConfirm()` writes a *different* warning for a draft than
for an issued quotation ([`app.js:1877`](../frontend/app.js#L1877)). Asking the same question
either way would train the user to click through it.

---

## 4. Business rules and validation (Section IV)

| Rule | Value | Where |
|---|---|---|
| Client markup | 20% flat | `MARKUP = 1.20` [`app.js:690`](../frontend/app.js#L690) |
| Quotation validity | 48 hours | `QUOTE_VALIDITY_HOURS` [`app.js:691`](../frontend/app.js#L691) |
| Allowed sign-up domain | `@goodfortune.com` | `ALLOWED_EMAIL_DOMAIN` [`app.js:322`](../frontend/app.js#L322) |
| Booking window | ISD ± 5 days | `handleForecast()` [`app.js:556`](../frontend/app.js#L556) |
| Containers | 1–500, whole numbers | [`app.js:1801`](../frontend/app.js#L1801) + DB check constraint |
| ISD range | derived from forecast, never hard-coded | `applyIsdBounds()` [`app.js:537`](../frontend/app.js#L537) |

Full prose version: [`business-logic.md`](business-logic.md).

---

## 5. System design (Section III)

**Navigation structure** — one shell, everything behind the login:

```
index.html
│
├─ #view-login ─── Login  ⇄  Register          ← the only screen reachable logged out
│                     │
│                     └── handleLogin() → completeLogin() → navigateTo('home')
│
└─ #view-app ───── sidebar (the same menu on every page)
                     │
                     ├─ OVERVIEW           Home ────────── About
                     ├─ FORECASTING        New Forecast ── Forecast Result ── Client Quote Preview
                     ├─ RECORDS & INSIGHT  Forecast History ── Executive Dashboard ── Market Impact
                     │                          └─ Edit / Delete modals (record modify)
                     └─ SUPPORT            Contact / Help
```

The whole system is a single page whose views are shown and hidden by `navigateTo()`
([`app.js:215`](../frontend/app.js#L215)) — nine destinations, one menu, no page reloads. Nothing
but the login screen is reachable without an account.

**Why Home, About and Contact sit behind the login too.** An earlier build had them as three
standalone public pages outside the app, on the argument that a stranger should be able to read
about the platform. That argument does not survive what the pages actually say: Home describes the
internal workflow screen by screen, About publishes the model's accuracy figures and its honest
limits, and Contact is now largely a Help section written for someone already using the system.
None of that is marketing copy for a stranger; it is documentation for a signed-in user, and it
reads as a support section rather than a shop window. Folding them in also removes a duplicate
navigation shell — there was one header for the public pages and a different sidebar for the app,
and "consistent navigation across all pages" is hard to claim with two of them. The brief lists
Header/Navigation once, and now there is exactly one.

**Data structure** — three tables, three deliberately different shapes
([`schema.sql`](../supabase/schema.sql), full reference in [`data-schema.md`](data-schema.md)):

| Table | Shape | Line | Why this shape |
|---|---|---|---|
| `snapshots` | JSONB blob | [`:18`](../supabase/schema.sql#L18) | ML output, replaced wholesale, never queried by field |
| `quote_requests` | Relational columns | [`:55`](../supabase/schema.sql#L55) | Needs per-row update, filter, sort — a blob cannot do this |
| `historical_data` | Relational, date PK | [`:302`](../supabase/schema.sql#L302) | One row per day, queried by range |
| `contact_messages` | Relational, insert-only | [`:346`](../supabase/schema.sql#L346) | Written from Contact / Help, never read back in the browser |

---

## 6. Where each report section gets its material

| Report section | Marks | Source |
|---|---|---|
| I. Introduction | 10 | [`README.md`](../README.md), About page [`index.html:648`](../frontend/index.html#L648) |
| II. Requirement Analysis | 20 | [`frontend-user-flow.md`](frontend-user-flow.md), [`data-schema.md`](data-schema.md) |
| III. System Design | 20 | §5 above, [`schema.sql`](../supabase/schema.sql) |
| IV. Development | 20 | §2, §3, §4 above, [`business-logic.md`](business-logic.md) |
| V. Testing | 10 | [`test-plan.md`](test-plan.md) |
| VI. Implementation & User Guide | 20 | [`deployment.md`](deployment.md), [`supabase/README.md`](../supabase/README.md), §7 below |

---

## 7. Folder structure and key files (Section VI)

```
frontend/
├── index.html              the whole system — login/register + all nine pages
├── supabase-config.js      project URL + publishable key
├── app.js                  application logic: auth, routing, forecast, CRUD, history
├── contact-form.js         Contact / Help form: validation + insert into contact_messages
├── exec-data.js            dashboard data layer (Supabase only)
├── exec-dashboard-panels.js  dashboard rendering
├── market-impact.js        exchange-rate scenario page
└── style.css               all styling, including 15 responsive breakpoints

supabase/
├── schema.sql              4 tables, RLS policies, 2 guard triggers
└── seed.sql                one-paste fill: forecast + history + samples

scripts/
├── pkl_to_json.py          pipeline ingest (service key, GitHub Actions)
└── pkl_to_seed_sql.py      offline seed generator (no key needed)
```

**Installation** is in [`supabase/README.md`](../supabase/README.md) — create project, run
`schema.sql`, run `seed.sql`, enable email auth, set the two constants in `supabase-config.js`.
Serve `frontend/` over HTTP and open `/`; the login screen is the entry point.

**Troubleshooting** starters, all real failure modes seen during development:

| Symptom | Cause | Fix |
|---|---|---|
| Login button stuck on "Data unavailable" | No forecast snapshot ingested | Run `seed.sql` |
| "Could not find the table 'public.x'" | `schema.sql` not run | Run it, then reload |
| Sign-up succeeds, login fails | Email confirmation is on | Confirm via inbox, or disable it in Auth settings |
| History table empty | `quote_requests` empty | Run `seed.sql`, or create a record through the app |
| Contact form reports a failure | `contact_messages` missing | Re-run `schema.sql` — it was added after the first three tables |
| Site loads but shows no data weeks later | Free-tier project paused | Open the Supabase dashboard once to wake it |
