BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TYPE "HostedAuthModel" AS ENUM ('user', 'session', 'account', 'verification');
CREATE TABLE "hosted_auth_record" (
    "model" "HostedAuthModel" NOT NULL,
    "id" TEXT NOT NULL,
    "member_id" TEXT,
    "lookup_key" TEXT,
    "secondary_lookup_key" TEXT,
    "payload_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hosted_auth_record_pkey" PRIMARY KEY ("model", "id"),
    CONSTRAINT "hosted_auth_record_owner_check" CHECK (
        ("model" = 'verification' AND "member_id" IS NULL)
        OR ("model" <> 'verification' AND "member_id" IS NOT NULL)
    ),
    CONSTRAINT "hosted_auth_record_member_id_fkey"
        FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hosted_auth_record_model_lookup_key_key" ON "hosted_auth_record"("model", "lookup_key");
CREATE UNIQUE INDEX "hosted_auth_record_model_secondary_lookup_key_key" ON "hosted_auth_record"("model", "secondary_lookup_key");
CREATE INDEX "hosted_auth_record_model_member_id_id_idx" ON "hosted_auth_record"("model", "member_id", "id");
CREATE INDEX "hosted_auth_record_model_expires_at_id_idx" ON "hosted_auth_record"("model", "expires_at", "id");

COMMIT;
