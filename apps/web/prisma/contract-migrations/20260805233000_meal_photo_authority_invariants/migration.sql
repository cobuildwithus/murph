-- Run only after the fence-aware Web deployment is live and the prior
-- function window has drained. Older Web revocation code retained credential
-- material on revoked rows and would violate the credential-shape constraint.
UPDATE "hosted_meal_photo_capture_enrollment"
SET "activated_at" = "created_at"
WHERE "authority_revision" = 0
  AND "revoked_at" IS NULL
  AND "activated_at" IS NULL;

UPDATE "hosted_meal_photo_capture_enrollment"
SET
  "upload_token_hash" = NULL,
  "idempotency_secret_encrypted" = NULL,
  "expires_at" = NULL,
  "activated_at" = NULL
WHERE "revoked_at" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hosted_meal_photo_capture_enrollment"
    WHERE "authority_revision" IS NULL
      OR (
        "revoked_at" IS NULL
        AND (
          "upload_token_hash" IS NULL
          OR "idempotency_secret_encrypted" IS NULL
          OR "expires_at" IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce meal-photo authority invariants while a revision or active credential set is incomplete.'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

ALTER TABLE "hosted_meal_photo_capture_enrollment"
  ALTER COLUMN "authority_revision" SET NOT NULL,
  ADD CONSTRAINT "hosted_meal_photo_capture_enrollment_authority_revision_check"
    CHECK ("authority_revision" BETWEEN 0 AND 2147483647) NOT VALID,
  ADD CONSTRAINT "hosted_meal_photo_capture_enrollment_credential_shape_check"
    CHECK (
      (
        "revoked_at" IS NULL
        AND "upload_token_hash" IS NOT NULL
        AND "idempotency_secret_encrypted" IS NOT NULL
        AND "expires_at" IS NOT NULL
        AND (
          "authority_revision" > 0
          OR "activated_at" IS NOT NULL
        )
      )
      OR
      (
        "revoked_at" IS NOT NULL
        AND "upload_token_hash" IS NULL
        AND "idempotency_secret_encrypted" IS NULL
        AND "expires_at" IS NULL
        AND "activated_at" IS NULL
      )
    ) NOT VALID;

ALTER TABLE "hosted_meal_photo_capture_enrollment"
  VALIDATE CONSTRAINT "hosted_meal_photo_capture_enrollment_authority_revision_check",
  VALIDATE CONSTRAINT "hosted_meal_photo_capture_enrollment_credential_shape_check";
