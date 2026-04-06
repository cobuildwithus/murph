create type "HostedMemberStatus" as enum ('invited', 'registered', 'suspended');
create type "HostedInviteStatus" as enum ('pending', 'opened', 'authenticated', 'paid', 'expired');
create type "HostedBillingStatus" as enum ('not_started', 'checkout_open', 'active', 'incomplete', 'past_due', 'canceled', 'unpaid', 'paused');
create type "HostedBillingMode" as enum ('payment', 'subscription');
create type "HostedBillingCheckoutStatus" as enum ('pending', 'open', 'completed', 'expired', 'failed', 'superseded');

create table "hosted_member" (
  "id" text not null,
  "status" "HostedMemberStatus" not null default 'invited',
  "billing_status" "HostedBillingStatus" not null default 'not_started',
  "billing_mode" "HostedBillingMode",
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null,
  constraint "hosted_member_pkey" primary key ("id")
);

create index "hosted_member_status_idx"
  on "hosted_member" ("status");
create index "hosted_member_billing_status_idx"
  on "hosted_member" ("billing_status");

create table "hosted_member_identity" (
  "member_id" text not null,
  "masked_phone_number_hint" text not null,
  "phone_lookup_key" text not null,
  "phone_number_verified_at" timestamptz,
  "privy_user_id" text,
  "wallet_address" text,
  "wallet_chain_type" text,
  "wallet_provider" text,
  "wallet_created_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "hosted_member_identity_pkey" primary key ("member_id"),
  constraint "hosted_member_identity_member_id_fkey" foreign key ("member_id") references "hosted_member" ("id") on delete cascade on update cascade
);

create unique index "hosted_member_identity_phone_lookup_key_key"
  on "hosted_member_identity" ("phone_lookup_key");
create unique index "hosted_member_identity_privy_user_id_key"
  on "hosted_member_identity" ("privy_user_id");
create unique index "hosted_member_identity_wallet_address_key"
  on "hosted_member_identity" ("wallet_address");

create table "hosted_member_routing" (
  "member_id" text not null,
  "linq_chat_id" text,
  "telegram_user_lookup_key" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "hosted_member_routing_pkey" primary key ("member_id"),
  constraint "hosted_member_routing_member_id_fkey" foreign key ("member_id") references "hosted_member" ("id") on delete cascade on update cascade
);

create unique index "hosted_member_routing_linq_chat_id_key"
  on "hosted_member_routing" ("linq_chat_id");
create unique index "hosted_member_routing_telegram_user_lookup_key_key"
  on "hosted_member_routing" ("telegram_user_lookup_key");

create table "hosted_member_billing_ref" (
  "member_id" text not null,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_latest_checkout_session_id" text,
  "stripe_latest_billing_event_created_at" timestamptz,
  "stripe_latest_billing_event_id" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "hosted_member_billing_ref_pkey" primary key ("member_id"),
  constraint "hosted_member_billing_ref_member_id_fkey" foreign key ("member_id") references "hosted_member" ("id") on delete cascade on update cascade
);

create unique index "hosted_member_billing_ref_stripe_customer_id_key"
  on "hosted_member_billing_ref" ("stripe_customer_id");
create unique index "hosted_member_billing_ref_stripe_subscription_id_key"
  on "hosted_member_billing_ref" ("stripe_subscription_id");

create table "hosted_invite" (
  "id" text not null,
  "member_id" text not null,
  "invite_code" text not null,
  "status" "HostedInviteStatus" not null default 'pending',
  "channel" text not null default 'linq',
  "sent_at" timestamptz,
  "opened_at" timestamptz,
  "authenticated_at" timestamptz,
  "paid_at" timestamptz,
  "expires_at" timestamptz not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null,
  constraint "hosted_invite_pkey" primary key ("id"),
  constraint "hosted_invite_member_id_fkey" foreign key ("member_id") references "hosted_member" ("id") on delete cascade on update cascade
);

create unique index "hosted_invite_invite_code_key"
  on "hosted_invite" ("invite_code");
create index "hosted_invite_member_id_created_at_idx"
  on "hosted_invite" ("member_id", "created_at");
create index "hosted_invite_expires_at_idx"
  on "hosted_invite" ("expires_at");

create table "hosted_billing_checkout" (
  "id" text not null,
  "member_id" text not null,
  "invite_id" text,
  "has_share_context" boolean not null default false,
  "stripe_checkout_session_id" text,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "price_id" text not null,
  "mode" "HostedBillingMode" not null,
  "status" "HostedBillingCheckoutStatus" not null default 'pending',
  "checkout_url" text,
  "amount_total" integer,
  "currency" text,
  "created_at" timestamptz not null default now(),
  "completed_at" timestamptz,
  "expired_at" timestamptz,
  "superseded_at" timestamptz,
  constraint "hosted_billing_checkout_pkey" primary key ("id"),
  constraint "hosted_billing_checkout_member_id_fkey" foreign key ("member_id") references "hosted_member" ("id") on delete cascade on update cascade,
  constraint "hosted_billing_checkout_invite_id_fkey" foreign key ("invite_id") references "hosted_invite" ("id") on delete set null on update cascade
);

create unique index "hosted_billing_checkout_stripe_checkout_session_id_key"
  on "hosted_billing_checkout" ("stripe_checkout_session_id");
create index "hosted_billing_checkout_member_id_created_at_idx"
  on "hosted_billing_checkout" ("member_id", "created_at");
create index "hosted_billing_checkout_invite_id_created_at_idx"
  on "hosted_billing_checkout" ("invite_id", "created_at");
create index "hosted_billing_checkout_stripe_customer_id_idx"
  on "hosted_billing_checkout" ("stripe_customer_id");
create index "hosted_billing_checkout_stripe_subscription_id_idx"
  on "hosted_billing_checkout" ("stripe_subscription_id");

create table "hosted_webhook_receipt" (
  "source" text not null,
  "event_id" text not null,
  "first_received_at" timestamptz not null,
  "claim_expires_at" timestamptz,
  "payload_json" jsonb,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "hosted_webhook_receipt_pkey" primary key ("source", "event_id")
);

create index "hosted_webhook_receipt_first_received_at_idx"
  on "hosted_webhook_receipt" ("first_received_at");
