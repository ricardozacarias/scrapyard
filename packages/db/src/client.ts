import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

/**
 * Shared Drizzle client backed by Neon's HTTP driver. Works in both the Node
 * scraper and Next.js server components / route handlers. Stateless per query,
 * so it's safe to import as a singleton.
 *
 * NOTE: import this only from server-side code. `DATABASE_URL` must never reach
 * the browser bundle.
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to your environment (.env locally, " +
        "Vercel env var in production, GitHub Actions secret in CI).",
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export type DB = ReturnType<typeof createDb>;

let _db: DB | undefined;

/** Lazily-created singleton DB client. */
export function getDb(): DB {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
