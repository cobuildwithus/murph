CREATE TABLE "hosted_ops_onboarding_voice_memo_attempt" (
  "id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_ops_onboarding_voice_memo_attempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_ops_onboarding_voice_memo_attempt_dedupe_key"
  ON "hosted_ops_onboarding_voice_memo_attempt"("dedupe_key");

CREATE INDEX "hosted_ops_onboarding_voice_memo_attempt_member_created_at_idx"
  ON "hosted_ops_onboarding_voice_memo_attempt"("member_id", "created_at");

ALTER TABLE "hosted_ops_onboarding_voice_memo_attempt"
  ADD CONSTRAINT "hosted_ops_onboarding_voice_memo_attempt_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
