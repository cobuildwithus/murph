-- Simplify hosted Stripe durability:
-- - remove durable checkout history
-- - keep only stable member billing refs
-- - shrink Stripe event storage to receipt/retry state

alter table "hosted_member_billing_ref"
  drop column if exists "stripe_latest_billing_event_created_at",
  drop column if exists "stripe_latest_billing_event_id",
  drop column if exists "stripe_latest_billing_event_id_encrypted",
  drop column if exists "stripe_latest_checkout_session_id",
  drop column if exists "stripe_latest_checkout_session_id_encrypted";

drop index if exists "hosted_stripe_event_customer_id_stripe_created_at_idx";
drop index if exists "hosted_stripe_event_subscription_id_stripe_created_at_idx";
drop index if exists "hosted_stripe_event_invoice_id_stripe_created_at_idx";
drop index if exists "hosted_stripe_event_checkout_session_id_stripe_created_at_idx";

alter table "hosted_stripe_event"
  drop column if exists "customer_id",
  drop column if exists "subscription_id",
  drop column if exists "invoice_id",
  drop column if exists "checkout_session_id",
  drop column if exists "charge_id",
  drop column if exists "payment_intent_id",
  drop column if exists "payload_json";

drop table if exists "hosted_billing_checkout";

drop type if exists "HostedBillingCheckoutStatus";
