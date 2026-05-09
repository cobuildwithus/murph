-- CreateIndex
CREATE INDEX "hosted_web_session_member_id_privy_user_id_created_at_id_idx" ON "hosted_web_session"("member_id", "privy_user_id", "created_at", "id");
