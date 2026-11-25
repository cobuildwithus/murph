-- Everyone is opt-in. Existing profiles stay off the board; leaving clears consent.
ALTER TABLE "game_profile" ADD COLUMN "everyone_joined_at" TIMESTAMPTZ;
