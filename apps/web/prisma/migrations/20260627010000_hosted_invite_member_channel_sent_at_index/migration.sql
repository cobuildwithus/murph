CREATE INDEX "hosted_invite_member_channel_sent_at_idx"
  ON "hosted_invite"("member_id", "channel", "sent_at");
