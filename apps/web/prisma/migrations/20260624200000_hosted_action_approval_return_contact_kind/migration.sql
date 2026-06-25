ALTER TABLE "hosted_sensitive_action_challenge"
  ADD COLUMN "return_contact_kind" TEXT;

ALTER TABLE "hosted_sensitive_action_challenge"
  ADD CONSTRAINT "hosted_sensitive_action_challenge_return_contact_kind_check"
  CHECK (
    "return_contact_kind" IS NULL
    OR "return_contact_kind" IN ('text', 'telegram', 'email')
  );
