-- Existing writers advance attempts on every claim. Adding released_claims to it
-- keeps the claim fence increasing even when a skipped attempt is refunded.
ALTER TABLE "game_place_art"
  ADD COLUMN "released_claims" INTEGER NOT NULL DEFAULT 0,
  DROP CONSTRAINT "game_place_art_status_check",
  ADD CONSTRAINT "game_place_art_status_check" CHECK ("status" IN ('making', 'ready', 'failed', 'available')) NOT VALID;
ALTER TABLE "game_place_art" VALIDATE CONSTRAINT "game_place_art_status_check";

CREATE TABLE "game_area_art_member_budget" (
  "member_id" TEXT PRIMARY KEY REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "day" DATE NOT NULL,
  "attempts" INTEGER NOT NULL
);
