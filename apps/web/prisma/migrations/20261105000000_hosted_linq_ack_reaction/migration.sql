-- Per-direct-chat burst state for the Web "on it" emoji tapback.
-- A burst is the member's messages after the chat's latest
-- hosted_linq_delivery.attempted_at (Murph's last outbound). claimed_at is the
-- reservation token for the burst's one tapback, reacted_at marks Linq
-- accepting it, and heavy_at silences the burst after a heavy message.
CREATE TABLE "hosted_linq_ack_reaction" (
  "linq_chat_lookup_key" TEXT NOT NULL,
  "claimed_at" TIMESTAMP(3),
  "reacted_at" TIMESTAMP(3),
  "heavy_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hosted_linq_ack_reaction_pkey" PRIMARY KEY ("linq_chat_lookup_key")
);
