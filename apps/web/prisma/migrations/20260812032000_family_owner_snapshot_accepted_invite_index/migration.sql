CREATE INDEX CONCURRENTLY "hagi_group_accepted_member_created_id_idx"
  ON "hosted_account_group_invite"(
    "group_id",
    "accepted_by_member_id",
    "created_at",
    "id"
  )
  WHERE "status" = 'accepted'
    AND "accepted_by_member_id" IS NOT NULL;
