-- Drop legacy device webhook payload bodies. Trace rows only need routing and claim metadata.
update "device_webhook_trace"
set "payload_json" = null
where "payload_json" is not null;

-- Rewrite legacy hosted Stripe payload snapshots to the smallest object shapes the current
-- handlers still read, and clear completed payloads entirely.
update "hosted_stripe_event"
set "payload_json" = case
  when "status" = 'completed' then 'null'::jsonb
  when jsonb_typeof("payload_json") <> 'object' then "payload_json"
  else jsonb_strip_nulls(
    jsonb_build_object(
      'type', to_jsonb("type"),
      'object',
        case
          when "type" in ('checkout.session.completed', 'checkout.session.expired') then jsonb_strip_nulls(
            jsonb_build_object(
              'amount_total', "payload_json"->'object'->'amount_total',
              'client_reference_id', "payload_json"->'object'->'client_reference_id',
              'currency', "payload_json"->'object'->'currency',
              'customer', to_jsonb("customer_id"),
              'id', case
                when "checkout_session_id" is null then "payload_json"->'object'->'id'
                else to_jsonb("checkout_session_id")
              end,
              'metadata', case
                when "payload_json"->'object'->'metadata'->'memberId' is null then null
                else jsonb_build_object(
                  'memberId',
                  "payload_json"->'object'->'metadata'->'memberId'
                )
              end,
              'mode', "payload_json"->'object'->'mode',
              'payment_status', "payload_json"->'object'->'payment_status',
              'subscription', to_jsonb("subscription_id")
            )
          )
          when "type" in (
            'customer.subscription.created',
            'customer.subscription.updated',
            'customer.subscription.deleted'
          ) then jsonb_strip_nulls(
            jsonb_build_object(
              'customer', to_jsonb("customer_id"),
              'id', case
                when "subscription_id" is null then "payload_json"->'object'->'id'
                else to_jsonb("subscription_id")
              end,
              'metadata', case
                when "payload_json"->'object'->'metadata'->'memberId' is null then null
                else jsonb_build_object(
                  'memberId',
                  "payload_json"->'object'->'metadata'->'memberId'
                )
              end,
              'status', "payload_json"->'object'->'status'
            )
          )
          when "type" in ('invoice.paid', 'invoice.payment_failed') then jsonb_strip_nulls(
            jsonb_build_object(
              'amount_paid', "payload_json"->'object'->'amount_paid',
              'charge', to_jsonb("charge_id"),
              'currency', "payload_json"->'object'->'currency',
              'customer', to_jsonb("customer_id"),
              'id', case
                when "invoice_id" is null then "payload_json"->'object'->'id'
                else to_jsonb("invoice_id")
              end,
              'payment_intent', to_jsonb("payment_intent_id"),
              'subscription', to_jsonb("subscription_id")
            )
          )
          when "type" = 'refund.created' then jsonb_strip_nulls(
            jsonb_build_object(
              'charge', to_jsonb("charge_id"),
              'id', "payload_json"->'object'->'id',
              'payment_intent', to_jsonb("payment_intent_id")
            )
          )
          when "type" in (
            'charge.dispute.created',
            'charge.dispute.closed',
            'charge.dispute.funds_reinstated',
            'charge.dispute.funds_withdrawn'
          ) then jsonb_strip_nulls(
            jsonb_build_object(
              'charge', to_jsonb("charge_id"),
              'id', "payload_json"->'object'->'id',
              'payment_intent', to_jsonb("payment_intent_id")
            )
          )
          else jsonb_strip_nulls(
            jsonb_build_object(
              'id', "payload_json"->'object'->'id'
            )
          )
        end
    )
  )
end;

-- Existing hosted webhook receipts remain untouched here. They are still used as the hydration
-- source for queued hosted execution outbox references, so a safe historical scrub needs to be
-- coordinated with outbox state rather than applied blindly in SQL.
