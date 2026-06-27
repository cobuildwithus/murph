CREATE TABLE "hosted_linq_first_contact_admission_budget" (
  "participant_contact_lookup_key" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "participant_contact_kind" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_linq_first_contact_admission_budget_pkey"
    PRIMARY KEY ("participant_contact_lookup_key", "event_id"),
  CONSTRAINT "hosted_linq_first_contact_admission_budget_contact_kind_check"
    CHECK ("participant_contact_kind" IN ('email', 'phone'))
);

CREATE INDEX "hosted_linq_first_contact_admission_budget_created_at_idx"
  ON "hosted_linq_first_contact_admission_budget"("created_at");
