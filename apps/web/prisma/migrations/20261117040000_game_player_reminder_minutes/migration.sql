-- A game's own reminder time, in minutes after local midnight. NULL follows
-- the player's profile time, so existing seats keep today's behavior. Only the
-- setReminders command writes it, and it accepts 0..1439.
ALTER TABLE "game_player" ADD COLUMN "reminder_minutes" INTEGER;
