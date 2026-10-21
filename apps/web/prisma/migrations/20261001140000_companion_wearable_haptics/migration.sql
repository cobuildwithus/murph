CREATE TABLE "companion_wearable_session" (
  "user_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "wearable" TEXT NOT NULL CHECK ("wearable" IN ('whoop', 'garmin')),
  "session_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("user_id", "wearable")
);
CREATE TABLE "companion_wearable_command" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "wearable" TEXT NOT NULL CHECK ("wearable" IN ('whoop', 'garmin')),
  "session_id" TEXT,
  "operation" TEXT NOT NULL CHECK ("operation" IN ('buzz', 'stop')),
  "status" TEXT NOT NULL CHECK ("status" IN ('unavailable', 'queued', 'claimed', 'acknowledged', 'unknown', 'cancelled')),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "companion_wearable_command_pending_idx"
  ON "companion_wearable_command" ("user_id", "wearable", "session_id", "status", "expires_at");
