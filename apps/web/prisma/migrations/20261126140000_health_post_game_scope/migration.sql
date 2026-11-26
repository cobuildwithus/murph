ALTER TABLE "health_post" ADD COLUMN "game_id" TEXT;

CREATE UNIQUE INDEX "health_post_live_payoff" ON "health_post" ("game_id")
  WHERE "game_id" IS NOT NULL AND "deleted_at" IS NULL;
