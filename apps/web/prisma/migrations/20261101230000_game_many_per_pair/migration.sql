-- Pair admission now uses the existing advisory lock and indexed player rows.
-- Keep the nullable legacy column until old Web functions have drained.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "game" DROP CONSTRAINT IF EXISTS "game_live_roster_check";
DROP INDEX IF EXISTS "game_live_roster_key_key";
CREATE INDEX "game_previous_game_id_idx" ON "game"("previous_game_id");
COMMIT;
