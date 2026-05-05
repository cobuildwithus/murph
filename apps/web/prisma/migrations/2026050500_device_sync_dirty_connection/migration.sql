CREATE TABLE "device_sync_dirty_connection" (
  "connection_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "dirty_revision" BIGINT NOT NULL DEFAULT 0,
  "processed_revision" BIGINT NOT NULL DEFAULT 0,
  "first_dirty_at" TIMESTAMPTZ NOT NULL,
  "latest_dirty_at" TIMESTAMPTZ NOT NULL,
  "window_start" TIMESTAMPTZ,
  "window_end" TIMESTAMPTZ,
  "event_count" BIGINT NOT NULL DEFAULT 0,
  "latest_trace_id" TEXT,
  "latest_event_type" TEXT,
  "latest_resource_category" TEXT,
  "source_provider_counts_json" JSONB,
  "resource_category_counts_json" JSONB,
  "dirty_resources_json" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "device_sync_dirty_connection_pkey" PRIMARY KEY ("connection_id"),
  CONSTRAINT "device_sync_dirty_connection_connection_id_fkey"
    FOREIGN KEY ("connection_id")
    REFERENCES "device_connection"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "device_sync_dirty_connection_user_id_provider_idx"
  ON "device_sync_dirty_connection"("user_id", "provider");

CREATE INDEX "device_sync_dirty_connection_user_id_dirty_revision_processed_revision_idx"
  ON "device_sync_dirty_connection"("user_id", "dirty_revision", "processed_revision");

CREATE INDEX "device_sync_dirty_connection_user_id_first_dirty_at_connection_id_idx"
  ON "device_sync_dirty_connection"("user_id", "first_dirty_at", "connection_id");

CREATE INDEX "device_sync_dirty_connection_latest_dirty_at_idx"
  ON "device_sync_dirty_connection"("latest_dirty_at");
