# Test Plan and Results — BAA3114 Final Assessment

> Feeds **Section V — Testing and User Acceptance (10 marks)**, which asks for a test plan, evidence
> that Create/Read/Update/Delete work, and responsive-design testing results.
>
> Results marked **✅ verified** were actually executed and their output captured below. Rows marked
> **☐ to run** are for you to execute and screenshot — the steps and expected results are written out
> so running them is mechanical.

**Environment under test**

| Item | Value |
|---|---|
| Live URL | https://web-design-ship-sense.vercel.app |
| Supabase project | `uioqmeulbvsnqfvtdmzt` |
| Forecast run | 2026-08-07 · 90 days · 2026-08-10 → 2026-12-11 |
| Seed data | 1 snapshot, 2,149 historical rows, 5 sample quote records |
| Browsers | Chrome (primary), Edge |

---

## 1. Functional test cases — CRUD

| # | Test case | Steps | Expected result | Status |
|---|---|---|---|---|
| **C1** | Create a forecast record | New Forecast → ISD in range, 10 containers, company, PIC → Forecast Estimated Shipping Fee → Prepare Client Quote → **Save Forecast Record** | Record appears at the top of Forecast History with status *Pending* | ☐ to run |
| **C2** | Create rejects empty fields | Leave Company blank → submit | Validation message; nothing written | ☐ to run |
| **C3** | Create rejects out-of-range ISD | Enter a date before 2026-08-10 | Rejected, range stated in the message | ☐ to run |
| **C4** | Create via public contact form | contact.html → complete → Send | Success message; row in `contact_messages` | ☐ to run |
| **R1** | Read all records | Open Forecast History | 5 seed records plus anything created | ☐ to run |
| **R2** | Read with filter | Type "Global" in the company filter | Only Global Marine shown | ☐ to run |
| **R3** | Read one record | Click View on any row | Modal shows that record's details | ☐ to run |
| **U1** | Update a draft | Edit on a Pending, un-issued row → change company, PIC, containers → Save Changes | Table reflects new values immediately | ☐ to run |
| **U2** | Update recomputes fees | In the same modal, change the ISD | Stored fee columns recompute for the new date | ☐ to run |
| **U3** | Update rejects bad input | Set containers to 0, or clear a required field | Inline error; no save | ☐ to run |
| **U4** | Update blocked after issue | Find a row with a quotation reference | **No Edit button** — the row is locked | ☐ to run |
| **D1** | Delete a draft | Delete on a Pending row → confirm | Row disappears; count drops by one | ☐ to run |
| **D2** | Delete asks first | Delete → read the dialog | Names the company; warns it cannot be undone | ☐ to run |
| **D3** | Delete can be cancelled | Delete → "Keep it" | Row still present | ☐ to run |
| **D4** | Delete blocked after a decision | Look at the Confirmed row | **No Delete button** | ☐ to run |

### Authentication

| # | Test case | Expected | Status |
|---|---|---|---|
| A1 | Register with a `@goodfortune.com` email | Account created | ☐ to run |
| A2 | Register with gmail.com | Rejected: work email required | ☐ to run |
| A3 | Password under 8 characters | Rejected | ☐ to run |
| A4 | Mismatched confirmation | Rejected | ☐ to run |
| A5 | Login with wrong password | Error banner, no access | ☐ to run |
| A6 | Direct access to `app.html` without logging in | Login screen, no data | ☐ to run |
| A7 | Logout then reload | Login screen — sessions are not persisted | ☐ to run |

---

## 2. Executed results — CRUD against the live API ✅

Run on 2026-08-12 against the deployed database using only the **public anon key**, so this
exercises the same path the browser uses. A throwaway record was created and removed; no seed data
was touched.

```
=== CREATE ===
POST /rest/v1/quote_requests   → created id=6, company="ZZ CRUD Test"

=== READ ===
GET  /rest/v1/quote_requests?id=eq.6
[{"company":"ZZ CRUD Test","pic":"Automated Check","containers":3,"status":"Pending"}]

=== UPDATE ===
PATCH /rest/v1/quote_requests?id=eq.6
company=ZZ CRUD Test (edited)  pic=Edited PIC  containers=12

=== DELETE ===
DELETE /rest/v1/quote_requests?id=eq.6   → rows deleted: 1
GET    /rest/v1/quote_requests?id=eq.6   → []            (confirmed gone)
```

**All four operations verified end-to-end.**

---

## 3. Executed results — security rules ✅

This is the part worth putting in the report in full. The UI hides Edit and Delete on records that
do not allow them, but hiding a button proves nothing: the anon key can call the API directly. These
two attempts did exactly that, against the Confirmed record, bypassing the interface entirely.

```
=== attempt DELETE on Confirmed record id=4 ===
DELETE /rest/v1/quote_requests?id=eq.4
response: []
rows deleted: 0                          ← refused by RLS policy

=== attempt UPDATE on Confirmed record id=4 ===
PATCH /rest/v1/quote_requests?id=eq.4   {"company":"HACKED"}
{"code":"P0001",
 "message":"quote_requests: record 4 is Confirmed and can no longer be modified"}

=== record intact ===
[{"id":4,"company":"Atlantic Cargo Services","status":"Confirmed"}]
```

**Conclusion:** the rules live in the database
([`schema.sql:136`](../supabase/schema.sql#L136) policy,
[`:145`](../supabase/schema.sql#L145) and [`:234`](../supabase/schema.sql#L234) triggers), not in the
interface. A record carrying a client's decision cannot be altered or destroyed by any client, UI or
otherwise.

---

## 4. Data integrity checks ✅

| Check | Expected | Result |
|---|---|---|
| Forecast snapshot present | 1 row, kind `forecast` | ✅ id=1, generated 2026-08-07 |
| Forecast horizon | 90 business days | ✅ 90 rows, 2026-08-10 → 2026-12-11 |
| Model metrics stored | present in payload | ✅ `model_summary` present |
| Historical rows | full daily history | ✅ 2,149 rows, 2018-01-09 → 2026-08-07 |
| History meets forecast | no gap | ✅ ends 08-07, forecast starts 08-10 (weekend) |
| Nulls in historical data | none | ✅ zero across all 7 measures |
| Sample quote records | one per lifecycle stage | ✅ 3 Pending, 1 Confirmed, 1 Cancelled |
| `contact_messages` reachable | table exists | ✅ HTTP 200 |

---

## 5. Responsive design testing

Measured by rendering each page at a fixed viewport width and reading
`document.documentElement.scrollWidth` back. If that exceeds the viewport width the page scrolls
sideways, which is the defect this is looking for. Chrome on Windows refuses to open a window
narrower than ~500px, so phone widths were rendered inside a correctly-sized iframe — a direct
`--window-size=390` screenshot silently lays out wider and crops, which looks like a broken layout
when nothing is wrong.

| Device class | Width | Page | Expected | Result |
|---|---|---|---|---|
| Desktop | 1440px | Forecast History | Sidebar rail, no hamburger | ✅ `scrollWidth=1440`, sidebar 210px |
| Desktop | 1440px | — | No horizontal overflow | ✅ none |
| Tablet | 820px | Executive Dashboard | Drawer nav, stacked cards | ✅ `scrollWidth=820` |
| Tablet | 768px | Forecast History | Table scrolls in its card | ✅ no page overflow |
| Mobile | 390px | Login | Form above branding | ✅ `scrollWidth=385` |
| Mobile | 390px | New Forecast | Full-width fields | ✅ `scrollWidth=390` |
| Mobile | 390px | Forecast History | Filters stacked, table scrolls | ✅ `scrollWidth=390`, table card 366px |
| Mobile | 390px | Nav drawer open | Drawer over dimmed backdrop | ✅ 250px drawer, backdrop active |

### Defect found and fixed

Worth reporting, because it is counter-intuitive and the fix is one line.

Giving the history table a `min-width` so its columns stayed legible made the layout **worse**.
Flex items default to `min-width: auto` — "never shrink below your content" — so the 760px table
pushed `.page` and `.app-main` out with it.

- **Before:** 390px viewport, **824px document**. The table sat un-scrolled while the entire page —
  sidebar, header and all — scrolled sideways underneath it.
- **Fix:** `min-width: 0` on the shell ([`style.css`](../frontend/style.css), search
  `app-main, .page-area, .page`).
- **After:** `scrollWidth=390`. Overflow now happens inside the card that owns it.

### Breakpoints

| Breakpoint | Purpose |
|---|---|
| ≤1280px | Tighter page padding |
| ≤1024px | Sidebar → off-canvas drawer; 3-col → 2-col |
| 561–1000px | Dashboard KPIs → 2 columns (avoids a single-file stack on tablets) |
| ≤768px | Login stacks; filters stack; chart text scaled up |
| ≤480px | Compact typography; row actions stack |
| `(pointer: coarse)` | 40–44px touch targets — keyed to the pointer, not width, because a 1024px tablet needs them too |

---

## 6. Browser and manual UX checks

| # | Check | Expected | Status |
|---|---|---|---|
| B1 | Chrome desktop | All pages render, no console errors | ☐ to run |
| B2 | Edge desktop | Same | ☐ to run |
| B3 | Real phone | Drawer opens, tables scroll, targets tappable | ☐ to run |
| B4 | PDF export | Quotation prints with reference and validity | ☐ to run |
| B5 | Public → app navigation | "Sign in" reaches the login screen | ☐ to run |
| B6 | Keyboard: Escape | Closes drawer and modals | ☐ to run |
| B7 | Dashboard chart hover | Tooltip shows date and fee | ☐ to run |

---

## 7. Screenshot checklist for the report

Number and caption each one — the brief requires captions on every figure.

**CRUD (Section V)**
1. New Forecast form, filled in
2. Validation error on an empty required field
3. Forecast Result — ±5 day grid with the lowest date marked
4. Client Quote before saving — "Save Forecast Record" visible
5. Forecast History with the new record at the top ← **Create**
6. History table, all records ← **Read**
7. Edit modal open with values loaded
8. History showing the changed values ← **Update**
9. Delete confirmation dialog
10. History with the record gone ← **Delete**
11. Confirmed row showing **no** Edit or Delete buttons ← business rule
12. Terminal output from §3 ← **database-level enforcement**

**Responsive (Section V)**
13. Desktop 1440px — sidebar rail
14. Tablet 820px — drawer closed
15. Tablet — drawer open over backdrop
16. Mobile 390px — login
17. Mobile — history table scrolling inside its card
18. Mobile — dashboard

**Features (Sections IV & VI)**
19. Login and registration
20. Public home page
21. About page
22. Contact form with a validation error
23. Executive Dashboard — KPIs and trend chart
24. Issued quotation with reference and validity
25. Exported PDF

---

## 8. Known limitations

Stating these earns more credit than hiding them, and the brief's marking rewards honest analysis.

| Limitation | Consequence |
|---|---|
| REST calls use the anon key, not the signed-in user's token | RLS cannot yet scope rows per user; any holder of the public key has the same access as a logged-in member of staff |
| Supabase free tier pauses after inactivity | Open the dashboard once a week until grading, or the live site shows no data |
| One route only (NE → US East Coast) | The route selector exists but is fixed |
| Market Impact is illustrative, not a model output | Stated on the page and in [`business-logic.md`](business-logic.md); no quotation may be priced from it |
| No automated test suite | All testing is manual plus the scripted API checks in §2–§4 |
