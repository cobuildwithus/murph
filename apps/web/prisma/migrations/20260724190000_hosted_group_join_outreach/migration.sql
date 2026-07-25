CREATE TABLE "hosted_group_join_outreach" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "offer_id" TEXT NOT NULL,
  "participant_phone_lookup_key" TEXT NOT NULL,
  "participant_phone_encrypted" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL,
  "next_attempt_at" TIMESTAMP(3) NOT NULL,
  "dispatch_started_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "phone_number_lookup_key" TEXT,
  "linq_chat_lookup_key" TEXT,
  "sent_at" TIMESTAMP(3),
  "replied_at" TIMESTAMP(3),
  "skipped_at" TIMESTAMP(3),
  "skip_reason" TEXT,
  "last_deferred_at" TIMESTAMP(3),
  "last_deferral_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_group_join_outreach_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_group_join_outreach_offer_participant_key"
  ON "hosted_group_join_outreach"(
    "offer_id",
    "participant_phone_lookup_key"
  );

CREATE INDEX "hosted_group_join_outreach_due_idx"
  ON "hosted_group_join_outreach"(
    "sent_at",
    "skipped_at",
    "next_attempt_at",
    "requested_at"
  );

CREATE INDEX "hosted_group_join_outreach_participant_attempt_idx"
  ON "hosted_group_join_outreach"(
    "participant_phone_lookup_key",
    "dispatch_started_at",
    "sent_at"
  );

CREATE INDEX "hosted_group_join_outreach_chat_idx"
  ON "hosted_group_join_outreach"("linq_chat_lookup_key", "sent_at");

ALTER TABLE "hosted_group_join_outreach"
  ADD CONSTRAINT "hosted_group_join_outreach_phone_number_lookup_key_fkey"
  FOREIGN KEY ("phone_number_lookup_key")
  REFERENCES "hosted_linq_line"("phone_number_lookup_key")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
