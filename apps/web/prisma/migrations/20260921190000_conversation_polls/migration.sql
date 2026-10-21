CREATE TABLE "hosted_conversation_poll" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "member_id" TEXT NOT NULL REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "channel" TEXT NOT NULL,
  "conversation_key" TEXT NOT NULL,
  "provider_poll_key" TEXT,
  "definition_encrypted" TEXT NOT NULL,
  "result_encrypted" TEXT,
  "dispatched_at" TIMESTAMP(3),
  "last_update_id" BIGINT,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "hosted_conversation_poll_provider_poll_key_key" ON "hosted_conversation_poll"("provider_poll_key");
CREATE INDEX "hosted_conversation_poll_conversation_idx" ON "hosted_conversation_poll"("member_id", "conversation_key", "created_at");
CREATE INDEX "hosted_conversation_poll_channel_dispatched_at_idx" ON "hosted_conversation_poll"("channel", "dispatched_at");

CREATE TABLE "hosted_conversation_poll_vote" (
  "poll_id" TEXT NOT NULL REFERENCES "hosted_conversation_poll"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "voter_key" TEXT NOT NULL,
  "vote_encrypted" TEXT NOT NULL,
  "last_update_id" BIGINT NOT NULL,
  "has_vote" BOOLEAN NOT NULL,
  PRIMARY KEY ("poll_id", "voter_key")
);
CREATE INDEX "hosted_conversation_poll_vote_page_idx" ON "hosted_conversation_poll_vote"("poll_id", "has_vote", "voter_key");
