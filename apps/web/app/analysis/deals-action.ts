"use server";

import { type DealFilter, type FairPriceDeal, queryDeals } from "@/lib/fair-price";

// Server action behind the same middleware gate as the pages. Input is
// untrusted (any client can POST); sanitize every field and let queryDeals
// enforce the top-N cap.
export async function fetchDeals(filter: DealFilter): Promise<FairPriceDeal[]> {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return queryDeals({
    models: Array.isArray(filter.models)
      ? filter.models.filter((m): m is string => typeof m === "string").slice(0, 500)
      : undefined,
    minPrice: num(filter.minPrice),
    maxPrice: num(filter.maxPrice),
    minYear: num(filter.minYear),
    maxKm: num(filter.maxKm),
    sortBy: filter.sortBy === "discountPct" ? "discountPct" : "saved",
  });
}
