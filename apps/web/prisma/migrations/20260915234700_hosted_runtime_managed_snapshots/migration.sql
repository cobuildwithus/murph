ALTER TABLE hosted_runtime_put_drain
  ADD COLUMN encrypted_byte_size bigint,
  ADD COLUMN encrypted_sha256 text,
  ADD COLUMN verified_at timestamp(3);

ALTER TABLE hosted_runtime_put_drain ADD CONSTRAINT hosted_runtime_managed_snapshot_bytes_check CHECK (
  (encrypted_byte_size IS NULL AND encrypted_sha256 IS NULL AND verified_at IS NULL)
  OR (kind = 'snapshot' AND upload_id IS NOT NULL AND object_key IS NOT NULL
      AND encrypted_byte_size IS NOT NULL AND encrypted_sha256 IS NOT NULL
      AND encrypted_byte_size > 0 AND encrypted_byte_size < 536870912
      AND encrypted_sha256 ~ '^[a-f0-9]{64}$'
      AND (verified_at IS NULL OR completed_at IS NOT NULL))
);
