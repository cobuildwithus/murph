ALTER TABLE "hosted_member"
  DROP COLUMN IF EXISTS "onboarding_welcome_queued_at",
  DROP COLUMN IF EXISTS "onboarding_welcome_sent_at";

ALTER TABLE "hosted_invite"
  DROP COLUMN IF EXISTS "trigger_text",
  DROP COLUMN IF EXISTS "linq_event_id",
  DROP COLUMN IF EXISTS "linq_chat_id";
