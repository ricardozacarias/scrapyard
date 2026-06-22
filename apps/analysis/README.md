# analysis

Ad-hoc, one-off analyses of the scraped dataset. These are **local-only** —
they are never built or deployed (Vercel ignores changes here), and their
outputs (`out/`) are gitignored. Use them to explore the data, prototype a
query before promoting it to a web chart, or export a result to share.

## Run

```bash
pnpm analysis scripts/price-by-brand.ts
```

`DATABASE_URL` is picked up automatically from the repo-root `.env` (or the
environment if already set).

## Write a new one

Copy `scripts/price-by-brand.ts`, change the query, run it. The harness
(`src/_harness.ts`) re-exports the db client (`getDb`), the Drizzle tables
(`listings`, `priceHistory`, `regions`, ...) and operators (`eq`, `desc`,
`sql`, `count`, `avg`, ...), plus:

- `printTable(rows)` — print to the terminal with a row count.
- `save(name, rows, format?)` — write `out/<name>.csv` (or `"json"`).

For quick throwaway queries you can also drop to raw SQL:

```ts
const db = getDb();
const rows = await db.execute(sql`select brand, count(*) from listings group by 1`);
```
