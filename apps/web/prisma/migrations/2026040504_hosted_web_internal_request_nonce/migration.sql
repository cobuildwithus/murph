create table "hosted_web_internal_request_nonce" (
  "nonce_hash" text not null,
  "user_id" text not null,
  "method" text not null,
  "path" text not null,
  "search" text not null default '',
  "created_at" timestamp(3) not null default current_timestamp,
  "expires_at" timestamp(3) not null,

  constraint "hosted_web_internal_request_nonce_pkey" primary key ("nonce_hash")
);

create index "hosted_web_internal_request_nonce_user_id_expires_at_idx"
  on "hosted_web_internal_request_nonce" ("user_id", "expires_at");

create index "hosted_web_internal_request_nonce_expires_at_idx"
  on "hosted_web_internal_request_nonce" ("expires_at");
