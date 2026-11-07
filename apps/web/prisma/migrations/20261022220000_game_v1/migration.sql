-- Additive v1 storage remains compatible with retained rows and old writers.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "game" DROP CONSTRAINT "game_length_days_check";
ALTER TABLE "game" ADD CONSTRAINT "game_length_days_check"
CHECK ("length_days" BETWEEN 1 AND 365) NOT VALID;
ALTER TABLE "game_entry" DROP CONSTRAINT "game_entry_attempt_check";
ALTER TABLE "game_entry" ADD CONSTRAINT "game_entry_attempt_check"
CHECK ("kind" IN ('photo', 'heart_rate', 'words', 'route', 'reps', 'excuse')
  AND "attempt" BETWEEN 0 AND 2
  AND ("attempt" = 0) = ("kind" = 'excuse')) NOT VALID;
ALTER TABLE "game_entry" ADD COLUMN "payload_encrypted" TEXT;
ALTER TABLE "game_entry" ADD COLUMN "blur_hash" TEXT;
COMMIT;

-- Validate retained rows separately, without blocking ordinary reads and writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "game" VALIDATE CONSTRAINT "game_length_days_check";
ALTER TABLE "game_entry" VALIDATE CONSTRAINT "game_entry_attempt_check";
COMMIT;
