CREATE INDEX CONCURRENTLY "hosted_group_member_join_confirmation_drain_idx"
  ON "hosted_group_member"("created_at", "id")
  WHERE "join_confirmation_eligible_at" IS NOT NULL
    AND "role" = 'member';
