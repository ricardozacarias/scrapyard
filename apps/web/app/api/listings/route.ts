import { NextResponse } from "next/server";

import { getListings, type ListingFilters, type SortKey } from "@/lib/queries";

export const dynamic = "force-dynamic";

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const filters: ListingFilters = {
    brand: sp.get("brand") ?? undefined,
    fuel: sp.get("fuel") ?? undefined,
    sellerType: sp.get("sellerType") ?? undefined,
    region: sp.get("region") ?? undefined,
    minPrice: num(sp.get("minPrice")),
    maxPrice: num(sp.get("maxPrice")),
    minYear: num(sp.get("minYear")),
    maxYear: num(sp.get("maxYear")),
    maxMileage: num(sp.get("maxMileage")),
    sort: (sp.get("sort") as SortKey | null) ?? "lastSeen",
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
    page: num(sp.get("page")) ?? 1,
    pageSize: num(sp.get("pageSize")) ?? 50,
  };

  const result = await getListings(filters);
  return NextResponse.json(result);
}
