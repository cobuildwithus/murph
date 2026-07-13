CREATE TABLE "device_sync_companion_capture_receipt" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "envelope_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "device_sync_companion_capture_receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_sync_companion_capture_receipt_connection_id_fkey"
    FOREIGN KEY ("connection_id")
    REFERENCES "device_connection"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "device_sync_companion_capture_receipt_user_id_connection_id_created_at_idx"
  ON "device_sync_companion_capture_receipt"("user_id", "connection_id", "created_at");
