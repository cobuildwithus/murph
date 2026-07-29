-- Preserve the Junction source that produced each webhook receipt so companion
-- clients can render source-scoped sync truth (Apple Health vs Health Connect).
ALTER TABLE "device_sync_signal"
ADD COLUMN "source_provider_slug" TEXT;

CREATE INDEX "device_sync_signal_user_source_idx" ON "device_sync_signal"("user_id", "source_provider_slug", "id");
