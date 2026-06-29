UPDATE "hosted_linq_first_contact_admission_decision"
SET "rejected_message_text" = NULL
WHERE "rejected_message_text" IS NOT NULL;
