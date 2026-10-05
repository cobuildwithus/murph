ALTER TABLE "device_sync_dirty_connection" ADD COLUMN "wake_deferred_until" TIMESTAMP(3);

CREATE INDEX "device_sync_dirty_connection_wake_deferred_until_idx" ON "device_sync_dirty_connection"("wake_deferred_until");
