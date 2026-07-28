ALTER TABLE "hosted_sensitive_action_challenge"
  ADD COLUMN "presentation_title_encrypted" TEXT,
  ADD COLUMN "presentation_body_encrypted" TEXT;

ALTER TABLE "hosted_sensitive_action_challenge"
  DROP CONSTRAINT "hosted_sensitive_action_challenge_approval_shape_check";

-- This expand constraint is backward compatible during the old-function drain:
-- old code may write the plaintext-only form and new code writes the
-- encrypted-only form. Mixed or empty presentation storage is never accepted.
-- The postdeploy contract migration invalidates drain-window plaintext
-- connected-app approvals and installs the encrypted-only final constraint.
ALTER TABLE "hosted_sensitive_action_challenge"
  ADD CONSTRAINT "hosted_sensitive_action_challenge_approval_shape_check"
  CHECK (
    (
      "kind" = 'assistant.action.approve'
      AND "approval_key" IS NOT NULL
      AND "action_id" IS NOT NULL
      AND "action_hash" IS NOT NULL
      AND "approval_status" IS NOT NULL
      AND (
        (
          "action_id" LIKE 'connected-app:%'
          AND (
            (
              "presentation_title" IS NOT NULL
              AND "presentation_body" IS NOT NULL
              AND "presentation_title_encrypted" IS NULL
              AND "presentation_body_encrypted" IS NULL
            )
            OR
            (
              "presentation_title" IS NULL
              AND "presentation_body" IS NULL
              AND "presentation_title_encrypted" IS NOT NULL
              AND "presentation_body_encrypted" IS NOT NULL
            )
          )
        )
        OR
        (
          "action_id" NOT LIKE 'connected-app:%'
          AND "presentation_title" IS NOT NULL
          AND "presentation_body" IS NOT NULL
          AND "presentation_title_encrypted" IS NULL
          AND "presentation_body_encrypted" IS NULL
        )
      )
    )
    OR
    (
      "kind" <> 'assistant.action.approve'
      AND "approval_key" IS NULL
      AND "action_id" IS NULL
      AND "action_hash" IS NULL
      AND "presentation_title" IS NULL
      AND "presentation_body" IS NULL
      AND "presentation_title_encrypted" IS NULL
      AND "presentation_body_encrypted" IS NULL
      AND "approval_status" IS NULL
      AND "decided_at" IS NULL
    )
  );
