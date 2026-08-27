ALTER TABLE "hosted_member"
ADD COLUMN "group_private_conversion_tracked_at" TIMESTAMP(3);

CREATE INDEX "hosted_member_group_private_conversion_tracked_at_idx"
ON "hosted_member"("group_private_conversion_tracked_at");
