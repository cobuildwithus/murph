-- The production runner reaches this migration only after the new deployment
-- is live and the prior function window has drained. Connected-app approvals
-- are short-lived, so invalidate old plaintext rows instead of copying private
-- provider content or requiring member-key access in SQL.
DELETE FROM "hosted_sensitive_action_challenge"
WHERE "kind" = 'assistant.action.approve'
  AND "action_id" LIKE 'connected-app:%'
  AND "presentation_title_encrypted" IS NULL
  AND "presentation_body_encrypted" IS NULL;

ALTER TABLE "hosted_sensitive_action_challenge"
  DROP CONSTRAINT "hosted_sensitive_action_challenge_approval_shape_check";

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
          AND "presentation_title" IS NULL
          AND "presentation_body" IS NULL
          AND "presentation_title_encrypted" IS NOT NULL
          AND "presentation_body_encrypted" IS NOT NULL
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
