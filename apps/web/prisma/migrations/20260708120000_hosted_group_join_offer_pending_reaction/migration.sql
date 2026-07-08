CREATE TABLE "hosted_group_join_offer_pending_reaction" (
  "event_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "message_lookup_key" TEXT NOT NULL,
  "message_lookup_key_candidates_json" JSONB NOT NULL,
  "thread_identity_lookup_key_candidates_json" JSONB NOT NULL,
  "provider_created_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_group_join_offer_pending_reaction_pkey" PRIMARY KEY ("event_id")
);

CREATE INDEX "hgrp_pending_reaction_message_idx"
  ON "hosted_group_join_offer_pending_reaction"("message_lookup_key", "accepted_at", "provider_created_at");

CREATE INDEX "hgrp_pending_reaction_open_idx"
  ON "hosted_group_join_offer_pending_reaction"("accepted_at", "provider_created_at");

CREATE INDEX "hgrp_pending_reaction_member_idx"
  ON "hosted_group_join_offer_pending_reaction"("member_id", "accepted_at");

ALTER TABLE "hosted_group_join_offer_pending_reaction"
  ADD CONSTRAINT "hosted_group_join_offer_pending_reaction_member_id_fkey"
  FOREIGN KEY ("member_id")
  REFERENCES "hosted_member"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
