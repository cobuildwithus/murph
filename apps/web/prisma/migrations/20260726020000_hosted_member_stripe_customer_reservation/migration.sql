ALTER TABLE "hosted_member_billing_ref"
  ADD COLUMN "stripe_customer_reservation_id" TEXT,
  ADD COLUMN "stripe_customer_reservation_created_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_customer_reservation_id_key"
  ON "hosted_member_billing_ref"("stripe_customer_reservation_id");
