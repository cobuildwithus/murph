ALTER TABLE "game_profile"
  ADD COLUMN "reminder_minutes" INTEGER NOT NULL DEFAULT 1140,
  ADD COLUMN "reminder_push" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reminder_text" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "game_player" ADD COLUMN "reminder_off" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companion_push_route" ADD COLUMN "game_reminders" BOOLEAN NOT NULL DEFAULT false;
