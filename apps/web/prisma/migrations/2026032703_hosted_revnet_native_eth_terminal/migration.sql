ALTER TABLE "hosted_revnet_issuance"
  RENAME COLUMN "token_address" TO "payment_asset_address";

ALTER TABLE "hosted_revnet_issuance"
  RENAME COLUMN "payment_amount_minor" TO "stripe_payment_amount_minor";

ALTER TABLE "hosted_revnet_issuance"
  RENAME COLUMN "payment_currency" TO "stripe_payment_currency";

ALTER TABLE "hosted_revnet_issuance"
  RENAME COLUMN "terminal_token_amount" TO "payment_amount";

DROP INDEX IF EXISTS "hosted_revnet_issuance_approval_tx_hash_key";

ALTER TABLE "hosted_revnet_issuance"
  DROP COLUMN "approval_tx_hash";
