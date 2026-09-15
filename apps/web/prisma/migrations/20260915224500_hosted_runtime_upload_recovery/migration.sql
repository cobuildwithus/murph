ALTER TABLE hosted_runtime_put_drain
  ADD COLUMN object_key TEXT,
  ADD COLUMN upload_id TEXT,
  ADD COLUMN reconcile_after TIMESTAMP(3),
  DROP CONSTRAINT hosted_runtime_put_drain_kind_check,
  ADD CHECK (kind IN ('snapshot', 'replica', 'media', 'private_media')),
  ADD CHECK ((upload_id IS NULL AND object_key IS NULL) OR (upload_id IS NOT NULL AND object_key IS NOT NULL));
CREATE INDEX hosted_runtime_put_drain_completed_at_reconcile_after_idx ON hosted_runtime_put_drain(completed_at, reconcile_after);
