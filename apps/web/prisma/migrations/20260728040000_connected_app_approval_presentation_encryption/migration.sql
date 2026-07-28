ALTER TABLE "hosted_sensitive_action_challenge"
  ADD COLUMN "presentation_title_encrypted" TEXT,
  ADD COLUMN "presentation_body_encrypted" TEXT;

ALTER TABLE "hosted_sensitive_action_challenge"
  DROP CONSTRAINT "hosted_sensitive_action_challenge_approval_shape_check";

-- Connected-app approvals and their encrypted presentation storage ship
-- together. The previously deployed Web producer writes only non-connected
-- plaintext approvals, which remain valid under this final constraint.
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
