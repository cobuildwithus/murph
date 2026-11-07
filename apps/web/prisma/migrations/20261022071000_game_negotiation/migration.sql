-- Negotiation claims both seats without starting either player's obligations.
-- The existing unique pair key reserves negotiating and live games alike.
ALTER TABLE "game" DROP CONSTRAINT IF EXISTS "game_status_check";
ALTER TABLE "game" ADD CONSTRAINT "game_status_check"
  CHECK ("status" IN ('invited', 'negotiating', 'live', 'settled', 'void')) NOT VALID;
ALTER TABLE "game" VALIDATE CONSTRAINT "game_status_check";

ALTER TABLE "game" DROP CONSTRAINT IF EXISTS "game_live_roster_check";
ALTER TABLE "game" ADD CONSTRAINT "game_live_roster_check"
  CHECK (("live_roster_key" IS NULL) = ("status" NOT IN ('negotiating', 'live'))) NOT VALID;
ALTER TABLE "game" VALIDATE CONSTRAINT "game_live_roster_check";
