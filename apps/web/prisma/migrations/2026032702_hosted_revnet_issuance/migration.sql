create type "HostedRevnetIssuanceStatus" as enum ('pending', 'submitting', 'submitted', 'confirmed', 'failed');

create table "hosted_revnet_issuance" (
  "id" text not null,
  "member_id" text not null,
  "idempotency_key" text not null,
  "stripe_invoice_id" text not null,
  "stripe_payment_intent_id" text,
  "stripe_charge_id" text,
  "chain_id" integer not null,
  "project_id" text not null,
  "terminal_address" text not null,
  "token_address" text not null,
  "beneficiary_address" text not null,
  "payment_amount_minor" integer not null,
  "payment_currency" text not null,
  "terminal_token_amount" text not null,
  "status" "HostedRevnetIssuanceStatus" not null default 'pending',
  "approval_tx_hash" text,
  "pay_tx_hash" text,
  "failure_code" text,
  "failure_message" text,
  "submitted_at" timestamptz,
  "confirmed_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null,
  constraint "hosted_revnet_issuance_pkey" primary key ("id"),
  constraint "hosted_revnet_issuance_member_id_fkey"
    foreign key ("member_id") references "hosted_member" ("id")
    on delete cascade on update cascade
);

create unique index "hosted_revnet_issuance_idempotency_key_key"
  on "hosted_revnet_issuance" ("idempotency_key");

create unique index "hosted_revnet_issuance_stripe_invoice_id_key"
  on "hosted_revnet_issuance" ("stripe_invoice_id");

create unique index "hosted_revnet_issuance_approval_tx_hash_key"
  on "hosted_revnet_issuance" ("approval_tx_hash");

create unique index "hosted_revnet_issuance_pay_tx_hash_key"
  on "hosted_revnet_issuance" ("pay_tx_hash");

create index "hosted_revnet_issuance_member_id_created_at_idx"
  on "hosted_revnet_issuance" ("member_id", "created_at");

create index "hosted_revnet_issuance_status_created_at_idx"
  on "hosted_revnet_issuance" ("status", "created_at");

create index "hosted_revnet_issuance_stripe_payment_intent_id_idx"
  on "hosted_revnet_issuance" ("stripe_payment_intent_id");

create index "hosted_revnet_issuance_stripe_charge_id_idx"
  on "hosted_revnet_issuance" ("stripe_charge_id");
