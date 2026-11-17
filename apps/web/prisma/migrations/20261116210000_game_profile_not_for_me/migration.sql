-- Activities a player never wants suggested in a game (About you, Not for
-- me), by key ("swimming"). The app and Murph write the whole list; readers
-- drop keys they don't know, so a new activity needs no migration.
ALTER TABLE "game_profile"
  ADD COLUMN "not_for_me" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
