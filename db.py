# db.py
import sqlite3
from pathlib import Path

DB_PATH = Path("scraper.db")
SCHEMA_PATH = Path("schema.sql")

# small, readable SQL that stays in code (only DDL lives in schema.sql)
_UPSERT_SQL = """
INSERT INTO cars (listing_id, title, url, city, region, seller_type,
                  price, currency, brand, fuel, model_year, mileage_km)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(listing_id) DO UPDATE SET
  title=excluded.title,
  url=excluded.url,
  city=excluded.city,
  region=excluded.region,
  seller_type=excluded.seller_type,
  price=excluded.price,
  currency=excluded.currency,
  brand=excluded.brand,
  fuel=excluded.fuel,
  model_year=excluded.model_year,
  mileage_km=excluded.mileage_km,
  scraped_at=datetime('now');
"""

def _ensure_schema(con: sqlite3.Connection):
    con.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

def save_cars(records):
    con = sqlite3.connect(DB_PATH)
    with con:  # auto-commit/rollback
        _ensure_schema(con)
        upserted = 0
        for rec in records:
            lid = rec.get("listing_id") or rec.get("url")
            if not lid:
                continue
            con.execute(_UPSERT_SQL, (
                lid,
                rec.get("title"),
                rec.get("url"),
                rec.get("city"),
                rec.get("region"),
                rec.get("seller_type"),
                rec.get("price"),
                rec.get("currency"),
                rec.get("brand"),
                rec.get("fuel"),
                rec.get("model_year"),
                rec.get("mileage_km"),
            ))
            upserted += 1
    return upserted
