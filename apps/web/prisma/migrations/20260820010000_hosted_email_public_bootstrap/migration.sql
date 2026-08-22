-- Public-address email is an unauthenticated bootstrap hint only. Its durable
-- attempt owner rate-limits provider entry and makes ambiguous delivery
-- terminal. Reply-alias generations revoke capabilities when verified email
-- identity rotates.
ALTER TABLE "hosted_member_routing"
  ADD COLUMN "reply_alias_generation" INTEGER;

CREATE TYPE "HostedEmailPublicBootstrapAttemptStatus" AS ENUM (
  'claimed',
  'sending',
  'sent',
  'ambiguous',
  'failed',
  'abandoned'
);

CREATE TABLE "hosted_email_public_bootstrap_attempt" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "candidate_email_lookup_key" TEXT NOT NULL,
  "status" "HostedEmailPublicBootstrapAttemptStatus" NOT NULL,
  "claimed_at" TIMESTAMP(3) NOT NULL,
  "provider_entry_at" TIMESTAMP(3),
  "provider_message_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_email_public_bootstrap_attempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hosted_email_public_bootstrap_attempt_member_id_claimed_at_id_idx"
  ON "hosted_email_public_bootstrap_attempt"("member_id", "claimed_at", "id");
CREATE INDEX "hosted_email_public_bootstrap_attempt_claimed_at_id_idx"
  ON "hosted_email_public_bootstrap_attempt"("claimed_at", "id");
CREATE INDEX "hosted_email_public_bootstrap_attempt_expires_at_id_idx"
  ON "hosted_email_public_bootstrap_attempt"("expires_at", "id");

ALTER TABLE "hosted_email_public_bootstrap_attempt"
  ADD CONSTRAINT "hosted_email_public_bootstrap_attempt_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
