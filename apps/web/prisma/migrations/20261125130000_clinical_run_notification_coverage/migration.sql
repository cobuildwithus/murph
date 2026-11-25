ALTER TABLE "clinical_record_retrieval_run"
  ADD COLUMN "notification_token_version" INTEGER,
  ADD COLUMN "notification_setting_revision" INTEGER,
  ADD COLUMN "notification_route_key" TEXT,
  ADD COLUMN "notification_coverage" TEXT,
  ADD CONSTRAINT "clinical_run_notification_fence" CHECK (
    ("notification_token_version" IS NULL AND "notification_setting_revision" IS NULL AND "notification_route_key" IS NULL AND "notification_coverage" IS NULL)
    OR ("notification_token_version" IS NOT NULL AND "notification_token_version" > 0
      AND "notification_setting_revision" IS NOT NULL AND "notification_setting_revision" >= 0
      AND "notification_route_key" IS NOT NULL AND "notification_route_key" ~ '^[0-9a-f]{64}$'
      AND ("notification_coverage" IS NULL OR "notification_coverage" IN ('proved', 'published', 'scheduled')))
  ) NOT VALID;
