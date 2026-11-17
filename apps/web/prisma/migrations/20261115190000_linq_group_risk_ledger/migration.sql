ALTER TABLE "hosted_linq_group_leave"
  ADD COLUMN "provider_leave_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provider_leave_last_attempt_at" TIMESTAMP(3),
  ADD COLUMN "provider_removed_at" TIMESTAMP(3),
  ADD COLUMN "provider_leave_terminal_code" VARCHAR(32),
  DROP CONSTRAINT "hosted_linq_group_leave_reason_check",
  ADD CONSTRAINT "hosted_linq_group_leave_reason_check"
    CHECK ("reason" IN ('oversized', 'operator_cleanup', 'assistant', 'blocked_participant')) NOT VALID;
ALTER TABLE "hosted_linq_group_leave" VALIDATE CONSTRAINT "hosted_linq_group_leave_reason_check";
CREATE INDEX "hosted_linq_group_leave_retry_idx" ON "hosted_linq_group_leave" ("provider_leave_last_attempt_at")
  WHERE "provider_removed_at" IS NULL AND "provider_leave_terminal_code" IS NULL;

CREATE TABLE "hosted_linq_group_sighting" (
  "chat_lookup_key" TEXT PRIMARY KEY,
  "line_lookup_key" TEXT,
  "first_observed_at" TIMESTAMP(3) NOT NULL,
  "last_observed_at" TIMESTAMP(3) NOT NULL,
  "provider_chat_created_at" TIMESTAMP(3),
  "service" VARCHAR(16),
  "roster_handle_count" INTEGER,
  "roster_complete" BOOLEAN NOT NULL DEFAULT false,
  "roster_observed_at" TIMESTAMP(3),
  "leave_marker_key" TEXT REFERENCES "hosted_linq_group_leave" ("thread_identity_lookup_key") ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX "hosted_linq_group_sighting_leave_marker_key_idx" ON "hosted_linq_group_sighting" ("leave_marker_key");
CREATE INDEX "hosted_linq_group_sighting_last_observed_at_idx" ON "hosted_linq_group_sighting" ("last_observed_at");
CREATE TABLE "hosted_linq_group_handle" (
  "chat_lookup_key" TEXT NOT NULL REFERENCES "hosted_linq_group_sighting" ("chat_lookup_key") ON UPDATE CASCADE ON DELETE CASCADE,
  "handle_lookup_key" TEXT NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "first_seen_via" VARCHAR(24) NOT NULL CHECK ("first_seen_via" IN ('roster', 'participant_added', 'sender')),
  "first_sent_at" TIMESTAMP(3),
  PRIMARY KEY ("chat_lookup_key", "handle_lookup_key")
);
CREATE INDEX "hosted_linq_group_handle_handle_lookup_key_chat_lookup_key_idx" ON "hosted_linq_group_handle" ("handle_lookup_key", "chat_lookup_key");
CREATE INDEX "hosted_linq_group_handle_last_seen_at_idx" ON "hosted_linq_group_handle" ("last_seen_at");
CREATE TABLE "hosted_linq_handle_block" (
  "contact_lookup_key" TEXT PRIMARY KEY,
  "contact_kind" VARCHAR(8) NOT NULL CHECK ("contact_kind" IN ('phone', 'email')),
  "contact_encrypted" TEXT NOT NULL,
  "reason" VARCHAR(16) NOT NULL CHECK ("reason" IN ('bot_ring', 'spam', 'abuse', 'operator')),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
