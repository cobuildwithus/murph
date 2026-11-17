-- A game's own reminder time, in minutes after local midnight. NULL follows
-- the player's profile time, so existing seats keep today's behavior.
ALTER TABLE "game_player"
  ADD COLUMN "reminder_minutes" INTEGER,
  ADD CONSTRAINT "game_player_reminder_minutes_range"
    CHECK ("reminder_minutes" IS NULL OR "reminder_minutes" BETWEEN 0 AND 1439);
