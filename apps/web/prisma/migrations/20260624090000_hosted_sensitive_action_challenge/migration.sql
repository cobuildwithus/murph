-- CreateTable
CREATE TABLE "hosted_sensitive_action_challenge" (
    "token_hash" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "binding_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_sensitive_action_challenge_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "hosted_sensitive_action_challenge_member_id_expires_at_idx"
ON "hosted_sensitive_action_challenge"("member_id", "expires_at");

-- CreateIndex
CREATE INDEX "hosted_sensitive_action_challenge_expires_at_idx"
ON "hosted_sensitive_action_challenge"("expires_at");

-- AddForeignKey
ALTER TABLE "hosted_sensitive_action_challenge"
ADD CONSTRAINT "hosted_sensitive_action_challenge_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
