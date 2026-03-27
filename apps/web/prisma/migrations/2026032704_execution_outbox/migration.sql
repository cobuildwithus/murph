create type "ExecutionOutboxStatus" as enum ('pending', 'dispatching', 'accepted', 'completed', 'failed');

create table "execution_outbox" (
  "id" text not null,
  "user_id" text not null,
  "source_type" text not null,
  "source_id" text,
  "event_id" text not null,
  "event_kind" text not null,
  "payload_json" jsonb not null,
  "status" "ExecutionOutboxStatus" not null default 'pending',
  "attempt_count" integer not null default 0,
  "last_attempt_at" timestamptz,
  "next_attempt_at" timestamptz not null default now(),
  "claim_token" text,
  "claim_expires_at" timestamptz,
  "accepted_at" timestamptz,
  "completed_at" timestamptz,
  "failed_at" timestamptz,
  "last_error" text,
  "last_status_json" jsonb,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null,
  constraint "execution_outbox_pkey" primary key ("id")
);

create unique index "execution_outbox_event_id_key"
  on "execution_outbox" ("event_id");

create index "execution_outbox_status_next_attempt_at_created_at_idx"
  on "execution_outbox" ("status", "next_attempt_at", "created_at");

create index "execution_outbox_user_id_created_at_idx"
  on "execution_outbox" ("user_id", "created_at");
