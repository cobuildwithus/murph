CREATE INDEX CONCURRENTLY "hagi_group_status_expires_id_idx"
  ON "hosted_account_group_invite"(
    "group_id",
    "status",
    "expires_at",
    "id"
  );
