CREATE TABLE "hosted_product_feedback" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "related_changelog_item_ids_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosted_product_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hosted_product_feedback_member_id_created_at_idx"
    ON "hosted_product_feedback"("member_id", "created_at");

ALTER TABLE "hosted_product_feedback"
    ADD CONSTRAINT "hosted_product_feedback_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
