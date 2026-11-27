-- The reply retains its own audience when the source comment is withdrawn.
ALTER TABLE "health_post_comment"
  ADD COLUMN "recipient_member_id" TEXT
  REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE
  CHECK ("recipient_member_id" IS NULL OR "visibility" = 'poster');

CREATE INDEX "health_post_comment_recipient_member_id_idx" ON "health_post_comment"("recipient_member_id");
