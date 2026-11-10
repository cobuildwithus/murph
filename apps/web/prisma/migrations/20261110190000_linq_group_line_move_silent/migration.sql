-- Retain the column for old Web readers during rollout. Silent moves do not use it.
ALTER TABLE "hosted_linq_group_line_move" ALTER COLUMN "notice_text_hash" DROP NOT NULL;

-- One removal owner. A claimed request may still dispatch until its provider
-- acceptance is recorded; absence alone cannot release that reservation.
ALTER TABLE "hosted_linq_group_line_move"
  ADD COLUMN "remove_started_at" TIMESTAMP(3),
  ADD COLUMN "remove_accepted_at" TIMESTAMP(3);

-- Cancelled rows are immutable. Their final updated_at is the replay boundary.
CREATE INDEX "linq_group_move_target_replay_idx"
  ON "hosted_linq_group_line_move" ("to_account_lookup_key", "status", "updated_at");
