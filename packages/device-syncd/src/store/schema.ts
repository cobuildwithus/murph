/**
 * Device-sync schema bootstrap owns the SQLite migration boundary so the main
 * store file does not also carry table layout and account/job/webhook logic.
 */

import type { DatabaseSync } from "node:sqlite";

// v10: device_connection_source.lifecycle_epoch (exact-source reconnect fence).
export const DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION = 10;

interface SqliteTableColumn {
  name?: unknown;
  notnull?: unknown;
}

const DEVICE_CREDENTIAL_STATE_MIGRATION_TABLE =
  "device_credential_state_legacy_credential_kind_migration";
const DEVICE_CONNECTION_SETUP_COLUMNS = {
  setupPhase: "setup_phase",
  setupExpiresAt: "setup_expires_at",
} as const;

function tableExists(database: DatabaseSync, tableName: string): boolean {
  const row = database.prepare(`
    select name
    from sqlite_master
    where type = 'table' and name = ?
  `).get(tableName) as { name?: string } | undefined;

  return row?.name === tableName;
}

function readDeviceCredentialStateColumns(database: DatabaseSync): SqliteTableColumn[] {
  return database.prepare("pragma table_info(device_credential_state)").all() as SqliteTableColumn[];
}

function readDeviceConnectionColumns(database: DatabaseSync): SqliteTableColumn[] {
  return database.prepare("pragma table_info(device_connection)").all() as SqliteTableColumn[];
}

function readOAuthStateColumns(database: DatabaseSync): SqliteTableColumn[] {
  return database.prepare("pragma table_info(oauth_state)").all() as SqliteTableColumn[];
}

function readConnectionSourceColumns(database: DatabaseSync): SqliteTableColumn[] {
  return database.prepare("pragma table_info(device_connection_source)").all() as SqliteTableColumn[];
}

function readWebhookTraceColumns(database: DatabaseSync): SqliteTableColumn[] {
  return database.prepare("pragma table_info(webhook_trace)").all() as SqliteTableColumn[];
}

function columnNames(columns: readonly SqliteTableColumn[]): Set<string> {
  return new Set(
    columns
      .map((column) => column.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

function isAccessTokenColumnNullable(columns: readonly SqliteTableColumn[]): boolean {
  const accessTokenColumn = columns.find((column) => column.name === "access_token_encrypted");
  return accessTokenColumn?.notnull === 0;
}

function isCurrentDeviceCredentialStateSchema(columns: readonly SqliteTableColumn[]): boolean {
  const names = columnNames(columns);

  return names.has("credential_kind")
    && names.has("provider_config_key")
    && names.has("credential_metadata_json")
    && isAccessTokenColumnNullable(columns);
}

function createDeviceCredentialStateTable(database: DatabaseSync): void {
  database.exec(`
    create table if not exists device_credential_state (
      account_id text primary key references device_connection(id) on delete cascade,
      credential_kind text not null default 'oauth_tokens',
      provider_config_key text,
      access_token_encrypted text,
      refresh_token_encrypted text,
      access_token_expires_at text,
      credential_metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null,
      check (credential_kind in ('oauth_tokens', 'provider_config', 'none')),
      check (
        (
          credential_kind = 'oauth_tokens'
          and provider_config_key is null
          and access_token_encrypted is not null
          and access_token_encrypted <> ''
        )
        or (
          credential_kind = 'provider_config'
          and provider_config_key is not null
          and access_token_encrypted is null
          and refresh_token_encrypted is null
          and access_token_expires_at is null
        )
        or (
          credential_kind = 'none'
          and provider_config_key is null
          and access_token_encrypted is null
          and refresh_token_encrypted is null
          and access_token_expires_at is null
        )
      )
    );
  `);
}

function ensureDeviceCredentialStateSchema(database: DatabaseSync): void {
  if (!tableExists(database, "device_credential_state")) {
    createDeviceCredentialStateTable(database);
    return;
  }

  const existingColumns = readDeviceCredentialStateColumns(database);
  if (isCurrentDeviceCredentialStateSchema(existingColumns)) {
    return;
  }

  database.exec(`
    drop table if exists ${DEVICE_CREDENTIAL_STATE_MIGRATION_TABLE};

    alter table device_credential_state
    rename to ${DEVICE_CREDENTIAL_STATE_MIGRATION_TABLE};
  `);

  createDeviceCredentialStateTable(database);

  database.exec(`
    insert into device_credential_state (
      account_id,
      credential_kind,
      provider_config_key,
      access_token_encrypted,
      refresh_token_encrypted,
      access_token_expires_at,
      credential_metadata_json,
      created_at,
      updated_at
    )
    select
      account_id,
      case
        when access_token_encrypted is null or access_token_encrypted = '' then 'none'
        else 'oauth_tokens'
      end,
      null,
      case
        when access_token_encrypted is null or access_token_encrypted = '' then null
        else access_token_encrypted
      end,
      case
        when access_token_encrypted is null or access_token_encrypted = '' then null
        else refresh_token_encrypted
      end,
      case
        when access_token_encrypted is null or access_token_encrypted = '' then null
        else access_token_expires_at
      end,
      '{}',
      created_at,
      updated_at
    from ${DEVICE_CREDENTIAL_STATE_MIGRATION_TABLE};

    drop table ${DEVICE_CREDENTIAL_STATE_MIGRATION_TABLE};
  `);

  clearLegacyEmptyTokenCredentials(database);
}

function ensureDeviceConnectionSetupColumns(database: DatabaseSync): void {
  const names = columnNames(readDeviceConnectionColumns(database));

  if (!names.has(DEVICE_CONNECTION_SETUP_COLUMNS.setupPhase)) {
    database.exec("alter table device_connection add column setup_phase text");
  }

  if (!names.has(DEVICE_CONNECTION_SETUP_COLUMNS.setupExpiresAt)) {
    database.exec("alter table device_connection add column setup_expires_at text");
  }
}

function ensureHostedConnectionIdentityColumn(database: DatabaseSync): void {
  const names = columnNames(readDeviceConnectionColumns(database));

  if (!names.has("hosted_connection_id")) {
    database.exec("alter table device_connection add column hosted_connection_id text");
  }

  database.exec(`
    create unique index if not exists device_connection_hosted_connection_id_idx
    on device_connection (hosted_connection_id)
    where hosted_connection_id is not null
  `);
}

/**
 * `last_seen_at` records that the provider still lists this source, so a
 * reconcile refreshes it whether or not any data arrived. `last_data_at`
 * records the last inbound payload that actually carried this source's data,
 * which is the only signal that can distinguish a live push carrier from one
 * the provider has silently stopped feeding. It stays null until the first
 * such payload lands.
 */
function ensureConnectionSourceLastDataColumn(database: DatabaseSync): void {
  if (!tableExists(database, "device_connection_source")) {
    return;
  }

  const names = columnNames(readConnectionSourceColumns(database));
  if (!names.has("last_data_at")) {
    database.exec("alter table device_connection_source add column last_data_at text");
  }
}

function ensureConnectionSourceLifecycleEpochColumn(database: DatabaseSync): void {
  if (!tableExists(database, "device_connection_source")) {
    return;
  }

  const names = columnNames(readConnectionSourceColumns(database));
  if (!names.has("lifecycle_epoch")) {
    database.exec(
      "alter table device_connection_source add column lifecycle_epoch integer not null default 1",
    );
  }
}

function ensureWebhookTraceClaimTokenColumn(database: DatabaseSync): void {
  if (!tableExists(database, "webhook_trace")) {
    return;
  }

  const names = columnNames(readWebhookTraceColumns(database));
  if (!names.has("claim_token")) {
    database.exec("alter table webhook_trace add column claim_token text");
  }
}

function ensureOAuthStateColumns(database: DatabaseSync): void {
  if (!tableExists(database, "oauth_state")) {
    return;
  }

  const names = columnNames(readOAuthStateColumns(database));
  if (!names.has("owner_id")) {
    database.exec("alter table oauth_state add column owner_id text");
  }
  if (!names.has("consumed_at")) {
    database.exec("alter table oauth_state add column consumed_at text");
  }
}

function clearLegacyEmptyTokenCredentials(database: DatabaseSync): void {
  if (!tableExists(database, "device_credential_state")) {
    return;
  }

  database.exec(`
    update device_credential_state
    set credential_kind = 'none',
        provider_config_key = null,
        access_token_encrypted = null,
        refresh_token_encrypted = null,
        access_token_expires_at = null
    where credential_kind = 'oauth_tokens'
      and (access_token_encrypted is null or access_token_encrypted = '');

    update device_credential_state
    set access_token_encrypted = null
    where credential_kind in ('provider_config', 'none')
      and access_token_encrypted = '';
  `);
}

export function ensureDeviceSyncStoreSchema(database: DatabaseSync): void {
  database.exec(`
      create table if not exists oauth_state (
        state text primary key,
        provider text not null,
        owner_id text,
        return_to text,
        metadata_json text not null,
        created_at text not null,
        expires_at text not null,
        consumed_at text
      );

      create index if not exists oauth_state_expires_idx
      on oauth_state (expires_at);

      create table if not exists device_connection (
        id text primary key,
        hosted_connection_id text,
        provider text not null,
        external_account_id text not null,
        display_name text,
        status text not null,
        setup_phase text,
        setup_expires_at text,
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

      create table if not exists device_connection_source (
        id text primary key,
        connection_id text not null references device_connection(id) on delete cascade,
        source_instance_key text not null,
        source_provider_slug text not null,
        display_name text,
        status text not null,
        resource_availability_summary_json text not null default '{}',
        last_error_code text,
        last_error_message text,
        lifecycle_epoch integer not null default 1,
        first_seen_at text not null,
        last_seen_at text not null,
        last_data_at text,
        created_at text not null,
        updated_at text not null,
        unique (connection_id, source_instance_key),
        check (status in ('connected', 'unavailable', 'error', 'disconnected'))
      );

      create index if not exists device_connection_source_list_idx
      on device_connection_source (
        connection_id,
        last_seen_at desc,
        source_provider_slug asc,
        source_instance_key asc
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
        claim_token text,
        primary key (provider, trace_id)
      );

      create index if not exists webhook_trace_received_idx
      on webhook_trace (received_at desc);
    `);

  ensureDeviceCredentialStateSchema(database);
  ensureOAuthStateColumns(database);
  ensureDeviceConnectionSetupColumns(database);
  ensureHostedConnectionIdentityColumn(database);
  ensureWebhookTraceClaimTokenColumn(database);
  ensureConnectionSourceLastDataColumn(database);
  ensureConnectionSourceLifecycleEpochColumn(database);
  clearLegacyEmptyTokenCredentials(database);
}
