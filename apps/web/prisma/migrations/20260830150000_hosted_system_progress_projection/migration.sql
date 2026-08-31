ALTER TABLE "hosted_workspace"
ADD COLUMN "next_default_processing_wake_at" TIMESTAMP(3),
ADD COLUMN "next_default_processing_wake_reason" TEXT,
ADD COLUMN "system_mailbox_progress_generation" BIGINT;
