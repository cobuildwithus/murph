alter table "device_webhook_trace"
  add column if not exists "status" text not null default 'processed',
  add column if not exists "processing_expires_at" timestamptz;

update "device_webhook_trace"
set "status" = 'processed'
where "status" is null;
