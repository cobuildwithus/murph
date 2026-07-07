CREATE TABLE "hosted_group_join_offer" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "message_lookup_key" TEXT NOT NULL,
  "message_id_suffix" TEXT,
  "projection_kinds_json" JSONB NOT NULL,
  "posted_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "hosted_group_join_offer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_group_join_offer_message_lookup_key_key"
  ON "hosted_group_join_offer"("message_lookup_key");

CREATE INDEX "hosted_group_join_offer_group_id_revoked_at_posted_at_idx"
  ON "hosted_group_join_offer"("group_id", "revoked_at", "posted_at");

ALTER TABLE "hosted_group_join_offer"
  ADD CONSTRAINT "hosted_group_join_offer_group_id_fkey"
  FOREIGN KEY ("group_id")
  REFERENCES "hosted_group"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
