ALTER TABLE "clinical_record_retrieval_run"
  ADD COLUMN "notification_token_version" INTEGER,
  ADD COLUMN "notification_setting_revision" INTEGER,
  ADD COLUMN "notification_route_key" TEXT,
  ADD COLUMN "notification_coverage" TEXT;
