CREATE TABLE "hosted_member_subscription_checkout" (
  "stripe_checkout_session_lookup_key" TEXT NOT NULL,
  "stripe_checkout_session_id_encrypted" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_member_subscription_checkout_pkey"
    PRIMARY KEY ("stripe_checkout_session_lookup_key"),
  CONSTRAINT "hosted_member_subscription_checkout_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "hosted_member_subscription_checkout_member_id_idx"
  ON "hosted_member_subscription_checkout"("member_id");
