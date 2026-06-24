ALTER TABLE "hosted_product_feedback"
    ADD COLUMN "summary" TEXT,
    DROP COLUMN "topic";
