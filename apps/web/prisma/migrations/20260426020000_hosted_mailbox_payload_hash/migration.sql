-- Add internal mailbox payload fingerprint used only for duplicate integrity checks.
ALTER TABLE "hosted_mailbox_item" ADD COLUMN "payload_hash" TEXT;
