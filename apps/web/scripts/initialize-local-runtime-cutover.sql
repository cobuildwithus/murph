-- A freshly reset local schema has no legacy runtime namespace to migrate.
-- Never rewrite an existing authority decision based on SQL emptiness alone.
INSERT INTO hosted_runtime_cutover (id, phase, updated_at)
VALUES ('runtime', 'postgres', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM hosted_runtime_cutover WHERE id = 'runtime' AND phase = 'postgres') THEN
    RAISE EXCEPTION 'Local runtime still uses the retired backend. Complete its migration with the preceding release or explicitly reset the isolated local stack.';
  END IF;
END $$;
