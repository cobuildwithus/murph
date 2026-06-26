CREATE TABLE "hosted_linq_first_contact_event_receipt" (
  "event_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "hosted_linq_first_contact_event_receipt_pkey" PRIMARY KEY ("event_id")
);
