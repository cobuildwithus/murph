CREATE TABLE "hosted_member_accepted_subscription" (
  "member_id" TEXT NOT NULL,
  "stripe_subscription_lookup_key" TEXT NOT NULL,
  "stripe_subscription_id_encrypted" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_member_accepted_subscription_pkey" PRIMARY KEY ("member_id", "stripe_subscription_lookup_key"),
  CONSTRAINT "hosted_member_accepted_subscription_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
