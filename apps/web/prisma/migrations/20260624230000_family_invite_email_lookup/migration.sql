-- Store privacy-preserving email targets for family invites (web accept binding).

ALTER TABLE "hosted_account_group_invite"
ADD COLUMN "target_email_lookup_key" TEXT,
ADD COLUMN "target_email_encrypted" TEXT;

CREATE INDEX "hagi_target_email_lookup_key_idx"
ON "hosted_account_group_invite"("target_email_lookup_key");
