ALTER TABLE "hosted_linq_delivery"
  ADD COLUMN "thread_is_direct" BOOLEAN;

UPDATE "hosted_linq_delivery"
SET "thread_is_direct" = FALSE
WHERE "target_kind" = 'thread'
  AND "status" = 'sent_no_receipt_expected';
