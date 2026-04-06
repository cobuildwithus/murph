alter table "device_connection"
  drop column if exists "status",
  drop column if exists "scopes",
  drop column if exists "access_token_expires_at",
  drop column if exists "metadata_json",
  drop column if exists "last_webhook_at",
  drop column if exists "last_sync_started_at",
  drop column if exists "last_sync_completed_at",
  drop column if exists "last_sync_error_at",
  drop column if exists "last_error_code",
  drop column if exists "last_error_message",
  drop column if exists "next_reconcile_at";

drop type if exists "DeviceConnectionStatus";
