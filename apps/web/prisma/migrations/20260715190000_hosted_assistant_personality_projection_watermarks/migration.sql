ALTER TABLE "hosted_member"
  ADD COLUMN "assistant_humor_causal_seq" BIGINT,
  ADD COLUMN "assistant_push_causal_seq" BIGINT,
  ADD COLUMN "assistant_detail_causal_seq" BIGINT;
