# Assessment Mapping — BAA3114 Final Assessment

> **What this file is for.** The report has to quote and explain real code. This maps every
> requirement in the assessment brief to the exact file and line that satisfies it, so writing a
> section means opening one file at one line rather than searching nine thousand lines for it.
>
> Line numbers are accurate as of commit `41e0631`. They move when code moves — if a reference
> looks wrong, search for the function name instead, which is stable.

---

## 1. Website components listed in the brief

| Brief component | Where it lives | Notes |
|---|---|---|
| Login page | [`app.html:123`](../frontend/app.html#L123) → [`app.js:421`](../frontend/app.js#L421) `handleLogin()` | Real Supabase Auth, not a mock check |
| Registration page | [`app.html:166`](../frontend/app.html#L166) → [`app.js:458`](../frontend/app.js#L458) `handleSignup()` | Name, email, password, confirm-password |
| Consistent header + navigation | Public: [`index.html:22`](../frontend/index.html#L22) header, `:41` nav. App: [`app.html:297`](../frontend/app.html#L297) sidebar toggle | Two shells, deliberately — see §5 |
| Home page (system overview) | [`index.html`](../frontend/index.html) — hero `:55`, stat band `:118`, "what" `:145`, "how" `:235`, lane `:276` | |
| About page (purpose, objectives) | [`about.html`](../frontend/about.html) — company `:67`, model `:110`, limits `:208`, rules `:282` | `:208` "What ShipSense does not claim" is unusually strong material for the report |
| Data-entry page / form | [`app.html:317`](../frontend/app.html#L317) → [`app.js:585`](../frontend/app.js#L585) `handleForecast()` | ISD, containers, company, PIC |
| Records display (structured table) | [`app.html:680`](../frontend/app.html#L680) → [`app.js:1957`](../frontend/app.js#L1957) `applyHistoryFilters()` | 8-column table + 4 filters |
| Record modification (update) | [`app.html:1031`](../frontend/app.html#L1031) modal → [`app.js:2107`](../frontend/app.js#L2107) / [`:2132`](../frontend/app.js#L2132) | |
| Record modification (delete) | [`app.js:2201`](../frontend/app.js#L2201) `deleteHistory()` → [`:147`](../frontend/app.js#L147) `deleteHistoryRecord()` | |
| Dashboard (key summaries) | [`app.html:721`](../frontend/app.html#L721) → [`exec-dashboard-panels.js:503`](../frontend/exec-dashboard-panels.js#L503) `renderKpis()` | KPIs, trend chart, calendar, daily table |
| Contact / help page | [`contact.html:142`](../frontend/contact.html#L142) form → [`site.js:262`](../frontend/site.js#L262) submit | Writes to `contact_messages` |

---

## 2. CRUD evidence — the core requirement

The brief's CRUD table maps one-to-one onto `quote_requests`:

| Operation | Required behaviour | UI entry point | Function | HTTP |
|---|---|---|---|---|
| **Create** | User can add a new record | "Save Forecast Record" on Client Quote | [`app.js:1244`](../frontend/app.js#L1244) `saveForecastRecord()` → [`:73`](../frontend/app.js#L73) `insertHistoryRecord()` | `POST /rest/v1/quote_requests` |
| **Read** | User can view stored records | Forecast History table | [`app.js:1957`](../frontend/app.js#L1957) `applyHistoryFilters()` → [`:62`](../frontend/app.js#L62) `initHistory()` | `GET /rest/v1/quote_requests` |
| **Update** | User can edit and save a record | Edit button → modal → Save Changes | [`app.js:2132`](../frontend/app.js#L2132) `saveEditRecord()` → [`:96`](../frontend/app.js#L96) `updateHistoryRecord()` | `PATCH /rest/v1/quote_requests?id=eq.N` |
| **Delete** | User can delete a record | Delete button → confirm dialog | [`app.js:2201`](../frontend/app.js#L2201) `deleteHistory()` → [`:147`](../frontend/app.js#L147) `deleteHistoryRecord()` | `DELETE /rest/v1/quote_requests?id=eq.N` |

A second entity, `contact_messages`, demonstrates **Create** from the public site
([`site.js:249`](../frontend/site.js#L249)) with no login at all — useful if the report wants to
show CRUD across two tables rather than one.

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
| Form validation | `handleForecast()` — 4 required fields + date range | [`app.js:585`](../frontend/app.js#L585) |
| | `saveEditRecord()` — re-validates on save, not just on type | [`app.js:2132`](../frontend/app.js#L2132) |
| | `handleSignup()` — domain, length, confirmation match | [`app.js:458`](../frontend/app.js#L458) |
| | `validateField()` — per-field contact validation | [`site.js:178`](../frontend/site.js#L178) |
| Navigation menus | `toggleSidebar()` — app drawer | [`app.js:310`](../frontend/app.js#L310) |
| | public nav toggle | [`site.js:32`](../frontend/site.js#L32) |
| | `navigateTo()` — SPA view router | [`app.js:259`](../frontend/app.js#L259) |
| Confirmation prompts | `openConfirm()` — custom modal, replaced native `confirm()` | [`app.js:1872`](../frontend/app.js#L1872) |
| | used by delete `:2201`, cancel `:2076`, re-quote `:1491` | |
| CRUD functions | see §2 | |

**Worth explaining in the report:** `openConfirm()` writes a *different* warning for a draft than
for an issued quotation ([`app.js:2208`](../frontend/app.js#L2208)). Asking the same question
either way would train the user to click through it.

---

## 4. Business rules and validation (Section IV)

| Rule | Value | Where |
|---|---|---|
| Client markup | 20% flat | `MARKUP = 1.20` [`app.js:854`](../frontend/app.js#L854) |
| Quotation validity | 48 hours | `QUOTE_VALIDITY_HOURS` [`app.js:855`](../frontend/app.js#L855) |
| Allowed sign-up domain | `@goodfortune.com` | [`app.js:353`](../frontend/app.js#L353) |
| Booking window | ISD ± 5 days | `handleForecast()` [`app.js:585`](../frontend/app.js#L585) |
| Containers | 1–500, whole numbers | [`app.js:2132`](../frontend/app.js#L2132) + DB check constraint |
| ISD range | derived from forecast, never hard-coded | `applyIsdBounds()` |

Full prose version: [`business-logic.md`](business-logic.md).

---

## 5. System design (Section III)

**Navigation structure** — two shells, and the split is a design decision worth defending:

```
PUBLIC (no login)                        APPLICATION (login required)
index.html   — overview, lane, how       app.html — single-page, 6 views
about.html   — company, model, limits      New Forecast → Forecast Result
contact.html — enquiry form                → Client Quote → Forecast History
     │                                      Executive Dashboard, Market Impact
     └──────── "Sign in" ──────────────────────────┘
```

The public site is static HTML with no data access. The application is a single page whose views
are shown and hidden by `navigateTo()`. A marker can therefore read the whole public site without
credentials, while business data stays behind Supabase Auth.

**Data structure** — three tables, three deliberately different shapes
([`schema.sql`](../supabase/schema.sql), full reference in [`data-schema.md`](data-schema.md)):

| Table | Shape | Line | Why this shape |
|---|---|---|---|
| `snapshots` | JSONB blob | [`:18`](../supabase/schema.sql#L18) | ML output, replaced wholesale, never queried by field |
| `quote_requests` | Relational columns | [`:55`](../supabase/schema.sql#L55) | Needs per-row update, filter, sort — a blob cannot do this |
| `historical_data` | Relational, date PK | [`:302`](../supabase/schema.sql#L302) | One row per day, queried by range |
| `contact_messages` | Relational, insert-only | [`:346`](../supabase/schema.sql#L346) | Public writes, staff reads |

---

## 6. Where each report section gets its material

| Report section | Marks | Source |
|---|---|---|
| I. Introduction | 10 | [`README.md`](../README.md), [`about.html:67`](../frontend/about.html#L67) |
| II. Requirement Analysis | 20 | [`frontend-user-flow.md`](frontend-user-flow.md), [`data-schema.md`](data-schema.md) |
| III. System Design | 20 | §5 above, [`schema.sql`](../supabase/schema.sql) |
| IV. Development | 20 | §2, §3, §4 above, [`business-logic.md`](business-logic.md) |
| V. Testing | 10 | [`test-plan.md`](test-plan.md) |
| VI. Implementation & User Guide | 20 | [`deployment.md`](deployment.md), [`supabase/README.md`](../supabase/README.md), §7 below |

---

## 7. Folder structure and key files (Section VI)

```
frontend/
├── index.html              public home — overview, lane, process
├── about.html              public about — company, model, limits
├── contact.html            public contact — enquiry form
├── app.html                the application (login + 6 views)
├── supabase-config.js      project URL + publishable key, shared by both shells
├── site.js                 public-site behaviour: nav, scroll-spy, contact validation
├── app.js                  application logic: auth, forecast, CRUD, history
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

**Troubleshooting** starters, all real failure modes seen during development:

| Symptom | Cause | Fix |
|---|---|---|
| Login button stuck on "Data unavailable" | No forecast snapshot ingested | Run `seed.sql` |
| "Could not find the table 'public.x'" | `schema.sql` not run | Run it, then reload |
| Sign-up succeeds, login fails | Email confirmation is on | Confirm via inbox, or disable it in Auth settings |
| History table empty | `quote_requests` empty | Run `seed.sql`, or create a record through the app |
| Contact form reports a failure | `contact_messages` missing | Re-run `schema.sql` — it was added after the first three tables |
| Site loads but shows no data weeks later | Free-tier project paused | Open the Supabase dashboard once to wake it |
