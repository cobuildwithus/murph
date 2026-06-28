ALTER TABLE "hosted_linq_first_contact_admission_decision"
  DROP CONSTRAINT IF EXISTS "hosted_linq_first_contact_admission_decision_rejected_message_check";

ALTER TABLE "hosted_linq_first_contact_admission_decision"
  DROP COLUMN IF EXISTS "rejected_message_text";
