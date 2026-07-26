CREATE TABLE "hosted_account_deletion_cleanup" (
  "id" TEXT NOT NULL,
  "payload_ciphertext" TEXT NOT NULL,
  "kms_key_name" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "cloudflare_completed_at" TIMESTAMP(3),
  "stripe_completed_at" TIMESTAMP(3),
  "privy_completed_at" TIMESTAMP(3),
  "next_attempt_at" TIMESTAMP(3) NOT NULL,
  "last_attempted_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_account_deletion_cleanup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hosted_account_deletion_cleanup_next_attempt_at_created_at_idx"
  ON "hosted_account_deletion_cleanup"("next_attempt_at", "created_at");
