ALTER TABLE "hosted_usage_credit_purchase"
  ALTER COLUMN "payer_member_id" DROP NOT NULL,
  ALTER COLUMN "stripe_price_id_encrypted" DROP NOT NULL,
  ALTER COLUMN "stripe_customer_id_encrypted" DROP NOT NULL;
