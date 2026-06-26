CREATE TABLE "hosted_linq_first_contact_admission_budget" (
  "participant_contact_lookup_key" TEXT NOT NULL,
  "participant_contact_kind" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_event_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_linq_first_contact_admission_budget_pkey"
    PRIMARY KEY ("participant_contact_lookup_key"),
  CONSTRAINT "hosted_linq_first_contact_admission_budget_contact_kind_check"
    CHECK ("participant_contact_kind" IN ('email', 'phone')),
  CONSTRAINT "hosted_linq_first_contact_admission_budget_attempt_count_check"
    CHECK ("attempt_count" >= 0)
);

CREATE INDEX "hosted_linq_first_contact_admission_budget_updated_at_idx"
  ON "hosted_linq_first_contact_admission_budget"("updated_at");
