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

CREATE TABLE IF NOT EXISTS supplement_external_labels (
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  upc TEXT,
  off_market BOOLEAN NOT NULL DEFAULT FALSE,
  search_text TEXT NOT NULL,
  label JSONB NOT NULL,
  source_url TEXT,
  matched_dsld_id BIGINT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplement_external_labels_source_check
    CHECK (source ~ '^[a-z][a-z0-9_-]*$'),
  CONSTRAINT supplement_external_labels_source_id_check
    CHECK (btrim(source_id) <> ''),
  PRIMARY KEY (source, source_id)
);

CREATE INDEX IF NOT EXISTS supplement_external_labels_search_idx
  ON supplement_external_labels
  USING GIN (to_tsvector('simple', search_text));

CREATE INDEX IF NOT EXISTS supplement_external_labels_upc_idx
  ON supplement_external_labels (upc)
  WHERE upc IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplement_external_labels_matched_dsld_idx
  ON supplement_external_labels (matched_dsld_id)
  WHERE matched_dsld_id IS NOT NULL;
