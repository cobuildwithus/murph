CREATE TYPE "HostedPhysicalNoteFailureReason" AS ENUM (
  'recipient_address',
  'artwork',
  'service_unavailable',
  'request_invalid',
  'prior_note_unresolved',
  'prior_note_accepted',
  'unknown'
);

ALTER TABLE "hosted_physical_note"
  ADD COLUMN "failure_reason" "HostedPhysicalNoteFailureReason";

CREATE INDEX CONCURRENTLY "hosted_physical_note_member_id_status_failure_reason_created_at_idx"
  ON "hosted_physical_note"("member_id", "status", "failure_reason", "created_at");
