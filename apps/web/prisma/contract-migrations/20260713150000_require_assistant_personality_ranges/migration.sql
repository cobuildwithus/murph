DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hosted_member"
    WHERE ("assistant_humor" IS NOT NULL AND "assistant_humor" NOT BETWEEN 0 AND 10)
      OR ("assistant_push" IS NOT NULL AND "assistant_push" NOT BETWEEN 0 AND 10)
      OR ("assistant_detail" IS NOT NULL AND "assistant_detail" NOT BETWEEN 0 AND 10)
  ) THEN
    RAISE EXCEPTION 'hosted_member assistant personality values must be between 0 and 10';
  END IF;
END $$;

ALTER TABLE "hosted_member"
  ADD CONSTRAINT "hosted_member_assistant_humor_range"
    CHECK ("assistant_humor" BETWEEN 0 AND 10),
  ADD CONSTRAINT "hosted_member_assistant_push_range"
    CHECK ("assistant_push" BETWEEN 0 AND 10),
  ADD CONSTRAINT "hosted_member_assistant_detail_range"
    CHECK ("assistant_detail" BETWEEN 0 AND 10);
