ALTER TABLE "hosted_linq_first_contact_admission_decision"
  ADD COLUMN "rejected_message_text" TEXT;

ALTER TABLE "hosted_linq_first_contact_admission_decision"
  ADD CONSTRAINT "hosted_linq_first_contact_admission_decision_rejected_message_check"
  CHECK (
    "rejected_message_text" IS NULL
    OR (
      "decision" = 'block'
      AND char_length("rejected_message_text") <= 2000
    )
  );
