-- CreateTable
CREATE TABLE "hosted_web_session" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "privy_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,

    CONSTRAINT "hosted_web_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hosted_web_session_token_hash_key" ON "hosted_web_session"("token_hash");

-- CreateIndex
CREATE INDEX "hosted_web_session_member_id_idx" ON "hosted_web_session"("member_id");

-- CreateIndex
CREATE INDEX "hosted_web_session_privy_user_id_idx" ON "hosted_web_session"("privy_user_id");

-- CreateIndex
CREATE INDEX "hosted_web_session_expires_at_idx" ON "hosted_web_session"("expires_at");

-- CreateIndex
CREATE INDEX "hosted_web_session_revoked_at_idx" ON "hosted_web_session"("revoked_at");

-- AddForeignKey
ALTER TABLE "hosted_web_session" ADD CONSTRAINT "hosted_web_session_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
