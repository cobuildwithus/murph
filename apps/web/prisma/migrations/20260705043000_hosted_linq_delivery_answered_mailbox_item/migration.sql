ALTER TABLE "hosted_linq_delivery"
  ADD COLUMN "answered_mailbox_item_id" TEXT;

CREATE INDEX "hosted_linq_delivery_answered_mailbox_item_id_idx"
  ON "hosted_linq_delivery"("answered_mailbox_item_id");
