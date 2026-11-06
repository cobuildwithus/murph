CREATE INDEX CONCURRENTLY "hosted_mailbox_item_telegram_update_dedupe_key_idx"
  ON "hosted_mailbox_item"("dedupe_key")
  WHERE "dedupe_key" LIKE 'telegram:update:%';
