# Deployment Guide

| | |
|---|---|
| Repository | https://github.com/kaihui11/Web-Design---ShipSense |
| Live site | https://web-design-ship-sense.vercel.app |

Every push to `main` triggers an automatic Vercel redeploy.

---

## Local Development

`fetch()` in `app.js` requires an HTTP server — opening `index.html` directly as `file://` will fail to load data.

```bash
cd frontend
python -m http.server 8080
# open http://localhost:8080
```

Login/signup uses Supabase Auth and requires a `@goodfortune.com` account — sign up from the login page, or see `supabase/README.md` to enable email auth on the project first.

---

## Deploy to Vercel (recommended)

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import from GitHub → select `kaihui11/Web-Design---ShipSense`
2. Leave **Root Directory** at the repository root — do *not* set it to `frontend`
3. Framework Preset: **Other**
4. Leave Build Command and Output Directory blank
5. Click **Deploy**

Step 2 matters: [`vercel.json`](../vercel.json) at the repo root already sets `"outputDirectory": "frontend"`, so `frontend/` becomes the document root. Setting Root Directory to `frontend` as well would resolve to `frontend/frontend` and break the deploy.

The result is a static site: `/` is the login screen, and every page in the system lives behind it in the same file. Assets resolve from the document root — `/style.css`, `/app.js`, `/data/macro-history.json`.

---

## Deploy to Netlify

1. Go to [netlify.com](https://netlify.com) → **Add new site** → Import from Git → select the repo
2. Base directory: *(leave blank)*
3. Build command: *(leave blank)*
4. Publish directory: `frontend`
5. Deploy

Publish directory is relative to the base directory, so setting both to `frontend` would look for `frontend/frontend` — the same trap as the Vercel step above.

---

## Deploy to GitHub Pages

1. In repo Settings → Pages → Source: **GitHub Actions**
2. Create `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: frontend
      - uses: actions/deploy-pages@v4
```

Note: GitHub Pages would serve from `https://kaihui11.github.io/Web-Design---ShipSense/` — a subpath, not a domain root. Nothing breaks under it: forecast and history data come from Supabase's REST API by absolute URL, and the one local file, `macro-history.json`, is fetched as a *relative* path (`exec-data.js:192`), so it resolves against the subpath correctly.

---

## Updating Forecast Data After Deployment

See [data-pipeline.md](data-pipeline.md) for the full workflow. In short:

1. Run notebook in Colab → push `shipsense_website_bundle.pkl` to GitHub
2. GitHub Actions (`update-forecast-pkl.yml`) auto-runs `scripts/pkl_to_json.py` → POSTs straight into Supabase
3. Users see fresh forecast data on next page load — no redeploy needed, the frontend reads Supabase live

---

## Backend (Supabase / Postgres) — live

The forecast data pipeline's backend is Supabase (hosted Postgres), reachable from both your machine and GitHub Actions. See [supabase/README.md](../supabase/README.md) for setup. Summary:

- `scripts/pkl_to_json.py` converts the notebook's `.pkl` output and `POST`s it straight into Supabase's `snapshots` and `historical_data` tables via its REST API (service_role key).
- `frontend/app.js`/`exec-data.js` fetch the latest snapshot from Supabase's REST API directly — it is the only data source for the Forecast tab.
- Sign-in is real Supabase Auth, and quote records live in the `quote_requests` table, so history is shared across devices rather than held in one browser. `localStorage` now carries only the selected ISD (`ss_isd`), shared between New Forecast and the Executive Dashboard.
- Still out of scope: multi-lane models. The route selector exists but is fixed to North Europe → US East Coast. See [business-logic.md](business-logic.md).
