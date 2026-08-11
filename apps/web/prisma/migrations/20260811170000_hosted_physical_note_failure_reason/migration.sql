CREATE TYPE "HostedPhysicalNoteFailureReason" AS ENUM (
  'recipient_address',
  'artwork',
  'service_unavailable',
  'request_invalid',
  'unknown'
);

ALTER TABLE "hosted_physical_note"
  ADD COLUMN "failure_reason" "HostedPhysicalNoteFailureReason";
