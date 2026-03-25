alter table "device_agent_session"
  add column "expires_at" timestamptz,
  add column "revoke_reason" text,
  add column "replaced_by_session_id" text;

update "device_agent_session"
set "expires_at" = coalesce("updated_at", "created_at") + interval '24 hours'
where "expires_at" is null;

alter table "device_agent_session"
  alter column "expires_at" set not null;

create index "device_agent_session_expires_at_idx"
  on "device_agent_session" ("expires_at");

create index "device_agent_session_replaced_by_session_id_idx"
  on "device_agent_session" ("replaced_by_session_id");
