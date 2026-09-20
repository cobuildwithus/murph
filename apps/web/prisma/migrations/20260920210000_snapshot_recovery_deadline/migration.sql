-- Cleanup retries may move cleanup_at; accepted archive expiry must not move.
ALTER TABLE hosted_runtime_orphan
  ADD COLUMN recovery_until TIMESTAMP(3);
