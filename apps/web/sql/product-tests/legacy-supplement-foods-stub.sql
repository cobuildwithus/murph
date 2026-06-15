CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  CONSTRAINT foods_id_check
    CHECK (btrim(id) <> '')
);
