# backend/run_scraper.py
# Purpose: CLI to run a scraper (currently: standvirtual) and save results into SQLite.
# What it does:
#   - Creates DB tables if needed
#   - Runs the chosen scraper (async)
#   - Upserts rows into the listings table
# Usage (from project root, venv active):
#   py -m backend.run_scraper
#   py -m backend.run_scraper --limit 30 --price-max 25000
#   py -m backend.run_scraper --site standvirtual

from __future__ import annotations

import asyncio
import argparse
from typing import Iterable, Dict, Any

from sqlalchemy.orm import Session

from .db import Base, engine, SessionLocal
from .models import Listing


def upsert_many(db: Session, items: Iterable[Dict[str, Any]]) -> int:
    """Insert new rows or update existing ones by primary key (id). Returns number of items processed."""
    count = 0
    for it in items:
        if "id" not in it:
            # Skip malformed rows defensively
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
    """Dynamically pick the scraper module and run it with kwargs."""
    if site == "standvirtual":
        from .scrapers import standvirtual as scraper
    else:
        raise SystemExit(f"Unknown site: {site}")

    return await scraper.run(**kwargs)


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run a scraper and upsert results into the local SQLite DB."
    )
    parser.add_argument(
        "--site",
        default="standvirtual",
        help="Which scraper to run (default: standvirtual)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=15,
        help="Max number of listings to fetch (default: 15)",
    )
    parser.add_argument(
        "--price-max",
        type=int,
        default=20000,
        dest="price_max",
        help="Upper price filter in EUR when supported by the scraper (default: 20000)",
    )
    args = parser.parse_args()

    # Ensure tables exist
    Base.metadata.create_all(bind=engine)

    # Run the scraper
    rows = await run_site(args.site, limit=args.limit, price_max=args.price_max)

    # Persist
    db = SessionLocal()
    try:
        n = upsert_many(db, rows)
        print(f"Saved {n} rows from {args.site}")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
