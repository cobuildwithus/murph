ALTER TABLE "hosted_mailbox_item"
ADD COLUMN "assistant_input_lookup_key" TEXT;

CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_assistant_input_lookup_key_key"
ON "hosted_mailbox_item"("user_id", "assistant_input_lookup_key");
