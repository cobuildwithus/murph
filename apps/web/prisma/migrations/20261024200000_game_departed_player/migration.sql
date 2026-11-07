-- A player who deletes their account leaves; the other player keeps the game
-- and its tickets as history. Account deletion clears these references before
-- removing the member, so the existing cascades never reach kept rows.
ALTER TABLE "game" ADD COLUMN "departed_player" JSONB;
ALTER TABLE "game" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "game_ticket" ALTER COLUMN "owed_by" DROP NOT NULL;
ALTER TABLE "game_ticket" ALTER COLUMN "owed_to" DROP NOT NULL;
