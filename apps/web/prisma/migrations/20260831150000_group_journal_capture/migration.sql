ALTER TABLE "hosted_member"
  ADD COLUMN "group_journal_capture_enabled" BOOLEAN,
  ADD COLUMN "group_journal_capture_consent_requested_at" TIMESTAMP(3);

ALTER TABLE "hosted_group_member"
  ADD COLUMN "journal_capture_disabled_at" TIMESTAMP(3);
