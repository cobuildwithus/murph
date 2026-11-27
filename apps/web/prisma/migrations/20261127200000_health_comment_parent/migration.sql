ALTER TABLE "health_post_comment"
  ADD COLUMN "parent_comment_id" UUID
  REFERENCES "health_post_comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "health_post_comment_post_id_parent_comment_id_idx"
  ON "health_post_comment"("post_id", "parent_comment_id");
