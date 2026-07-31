UPDATE "hosted_product_feedback"
SET
  "summary" = NULL,
  "id" = 'product_feedback_' || replace(gen_random_uuid()::text, '-', ''),
  "member_id" = NULL
WHERE "member_id" IS NOT NULL;
