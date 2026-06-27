ALTER TABLE "hosted_invite"
  ADD COLUMN "linq_first_contact_event_id" TEXT;

CREATE INDEX "hosted_invite_linq_first_contact_event_id_idx"
  ON "hosted_invite"("linq_first_contact_event_id");
