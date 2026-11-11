-- Run after the Web deployment removing the unused field is live and drained.
ALTER TABLE "hosted_computer_run" DROP COLUMN IF EXISTS "awaiting_message";
