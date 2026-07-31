CREATE INDEX CONCURRENTLY "hosted_product_feedback_created_at_kind_idx"
  ON "hosted_product_feedback"("created_at", "kind");
