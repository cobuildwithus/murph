create table "linq_recipient_binding" (
  "id" text not null,
  "user_id" text not null,
  "recipient_phone" text not null,
  "label" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "linq_recipient_binding_pkey" primary key ("id")
);

create unique index "linq_recipient_binding_recipient_phone_key"
  on "linq_recipient_binding" ("recipient_phone");

create index "linq_recipient_binding_user_id_recipient_phone_idx"
  on "linq_recipient_binding" ("user_id", "recipient_phone");

create table "linq_webhook_event" (
  "id" serial not null,
  "user_id" text not null,
  "binding_id" text not null,
  "recipient_phone" text not null,
  "event_id" text not null,
  "trace_id" text,
  "event_type" text not null,
  "chat_id" text,
  "message_id" text,
  "occurred_at" timestamptz,
  "received_at" timestamptz not null,
  "payload_json" jsonb not null,
  "created_at" timestamptz not null default now(),
  constraint "linq_webhook_event_pkey" primary key ("id"),
  constraint "linq_webhook_event_binding_id_fkey"
    foreign key ("binding_id") references "linq_recipient_binding"("id")
    on delete cascade on update cascade
);

create unique index "linq_webhook_event_event_id_key"
  on "linq_webhook_event" ("event_id");

create index "linq_webhook_event_user_id_id_idx"
  on "linq_webhook_event" ("user_id", "id");

create index "linq_webhook_event_binding_id_id_idx"
  on "linq_webhook_event" ("binding_id", "id");

create index "linq_webhook_event_recipient_phone_id_idx"
  on "linq_webhook_event" ("recipient_phone", "id");

create index "linq_webhook_event_received_at_idx"
  on "linq_webhook_event" ("received_at");
