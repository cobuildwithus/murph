CREATE TABLE "hosted_linq_delivery_answered_mailbox_item" (
  "delivery_id" TEXT NOT NULL,
  "mailbox_item_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "hosted_linq_delivery_answered_mailbox_item_pkey"
    PRIMARY KEY ("delivery_id", "mailbox_item_id"),
  CONSTRAINT "hosted_linq_delivery_answered_mailbox_item_delivery_id_fkey"
    FOREIGN KEY ("delivery_id")
    REFERENCES "hosted_linq_delivery"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "hosted_linq_delivery_answered_mailbox_item_mailbox_item_id_fkey"
    FOREIGN KEY ("mailbox_item_id")
    REFERENCES "hosted_mailbox_item"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "hosted_linq_delivery_answered_mailbox_item_mailbox_item_id_idx"
  ON "hosted_linq_delivery_answered_mailbox_item"("mailbox_item_id");
