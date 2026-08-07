ALTER TABLE "hosted_meal_photo_capture_enrollment"
ALTER COLUMN "upload_token_hash" DROP NOT NULL,
ALTER COLUMN "idempotency_secret_encrypted" DROP NOT NULL,
ALTER COLUMN "expires_at" DROP NOT NULL;

ALTER TABLE "hosted_meal_photo_capture_enrollment"
ADD COLUMN "authority_revision" INTEGER DEFAULT 0,
ADD COLUMN "activated_at" TIMESTAMP(3);
