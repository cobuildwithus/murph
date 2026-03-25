create table "device_browser_assertion_nonce" (
  "nonce_hash" text not null,
  "user_id" text not null,
  "method" text not null,
  "path" text not null,
  "created_at" timestamptz not null default now(),
  "expires_at" timestamptz not null,
  constraint "device_browser_assertion_nonce_pkey" primary key ("nonce_hash")
);

create index "device_browser_assertion_nonce_user_id_expires_at_idx"
  on "device_browser_assertion_nonce" ("user_id", "expires_at");

create index "device_browser_assertion_nonce_expires_at_idx"
  on "device_browser_assertion_nonce" ("expires_at");
