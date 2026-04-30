CREATE TABLE "device_connection_source" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "source_instance_key" TEXT NOT NULL,
  "source_provider_slug" TEXT NOT NULL,
  "display_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'connected',
  "resource_availability_summary_json" JSONB,
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "device_connection_source_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "device_connection_source"
  ADD CONSTRAINT "device_connection_source_instance_key_check"
  CHECK ("source_instance_key" ~ '^[a-z0-9][a-z0-9_-]{0,127}$');

ALTER TABLE "device_connection_source"
  ADD CONSTRAINT "device_connection_source_provider_slug_check"
  CHECK ("source_provider_slug" ~ '^[a-z0-9][a-z0-9_-]{0,79}$');

ALTER TABLE "device_connection_source"
  ADD CONSTRAINT "device_connection_source_status_check"
  CHECK ("status" IN ('connected', 'unavailable', 'error', 'disconnected'));

ALTER TABLE "device_connection_source"
  ADD CONSTRAINT "device_connection_source_display_name_length_check"
  CHECK ("display_name" IS NULL OR char_length("display_name") <= 120);

ALTER TABLE "device_connection_source"
  ADD CONSTRAINT "device_connection_source_last_error_code_length_check"
  CHECK ("last_error_code" IS NULL OR char_length("last_error_code") <= 80);

ALTER TABLE "device_connection_source"
  ADD CONSTRAINT "device_connection_source_last_error_message_length_check"
  CHECK ("last_error_message" IS NULL OR char_length("last_error_message") <= 240);

ALTER TABLE "device_connection_source"
  ADD CONSTRAINT "device_connection_source_resource_summary_shape_check"
  CHECK (
    "resource_availability_summary_json" IS NULL
    OR jsonb_typeof("resource_availability_summary_json") = 'object'
  );

CREATE UNIQUE INDEX "device_connection_source_connection_id_source_instance_key_key"
  ON "device_connection_source"("connection_id", "source_instance_key");

CREATE INDEX "device_connection_source_list_idx"
  ON "device_connection_source"("connection_id", "last_seen_at" DESC, "source_provider_slug", "source_instance_key");

CREATE INDEX "device_connection_source_connection_id_status_idx"
  ON "device_connection_source"("connection_id", "status");

ALTER TABLE "device_connection_source"
  ADD CONSTRAINT "device_connection_source_connection_id_fkey"
  FOREIGN KEY ("connection_id")
  REFERENCES "device_connection"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
