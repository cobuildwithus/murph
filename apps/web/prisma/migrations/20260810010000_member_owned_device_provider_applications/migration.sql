BEGIN;

CREATE TABLE "device_provider_application" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "config_encrypted" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "device_provider_application_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_provider_application_revision_positive_check"
    CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "device_provider_application_member_id_provider_key"
  ON "device_provider_application"("member_id", "provider");

ALTER TABLE "device_provider_application"
  ADD CONSTRAINT "device_provider_application_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_connection"
  ADD COLUMN "provider_application_id" TEXT,
  ADD COLUMN "provider_application_revision" INTEGER;

CREATE INDEX "device_connection_provider_application_id_idx"
  ON "device_connection"("provider_application_id");

ALTER TABLE "device_connection"
  ADD CONSTRAINT "device_connection_provider_application_id_fkey"
  FOREIGN KEY ("provider_application_id") REFERENCES "device_provider_application"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "device_oauth_session"
  ADD COLUMN "provider_application_id" TEXT,
  ADD COLUMN "provider_application_revision" INTEGER;

CREATE INDEX "device_oauth_session_provider_application_id_idx"
  ON "device_oauth_session"("provider_application_id");

ALTER TABLE "device_oauth_session"
  ADD CONSTRAINT "device_oauth_session_provider_application_id_fkey"
  FOREIGN KEY ("provider_application_id") REFERENCES "device_provider_application"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_connection"
  ADD CONSTRAINT "device_connection_provider_application_revision_pair_check"
  CHECK (
    ("provider_application_id" IS NULL AND "provider_application_revision" IS NULL)
    OR
    ("provider_application_id" IS NOT NULL AND "provider_application_revision" IS NOT NULL AND "provider_application_revision" > 0)
  );

ALTER TABLE "device_oauth_session"
  ADD CONSTRAINT "device_oauth_session_provider_application_revision_pair_check"
  CHECK (
    ("provider_application_id" IS NULL AND "provider_application_revision" IS NULL)
    OR
    ("provider_application_id" IS NOT NULL AND "provider_application_revision" IS NOT NULL AND "provider_application_revision" > 0)
  );

COMMIT;
