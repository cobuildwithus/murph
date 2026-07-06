ALTER TABLE "hosted_group"
  ADD COLUMN "join_offer_message_lookup_key" TEXT,
  ADD COLUMN "join_offer_message_id_suffix" TEXT,
  ADD COLUMN "join_offer_projection_kinds_json" JSONB,
  ADD COLUMN "join_offer_posted_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "hosted_group_join_offer_message_lookup_key_key"
  ON "hosted_group"("join_offer_message_lookup_key");
