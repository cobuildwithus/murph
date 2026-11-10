-- Reader-first control state. No producer is enabled by this migration.
CREATE TABLE "hosted_linq_group_line_move" (
  "id" TEXT PRIMARY KEY,
  "container_member_id" TEXT NOT NULL REFERENCES "hosted_thread_container"("member_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "from_account_lookup_key" TEXT NOT NULL,
  "to_account_lookup_key" TEXT NOT NULL,
  "from_thread_identity_lookup_key" TEXT NOT NULL,
  "to_thread_identity_lookup_key" TEXT,
  "source_cleanup_encrypted" TEXT NOT NULL,
  "notice_text_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "adoption_deadline_at" TIMESTAMP(3) NOT NULL,
  "add_started_at" TIMESTAMP(3),
  "add_confirmed_at" TIMESTAMP(3),
  "notice_sent_at" TIMESTAMP(3),
  "adopted_at" TIMESTAMP(3),
  "leave_confirmed_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "linq_group_move_status_check" CHECK ("status" IN ('reserved', 'adopted', 'left', 'cancelled')),
  CONSTRAINT "linq_group_move_adoption_check" CHECK (
    ("status" IN ('adopted', 'left') AND "to_thread_identity_lookup_key" IS NOT NULL AND "adopted_at" IS NOT NULL)
    OR ("status" IN ('reserved', 'cancelled') AND "to_thread_identity_lookup_key" IS NULL AND "adopted_at" IS NULL)
  ),
  CONSTRAINT "linq_group_move_lines_check" CHECK ("from_account_lookup_key" <> "to_account_lookup_key")
);
CREATE UNIQUE INDEX "linq_group_move_reserved_target_key" ON "hosted_linq_group_line_move" ("to_account_lookup_key") WHERE "status" = 'reserved';
CREATE UNIQUE INDEX "linq_group_move_reserved_source_key" ON "hosted_linq_group_line_move" ("from_thread_identity_lookup_key") WHERE "status" = 'reserved';
CREATE INDEX "linq_group_move_source_idx" ON "hosted_linq_group_line_move" ("from_thread_identity_lookup_key", "status");
CREATE INDEX "linq_group_move_destination_idx" ON "hosted_linq_group_line_move" ("to_thread_identity_lookup_key", "status");
CREATE INDEX "linq_group_move_target_idx" ON "hosted_linq_group_line_move" ("to_account_lookup_key", "status");
CREATE INDEX "linq_group_move_container_idx" ON "hosted_linq_group_line_move" ("container_member_id", "status");
