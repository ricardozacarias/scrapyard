export * from "./schema";
export * from "./client";
export * from "./regions";
export * from "./municipalities";

export type { SQL } from "drizzle-orm";
export type { AnyPgColumn } from "drizzle-orm/pg-core";

// Re-export the drizzle operators consumers need, so apps depend only on
// @scrapyard/db and share one resolved drizzle-orm instance.
export {
  and,
  asc,
  avg,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  like,
  lte,
  max,
  min,
  or,
  sql,
  sum,
} from "drizzle-orm";
