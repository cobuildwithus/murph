CREATE TABLE "hosted_account_deletion_cleanup" (
  "id" TEXT NOT NULL,
  "payload_ciphertext" TEXT NOT NULL,
  "kms_key_name" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "cloudflare_completed_at" TIMESTAMP(3),
  "stripe_completed_at" TIMESTAMP(3),
  "privy_completed_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL,
  "last_attempted_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_account_deletion_cleanup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hosted_account_deletion_cleanup_next_attempt_at_lease_expires_at_idx"
  ON "hosted_account_deletion_cleanup"("next_attempt_at", "lease_expires_at");
