CREATE TABLE "hosted_group_join_outreach" (
  "id" TEXT NOT NULL,
  "offer_id" TEXT NOT NULL,
  "participant_phone_lookup_key" TEXT NOT NULL,
  "participant_phone_encrypted" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL,
  "next_attempt_at" TIMESTAMP(3) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
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
    "next_attempt_at",
    "requested_at"
  );

CREATE INDEX "hosted_group_join_outreach_participant_due_idx"
  ON "hosted_group_join_outreach"(
    "participant_phone_lookup_key",
    "next_attempt_at"
  );

ALTER TABLE "hosted_group_join_outreach"
  ADD CONSTRAINT "hosted_group_join_outreach_offer_id_fkey"
  FOREIGN KEY ("offer_id")
  REFERENCES "hosted_group_join_offer"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "hosted_linq_delivery"
  ADD COLUMN "group_join_outreach_id" TEXT,
  ADD COLUMN "group_join_reply_occurred_at" TIMESTAMP(3);

CREATE INDEX "hosted_linq_delivery_group_join_outreach_status_idx"
  ON "hosted_linq_delivery"(
    "group_join_outreach_id",
    "status",
    "attempted_at"
  );

ALTER TABLE "hosted_linq_delivery"
  ADD CONSTRAINT "hosted_linq_delivery_group_join_outreach_id_fkey"
  FOREIGN KEY ("group_join_outreach_id")
  REFERENCES "hosted_group_join_outreach"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "hosted_linq_provider_event"
  ADD COLUMN "group_join_offer_handled_at" TIMESTAMP(3);
