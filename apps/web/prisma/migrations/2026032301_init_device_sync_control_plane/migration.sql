create type "DeviceConnectionStatus" as enum ('active', 'reauthorization_required', 'disconnected');

create table "device_connection" (
  "id" text not null,
  "user_id" text not null,
  "provider" text not null,
  "external_account_id" text not null,
  "display_name" text,
  "status" "DeviceConnectionStatus" not null default 'active',
  "scopes" text[] not null default '{}',
  "access_token_expires_at" timestamptz,
  "metadata_json" jsonb not null default '{}'::jsonb,
  "connected_at" timestamptz not null,
  "last_webhook_at" timestamptz,
  "last_sync_started_at" timestamptz,
  "last_sync_completed_at" timestamptz,
  "last_sync_error_at" timestamptz,
  "last_error_code" text,
  "last_error_message" text,
  "next_reconcile_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "device_connection_pkey" primary key ("id")
);

create unique index "device_connection_provider_external_account_id_key"
  on "device_connection" ("provider", "external_account_id");

create index "device_connection_user_id_provider_idx"
  on "device_connection" ("user_id", "provider");

create table "device_connection_secret" (
  "connection_id" text not null,
  "access_token_encrypted" text not null,
  "refresh_token_encrypted" text,
  "token_version" integer not null default 1,
  "key_version" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "device_connection_secret_pkey" primary key ("connection_id"),
  constraint "device_connection_secret_connection_id_fkey"
    foreign key ("connection_id") references "device_connection"("id")
    on delete cascade on update cascade
);

create table "device_oauth_session" (
  "state" text not null,
  "user_id" text,
  "provider" text not null,
  "return_to" text,
  "metadata_json" jsonb not null default '{}'::jsonb,
  "created_at" timestamptz not null,
  "expires_at" timestamptz not null,
  constraint "device_oauth_session_pkey" primary key ("state")
);

create index "device_oauth_session_expires_at_idx"
  on "device_oauth_session" ("expires_at");

create index "device_oauth_session_user_id_provider_idx"
  on "device_oauth_session" ("user_id", "provider");

create table "device_webhook_trace" (
  "provider" text not null,
  "trace_id" text not null,
  "external_account_id" text not null,
  "event_type" text not null,
  "received_at" timestamptz not null,
  "payload_json" jsonb,
  "created_at" timestamptz not null default now(),
  constraint "device_webhook_trace_pkey" primary key ("provider", "trace_id")
);

create index "device_webhook_trace_provider_external_account_id_idx"
  on "device_webhook_trace" ("provider", "external_account_id");

create index "device_webhook_trace_received_at_idx"
  on "device_webhook_trace" ("received_at");

create table "device_sync_signal" (
  "id" serial not null,
  "user_id" text not null,
  "connection_id" text,
  "provider" text not null,
  "kind" text not null,
  "payload_json" jsonb,
  "created_at" timestamptz not null default now(),
  constraint "device_sync_signal_pkey" primary key ("id"),
  constraint "device_sync_signal_connection_id_fkey"
    foreign key ("connection_id") references "device_connection"("id")
    on delete cascade on update cascade
);

create index "device_sync_signal_user_id_id_idx"
  on "device_sync_signal" ("user_id", "id");

create index "device_sync_signal_connection_id_idx"
  on "device_sync_signal" ("connection_id");

create table "device_agent_session" (
  "id" text not null,
  "user_id" text not null,
  "label" text,
  "token_hash" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "last_seen_at" timestamptz,
  "revoked_at" timestamptz,
  constraint "device_agent_session_pkey" primary key ("id")
);

create unique index "device_agent_session_token_hash_key"
  on "device_agent_session" ("token_hash");

create index "device_agent_session_user_id_idx"
  on "device_agent_session" ("user_id");

create index "device_agent_session_revoked_at_idx"
  on "device_agent_session" ("revoked_at");
