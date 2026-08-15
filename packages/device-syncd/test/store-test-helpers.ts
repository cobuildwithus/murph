import { openSqliteRuntimeDatabase } from "@murphai/runtime-state/node";

import type { SqliteDeviceSyncStore } from "../src/store.ts";

export interface DeviceSyncJobRowForTesting {
  attempts: number;
  id: string;
  kind: string;
  last_error_code: string | null;
  last_error_message: string | null;
  status: string;
}

export interface DeviceSyncCredentialStateRowForTesting {
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
  credential_kind: string;
  credential_metadata_json: string;
  provider_config_key: string | null;
  refresh_token_encrypted: string | null;
}

export interface DeviceSyncObservationStateRowForTesting {
  hosted_observed_connection_revision: number;
  hosted_observed_token_revision: number;
  hosted_observed_token_version: number | null;
  hosted_observed_updated_at: string | null;
  last_error_code: string | null;
  last_webhook_at: string | null;
  local_connection_revision: number;
  local_token_revision: number;
  next_reconcile_at: string | null;
}

export interface DeviceSyncWebhookTraceLifecycleRowForTesting {
  processing_expires_at: string | null;
  status: string;
  trace_id: string;
}

export interface DeviceSyncWebhookTraceRowForTesting {
  external_account_id: string;
  payload_json: string;
  processing_expires_at: string | null;
  status: string;
}

interface InsertWebhookTraceRowForTestingInput {
  eventType: string;
  externalAccountId: string;
  payloadJson?: string;
  processingExpiresAt?: string | null;
  provider: string;
  receivedAt: string;
  status?: string;
  traceId: string;
}

function withStoreDatabase<T>(
  store: SqliteDeviceSyncStore,
  callback: (database: ReturnType<typeof openSqliteRuntimeDatabase>) => T,
): T {
  const database = openSqliteRuntimeDatabase(store.databasePath);

  try {
    return callback(database);
  } finally {
    database.close();
  }
}

function assertSqlIdentifier(name: string): string {
  if (!/^[a-z_]+$/u.test(name)) {
    throw new TypeError(`Unsupported sqlite identifier ${name}`);
  }

  return name;
}

export function readTableColumnsForTesting(store: SqliteDeviceSyncStore, tableName: string): string[] {
  return withStoreDatabase(store, (database) =>
    (
      database.prepare(`pragma table_info(${assertSqlIdentifier(tableName)})`).all() as Array<{ name?: string }>
    )
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"));
}

export function readNamedSqliteTablesForTesting(
  store: SqliteDeviceSyncStore,
  tableNames: readonly string[],
): string[] {
  if (tableNames.length === 0) {
    return [];
  }

  return withStoreDatabase(store, (database) => {
    const placeholderList = tableNames.map(() => "?").join(", ");

    return (
      database.prepare(`
        select name
        from sqlite_master
        where type = 'table'
          and name in (${placeholderList})
        order by name asc
      `).all(...tableNames) as Array<{ name?: string }>
    )
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string");
  });
}

export function countJobsForAccountForTesting(store: SqliteDeviceSyncStore, accountId: string): number {
  return withStoreDatabase(store, (database) =>
    (
      database.prepare(`
        select count(*) as total
        from device_job
        where account_id = ?
      `).get(accountId) as { total?: number } | undefined
    )?.total ?? 0);
}

export function listJobKindsForAccountForTesting(store: SqliteDeviceSyncStore, accountId: string): string[] {
  return withStoreDatabase(store, (database) =>
    (
      database.prepare(`
        select kind
        from device_job
        where account_id = ?
        order by created_at asc, id asc
      `).all(accountId) as Array<{ kind?: string }>
    )
      .map((row) => row.kind)
      .filter((kind): kind is string => typeof kind === "string"));
}

export function readJobsForAccountForTesting(
  store: SqliteDeviceSyncStore,
  accountId: string,
): DeviceSyncJobRowForTesting[] {
  return withStoreDatabase(store, (database) =>
    (database.prepare(`
      select id, kind, status, attempts, last_error_code, last_error_message
      from device_job
      where account_id = ?
      order by created_at asc, id asc
    `).all(accountId) as Array<Record<string, unknown>>).map((row) => ({
      attempts: typeof row.attempts === "number" ? row.attempts : Number(row.attempts ?? 0),
      id: String(row.id ?? ""),
      kind: String(row.kind ?? ""),
      last_error_code: row.last_error_code === null || typeof row.last_error_code === "string"
        ? row.last_error_code
        : String(row.last_error_code),
      last_error_message: row.last_error_message === null || typeof row.last_error_message === "string"
        ? row.last_error_message
        : String(row.last_error_message),
      status: String(row.status ?? ""),
    })));
}

export function readFirstJobIdForAccountForTesting(store: SqliteDeviceSyncStore, accountId: string): string | null {
  return withStoreDatabase(store, (database) =>
    (
      database.prepare(`
        select id
        from device_job
        where account_id = ?
        order by created_at asc, id asc
        limit 1
      `).get(accountId) as { id?: string } | undefined
    )?.id ?? null);
}

export function expireJobLeaseForTesting(
  store: SqliteDeviceSyncStore,
  jobId: string,
  leaseExpiresAt: string,
): void {
  withStoreDatabase(store, (database) => {
    database.prepare(`
      update device_job
      set lease_expires_at = ?
      where id = ?
    `).run(leaseExpiresAt, jobId);
  });
}

export function setJobAttemptsForTesting(
  store: SqliteDeviceSyncStore,
  jobId: string,
  attempts: number,
): void {
  withStoreDatabase(store, (database) => {
    database.prepare(`
      update device_job
      set attempts = ?
      where id = ?
    `).run(attempts, jobId);
  });
}

export function setJobContinuationForTesting(
  store: SqliteDeviceSyncStore,
  jobId: string,
  payload: Record<string, unknown>,
): void {
  withStoreDatabase(store, (database) => {
    database.prepare(`
      update device_job
      set payload_json = ?
      where id = ?
    `).run(JSON.stringify(payload), jobId);
  });
}

export function setConnectionUpdatedAtForTesting(
  store: SqliteDeviceSyncStore,
  accountId: string,
  updatedAt: string,
): void {
  withStoreDatabase(store, (database) => {
    database.prepare(`
      update device_connection
      set updated_at = ?
      where id = ?
    `).run(updatedAt, accountId);
  });
}

export function setConnectionScopesJsonForTesting(
  store: SqliteDeviceSyncStore,
  accountId: string,
  scopesJson: string,
): void {
  withStoreDatabase(store, (database) => {
    database.prepare("update device_connection set scopes_json = ? where id = ?").run(scopesJson, accountId);
  });
}

export function deleteConnectionForTesting(
  store: SqliteDeviceSyncStore,
  accountId: string,
): void {
  withStoreDatabase(store, (database) => {
    database.prepare("delete from device_connection where id = ?").run(accountId);
  });
}

export function setCredentialStateForTesting(
  store: SqliteDeviceSyncStore,
  accountId: string,
  patch: Partial<DeviceSyncCredentialStateRowForTesting>,
): void {
  const entries = Object.entries(patch);
  if (entries.length === 0) {
    return;
  }

  const assignments = entries
    .map(([key]) => `${assertSqlIdentifier(key)} = ?`)
    .join(", ");
  const values = entries.map(([, value]) => value);

  withStoreDatabase(store, (database) => {
    database.prepare(`update device_credential_state set ${assignments} where account_id = ?`).run(...values, accountId);
  });
}

export function readCredentialStateForTesting(
  store: SqliteDeviceSyncStore,
  accountId: string,
): DeviceSyncCredentialStateRowForTesting | null {
  return withStoreDatabase(store, (database) =>
    (database.prepare(`
      select
        credential_kind,
        provider_config_key,
        access_token_encrypted,
        refresh_token_encrypted,
        access_token_expires_at,
        credential_metadata_json
      from device_credential_state
      where account_id = ?
    `).get(accountId) as DeviceSyncCredentialStateRowForTesting | undefined) ?? null);
}

export function readObservationStateForTesting(
  store: SqliteDeviceSyncStore,
  accountId: string,
): DeviceSyncObservationStateRowForTesting | null {
  return withStoreDatabase(store, (database) =>
    (database.prepare(`
      select
        hosted_observed_updated_at,
        hosted_observed_connection_revision,
        hosted_observed_token_version,
        hosted_observed_token_revision,
        local_connection_revision,
        local_token_revision,
        last_webhook_at,
        last_error_code,
        next_reconcile_at
      from device_observation_state
      where account_id = ?
    `).get(accountId) as DeviceSyncObservationStateRowForTesting | undefined) ?? null);
}

export function insertWebhookTraceRowForTesting(
  store: SqliteDeviceSyncStore,
  input: InsertWebhookTraceRowForTestingInput,
): void {
  withStoreDatabase(store, (database) => {
    database.prepare(`
      insert into webhook_trace (
        provider,
        trace_id,
        external_account_id,
        event_type,
        received_at,
        payload_json,
        status,
        processing_expires_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.provider,
      input.traceId,
      input.externalAccountId,
      input.eventType,
      input.receivedAt,
      input.payloadJson ?? "{}",
      input.status ?? "processed",
      input.processingExpiresAt ?? null,
    );
  });
}

export function readWebhookTraceRowForTesting(
  store: SqliteDeviceSyncStore,
  provider: string,
  traceId: string,
): DeviceSyncWebhookTraceRowForTesting | null {
  return withStoreDatabase(store, (database) =>
    (database.prepare(`
      select external_account_id, payload_json, processing_expires_at, status
      from webhook_trace
      where provider = ?
        and trace_id = ?
    `).get(provider, traceId) as DeviceSyncWebhookTraceRowForTesting | undefined) ?? null);
}

export function readWebhookTraceStatusForTesting(
  store: SqliteDeviceSyncStore,
  provider: string,
  traceId: string,
): string | null {
  return readWebhookTraceRowForTesting(store, provider, traceId)?.status ?? null;
}

export function readWebhookTraceLifecycleRowsForTesting(
  store: SqliteDeviceSyncStore,
  provider: string,
): DeviceSyncWebhookTraceLifecycleRowForTesting[] {
  return withStoreDatabase(store, (database) =>
    (database.prepare(`
      select trace_id, status, processing_expires_at
      from webhook_trace
      where provider = ?
      order by trace_id asc
    `).all(provider) as Array<Record<string, unknown>>).map((row) => ({
      processing_expires_at: row.processing_expires_at === null || typeof row.processing_expires_at === "string"
        ? row.processing_expires_at
        : String(row.processing_expires_at),
      status: String(row.status ?? ""),
      trace_id: String(row.trace_id ?? ""),
    })));
}
