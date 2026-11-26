ALTER TABLE "health_post"
  ADD COLUMN "posted_card_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
