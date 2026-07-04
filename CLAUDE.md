# CLAUDE.md

Guidance for working in this repo. See `README.md` for full setup/architecture.

## What this is

`scrapyard` — a TypeScript pnpm monorepo that scrapes standvirtual.com car
listings into Neon Postgres and serves a public Next.js dashboard.

- `packages/db` — Drizzle schema, Neon client, regions, migrations
- `apps/scraper` — cheerio scraper + ingest CLI (run locally or via GitHub Actions cron)
- `apps/web` — Next.js (App Router) dashboard, deployed on Vercel

`DATABASE_URL` is the core config value everything needs — read server-side only
(`packages/db/client.ts`), never in the browser bundle. It's the only var the
scraper / migrations / GitHub Actions need.

`APP_PASSWORD` (web app only, optional) gates the whole site behind a single
login page. When set as a Vercel env var, `middleware.ts` redirects every page
(except `/login` + static assets) to `/login`, which checks the password and
sets an httpOnly auth cookie. When unset, the gate is off and the site is public.

## Data exposure — deliberate decisions (read before changing the web app)

A password gate (`APP_PASSWORD` + `middleware.ts` + `/login`) now exists: when
`APP_PASSWORD` is set in Vercel, the **entire app** (dashboard, `/listings`,
`/analysis`, `/runs`) sits behind one shared-password login. When it's unset the
site is fully public. Either way the data-exposure rules below still hold — they
govern what's safe to ship *to whoever can see the page*, gated or not. The owner
is fine with permitted viewers *seeing* stats and analysis, but **not** with
anyone being able to bulk-download the scraped dataset (it represents real
scraping effort). The web app is built to that line:

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
- **The fair-price model (`apps/web/lib/fair-price.ts`) splits along the same
  line.** Per-model depreciation stats + retention curves are aggregates and are
  passed to the client explorer. Deal rows carry `title`/`url` and leave the
  server only via the `fetchDeals` server action → `queryDeals`, which returns a
  **filtered top-N (`DEAL_LIMIT`, 25)** per request — same per-ad exposure class
  as the Movers table / `/listings`, effortful to bulk-scrape. Don't raise the
  cap, add pagination/offsets, or expose the unfiltered pool.

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
