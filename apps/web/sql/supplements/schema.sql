CREATE TABLE IF NOT EXISTS supplements (
  dsld_id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  upc TEXT,
  off_market BOOLEAN NOT NULL DEFAULT FALSE,
  search_text TEXT NOT NULL,
  label JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplements_search_idx
  ON supplements
  USING GIN (to_tsvector('simple', search_text));

CREATE INDEX IF NOT EXISTS supplements_upc_idx
  ON supplements (upc)
  WHERE upc IS NOT NULL;
