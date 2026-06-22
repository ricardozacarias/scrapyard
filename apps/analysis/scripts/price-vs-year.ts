// Example chart: price vs. model year for active listings, as a static SVG.
//
//   pnpm analysis scripts/price-vs-year.ts  →  out/price-vs-year.svg
//
// Prototype the Plot spec here; the same spec lifts into a web component since
// apps/web uses @observablehq/plot too.

import * as Plot from "@observablehq/plot";

import { and, chart, eq, getDb, gte, listings, sql } from "../src/_harness";

async function main() {
  const db = getDb();

  const rows = await db
    .select({ year: listings.modelYear, price: listings.currentPrice })
    .from(listings)
    .where(
      and(
        eq(listings.isActive, true),
        gte(listings.modelYear, 1990),
        sql`${listings.currentPrice} between 500 and 150000`,
      ),
    );

  chart("price-vs-year", {
    width: 900,
    height: 560,
    marginLeft: 70,
    grid: true,
    x: { label: "Model year", tickFormat: "d" },
    y: { label: "Price (€)", tickFormat: "~s" },
    marks: [
      Plot.dot(rows, { x: "year", y: "price", r: 1.5, fill: "currentColor", fillOpacity: 0.25 }),
      Plot.lineY(
        rows,
        Plot.groupX({ y: "median" }, { x: "year", y: "price", stroke: "crimson", strokeWidth: 2 }),
      ),
    ],
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
