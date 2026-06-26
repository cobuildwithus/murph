CREATE TABLE "hosted_linq_first_contact_event_receipt" (
  "event_id" TEXT NOT NULL,
  "handling" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "invite_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_linq_first_contact_event_receipt_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "hosted_linq_first_contact_event_receipt_handling_check"
    CHECK ("handling" IN ('signup_link_sent'))
);
