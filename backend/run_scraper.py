# backend/run_scraper.py
from __future__ import annotations

import asyncio
import argparse
from typing import Iterable, Dict, Any, Optional, Tuple

from sqlalchemy.orm import Session

from .db import Base, engine, SessionLocal
from .models import Listing, RawFetch  # keep listings for now; add RawFetch for raw snapshots

# -----------------------------
# RAW snapshot (site-agnostic)
# -----------------------------
async def _fetch_raw_search_html(site: str, *, price_max: Optional[int], timeout_ms: int = 30000) -> Tuple[str, str]:
    if site == "standvirtual":
        from .scrapers import standvirtual as scraper
        search_url = scraper.build_search_url(price_max)
    else:
        raise SystemExit(f"Unknown site for RAW fetch: {site}")

    from playwright.async_api import async_playwright

    ua = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        ctx = await browser.new_context(
            user_agent=ua, locale="pt-PT", timezone_id="Europe/Lisbon", viewport={"width": 1366, "height": 900}
        )
        page = await ctx.new_page()
        await page.goto(search_url, wait_until="domcontentloaded", timeout=timeout_ms)
        html = await page.content()
        await browser.close()
        return search_url, html

def _insert_raw_fetch(
    db: Session,
    *,
    source: str,
    url: str,
    body: str,
    status_code: int | None = None,
    content_type: str | None = "text/html",
    error: str | None = None,
) -> int:
    row = RawFetch(
        source=source,
        url=url,
        status_code=status_code,
        content_type=content_type,
        body=body,
        error=error,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id

# -----------------------------
# Existing upsert + run_site
# -----------------------------
def upsert_many(db: Session, items: Iterable[Dict[str, Any]]) -> int:
    count = 0
    for it in items:
        if "id" not in it:
            continue
        obj = db.get(Listing, it["id"])
        if obj:
            for k, v in it.items():
                setattr(obj, k, v)
        else:
            db.add(Listing(**it))
        count += 1
    db.commit()
    return count

async def run_site(site: str, **kwargs) -> list[dict]:
    if site == "standvirtual":
        from .scrapers import standvirtual as scraper
    else:
        raise SystemExit(f"Unknown site: {site}")
    return await scraper.run(**kwargs)

# -----------------------------
# CLI
# -----------------------------
async def main() -> None:
    parser = argparse.ArgumentParser(description="Run a scraper, save RAW snapshot, and upsert results into SQLite.")
    parser.add_argument("--site", default="standvirtual", help="Which scraper to run (default: standvirtual)")
    parser.add_argument("--limit", type=int, default=15, help="Max number of listings to fetch (default: 15)")
    parser.add_argument("--price-max", type=int, default=20000, dest="price_max",
                        help="Upper price filter in EUR (default: 20000)")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)

    # 1) RAW snapshot (non-breaking)
    try:
        url, html = await _fetch_raw_search_html(args.site, price_max=args.price_max)
        db = SessionLocal()
        try:
            _insert_raw_fetch(db, source=args.site, url=url, body=html, content_type="text/html")
        finally:
            db.close()
    except Exception as e:
        print(f"[warn] RAW snapshot failed: {e!r}")

    # 2) Parse + upsert as before
    rows = await run_site(args.site, limit=args.limit, price_max=args.price_max)
    db = SessionLocal()
    try:
        n = upsert_many(db, rows)
        print(f"Saved {n} rows from {args.site}")
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(main())
