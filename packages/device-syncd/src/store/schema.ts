/**
 * Device-sync schema bootstrap owns the SQLite migration boundary so the main
 * store file does not also carry table layout and account/job/webhook logic.
 */

import type { DatabaseSync } from "node:sqlite";

export const DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION = 2;

function addColumnIfMissing(
  database: DatabaseSync,
  tableName: string,
  columnName: string,
  definition: string,
): boolean {
  const columns = new Set(
    (database.prepare(`pragma table_info(${tableName})`).all() as Array<{ name?: string }>)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );

  if (columns.has(columnName)) {
    return false;
  }

  database.exec(`alter table ${tableName} add column ${columnName} ${definition};`);
  return true;
}

function backfillLegacyDeviceObservationRevisions(database: DatabaseSync): void {
  database.exec(`
    update device_observation_state as observation
    set local_connection_revision = 1
    where local_connection_revision = 0
      and hosted_observed_updated_at is not null
      and exists (
        select 1
        from device_connection as connection
        where connection.id = observation.account_id
          and connection.updated_at <> observation.hosted_observed_updated_at
      );

    update device_observation_state as observation
    set local_token_revision = 1
    where local_token_revision = 0
      and hosted_observed_token_version is not null
      and hosted_observed_updated_at is not null
      and exists (
        select 1
        from device_credential_state as credential
        where credential.account_id = observation.account_id
          and credential.updated_at <> observation.hosted_observed_updated_at
      );
  `);
}

export function ensureDeviceSyncStoreSchema(database: DatabaseSync): void {
  database.exec(`
      create table if not exists oauth_state (
        state text primary key,
        provider text not null,
        return_to text,
        metadata_json text not null,
        created_at text not null,
        expires_at text not null
      );

      create index if not exists oauth_state_expires_idx
      on oauth_state (expires_at);

      create table if not exists device_connection (
        id text primary key,
        provider text not null,
        external_account_id text not null,
        display_name text,
        status text not null,
        scopes_json text not null,
        disconnect_generation integer not null default 0,
        metadata_json text not null,
        connected_at text not null,
        created_at text not null,
        updated_at text not null,
        unique (provider, external_account_id)
      );

      create index if not exists device_connection_provider_idx
      on device_connection (provider, updated_at desc);

      create table if not exists device_credential_state (
        account_id text primary key references device_connection(id) on delete cascade,
        access_token_encrypted text not null,
        refresh_token_encrypted text,
        access_token_expires_at text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists device_observation_state (
        account_id text primary key references device_connection(id) on delete cascade,
        hosted_observed_updated_at text,
        hosted_observed_connection_revision integer not null default 0,
        hosted_observed_token_version integer,
        hosted_observed_token_revision integer not null default 0,
        local_connection_revision integer not null default 0,
        local_token_revision integer not null default 0,
        last_webhook_at text,
        last_sync_started_at text,
        last_sync_completed_at text,
        last_sync_error_at text,
        last_error_code text,
        last_error_message text,
        next_reconcile_at text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists device_job (
        id text primary key,
        provider text not null,
        account_id text not null references device_connection(id) on delete cascade,
        kind text not null,
        payload_json text not null,
        priority integer not null default 0,
        available_at text not null,
        attempts integer not null default 0,
        max_attempts integer not null default 5,
        dedupe_key text,
        status text not null,
        lease_owner text,
        lease_expires_at text,
        last_error_code text,
        last_error_message text,
        created_at text not null,
        updated_at text not null,
        started_at text,
        finished_at text
      );

      create index if not exists device_job_claim_idx
      on device_job (status, available_at asc, priority desc, created_at asc);

      create index if not exists device_job_account_idx
      on device_job (account_id, status, created_at desc);

      create index if not exists device_job_account_running_idx
      on device_job (account_id, status, lease_expires_at);

      create table if not exists webhook_trace (
        provider text not null,
        trace_id text not null,
        external_account_id text not null,
        event_type text not null,
        received_at text not null,
        payload_json text not null,
        status text not null default 'processed',
        processing_expires_at text,
        primary key (provider, trace_id)
      );

      create index if not exists webhook_trace_received_idx
      on webhook_trace (received_at desc);
    `);

  const addedHostedObservedConnectionRevision = addColumnIfMissing(
    database,
    "device_observation_state",
    "hosted_observed_connection_revision",
    "integer not null default 0",
  );
  const addedHostedObservedTokenRevision = addColumnIfMissing(
    database,
    "device_observation_state",
    "hosted_observed_token_revision",
    "integer not null default 0",
  );
  const addedLocalConnectionRevision = addColumnIfMissing(
    database,
    "device_observation_state",
    "local_connection_revision",
    "integer not null default 0",
  );
  const addedLocalTokenRevision = addColumnIfMissing(
    database,
    "device_observation_state",
    "local_token_revision",
    "integer not null default 0",
  );

  if (
    addedHostedObservedConnectionRevision
    || addedHostedObservedTokenRevision
    || addedLocalConnectionRevision
    || addedLocalTokenRevision
  ) {
    backfillLegacyDeviceObservationRevisions(database);
  }
}
