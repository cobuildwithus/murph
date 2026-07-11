ALTER TABLE "hosted_member"
  ADD COLUMN "assistant_humor" INTEGER,
  ADD COLUMN "assistant_push" INTEGER,
  ADD COLUMN "assistant_detail" INTEGER,
  ADD CONSTRAINT "hosted_member_assistant_humor_range"
    CHECK ("assistant_humor" BETWEEN 0 AND 10),
  ADD CONSTRAINT "hosted_member_assistant_push_range"
    CHECK ("assistant_push" BETWEEN 0 AND 10),
  ADD CONSTRAINT "hosted_member_assistant_detail_range"
    CHECK ("assistant_detail" BETWEEN 0 AND 10);
