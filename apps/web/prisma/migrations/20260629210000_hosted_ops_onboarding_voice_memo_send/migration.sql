CREATE TABLE "hosted_ops_onboarding_voice_memo_send" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "linq_chat_lookup_key" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "sent_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_ops_onboarding_voice_memo_send_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_ops_onboarding_voice_memo_member_chat_request_key"
  ON "hosted_ops_onboarding_voice_memo_send"("member_id", "linq_chat_lookup_key", "request_id");

CREATE INDEX "hosted_ops_onboarding_voice_memo_member_created_at_idx"
  ON "hosted_ops_onboarding_voice_memo_send"("member_id", "created_at");

ALTER TABLE "hosted_ops_onboarding_voice_memo_send"
  ADD CONSTRAINT "hosted_ops_onboarding_voice_memo_send_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
