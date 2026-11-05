-- Which member message the burst's tapback went on (HMAC lookup key) and the
-- emoji, so Murph's own react_to_message can skip a message Web already
-- reacted to. Legacy rows stay NULL.
ALTER TABLE "hosted_linq_ack_reaction"
  ADD COLUMN "message_lookup_key" TEXT,
  ADD COLUMN "reaction" TEXT;
