-- Delivery-time reply acceptance stamps answered mailbox rows without
-- advancing the lane watermark or creating a side table.
ALTER TABLE "hosted_mailbox_item" ADD COLUMN "consumed_at" TIMESTAMP(3);
