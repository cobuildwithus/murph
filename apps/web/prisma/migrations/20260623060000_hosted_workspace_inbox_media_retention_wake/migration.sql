ALTER TABLE "hosted_workspace"
  ADD COLUMN "inbox_media_retention_wake_at" TIMESTAMP(3);

UPDATE "hosted_workspace"
SET "inbox_media_retention_wake_at" = CURRENT_TIMESTAMP
WHERE "inbox_media_retention_wake_at" IS NULL;
