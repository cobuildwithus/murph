-- Separate from the retired refresh_token_encrypted compatibility column,
-- which the older contract migration may still remove.
ALTER TABLE "clinical_record_connection"
  ADD COLUMN "persistent_token_encrypted" TEXT,
  ADD COLUMN "refresh_lease_id" TEXT,
  ADD COLUMN "refresh_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "next_sync_at" TIMESTAMP(3),
  ADD COLUMN "last_checked_at" TIMESTAMP(3);
CREATE INDEX "clinical_record_connection_status_next_sync_at_idx"
  ON "clinical_record_connection"("status", "next_sync_at");
