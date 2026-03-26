create table "hosted_share_link" (
  "id" text not null,
  "code_hash" text not null,
  "sender_member_id" text,
  "preview_title" text not null,
  "preview_json" jsonb,
  "encrypted_payload" text not null,
  "encryption_key_version" text not null,
  "expires_at" timestamptz not null,
  "accepted_at" timestamptz,
  "accepted_by_member_id" text,
  "consumed_at" timestamptz,
  "consumed_by_member_id" text,
  "last_event_id" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null,
  constraint "hosted_share_link_pkey" primary key ("id")
);

create unique index "hosted_share_link_code_hash_key"
  on "hosted_share_link" ("code_hash");

create index "hosted_share_link_sender_member_id_created_at_idx"
  on "hosted_share_link" ("sender_member_id", "created_at");

create index "hosted_share_link_expires_at_idx"
  on "hosted_share_link" ("expires_at");

create index "hosted_share_link_accepted_by_member_id_accepted_at_idx"
  on "hosted_share_link" ("accepted_by_member_id", "accepted_at");

create index "hosted_share_link_consumed_by_member_id_consumed_at_idx"
  on "hosted_share_link" ("consumed_by_member_id", "consumed_at");
