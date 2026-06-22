import Link from "next/link";

import { brandMark } from "@/lib/brands";
import { formatNumber, formatPrice } from "@/lib/format";
import {
  getFilterOptions,
  getListings,
  type ListingFilters,
  type SortKey,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}
function num(v: string | string[] | undefined): number | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseFilters(sp: SearchParams): ListingFilters {
  const sort = str(sp.sort) as SortKey | undefined;
  const dir = str(sp.dir) === "asc" ? "asc" : "desc";
  return {
    make: str(sp.make),
    model: str(sp.model),
    fuel: str(sp.fuel),
    sellerType: str(sp.sellerType),
    region: str(sp.region),
    minPrice: num(sp.minPrice),
    maxPrice: num(sp.maxPrice),
    minYear: num(sp.minYear),
    maxYear: num(sp.maxYear),
    maxMileage: num(sp.maxMileage),
    sort: sort ?? "lastSeen",
    dir,
    page: num(sp.page) ?? 1,
    pageSize: 50,
  };
}

function queryString(base: ListingFilters, overrides: Record<string, string | number>): string {
  const params = new URLSearchParams();
  const merged: Record<string, unknown> = { ...base, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (k === "pageSize") continue;
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  return `?${params.toString()}`;
}

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "make", label: "Make" },
  { key: "price", label: "Price", num: true },
  { key: "year", label: "Year", num: true },
  { key: "mileage", label: "Mileage (km)", num: true },
  { key: "lastSeen", label: "Last seen", num: true },
];

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const [{ rows, total, page, pageSize }, options] = await Promise.all([
    getListings(filters),
    getFilterOptions(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const sel = (name: keyof ListingFilters, label: string, opts: string[]) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={(filters[name] as string) ?? ""}>
        <option value="">Any</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <main className="container">
      <h1>Listings</h1>
      <p className="subtitle">
        {total.toLocaleString("pt-PT")} listings · page {page} of {totalPages}
      </p>

      <form className="panel" method="get" action="/listings">
        <div className="filters">
          {sel("make", "Make", options.makes)}
          {sel("fuel", "Fuel", options.fuels)}
          {sel("sellerType", "Seller", options.sellerTypes)}
          {sel("region", "District", options.regions)}
          <div className="field">
            <label htmlFor="minPrice">Min price</label>
            <input id="minPrice" name="minPrice" type="number" defaultValue={filters.minPrice} />
          </div>
          <div className="field">
            <label htmlFor="maxPrice">Max price</label>
            <input id="maxPrice" name="maxPrice" type="number" defaultValue={filters.maxPrice} />
          </div>
          <div className="field">
            <label htmlFor="minYear">Min year</label>
            <input id="minYear" name="minYear" type="number" defaultValue={filters.minYear} />
          </div>
          <div className="field">
            <label htmlFor="maxMileage">Max mileage</label>
            <input
              id="maxMileage"
              name="maxMileage"
              type="number"
              defaultValue={filters.maxMileage}
            />
          </div>
        </div>
        <input type="hidden" name="sort" value={filters.sort} />
        <input type="hidden" name="dir" value={filters.dir} />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" type="submit">
            Apply filters
          </button>
          <Link className="btn secondary" href="/listings">
            Reset
          </Link>
        </div>
      </form>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Model</th>
              {COLUMNS.map((c) => {
                const active = filters.sort === c.key;
                const nextDir = active && filters.dir === "desc" ? "asc" : "desc";
                const arrow = active ? (filters.dir === "desc" ? " ↓" : " ↑") : "";
                return (
                  <th key={c.key} className={c.num ? "num" : undefined}>
                    <Link href={queryString(filters, { sort: c.key, dir: nextDir, page: 1 })}>
                      {c.label}
                      {arrow}
                    </Link>
                  </th>
                );
              })}
              <th>Fuel</th>
              <th>Seller</th>
              <th>District</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted">
                  No listings match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.title ?? "(untitled)"}
                      </a>
                    ) : (
                      (r.title ?? "(untitled)")
                    )}
                  </td>
                  <td>{r.model ?? "—"}</td>
                  <td>
                    {(() => {
                      const mark = brandMark(r.make);
                      return (
                        <span className="brand-cell">
                          {mark?.mono && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="brand-logo-mono sm"
                              src={mark.logo}
                              alt=""
                              aria-hidden="true"
                            />
                          )}
                          <span>{r.make ?? "—"}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="num">{formatPrice(r.currentPrice, r.currency ?? "EUR")}</td>
                  <td className="num">{r.modelYear ?? "—"}</td>
                  <td className="num">{formatNumber(r.mileageKm)}</td>
                  <td className="num">{new Date(r.lastSeenAt).toLocaleDateString("pt-PT")}</td>
                  <td>{r.fuel ?? "—"}</td>
                  <td>{r.sellerType ?? "—"}</td>
                  <td>{r.district ?? r.city ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="pagination">
          {page > 1 ? (
            <Link className="btn secondary" href={queryString(filters, { page: page - 1 })}>
              ← Prev
            </Link>
          ) : (
            <span className="btn secondary" style={{ opacity: 0.4 }}>
              ← Prev
            </span>
          )}
          <span className="muted">
            Page {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link className="btn secondary" href={queryString(filters, { page: page + 1 })}>
              Next →
            </Link>
          ) : (
            <span className="btn secondary" style={{ opacity: 0.4 }}>
              Next →
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
