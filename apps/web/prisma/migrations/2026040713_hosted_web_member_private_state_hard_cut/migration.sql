-- Greenfield hard cut: hosted member private identifiers move back into encrypted
-- Postgres owner tables. Cloudflare no longer owns a durable member-private-state blob.

alter table "hosted_member_identity"
  add column if not exists "privy_user_id_encrypted" text,
  add column if not exists "wallet_address_encrypted" text,
  add column if not exists "signup_phone_number_encrypted" text,
  add column if not exists "signup_phone_code_sent_at" timestamp(3),
  add column if not exists "signup_phone_code_send_attempt_id" text,
  add column if not exists "signup_phone_code_send_attempt_started_at" timestamp(3);

alter table "hosted_member_routing"
  add column if not exists "linq_chat_id_encrypted" text;

alter table "hosted_member_billing_ref"
  add column if not exists "stripe_customer_id_encrypted" text,
  add column if not exists "stripe_subscription_id_encrypted" text,
  add column if not exists "stripe_latest_billing_event_id_encrypted" text,
  add column if not exists "stripe_latest_checkout_session_id_encrypted" text;
