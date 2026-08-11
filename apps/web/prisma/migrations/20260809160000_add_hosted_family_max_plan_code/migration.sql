DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hosted_account_group_membership"
    WHERE "plan_code" IS NULL
      OR "plan_code" NOT IN ('pulse', 'edge', 'max')
  ) OR EXISTS (
    SELECT 1
    FROM "hosted_account_group_invite"
    WHERE "plan_code" IS NULL
      OR "plan_code" NOT IN ('pulse', 'edge', 'max')
  ) THEN
    RAISE EXCEPTION
      'Cannot require Family plan codes while an unsupported assignment remains.'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

ALTER TABLE "hosted_account_group_membership"
  ALTER COLUMN "plan_code" SET NOT NULL,
  DROP CONSTRAINT IF EXISTS "hosted_account_group_membership_plan_code_check",
  ADD CONSTRAINT "hosted_account_group_membership_plan_code_check"
    CHECK ("plan_code" IN ('pulse', 'edge', 'max')) NOT VALID;

ALTER TABLE "hosted_account_group_membership"
  VALIDATE CONSTRAINT "hosted_account_group_membership_plan_code_check";

ALTER TABLE "hosted_account_group_invite"
  ALTER COLUMN "plan_code" SET NOT NULL,
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
