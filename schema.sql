PRAGMA journal_mode=WAL;
PRAGMA foreign_keys = ON;
-- --- cars ---------------------------------------------------------------
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

-- --- canonical regions (districts) --------------------------------
CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK (level IN ('district','municipality')),
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  geom_key TEXT NOT NULL,
  parent_code TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS regions_level_name_idx
  ON regions(level, name);

CREATE TABLE IF NOT EXISTS region_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  alias TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS region_aliases_alias_idx
  ON region_aliases(lower(alias));

-- seed 18 districts
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

-- seed common alias spellings
INSERT OR IGNORE INTO region_aliases (region_id, alias)
  SELECT id, 'Lisbon' FROM regions WHERE name='Lisboa';
INSERT OR IGNORE INTO region_aliases (region_id, alias)
  SELECT id, 'Setubal' FROM regions WHERE name='Setúbal';
INSERT OR IGNORE INTO region_aliases (region_id, alias)
  SELECT id, 'Evora' FROM regions WHERE name='Évora';
INSERT OR IGNORE INTO region_aliases (region_id, alias)
  SELECT id, 'Braganca' FROM regions WHERE name='Bragança';
INSERT OR IGNORE INTO region_aliases (region_id, alias)
  SELECT id, 'Santarem' FROM regions WHERE name='Santarém';
INSERT OR IGNORE INTO region_aliases (region_id, alias)
  SELECT id, 'Viana-do-Castelo' FROM regions WHERE name='Viana do Castelo';
INSERT OR IGNORE INTO region_aliases (region_id, alias)
  SELECT id, 'Vila-Real' FROM regions WHERE name='Vila Real';
