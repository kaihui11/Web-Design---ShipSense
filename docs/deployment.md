# Deployment Guide

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

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import from GitHub → select `kaihui11/shipsense`
2. Set **Root Directory** to `frontend`
3. Framework Preset: **Other**
4. Leave Build Command and Output Directory blank
5. Click **Deploy**

Vercel will serve `frontend/` as a static site. Every push to `main` triggers an automatic redeploy.

---

## Deploy to Netlify

1. Go to [netlify.com](https://netlify.com) → **Add new site** → Import from Git → select the repo
2. Base directory: `frontend`
3. Build command: *(leave blank)*
4. Publish directory: `frontend`
5. Deploy

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

Note: GitHub Pages serves from `https://kaihui11.github.io/shipsense/` — `app.js` fetches forecast data directly from Supabase's REST API, so no relative-path data files need to resolve correctly under the Pages subpath.

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
- Auth, history persistence (`localStorage`), and multi-lane models are still out of scope for this pass — see `docs/business-logic.md` for what's still simulated client-side.
