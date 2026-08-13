BEGIN;

CREATE TABLE "device_provider_setup" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "connect_source_id" TEXT NOT NULL,
  "connect_target" TEXT NOT NULL,
  "source_provider_slug" TEXT,
  "status" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "browser_run_id" TEXT,
  "provider_application_id" TEXT,
  "provider_application_revision" INTEGER,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "device_provider_setup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_provider_setup_member_provider_active_key"
  ON "device_provider_setup"("member_id", "provider")
  WHERE "active" = TRUE;

CREATE INDEX "device_provider_setup_member_provider_updated_idx"
  ON "device_provider_setup"("member_id", "provider", "updated_at");
CREATE INDEX "device_provider_setup_provider_application_id_idx"
  ON "device_provider_setup"("provider_application_id");
CREATE INDEX "device_provider_setup_browser_run_id_idx"
  ON "device_provider_setup"("browser_run_id");

ALTER TABLE "device_provider_setup"
  ADD CONSTRAINT "device_provider_setup_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_provider_setup"
  ADD CONSTRAINT "device_provider_setup_browser_run_id_fkey"
  FOREIGN KEY ("browser_run_id") REFERENCES "hosted_computer_run"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "device_provider_setup"
  ADD CONSTRAINT "device_provider_setup_provider_application_id_fkey"
  FOREIGN KEY ("provider_application_id") REFERENCES "device_provider_application"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_computer_run"
  ADD COLUMN "owner_purpose" TEXT,
  ADD COLUMN "owner_key" TEXT;

CREATE INDEX "hosted_computer_run_member_owner_status_idx"
  ON "hosted_computer_run"("member_id", "owner_purpose", "owner_key", "status");

ALTER TABLE "device_connect_intent"
  ADD COLUMN "provider_setup_id" TEXT;

CREATE INDEX "device_connect_intent_provider_setup_id_idx"
  ON "device_connect_intent"("provider_setup_id");

ALTER TABLE "device_connect_intent"
  ADD CONSTRAINT "device_connect_intent_provider_setup_id_fkey"
  FOREIGN KEY ("provider_setup_id") REFERENCES "device_provider_setup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
