# CLAUDE.md

Guidance for working in this repo. See `README.md` for full setup/architecture.

## What this is

`scrapyard` — a TypeScript pnpm monorepo that scrapes standvirtual.com car
listings into Neon Postgres and serves a public Next.js dashboard.

- `packages/db` — Drizzle schema, Neon client, regions, migrations
- `apps/scraper` — cheerio scraper + ingest CLI (run locally or via GitHub Actions cron)
- `apps/web` — Next.js (App Router) dashboard, deployed on Vercel

`DATABASE_URL` is the single config value everything needs. It is the **only**
env var to set in Vercel / GitHub Actions secrets. It is read server-side only
(`packages/db/client.ts`) and never reaches the browser bundle.

## Data exposure — deliberate decisions (read before changing the web app)

The deployed site is **intentionally public with no authentication**. The owner
is fine with people *viewing* stats and analysis, but **not** with anyone being
able to bulk-download the scraped dataset (it represents real scraping effort).
The web app is built to that line:

- **No bulk JSON API.** There is deliberately no `/api/*` route. A
  `GET /api/listings` endpoint used to exist and was **removed** because it let
  anyone export the full dataset in clean JSON. Do not re-add a route that
  returns raw rows in bulk.
- **The `/analysis` scatter is de-identified.** Its data is shipped to the
  browser to render client-side, so `getAnalysisRows` (in `apps/web/lib/queries.ts`)
  and `ScatterPoint` (in `apps/web/app/analysis/scatter.tsx`) **exclude `title`
  and `url`** on purpose. Points are non-clickable and tooltips show brand +
  numeric values only. Don't add identifying fields back to the points shipped
  to the client.
- **The `/analysis` map ships the full de-identified dataset.** The interactive
  choropleth (`MapExplorer` + `getMapData` in `apps/web/lib/queries.ts`) sends
  **every priced listing** to the browser — make, model, year, mileage, price,
  district, concelho — so make/model/year/mileage filtering and region medians
  can be recomputed client-side with no round-trips. This is a **deliberate owner
  decision** (chosen over a server-aggregation hybrid) for filter flexibility. It
  is the one place the *whole* structured dataset leaves the server, so the line
  is held strictly elsewhere: the payload is **de-identified — no `title`, `url`,
  or `id`** — and dictionary-encoded/rounded (`getMapData`). Keep it that way; do
  not add identifying fields to `MapPayload`.
- **Aggregates are fine to expose.** `getSummary` / price-drop queries return
  medians, counts, and a top-20 list — safe to keep public.

### Open item / TODO (pinned)

- **`/listings` is currently public on purpose.** It's a server-rendered,
  paginated HTML table of individual rows. It's kept available for now because
  it's useful to the owner for planning analysis. It's the one remaining surface
  that shows per-ad rows. It's effortful to bulk-scrape (paginated HTML, no
  clean API), so it's an accepted trade-off **for now**.
- **Before any wide-audience launch**, revisit `/listings`: either lock it down
  (e.g. Vercel Password Protection / Vercel Authentication — no code change), cap
  pagination depth / require filters, or remove the page. Decide based on how
  public the site is going.

## Conventions

- `DATABASE_URL` must be present for `db:migrate`, `scrape`, and the web app.
  Locally it lives in `.env` (gitignored). Nothing auto-loads `.env` for the
  scraper/drizzle, so export it or source `.env` when running those locally.
- The scraper exits non-zero if it parses zero listings (so CI catches selector
  breaks / blocks). Keep that behavior.
- Run `pnpm typecheck` before committing web/db changes.
