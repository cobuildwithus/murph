-- Store privacy-preserving Telegram username targets for family invite fallback.

ALTER TABLE "hosted_account_group_invite"
ADD COLUMN "target_telegram_username_lookup_key" TEXT,
ADD COLUMN "target_telegram_username_encrypted" TEXT;

CREATE INDEX "hagi_target_telegram_username_lookup_key_idx"
ON "hosted_account_group_invite"("target_telegram_username_lookup_key");
