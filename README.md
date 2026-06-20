# Standvirtual Insights

A TypeScript monorepo that scrapes car listings from
[standvirtual.com](https://www.standvirtual.com) into a live Postgres (Neon) database,
and serves a Next.js dashboard (deployable on Vercel) to browse the listings and run
analysis — correlations, outliers, and price-history trends.

## Architecture

```
GitHub Actions (cron, Node)      Neon Postgres              Vercel (Next.js)
  scraper (cheerio)         ──►  listings                ◄──  /listings browser
                                 price_history (history)      /analysis dashboard
                                 regions / region_aliases     (server-side Drizzle queries)
```

The scraper and the web app are fully decoupled — they share only the Neon database and
the Drizzle schema package. `DATABASE_URL` is the single connection string used by the
scraper, the migrations, and the web app.

## Workspaces

| Path             | What it is                                                             |
| ---------------- | --------------------------------------------------------------------- |
| `packages/db`    | Drizzle schema, Neon client, region seed data + resolver, migrations  |
| `apps/scraper`   | TypeScript scraper (cheerio) + ingest CLI                             |
| `apps/web`       | Next.js (App Router) dashboard for Vercel                             |

## Prerequisites

- Node 20+ and pnpm (`corepack enable` / `volta install pnpm`)
- A Neon Postgres database — copy its connection string

## Setup

```bash
pnpm install
cp .env.example .env        # then paste your Neon DATABASE_URL
```

Make `DATABASE_URL` available to the tools that need it. Locally, export it or use a
`.env` (the scraper and drizzle read `process.env.DATABASE_URL`):

```bash
export DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
```

### Apply the schema

```bash
pnpm db:migrate        # creates tables; regions are seeded on first scrape
```

### Run the scraper

```bash
pnpm scrape -- --pages 5                 # scrape 5 search pages
pnpm scrape -- --pages 10 --max-price 15000
```

The scraper upserts current state into `listings` and appends a row to `price_history`
only when a listing's price changes. It exits non-zero if it parses zero listings (so a
selector change or a block is caught, not silently ignored).

### Run the web app

```bash
pnpm web:dev           # http://localhost:3000
```

- `/` — dashboard summary (counts, median price by brand/district)
- `/listings` — filterable / sortable / paginated table; links out to each listing
- `/analysis` — scatter + regression + outlier detection, plus biggest recent price drops
- `/api/listings` — JSON endpoint mirroring the listings filters

## Scheduled scraping (GitHub Actions)

`.github/workflows/scrape.yml` runs daily (and on-demand via "Run workflow"). Add the
Neon connection string as a repository secret named **`DATABASE_URL`**
(Settings → Secrets and variables → Actions).

## Deploy the web app to Vercel

1. Import the repo into Vercel and set the **Root Directory** to `apps/web`.
   Vercel detects the pnpm workspace and installs from the monorepo root.
2. Add the **`DATABASE_URL`** environment variable (use the Neon **pooled** connection
   string for serverless).
3. Deploy. The dashboard pages are server-rendered and read directly from Neon.

`DATABASE_URL` is only ever read in server code (`packages/db` is imported via server
components, route handlers, and `lib/queries.ts` which is marked `server-only`), so it
never reaches the browser bundle.

## Data model

- **`listings`** — one row per listing (current state), keyed by `external_id`. Upserted
  each scrape; `last_seen_at` refreshed every run.
- **`price_history`** — append-only `(listing_id, price, observed_at)`; a row is added
  only when the price changes. Powers price-drop and trend analysis.
- **`regions`** / **`region_aliases`** — the 18 mainland Portuguese districts plus alias
  spellings; scraped locations are mapped to a canonical district id.

## Useful scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `pnpm db:generate`  | Generate a new Drizzle migration     |
| `pnpm db:migrate`   | Apply migrations                     |
| `pnpm db:studio`    | Open Drizzle Studio                  |
| `pnpm scrape`       | Run the scraper                      |
| `pnpm web:dev`      | Next.js dev server                   |
| `pnpm typecheck`    | Typecheck every workspace            |
