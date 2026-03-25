create type "HostedMemberStatus" as enum ('invited', 'registered', 'active', 'suspended');
create type "HostedInviteStatus" as enum ('pending', 'opened', 'authenticated', 'paid', 'expired');
create type "HostedPasskeyChallengeType" as enum ('registration', 'authentication');
create type "HostedBillingStatus" as enum ('not_started', 'checkout_open', 'active', 'incomplete', 'past_due', 'canceled', 'unpaid', 'paused');
create type "HostedBillingMode" as enum ('payment', 'subscription');
create type "HostedBillingCheckoutStatus" as enum ('open', 'completed', 'expired', 'failed');

create table "hosted_member" (
  "id" text not null,
  "phone_number" text not null,
  "normalized_phone_number" text not null,
  "phone_number_verified_at" timestamptz,
  "webauthn_user_id" text not null,
  "status" "HostedMemberStatus" not null default 'invited',
  "billing_status" "HostedBillingStatus" not null default 'not_started',
  "billing_mode" "HostedBillingMode",
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_latest_checkout_session_id" text,
  "linq_chat_id" text,
  "encrypted_bootstrap_secret" text,
  "encryption_key_version" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null,
  constraint "hosted_member_pkey" primary key ("id")
);

create unique index "hosted_member_normalized_phone_number_key"
  on "hosted_member" ("normalized_phone_number");
create unique index "hosted_member_webauthn_user_id_key"
  on "hosted_member" ("webauthn_user_id");
create unique index "hosted_member_stripe_customer_id_key"
  on "hosted_member" ("stripe_customer_id");
create unique index "hosted_member_stripe_subscription_id_key"
  on "hosted_member" ("stripe_subscription_id");
create index "hosted_member_status_idx"
  on "hosted_member" ("status");
create index "hosted_member_billing_status_idx"
  on "hosted_member" ("billing_status");

create table "hosted_invite" (
  "id" text not null,
  "member_id" text not null,
  "invite_code" text not null,
  "status" "HostedInviteStatus" not null default 'pending',
  "channel" text not null default 'linq',
  "trigger_text" text,
  "linq_event_id" text,
  "linq_chat_id" text,
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

create table "hosted_passkey" (
  "id" text not null,
  "member_id" text not null,
  "credential_id" text not null,
  "public_key" bytea not null,
  "counter" integer not null default 0,
  "transports" text[] not null default '{}',
  "device_type" text,
  "backed_up" boolean not null default false,
  "created_at" timestamptz not null default now(),
  "last_used_at" timestamptz,
  constraint "hosted_passkey_pkey" primary key ("id"),
  constraint "hosted_passkey_member_id_fkey" foreign key ("member_id") references "hosted_member" ("id") on delete cascade on update cascade
);

create unique index "hosted_passkey_credential_id_key"
  on "hosted_passkey" ("credential_id");
create index "hosted_passkey_member_id_idx"
  on "hosted_passkey" ("member_id");

create table "hosted_session" (
  "id" text not null,
  "member_id" text not null,
  "invite_id" text,
  "token_hash" text not null,
  "user_agent" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null,
  "expires_at" timestamptz not null,
  "last_seen_at" timestamptz,
  "revoked_at" timestamptz,
  "revoke_reason" text,
  constraint "hosted_session_pkey" primary key ("id"),
  constraint "hosted_session_member_id_fkey" foreign key ("member_id") references "hosted_member" ("id") on delete cascade on update cascade,
  constraint "hosted_session_invite_id_fkey" foreign key ("invite_id") references "hosted_invite" ("id") on delete set null on update cascade
);

create unique index "hosted_session_token_hash_key"
  on "hosted_session" ("token_hash");
create index "hosted_session_member_id_idx"
  on "hosted_session" ("member_id");
create index "hosted_session_invite_id_idx"
  on "hosted_session" ("invite_id");
create index "hosted_session_expires_at_idx"
  on "hosted_session" ("expires_at");
create index "hosted_session_revoked_at_idx"
  on "hosted_session" ("revoked_at");

create table "hosted_passkey_challenge" (
  "id" text not null,
  "member_id" text not null,
  "invite_id" text,
  "type" "HostedPasskeyChallengeType" not null,
  "challenge" text not null,
  "expires_at" timestamptz not null,
  "created_at" timestamptz not null default now(),
  constraint "hosted_passkey_challenge_pkey" primary key ("id"),
  constraint "hosted_passkey_challenge_member_id_fkey" foreign key ("member_id") references "hosted_member" ("id") on delete cascade on update cascade,
  constraint "hosted_passkey_challenge_invite_id_fkey" foreign key ("invite_id") references "hosted_invite" ("id") on delete set null on update cascade
);

create unique index "hosted_passkey_challenge_type_challenge_key"
  on "hosted_passkey_challenge" ("type", "challenge");
create index "hosted_passkey_challenge_member_id_type_expires_at_idx"
  on "hosted_passkey_challenge" ("member_id", "type", "expires_at");
create index "hosted_passkey_challenge_invite_id_type_expires_at_idx"
  on "hosted_passkey_challenge" ("invite_id", "type", "expires_at");
create index "hosted_passkey_challenge_expires_at_idx"
  on "hosted_passkey_challenge" ("expires_at");

create table "hosted_billing_checkout" (
  "id" text not null,
  "member_id" text not null,
  "invite_id" text,
  "stripe_checkout_session_id" text not null,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "price_id" text not null,
  "mode" "HostedBillingMode" not null,
  "status" "HostedBillingCheckoutStatus" not null default 'open',
  "checkout_url" text,
  "amount_total" integer,
  "currency" text,
  "created_at" timestamptz not null default now(),
  "completed_at" timestamptz,
  "expired_at" timestamptz,
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
  "payload_json" jsonb,
  "created_at" timestamptz not null default now(),
  constraint "hosted_webhook_receipt_pkey" primary key ("source", "event_id")
);

create index "hosted_webhook_receipt_first_received_at_idx"
  on "hosted_webhook_receipt" ("first_received_at");
