DROP INDEX IF EXISTS "hosted_computer_run_one_active_profile_idx";

DROP INDEX IF EXISTS "hosted_computer_run_member_id_profile_key_updated_at_idx";

ALTER TABLE "hosted_computer_run"
  DROP COLUMN IF EXISTS "profile_key";

CREATE UNIQUE INDEX "hosted_computer_run_one_active_member_idx"
  ON "hosted_computer_run"("member_id")
  WHERE "status" IN ('running', 'awaiting_user', 'cleanup_pending');
