-- Drop the category guardrail from first-contact admission decisions. The
-- runtime now trusts the model's `decision` field on its own, so the column
-- and its CHECK constraint are vestigial. Make it nullable in the expand
-- phase so any old in-flight code path that still writes a category keeps
-- working until it is rolled forward; a follow-up migration may drop the
-- column entirely once no writers remain.
ALTER TABLE "hosted_linq_first_contact_admission_decision"
  DROP CONSTRAINT IF EXISTS "hosted_linq_first_contact_admission_decision_category_check";

ALTER TABLE "hosted_linq_first_contact_admission_decision"
  ALTER COLUMN "category" DROP NOT NULL;
