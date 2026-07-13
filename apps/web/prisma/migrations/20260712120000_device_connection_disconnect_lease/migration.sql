alter table "device_connection"
  add column "disconnect_lease_owner" text,
  add column "disconnect_lease_expires_at" timestamptz(3);

alter table "device_connection"
  add constraint "device_connection_disconnect_lease_pair_check"
  check (
    ("disconnect_lease_owner" is null and "disconnect_lease_expires_at" is null)
    or
    ("disconnect_lease_owner" is not null and "disconnect_lease_expires_at" is not null)
  );
