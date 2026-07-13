alter table "device_connection"
  add column "disconnect_lease_owner" text,
  add column "disconnect_lease_expires_at" timestamptz(3);
