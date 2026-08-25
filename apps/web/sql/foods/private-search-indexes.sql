\set ON_ERROR_STOP on

-- Run this file directly with psql. CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction, so deployment must complete these statements before
-- the Web build-time product-label preflight is allowed to pass.
-- IF NOT EXISTS deliberately preserves an already-correct live index. If the
-- preflight reports `not_live` or `wrong_definition`, follow the fixed-name
-- concurrent drop procedure in apps/web/README.md for only the reported index,
-- then rerun this file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS foods_name_rank_idx
  ON foods
  USING GIST (name gist_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS foods_name_exact_rank_idx
  ON foods (lower(name), data_origin_priority, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS foods_canonical_rank_idx
  ON foods (canonical_key, data_origin_priority, id);
