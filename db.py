# db.py
import os
import sqlite3
from pathlib import Path
import unicodedata
import re

DB_PATH = Path("scraper.db")
SCHEMA_PATH = Path("schema.sql")

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_PG = DATABASE_URL.startswith("postgres")

def connect():
    if IS_PG:
        import psycopg  # psycopg[binary]
        return psycopg.connect(DATABASE_URL)
    return sqlite3.connect(DB_PATH)

def _q(sql: str) -> str:
    """Swap SQLite '?' placeholders to Postgres '%s' when needed."""
    return sql.replace("?", "%s") if IS_PG else sql

# --- SQL (two small variants: only placeholders + now() differ)
_UPSERT_SQL_SQLITE = """
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

_UPSERT_SQL_PG = """
INSERT INTO cars (listing_id, title, url, city, region, seller_type,
                  price, currency, brand, fuel, model_year, mileage_km)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (listing_id) DO UPDATE SET
  title=EXCLUDED.title,
  url=EXCLUDED.url,
  city=EXCLUDED.city,
  region=EXCLUDED.region,
  seller_type=EXCLUDED.seller_type,
  price=EXCLUDED.price,
  currency=EXCLUDED.currency,
  brand=EXCLUDED.brand,
  fuel=EXCLUDED.fuel,
  model_year=EXCLUDED.model_year,
  mileage_km=EXCLUDED.mileage_km,
  scraped_at=NOW();
"""

def _ensure_schema(con):
    if IS_PG:
        return  # managed separately with schema_pg.sql
    con.executescript(Path(SCHEMA_PATH).read_text(encoding="utf-8"))

def _ensure_region_column(con):
    if IS_PG:
        return  # PG schema already has region_id + index
    cols = [row[1] for row in con.execute("PRAGMA table_info(cars);")]
    if "region_id" not in cols:
        con.execute("ALTER TABLE cars ADD COLUMN region_id INTEGER;")
        con.execute("CREATE INDEX IF NOT EXISTS cars_region_id_idx ON cars(region_id);")

def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

def resolve_region_id(con, city: str | None, region: str | None):
    """
    Resolve a scraped (city/region) string to a canonical district region_id.
    Tries: alias exact → name exact → loose slug contains.
    """
    cand = (region or city or "").strip()
    if not cand:
        return None

    row = con.execute(_q("""
        SELECT r.id
        FROM region_aliases a
        JOIN regions r ON r.id = a.region_id
        WHERE lower(a.alias) = ?
        LIMIT 1
    """), (cand.lower(),)).fetchone()
    if row:
        return row[0]

    row = con.execute(_q("""
        SELECT id
        FROM regions
        WHERE level='district' AND lower(name) = ?
        LIMIT 1
    """), (cand.lower(),)).fetchone()
    if row:
        return row[0]

    s = _slug(cand)
    row = con.execute(_q("""
        WITH c AS (
          SELECT r.id, lower(r.name) AS n FROM regions r WHERE r.level='district'
          UNION ALL
          SELECT a.region_id AS id, lower(a.alias) AS n FROM region_aliases a
        )
        SELECT id FROM c
        WHERE %s LIKE '%%' || n || '%%'
        LIMIT 1
    """), (s,) if IS_PG else (s,)).fetchone()
    return row[0] if row else None

def _seed_districts(con):
    if IS_PG:
        return  # PG pre-seeded via schema_pg.sql
    con.executescript("""
    INSERT OR IGNORE INTO regions (level, code, name, geom_key)
    VALUES
      ('district', NULL, 'Aveiro','Aveiro'),
      ('district', NULL, 'Beja','Beja'),
      ('district', NULL, 'Braga','Braga'),
      ('district', NULL, 'Bragança','Bragança'),
      ('district', NULL, 'Castelo Branco','Castelo Branco'),
      ('district', NULL, 'Coimbra','Coimbra'),
      ('district', NULL, 'Évora','Évora'),
      ('district', NULL, 'Faro','Faro'),
      ('district', NULL, 'Guarda','Guarda'),
      ('district', NULL, 'Leiria','Leiria'),
      ('district', NULL, 'Lisboa','Lisboa'),
      ('district', NULL, 'Portalegre','Portalegre'),
      ('district', NULL, 'Porto','Porto'),
      ('district', NULL, 'Santarém','Santarém'),
      ('district', NULL, 'Setúbal','Setúbal'),
      ('district', NULL, 'Viana do Castelo','Viana do Castelo'),
      ('district', NULL, 'Vila Real','Vila Real'),
      ('district', NULL, 'Viseu','Viseu');

    INSERT OR IGNORE INTO region_aliases (region_id, alias)
      SELECT id, 'Lisbon' FROM regions WHERE level='district' AND name='Lisboa';
    INSERT OR IGNORE INTO region_aliases (region_id, alias)
      SELECT id, 'Setubal' FROM regions WHERE level='district' AND name='Setúbal';
    INSERT OR IGNORE INTO region_aliases (region_id, alias)
      SELECT id, 'Evora' FROM regions WHERE level='district' AND name='Évora';
    INSERT OR IGNORE INTO region_aliases (region_id, alias)
      SELECT id, 'Braganca' FROM regions WHERE level='district' AND name='Bragança';
    INSERT OR IGNORE INTO region_aliases (region_id, alias)
      SELECT id, 'Santarem' FROM regions WHERE level='district' AND name='Santarém';
    INSERT OR IGNORE INTO region_aliases (region_id, alias)
      SELECT id, 'Viana-do-Castelo' FROM regions WHERE level='district' AND name='Viana do Castelo';
    INSERT OR IGNORE INTO region_aliases (region_id, alias)
      SELECT id, 'Vila-Real' FROM regions WHERE level='district' AND name='Vila Real';
    """)

def backfill_cars_region_ids():
    con = connect()
    updated = 0
    with con:
        _ensure_schema(con)
        _ensure_region_column(con)
        for lid, city, region in con.execute("SELECT listing_id, city, region FROM cars WHERE region_id IS NULL"):
            rid = resolve_region_id(con, city, region)
            if rid is not None:
                con.execute(_q("UPDATE cars SET region_id = ? WHERE listing_id = ?"),
                            (rid, lid) if not IS_PG else (rid, lid))
                updated += 1
    return updated

def save_cars(records):
    con = connect()
    upsert_sql = _UPSERT_SQL_PG if IS_PG else _UPSERT_SQL_SQLITE
    with con:  # auto-commit/rollback
        _ensure_schema(con)
        _ensure_region_column(con)
        _seed_districts(con)
        upserted = 0
        for rec in records:
            lid = rec.get("listing_id") or rec.get("url")
            if not lid:
                continue
            con.execute(upsert_sql, (
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
            rid = resolve_region_id(con, rec.get("city"), rec.get("region"))
            if rid is not None:
                con.execute(_q("UPDATE cars SET region_id = ? WHERE listing_id = ?"),
                            (rid, lid) if not IS_PG else (rid, lid))
    return upserted
