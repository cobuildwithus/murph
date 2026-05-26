CREATE TABLE "device_sync_dirty_payload" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "dirty_revision" BIGINT NOT NULL,
  "resource_encrypted" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "device_sync_dirty_payload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_sync_dirty_payload_connection_id_fkey"
    FOREIGN KEY ("connection_id")
    REFERENCES "device_connection"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "device_sync_dirty_payload_connection_id_dirty_revision_idx"
  ON "device_sync_dirty_payload"("connection_id", "dirty_revision");

CREATE INDEX "device_sync_dirty_payload_user_id_connection_id_dirty_revision_idx"
  ON "device_sync_dirty_payload"("user_id", "connection_id", "dirty_revision");

CREATE INDEX "device_sync_dirty_payload_created_at_idx"
  ON "device_sync_dirty_payload"("created_at");
