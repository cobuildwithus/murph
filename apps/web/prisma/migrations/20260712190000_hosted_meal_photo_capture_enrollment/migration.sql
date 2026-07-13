CREATE TABLE "hosted_meal_photo_capture_enrollment" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "installation_id_hash" TEXT NOT NULL,
    "upload_token_hash" TEXT NOT NULL,
    "idempotency_secret_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_meal_photo_capture_enrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_meal_photo_capture_enrollment_upload_token_hash_key"
ON "hosted_meal_photo_capture_enrollment"("upload_token_hash");

CREATE UNIQUE INDEX "hosted_meal_photo_capture_enrollment_member_id_installation_id_hash_key"
ON "hosted_meal_photo_capture_enrollment"("member_id", "installation_id_hash");

CREATE INDEX "hosted_meal_photo_capture_enrollment_member_id_revoked_at_expires_at_idx"
ON "hosted_meal_photo_capture_enrollment"("member_id", "revoked_at", "expires_at");

CREATE INDEX "hosted_meal_photo_capture_enrollment_expires_at_idx"
ON "hosted_meal_photo_capture_enrollment"("expires_at");

ALTER TABLE "hosted_meal_photo_capture_enrollment"
ADD CONSTRAINT "hosted_meal_photo_capture_enrollment_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
