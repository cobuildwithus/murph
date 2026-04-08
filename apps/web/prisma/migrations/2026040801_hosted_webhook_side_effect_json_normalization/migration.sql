-- Normalize hosted webhook side-effect persistence around common retry fields plus kind-owned JSON detail.
ALTER TABLE "hosted_webhook_receipt_side_effect"
ADD COLUMN "payload_json" JSONB,
ADD COLUMN "result_json" JSONB;

UPDATE "hosted_webhook_receipt_side_effect"
SET
  "payload_json" = CASE
    WHEN "kind" = 'hosted_execution_dispatch' THEN "dispatch_payload_json"
    WHEN "kind" = 'linq_message_send' THEN jsonb_build_object(
      'chatId', "linq_chat_id",
      'inviteId', "linq_invite_id",
      'replyToMessageId', "linq_reply_to_message_id",
      'template', "linq_template"
    )
    WHEN "kind" = 'revnet_invoice_issue' THEN jsonb_build_object(
      'amountPaid', "revnet_amount_paid",
      'chargeId', "revnet_charge_id",
      'currency', "revnet_currency",
      'invoiceId', "revnet_invoice_id",
      'memberId', "revnet_member_id",
      'paymentIntentId', "revnet_payment_intent_id"
    )
    ELSE NULL
  END,
  "result_json" = CASE
    WHEN "kind" = 'hosted_execution_dispatch' AND "sent_at" IS NOT NULL THEN jsonb_build_object(
      'dispatched', true
    )
    WHEN "kind" = 'linq_message_send' AND (
      "linq_result_chat_id" IS NOT NULL
      OR "linq_result_message_id" IS NOT NULL
    ) THEN jsonb_build_object(
      'chatId', "linq_result_chat_id",
      'messageId', "linq_result_message_id"
    )
    WHEN "kind" = 'revnet_invoice_issue' AND "revnet_result_handled" = TRUE THEN jsonb_build_object(
      'handled', true
    )
    ELSE NULL
  END;

ALTER TABLE "hosted_webhook_receipt_side_effect"
ALTER COLUMN "payload_json" SET NOT NULL;

ALTER TABLE "hosted_webhook_receipt_side_effect"
DROP COLUMN "dispatch_payload_json",
DROP COLUMN "linq_chat_id",
DROP COLUMN "linq_invite_id",
DROP COLUMN "linq_reply_to_message_id",
DROP COLUMN "linq_template",
DROP COLUMN "linq_result_chat_id",
DROP COLUMN "linq_result_message_id",
DROP COLUMN "revnet_amount_paid",
DROP COLUMN "revnet_charge_id",
DROP COLUMN "revnet_currency",
DROP COLUMN "revnet_invoice_id",
DROP COLUMN "revnet_member_id",
DROP COLUMN "revnet_payment_intent_id",
DROP COLUMN "revnet_result_handled";
