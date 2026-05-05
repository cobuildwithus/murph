ALTER TABLE "hosted_member_routing"
  ADD COLUMN "pending_linq_participant_contact_kind" TEXT,
  ADD COLUMN "pending_linq_participant_contact_lookup_key" TEXT,
  ADD COLUMN "pending_linq_participant_contact_encrypted" TEXT,
  ADD COLUMN "pending_linq_participant_contact_observed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "hosted_member_routing_pending_linq_participant_contact_lookup_key_key"
  ON "hosted_member_routing"("pending_linq_participant_contact_lookup_key");
