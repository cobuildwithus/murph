ALTER TABLE "hosted_computer_handoff"
  ADD COLUMN "return_contact_kind" TEXT;

ALTER TABLE "hosted_computer_handoff"
  ADD CONSTRAINT "hosted_computer_handoff_return_contact_kind_check"
  CHECK (
    "return_contact_kind" IS NULL
    OR "return_contact_kind" IN ('text', 'telegram', 'email')
  );
