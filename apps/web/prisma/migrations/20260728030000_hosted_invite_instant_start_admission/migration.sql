ALTER TABLE "hosted_invite"
ADD COLUMN "instant_start_admission_event_id" TEXT;

CREATE INDEX "hosted_invite_member_id_instant_start_admission_event_id_idx"
ON "hosted_invite"("member_id", "instant_start_admission_event_id");
