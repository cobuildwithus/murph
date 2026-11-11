-- Reuse the FK-free retention registry for opaque recap retirement receipts.
ALTER TABLE hosted_runtime_orphan DROP CONSTRAINT hosted_runtime_orphan_kind_check;
ALTER TABLE hosted_runtime_orphan ADD CONSTRAINT hosted_runtime_orphan_kind_check
  CHECK (kind IN ('snapshot', 'legacy_snapshot', 'replica', 'game_recap')) NOT VALID;
ALTER TABLE hosted_runtime_orphan VALIDATE CONSTRAINT hosted_runtime_orphan_kind_check;
