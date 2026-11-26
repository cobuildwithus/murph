ALTER TABLE "health_post" ADD COLUMN "game_id" TEXT;

-- DropIndex
DROP INDEX "health_post_author_member_id_deleted_at_created_at_id_idx";

-- CreateIndex
CREATE INDEX "health_post_author_member_id_deleted_at_created_at_id_game__idx" ON "health_post"("author_member_id", "deleted_at", "created_at" DESC, "id" DESC, "game_id");

CREATE UNIQUE INDEX "health_post_live_payoff" ON "health_post" ("game_id")
  WHERE "game_id" IS NOT NULL AND "deleted_at" IS NULL;
