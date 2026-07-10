CREATE TYPE "HostedPhoneCallTransferOutcome" AS ENUM ('cancelled', 'bridged');

ALTER TABLE "hosted_phone_call"
  ADD COLUMN "transfer_outcome" "HostedPhoneCallTransferOutcome";
