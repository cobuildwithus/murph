ALTER TABLE "hosted_sensitive_action_challenge"
  ADD COLUMN "consumed_at" TIMESTAMP(3);

ALTER TABLE "hosted_sensitive_action_challenge"
  ADD CONSTRAINT "hosted_sensitive_action_challenge_consumed_shape_check"
  CHECK (
    "consumed_at" IS NULL
    OR ("approval_status" = 'approved' AND "decided_at" IS NOT NULL)
  );
