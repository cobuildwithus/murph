ALTER TABLE "hosted_sensitive_action_challenge"
  ADD COLUMN "consumed_at" TIMESTAMP(3),
  ADD COLUMN "consumed_by" TEXT;

ALTER TABLE "hosted_sensitive_action_challenge"
  ADD CONSTRAINT "hosted_sensitive_action_challenge_consumed_shape_check"
  CHECK (
    ("consumed_at" IS NULL AND "consumed_by" IS NULL)
    OR (
      "consumed_at" IS NOT NULL
      AND "consumed_by" IS NOT NULL
      AND "approval_status" = 'approved'
      AND "decided_at" IS NOT NULL
    )
  );
