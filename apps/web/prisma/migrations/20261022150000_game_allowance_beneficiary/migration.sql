-- Freeze game-room allowance attribution without changing historical usage.
-- No member foreign key: runtime ownership survives member deletion.
ALTER TABLE "hosted_runtime_owner"
  ADD COLUMN "allowance_beneficiary_member_id" TEXT;

ALTER TABLE "hosted_ai_usage"
  ADD COLUMN "allowance_beneficiary_member_id" TEXT;
