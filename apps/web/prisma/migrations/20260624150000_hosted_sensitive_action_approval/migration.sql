CREATE TYPE "HostedSensitiveActionApprovalStatus" AS ENUM (
  'pending',
  'approved',
  'denied'
);

ALTER TABLE "hosted_sensitive_action_challenge"
  ADD COLUMN "approval_key" TEXT,
  ADD COLUMN "action_id" TEXT,
  ADD COLUMN "action_hash" TEXT,
  ADD COLUMN "presentation_title" TEXT,
  ADD COLUMN "presentation_body" TEXT,
  ADD COLUMN "approval_status" "HostedSensitiveActionApprovalStatus",
  ADD COLUMN "decided_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "hosted_sensitive_action_challenge_approval_key_key"
  ON "hosted_sensitive_action_challenge"("approval_key");
CREATE INDEX "hosted_sensitive_action_challenge_member_id_approval_status_expires_at_idx"
  ON "hosted_sensitive_action_challenge"("member_id", "approval_status", "expires_at");

ALTER TABLE "hosted_sensitive_action_challenge"
  ADD CONSTRAINT "hosted_sensitive_action_challenge_approval_shape_check"
  CHECK (
    (
      "kind" = 'assistant.action.approve'
      AND "approval_key" IS NOT NULL
      AND "action_id" IS NOT NULL
      AND "action_hash" IS NOT NULL
      AND "presentation_title" IS NOT NULL
      AND "presentation_body" IS NOT NULL
      AND "approval_status" IS NOT NULL
    )
    OR
    (
      "kind" <> 'assistant.action.approve'
      AND "approval_key" IS NULL
      AND "action_id" IS NULL
      AND "action_hash" IS NULL
      AND "presentation_title" IS NULL
      AND "presentation_body" IS NULL
      AND "approval_status" IS NULL
      AND "decided_at" IS NULL
    )
  ),
  ADD CONSTRAINT "hosted_sensitive_action_challenge_decision_shape_check"
  CHECK (
    "approval_status" IS NULL
    OR ("approval_status" = 'pending' AND "decided_at" IS NULL)
    OR ("approval_status" IN ('approved', 'denied') AND "decided_at" IS NOT NULL)
  );
