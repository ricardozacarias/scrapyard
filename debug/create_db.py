# create_db.py
import sqlite3
from pathlib import Path

DB_PATH = Path("scraper.db")

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS cars (
  listing_id   TEXT PRIMARY KEY,   -- stable id from the site
  title        TEXT,
  url          TEXT,
  city         TEXT,
  region       TEXT,
  seller_type  TEXT,
  price        INTEGER,
  currency     TEXT,
  brand        TEXT,
  fuel         TEXT,
  model_year   INTEGER,
  mileage_km   INTEGER,
  scraped_at   TEXT DEFAULT (datetime('now'))
);
"""

def main():
    with sqlite3.connect(DB_PATH) as con:
        con.executescript(SCHEMA)
    print(f"Created/verified database at: {DB_PATH.resolve()}")

if __name__ == "__main__":
    main()
