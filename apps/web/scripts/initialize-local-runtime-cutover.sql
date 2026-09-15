-- Local schema pushes do not execute migration data statements. Preserve any
-- existing authority decision and match the migration's default for a new DB.
INSERT INTO hosted_runtime_cutover (id, phase, updated_at)
VALUES ('runtime', 'legacy', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;
