-- Backend ownership is independent of the execution attempt's lifecycle.
-- Keep obligations and migration identity after canonical member deletion.
ALTER TABLE hosted_runtime_owner
  ADD COLUMN migration_phase TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN migration_id TEXT;

ALTER TABLE hosted_runtime_owner
  ADD CONSTRAINT hosted_runtime_owner_migration_phase_check
  CHECK (migration_phase IN ('legacy', 'quiescing', 'freezing', 'importing', 'postgres'));

UPDATE hosted_runtime_owner
SET migration_phase = 'postgres'
WHERE EXISTS (
  SELECT 1 FROM hosted_runtime_cutover WHERE id = 'runtime' AND phase = 'postgres'
);

CREATE INDEX hosted_runtime_owner_migration_phase_user_id_idx
  ON hosted_runtime_owner (migration_phase, user_id);
