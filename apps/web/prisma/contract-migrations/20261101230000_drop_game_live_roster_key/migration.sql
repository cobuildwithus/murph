-- Run only after the derived-pair Web deployment has converged.
ALTER TABLE "game" DROP COLUMN IF EXISTS "live_roster_key";
