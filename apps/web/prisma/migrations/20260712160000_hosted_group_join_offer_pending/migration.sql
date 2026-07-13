ALTER TABLE "hosted_group_join_offer"
  ALTER COLUMN "message_lookup_key" DROP NOT NULL;

ALTER TABLE "hosted_group_join_offer"
  ADD COLUMN "thread_identity_lookup_key" TEXT,
  ADD COLUMN "message_digest" TEXT;

CREATE INDEX "hosted_group_join_offer_pending_match_idx"
  ON "hosted_group_join_offer"(
    "thread_identity_lookup_key",
    "message_digest",
    "revoked_at",
    "posted_at"
  );
