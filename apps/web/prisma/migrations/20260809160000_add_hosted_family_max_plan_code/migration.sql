ALTER TABLE "hosted_account_group_membership"
  DROP CONSTRAINT IF EXISTS "hosted_account_group_membership_plan_code_check",
  ADD CONSTRAINT "hosted_account_group_membership_plan_code_check"
    CHECK ("plan_code" IN ('pulse', 'edge', 'max')) NOT VALID;

ALTER TABLE "hosted_account_group_membership"
  VALIDATE CONSTRAINT "hosted_account_group_membership_plan_code_check";

ALTER TABLE "hosted_account_group_invite"
  DROP CONSTRAINT IF EXISTS "hosted_account_group_invite_plan_code_check",
  ADD CONSTRAINT "hosted_account_group_invite_plan_code_check"
    CHECK ("plan_code" IN ('pulse', 'edge', 'max')) NOT VALID;

ALTER TABLE "hosted_account_group_invite"
  VALIDATE CONSTRAINT "hosted_account_group_invite_plan_code_check";

ALTER TABLE "hosted_account_group_plan_capacity"
  DROP CONSTRAINT IF EXISTS "hosted_account_group_plan_capacity_plan_code_check",
  ADD CONSTRAINT "hosted_account_group_plan_capacity_plan_code_check"
    CHECK ("plan_code" IN ('pulse', 'edge', 'max')) NOT VALID;

ALTER TABLE "hosted_account_group_plan_capacity"
  VALIDATE CONSTRAINT "hosted_account_group_plan_capacity_plan_code_check";
