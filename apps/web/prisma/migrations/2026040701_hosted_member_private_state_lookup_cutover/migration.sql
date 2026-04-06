-- Hard cutover: move recoverable hosted-member provider identifiers out of Postgres
-- and into Cloudflare-owned encrypted member-private-state objects. Postgres keeps
-- only blind lookup keys needed for equality joins and routing.
--
-- This migration is intentionally destructive for existing raw identifiers. In a
-- non-greenfield environment, backfill raw values into Cloudflare member-private-state
-- storage before applying this migration.

alter table "hosted_member_identity"
  add column if not exists "privy_user_lookup_key" text,
  add column if not exists "wallet_address_lookup_key" text;

alter table "hosted_member_routing"
  add column if not exists "linq_chat_lookup_key" text;

alter table "hosted_member_billing_ref"
  add column if not exists "stripe_customer_lookup_key" text,
  add column if not exists "stripe_subscription_lookup_key" text;

alter table "hosted_member_identity"
  drop column if exists "privy_user_id",
  drop column if exists "wallet_address";

alter table "hosted_member_routing"
  drop column if exists "linq_chat_id";

alter table "hosted_member_billing_ref"
  drop column if exists "stripe_customer_id",
  drop column if exists "stripe_subscription_id",
  drop column if exists "stripe_latest_checkout_session_id",
  drop column if exists "stripe_latest_billing_event_id";

create unique index if not exists "hosted_member_identity_privy_user_lookup_key_key"
  on "hosted_member_identity" ("privy_user_lookup_key");

create unique index if not exists "hosted_member_identity_wallet_address_lookup_key_key"
  on "hosted_member_identity" ("wallet_address_lookup_key");

create unique index if not exists "hosted_member_routing_linq_chat_lookup_key_key"
  on "hosted_member_routing" ("linq_chat_lookup_key");

create unique index if not exists "hosted_member_billing_ref_stripe_customer_lookup_key_key"
  on "hosted_member_billing_ref" ("stripe_customer_lookup_key");

create unique index if not exists "hosted_member_billing_ref_stripe_subscription_lookup_key_key"
  on "hosted_member_billing_ref" ("stripe_subscription_lookup_key");
