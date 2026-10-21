-- Expand the existing entry vocabulary without changing per-day attempt caps.
-- Replace atomically without scanning retained rows under the metadata lock.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "game_entry" DROP CONSTRAINT "game_entry_attempt_check";
ALTER TABLE "game_entry" ADD CONSTRAINT "game_entry_attempt_check"
CHECK ("kind" IN ('photo', 'heart_rate', 'excuse')
  AND "attempt" BETWEEN 0 AND 2
  AND ("attempt" = 0) = ("kind" = 'excuse')) NOT VALID;
COMMIT;

-- Validate separately so ordinary reads and writes can continue during the scan.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "game_entry" VALIDATE CONSTRAINT "game_entry_attempt_check";
COMMIT;
