CREATE TABLE "hosted_account_group_plan_capacity" (
  "group_id" TEXT NOT NULL,
  "plan_code" TEXT NOT NULL,
  "billed_quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_account_group_plan_capacity_pkey"
    PRIMARY KEY ("group_id", "plan_code"),
  CONSTRAINT "hosted_account_group_plan_capacity_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "hosted_account_group"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "hosted_account_group_plan_capacity_quantity_check"
    CHECK ("billed_quantity" > 0),
  CONSTRAINT "hosted_account_group_plan_capacity_plan_code_check"
    CHECK ("plan_code" IN ('pulse', 'edge'))
);

CREATE INDEX "hosted_account_group_plan_capacity_plan_code_idx"
ON "hosted_account_group_plan_capacity"("plan_code");

ALTER TABLE "hosted_account_group_membership"
ADD COLUMN "plan_code" TEXT DEFAULT 'pulse';

ALTER TABLE "hosted_account_group_invite"
ADD COLUMN "plan_code" TEXT DEFAULT 'pulse';
