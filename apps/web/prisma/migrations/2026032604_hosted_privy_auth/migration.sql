alter table "hosted_member"
  add column "privy_user_id" text,
  add column "wallet_address" text,
  add column "wallet_chain_type" text,
  add column "wallet_provider" text,
  add column "wallet_created_at" timestamptz;

create unique index "hosted_member_privy_user_id_key"
  on "hosted_member" ("privy_user_id");

create unique index "hosted_member_wallet_address_key"
  on "hosted_member" ("wallet_address");
