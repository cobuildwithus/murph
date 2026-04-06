CREATE TABLE "hosted_member_identity" (
  "member_id" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "normalized_phone_number" TEXT NOT NULL,
  "phone_number_verified_at" TIMESTAMP(3),
  "privy_user_id" TEXT,
  "wallet_address" TEXT,
  "wallet_chain_type" TEXT,
  "wallet_provider" TEXT,
  "wallet_created_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_member_identity_pkey" PRIMARY KEY ("member_id")
);

CREATE TABLE "hosted_member_routing" (
  "member_id" TEXT NOT NULL,
  "linq_chat_id" TEXT,
  "telegram_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_member_routing_pkey" PRIMARY KEY ("member_id")
);

CREATE TABLE "hosted_member_billing_ref" (
  "member_id" TEXT NOT NULL,
  "stripe_customer_id" TEXT,
  "stripe_subscription_id" TEXT,
  "stripe_latest_checkout_session_id" TEXT,
  "stripe_latest_billing_event_created_at" TIMESTAMP(3),
  "stripe_latest_billing_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_member_billing_ref_pkey" PRIMARY KEY ("member_id")
);

CREATE UNIQUE INDEX "hosted_member_identity_normalized_phone_number_key"
  ON "hosted_member_identity" ("normalized_phone_number");

CREATE UNIQUE INDEX "hosted_member_identity_privy_user_id_key"
  ON "hosted_member_identity" ("privy_user_id");

CREATE UNIQUE INDEX "hosted_member_identity_wallet_address_key"
  ON "hosted_member_identity" ("wallet_address");

CREATE UNIQUE INDEX "hosted_member_routing_telegram_user_id_key"
  ON "hosted_member_routing" ("telegram_user_id");

CREATE UNIQUE INDEX "hosted_member_routing_linq_chat_id_key"
  ON "hosted_member_routing" ("linq_chat_id");

CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_customer_id_key"
  ON "hosted_member_billing_ref" ("stripe_customer_id");

CREATE UNIQUE INDEX "hosted_member_billing_ref_stripe_subscription_id_key"
  ON "hosted_member_billing_ref" ("stripe_subscription_id");

ALTER TABLE "hosted_member_identity"
  ADD CONSTRAINT "hosted_member_identity_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_member_routing"
  ADD CONSTRAINT "hosted_member_routing_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_member_billing_ref"
  ADD CONSTRAINT "hosted_member_billing_ref_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "hosted_session";

ALTER TABLE "hosted_member"
DROP COLUMN "phone_number",
DROP COLUMN "normalized_phone_number",
DROP COLUMN "phone_number_verified_at",
DROP COLUMN "privy_user_id",
DROP COLUMN "wallet_address",
DROP COLUMN "wallet_chain_type",
DROP COLUMN "wallet_provider",
DROP COLUMN "wallet_created_at",
DROP COLUMN "stripe_customer_id",
DROP COLUMN "stripe_subscription_id",
DROP COLUMN "stripe_latest_checkout_session_id",
DROP COLUMN "stripe_latest_billing_event_created_at",
DROP COLUMN "stripe_latest_billing_event_id",
DROP COLUMN "linq_chat_id",
DROP COLUMN "telegram_user_id",
DROP COLUMN "telegram_username";
