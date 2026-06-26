CREATE TABLE "hosted_linq_first_contact_admission_decision" (
  "event_id" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_linq_first_contact_admission_decision_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "hosted_linq_first_contact_admission_decision_decision_check"
    CHECK ("decision" IN ('allow', 'block')),
  CONSTRAINT "hosted_linq_first_contact_admission_decision_category_check"
    CHECK ("category" IN (
      'benign_greeting',
      'join_intent',
      'murph_question',
      'not_murph_intent',
      'marketing_outreach',
      'promotional_campaign',
      'wrong_number_or_personal_logistics',
      'unsupported_content',
      'uncertain'
    )),
  CONSTRAINT "hosted_linq_first_contact_admission_decision_confidence_check"
    CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "hosted_linq_first_contact_admission_decision_source_check"
    CHECK ("source" IN ('deterministic', 'model'))
);
