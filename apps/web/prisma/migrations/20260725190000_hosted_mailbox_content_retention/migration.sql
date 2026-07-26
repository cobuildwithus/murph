-- Phase one is additive only. Do not re-arm existing workspace snapshots here:
-- settled legacy snapshots may no longer retain a trustworthy receipt for
-- unstamped user transcript entries. A separate phase-two migration may re-arm
-- them only after 14 complete days of verified stamping-capable runner
-- convergence.
ALTER TABLE "hosted_mailbox_item"
ADD COLUMN "content_retired_at" TIMESTAMP(3),
ADD COLUMN "retention_disposition" TEXT;
