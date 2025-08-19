PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS cars (
  listing_id   TEXT PRIMARY KEY,
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
