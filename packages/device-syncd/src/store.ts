import type { DatabaseSync } from "node:sqlite";

import {
  applySqliteRuntimeMigrations,
  openSqliteRuntimeDatabase,
  tableExists,
  withImmediateTransaction,
} from "@murphai/runtime-state/node";

import {
  generatePrefixedId,
  maybeParseJsonObject,
  sanitizeStoredDeviceSyncMetadata,
  stringifyJson,
  toIsoTimestamp,
} from "./shared.ts";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
  DeviceSyncAccountStatus,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncServiceSummary,
  OAuthStateRecord,
  ProviderAuthTokens,
  StoredDeviceSyncAccount,
} from "./types.ts";

interface AccountUpsertInput {
  provider: string;
  externalAccountId: string;
  displayName?: string | null;
  status?: DeviceSyncAccountStatus;
  scopes?: string[];
  tokens: ProviderAuthTokens & { accessTokenEncrypted: string; refreshTokenEncrypted?: string | null };
  metadata?: Record<string, unknown>;
  connectedAt: string;
  nextReconcileAt?: string | null;
}

interface AccountPatchInput {
  displayName?: string | null;
  status?: DeviceSyncAccountStatus;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  nextReconcileAt?: string | null;
  clearErrors?: boolean;
}

interface HostedAccountHydrationInput {
  clearTokens?: boolean;
  connection: {
    connectedAt: string;
    displayName: string | null;
    externalAccountId: string;
    metadata: Record<string, unknown>;
    provider: string;
    scopes: string[];
    status: DeviceSyncAccountStatus;
    updatedAt: string;
  };
  hostedObservedTokenVersion: number | null;
  hostedObservedUpdatedAt: string | null;
  localState: {
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    lastSyncCompletedAt: string | null;
    lastSyncErrorAt: string | null;
    lastSyncStartedAt: string | null;
    lastWebhookAt: string | null;
    nextReconcileAt: string | null;
  };
  tokens?: ProviderAuthTokens & {
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string | null;
  };
}

interface EnqueueJobInput extends DeviceSyncJobInput {
  provider: string;
  accountId: string;
}

interface StoredAccountRow {
  id: string;
  provider: string;
  external_account_id: string;
  display_name: string | null;
  status: DeviceSyncAccountStatus;
  scopes_json: string | null;
  disconnect_generation: number;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  access_token_expires_at: string | null;
  hosted_observed_updated_at: string | null;
  hosted_observed_token_version: number | null;
  metadata_json: string | null;
  connected_at: string;
  last_webhook_at: string | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  last_sync_error_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  next_reconcile_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredJobRow {
  id: string;
  provider: string;
  account_id: string;
  kind: string;
  payload_json: string | null;
  priority: number;
  available_at: string;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
  status: "queued" | "running" | "succeeded" | "dead";
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface OAuthStateRow {
  state: string;
  provider: string;
  return_to: string | null;
  metadata_json: string | null;
  created_at: string;
  expires_at: string;
}

interface StoredWebhookTraceRow {
  provider: string;
  trace_id: string;
  status: string | null;
  processing_expires_at: string | null;
}

const DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION = 2;
function mapAccountRow(row: StoredAccountRow | undefined): StoredDeviceSyncAccount | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    provider: row.provider,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    status: row.status,
    scopes: JSON.parse(row.scopes_json ?? "[]") as string[],
    disconnectGeneration: row.disconnect_generation,
    accessTokenEncrypted: row.access_token_encrypted,
    hostedObservedTokenVersion: row.hosted_observed_token_version,
    hostedObservedUpdatedAt: row.hosted_observed_updated_at,
    refreshTokenEncrypted: row.refresh_token_encrypted,
    accessTokenExpiresAt: row.access_token_expires_at,
    metadata: sanitizeStoredDeviceSyncMetadata(maybeParseJsonObject(row.metadata_json)),
    connectedAt: row.connected_at,
    lastWebhookAt: row.last_webhook_at,
    lastSyncStartedAt: row.last_sync_started_at,
    lastSyncCompletedAt: row.last_sync_completed_at,
    lastSyncErrorAt: row.last_sync_error_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    nextReconcileAt: row.next_reconcile_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

function mapJobRow(row: StoredJobRow | undefined): DeviceSyncJobRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    provider: row.provider,
    accountId: row.account_id,
    kind: row.kind,
    payload: maybeParseJsonObject(row.payload_json),
    priority: row.priority,
    availableAt: row.available_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    dedupeKey: row.dedupe_key,
    status: row.status,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapOAuthStateRow(row: OAuthStateRow | undefined): OAuthStateRecord | null {
  if (!row) {
    return null;
  }

  return {
    state: row.state,
    provider: row.provider,
    returnTo: row.return_to,
    metadata: maybeParseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function resolveHydratedHostedAccountTokens(input: {
  existing: StoredDeviceSyncAccount | null;
  inputTokens: HostedAccountHydrationInput["tokens"];
  shouldClearTokens: boolean;
}): {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: string | null;
} {
  if (input.inputTokens) {
    return {
      accessTokenEncrypted: input.inputTokens.accessTokenEncrypted,
      refreshTokenEncrypted: input.inputTokens.refreshTokenEncrypted ?? null,
      accessTokenExpiresAt: input.inputTokens.accessTokenExpiresAt ?? null,
    };
  }

  if (input.shouldClearTokens) {
    return {
      accessTokenEncrypted: "",
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
    };
  }

  return {
    accessTokenEncrypted: input.existing?.accessTokenEncrypted ?? "",
    refreshTokenEncrypted: input.existing?.refreshTokenEncrypted ?? null,
    accessTokenExpiresAt: input.existing?.accessTokenExpiresAt ?? null,
  };
}


function ensureLegacyDeviceSyncStoreSchema(database: DatabaseSync): void {
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

      create table if not exists device_account (
        id text primary key,
        provider text not null,
        external_account_id text not null,
        display_name text,
        status text not null,
        scopes_json text not null,
        disconnect_generation integer not null default 0,
        access_token_encrypted text not null,
        refresh_token_encrypted text,
        access_token_expires_at text,
        hosted_observed_updated_at text,
        hosted_observed_token_version integer,
        metadata_json text not null,
        connected_at text not null,
        last_webhook_at text,
        last_sync_started_at text,
        last_sync_completed_at text,
        last_sync_error_at text,
        last_error_code text,
        last_error_message text,
        next_reconcile_at text,
        created_at text not null,
        updated_at text not null,
        unique (provider, external_account_id)
      );

      create index if not exists device_account_provider_idx
      on device_account (provider, updated_at desc);

      create table if not exists device_job (
        id text primary key,
        provider text not null,
        account_id text not null references device_account(id) on delete cascade,
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
}

function ensureAuthoritySplitDeviceSyncStoreSchema(database: DatabaseSync): void {
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
        hosted_observed_token_version integer,
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
}

function migrateLegacyDeviceSyncStoreToAuthoritySplit(database: DatabaseSync): void {
  if (!tableExists(database, "device_account")) {
    ensureAuthoritySplitDeviceSyncStoreSchema(database);
    return;
  }

  ensureAuthoritySplitDeviceSyncStoreSchema(database);

  database.exec(`
      insert into device_connection (
        id,
        provider,
        external_account_id,
        display_name,
        status,
        scopes_json,
        disconnect_generation,
        metadata_json,
        connected_at,
        created_at,
        updated_at
      )
      select
        id,
        provider,
        external_account_id,
        display_name,
        status,
        scopes_json,
        disconnect_generation,
        metadata_json,
        connected_at,
        created_at,
        updated_at
      from device_account;

      insert into device_credential_state (
        account_id,
        access_token_encrypted,
        refresh_token_encrypted,
        access_token_expires_at,
        created_at,
        updated_at
      )
      select
        id,
        access_token_encrypted,
        refresh_token_encrypted,
        access_token_expires_at,
        created_at,
        updated_at
      from device_account;

      insert into device_observation_state (
        account_id,
        hosted_observed_updated_at,
        hosted_observed_token_version,
        last_webhook_at,
        last_sync_started_at,
        last_sync_completed_at,
        last_sync_error_at,
        last_error_code,
        last_error_message,
        next_reconcile_at,
        created_at,
        updated_at
      )
      select
        id,
        hosted_observed_updated_at,
        hosted_observed_token_version,
        last_webhook_at,
        last_sync_started_at,
        last_sync_completed_at,
        last_sync_error_at,
        last_error_code,
        last_error_message,
        next_reconcile_at,
        created_at,
        updated_at
      from device_account;

      create table device_job_next (
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

      insert into device_job_next (
        id,
        provider,
        account_id,
        kind,
        payload_json,
        priority,
        available_at,
        attempts,
        max_attempts,
        dedupe_key,
        status,
        lease_owner,
        lease_expires_at,
        last_error_code,
        last_error_message,
        created_at,
        updated_at,
        started_at,
        finished_at
      )
      select
        id,
        provider,
        account_id,
        kind,
        payload_json,
        priority,
        available_at,
        attempts,
        max_attempts,
        dedupe_key,
        status,
        lease_owner,
        lease_expires_at,
        last_error_code,
        last_error_message,
        created_at,
        updated_at,
        started_at,
        finished_at
      from device_job;

      drop table device_job;
      alter table device_job_next rename to device_job;
      drop table device_account;
    `);

  ensureAuthoritySplitDeviceSyncStoreSchema(database);
}

function latestIsoTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return Date.parse(left) >= Date.parse(right) ? left : right;
}

const ACCOUNT_ROW_SELECT = `
  select
    connection.id as id,
    connection.provider as provider,
    connection.external_account_id as external_account_id,
    connection.display_name as display_name,
    connection.status as status,
    connection.scopes_json as scopes_json,
    connection.disconnect_generation as disconnect_generation,
    credential.access_token_encrypted as access_token_encrypted,
    credential.refresh_token_encrypted as refresh_token_encrypted,
    credential.access_token_expires_at as access_token_expires_at,
    observation.hosted_observed_updated_at as hosted_observed_updated_at,
    observation.hosted_observed_token_version as hosted_observed_token_version,
    connection.metadata_json as metadata_json,
    connection.connected_at as connected_at,
    observation.last_webhook_at as last_webhook_at,
    observation.last_sync_started_at as last_sync_started_at,
    observation.last_sync_completed_at as last_sync_completed_at,
    observation.last_sync_error_at as last_sync_error_at,
    observation.last_error_code as last_error_code,
    observation.last_error_message as last_error_message,
    observation.next_reconcile_at as next_reconcile_at,
    connection.created_at as created_at,
    max(connection.updated_at, credential.updated_at, observation.updated_at) as updated_at
  from device_connection as connection
  join device_credential_state as credential
    on credential.account_id = connection.id
  join device_observation_state as observation
    on observation.account_id = connection.id
`;

export class SqliteDeviceSyncStore {
  readonly databasePath: string;
  readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = openSqliteRuntimeDatabase(databasePath);
    applySqliteRuntimeMigrations(this.database, {
      migrations: [
        {
          version: 1,
          migrate(candidateDatabase) {
            ensureLegacyDeviceSyncStoreSchema(candidateDatabase);
          },
        },
        {
          version: DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
          migrate(candidateDatabase) {
            migrateLegacyDeviceSyncStoreToAuthoritySplit(candidateDatabase);
          },
        },
      ],
      schemaVersion: DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
      storeName: "device sync runtime",
    });
  }

  close(): void {
    this.database.close();
  }

  summarize(): DeviceSyncServiceSummary {
    const row = this.database.prepare(`
      select
        (select count(*) from device_connection) as accounts_total,
        (select count(*) from device_connection where status = 'active') as accounts_active,
        (select count(*) from device_job where status = 'queued') as jobs_queued,
        (select count(*) from device_job where status = 'running') as jobs_running,
        (select count(*) from device_job where status = 'dead') as jobs_dead,
        (select count(*) from oauth_state) as oauth_states,
        (select count(*) from webhook_trace) as webhook_traces
    `).get() as {
      accounts_total: number;
      accounts_active: number;
      jobs_queued: number;
      jobs_running: number;
      jobs_dead: number;
      oauth_states: number;
      webhook_traces: number;
    };

    return {
      accountsTotal: row.accounts_total,
      accountsActive: row.accounts_active,
      jobsQueued: row.jobs_queued,
      jobsRunning: row.jobs_running,
      jobsDead: row.jobs_dead,
      oauthStates: row.oauth_states,
      webhookTraces: row.webhook_traces,
    };
  }

  createOAuthState(input: OAuthStateRecord): OAuthStateRecord {
    this.database.prepare(`
      insert into oauth_state (state, provider, return_to, metadata_json, created_at, expires_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(
      input.state,
      input.provider,
      input.returnTo,
      stringifyJson(input.metadata ?? {}),
      input.createdAt,
      input.expiresAt,
    );

    return input;
  }

  deleteExpiredOAuthStates(now: string): number {
    const result = this.database.prepare("delete from oauth_state where expires_at <= ?").run(now) as { changes: number };
    return result.changes ?? 0;
  }

  consumeOAuthState(state: string, now: string): OAuthStateRecord | null {
    return withImmediateTransaction(this.database, () => {
      const row = this.database.prepare(`
        select state, provider, return_to, metadata_json, created_at, expires_at
        from oauth_state
        where state = ?
      `).get(state) as OAuthStateRow | undefined;

      if (!row || Date.parse(row.expires_at) <= Date.parse(now)) {
        this.database.prepare("delete from oauth_state where state = ?").run(state);
        return null;
      }

      this.database.prepare("delete from oauth_state where state = ?").run(state);
      return mapOAuthStateRow(row);
    });
  }

  listAccounts(provider?: string): StoredDeviceSyncAccount[] {
    const rows = (provider
      ? this.database.prepare(`
          ${ACCOUNT_ROW_SELECT}
          where connection.provider = ?
          order by updated_at desc, connection.id desc
        `).all(provider)
      : this.database.prepare(`
          ${ACCOUNT_ROW_SELECT}
          order by updated_at desc, connection.id desc
        `).all()) as unknown as StoredAccountRow[];

    return rows.map((row) => mapAccountRow(row)).filter(Boolean) as StoredDeviceSyncAccount[];
  }

  getAccountById(accountId: string): StoredDeviceSyncAccount | null {
    const row = this.database.prepare(`
      ${ACCOUNT_ROW_SELECT}
      where connection.id = ?
    `).get(accountId) as StoredAccountRow | undefined;

    return mapAccountRow(row);
  }

  getAccountByExternalAccount(provider: string, externalAccountId: string): StoredDeviceSyncAccount | null {
    const row = this.database.prepare(`
      ${ACCOUNT_ROW_SELECT}
      where connection.provider = ? and connection.external_account_id = ?
    `).get(provider, externalAccountId) as StoredAccountRow | undefined;

    return mapAccountRow(row);
  }

  upsertAccount(input: AccountUpsertInput): StoredDeviceSyncAccount {
    return withImmediateTransaction(this.database, () => {
      const existing = this.getAccountByExternalAccount(input.provider, input.externalAccountId);
      const now = input.connectedAt;
      const status = input.status ?? "active";
      const scopesJson = stringifyJson(input.scopes ?? []);
      const metadataJson = stringifyJson(sanitizeStoredDeviceSyncMetadata(input.metadata ?? {}));

      if (existing) {
        this.database.prepare(`
          update device_connection
          set display_name = ?,
              status = ?,
              scopes_json = ?,
              metadata_json = ?,
              connected_at = ?,
              updated_at = ?
          where id = ?
        `).run(
          input.displayName ?? null,
          status,
          scopesJson,
          metadataJson,
          input.connectedAt,
          now,
          existing.id,
        );

        this.database.prepare(`
          update device_credential_state
          set access_token_encrypted = ?,
              refresh_token_encrypted = ?,
              access_token_expires_at = ?,
              updated_at = ?
          where account_id = ?
        `).run(
          input.tokens.accessTokenEncrypted,
          input.tokens.refreshTokenEncrypted ?? null,
          input.tokens.accessTokenExpiresAt ?? null,
          now,
          existing.id,
        );

        this.database.prepare(`
          update device_observation_state
          set next_reconcile_at = ?,
              last_sync_error_at = null,
              last_error_code = null,
              last_error_message = null,
              updated_at = ?
          where account_id = ?
        `).run(
          input.nextReconcileAt ?? null,
          now,
          existing.id,
        );

        return this.getAccountById(existing.id)!;
      }

      const id = generatePrefixedId("dsa");
      this.database.prepare(`
        insert into device_connection (
          id,
          provider,
          external_account_id,
          display_name,
          status,
          scopes_json,
          metadata_json,
          connected_at,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.provider,
        input.externalAccountId,
        input.displayName ?? null,
        status,
        scopesJson,
        metadataJson,
        input.connectedAt,
        now,
        now,
      );

      this.database.prepare(`
        insert into device_credential_state (
          account_id,
          access_token_encrypted,
          refresh_token_encrypted,
          access_token_expires_at,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.tokens.accessTokenEncrypted,
        input.tokens.refreshTokenEncrypted ?? null,
        input.tokens.accessTokenExpiresAt ?? null,
        now,
        now,
      );

      this.database.prepare(`
        insert into device_observation_state (
          account_id,
          hosted_observed_updated_at,
          hosted_observed_token_version,
          last_webhook_at,
          last_sync_started_at,
          last_sync_completed_at,
          last_sync_error_at,
          last_error_code,
          last_error_message,
          next_reconcile_at,
          created_at,
          updated_at
        ) values (?, null, null, null, null, null, null, null, null, ?, ?, ?)
      `).run(
        id,
        input.nextReconcileAt ?? null,
        now,
        now,
      );

      return this.getAccountById(id)!;
    });
  }

  patchAccount(accountId: string, patch: AccountPatchInput): StoredDeviceSyncAccount {
    return withImmediateTransaction(this.database, () => {
      const existing = this.getAccountById(accountId);

      if (!existing) {
        throw new TypeError(`Unknown account ${accountId}`);
      }

      const now = toIsoTimestamp(new Date());
      const metadata = sanitizeStoredDeviceSyncMetadata(
        patch.metadata ? { ...existing.metadata, ...patch.metadata } : existing.metadata,
      );
      const nextReconcileAt = Object.prototype.hasOwnProperty.call(patch, "nextReconcileAt")
        ? patch.nextReconcileAt ?? null
        : existing.nextReconcileAt;
      const displayName = Object.prototype.hasOwnProperty.call(patch, "displayName")
        ? patch.displayName ?? null
        : existing.displayName;
      const scopes = Object.prototype.hasOwnProperty.call(patch, "scopes")
        ? patch.scopes ?? []
        : existing.scopes;

      this.database.prepare(`
        update device_connection
        set display_name = ?,
            status = ?,
            scopes_json = ?,
            metadata_json = ?,
            updated_at = ?
        where id = ?
      `).run(
        displayName,
        patch.status ?? existing.status,
        stringifyJson(scopes),
        stringifyJson(metadata),
        now,
        existing.id,
      );

      this.database.prepare(`
        update device_observation_state
        set next_reconcile_at = ?,
            last_sync_error_at = ?,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        where account_id = ?
      `).run(
        nextReconcileAt,
        patch.clearErrors ? null : existing.lastSyncErrorAt,
        patch.clearErrors ? null : existing.lastErrorCode,
        patch.clearErrors ? null : existing.lastErrorMessage,
        now,
        existing.id,
      );

      return this.getAccountById(existing.id)!;
    });
  }

  updateAccountTokens(
    accountId: string,
    tokens: ProviderAuthTokens & { accessTokenEncrypted: string; refreshTokenEncrypted?: string | null },
    disconnectGeneration?: number,
  ): StoredDeviceSyncAccount | null {
    const now = toIsoTimestamp(new Date());
    const result = this.database.prepare(`
      update device_credential_state
      set access_token_encrypted = ?,
          refresh_token_encrypted = ?,
          access_token_expires_at = ?,
          updated_at = ?
      where account_id = ?
        and (? is null or exists (
          select 1
          from device_connection
          where device_connection.id = device_credential_state.account_id
            and device_connection.disconnect_generation = ?
            and device_connection.status = 'active'
        ))
    `).run(
      tokens.accessTokenEncrypted,
      tokens.refreshTokenEncrypted ?? null,
      tokens.accessTokenExpiresAt ?? null,
      now,
      accountId,
      disconnectGeneration ?? null,
      disconnectGeneration ?? null,
    ) as { changes: number };

    if ((result.changes ?? 0) === 0) {
      return null;
    }

    return this.getAccountById(accountId)!;
  }

  hydrateHostedAccount(input: HostedAccountHydrationInput): StoredDeviceSyncAccount | null {
    return withImmediateTransaction(this.database, () => {
      const existing = this.getAccountByExternalAccount(
        input.connection.provider,
        input.connection.externalAccountId,
      );

      if (!existing && input.tokens === undefined) {
        return null;
      }

      const shouldClearTokens = input.clearTokens === true
        || (input.connection.status === "disconnected" && input.tokens === undefined);
      const rowUpdatedAt = latestIsoTimestamp(existing?.updatedAt ?? null, input.connection.updatedAt)
        ?? input.connection.updatedAt;
      const { accessTokenEncrypted, refreshTokenEncrypted, accessTokenExpiresAt } = resolveHydratedHostedAccountTokens({
        existing,
        inputTokens: input.tokens,
        shouldClearTokens,
      });
      const hostedObservedUpdatedAt = input.hostedObservedUpdatedAt ?? existing?.hostedObservedUpdatedAt ?? null;
      const hostedObservedTokenVersion = input.hostedObservedTokenVersion ?? existing?.hostedObservedTokenVersion ?? null;
      const metadata = sanitizeStoredDeviceSyncMetadata(input.connection.metadata);
      const disconnectGeneration = existing
        ? input.connection.status === "disconnected" && existing.status !== "disconnected"
          ? existing.disconnectGeneration + 1
          : existing.disconnectGeneration
        : input.connection.status === "disconnected"
          ? 1
          : 0;

      if (existing) {
        this.database.prepare(`
          update device_connection
          set display_name = ?,
              status = ?,
              scopes_json = ?,
              disconnect_generation = ?,
              metadata_json = ?,
              connected_at = ?,
              updated_at = ?
          where id = ?
        `).run(
          input.connection.displayName,
          input.connection.status,
          stringifyJson(input.connection.scopes),
          disconnectGeneration,
          stringifyJson(metadata),
          input.connection.connectedAt,
          rowUpdatedAt,
          existing.id,
        );

        this.database.prepare(`
          update device_credential_state
          set access_token_encrypted = ?,
              refresh_token_encrypted = ?,
              access_token_expires_at = ?,
              updated_at = ?
          where account_id = ?
        `).run(
          accessTokenEncrypted,
          refreshTokenEncrypted,
          accessTokenExpiresAt,
          rowUpdatedAt,
          existing.id,
        );

        this.database.prepare(`
          update device_observation_state
          set hosted_observed_updated_at = ?,
              hosted_observed_token_version = ?,
              last_webhook_at = ?,
              last_sync_started_at = ?,
              last_sync_completed_at = ?,
              last_sync_error_at = ?,
              last_error_code = ?,
              last_error_message = ?,
              next_reconcile_at = ?,
              updated_at = ?
          where account_id = ?
        `).run(
          hostedObservedUpdatedAt,
          hostedObservedTokenVersion,
          input.localState.lastWebhookAt,
          input.localState.lastSyncStartedAt,
          input.localState.lastSyncCompletedAt,
          input.localState.lastSyncErrorAt,
          input.localState.lastErrorCode,
          input.localState.lastErrorMessage,
          input.localState.nextReconcileAt,
          rowUpdatedAt,
          existing.id,
        );

        return this.getAccountById(existing.id)!;
      }

      const id = generatePrefixedId("dsa");
      this.database.prepare(`
        insert into device_connection (
          id,
          provider,
          external_account_id,
          display_name,
          status,
          scopes_json,
          disconnect_generation,
          metadata_json,
          connected_at,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.connection.provider,
        input.connection.externalAccountId,
        input.connection.displayName,
        input.connection.status,
        stringifyJson(input.connection.scopes),
        disconnectGeneration,
        stringifyJson(metadata),
        input.connection.connectedAt,
        input.connection.updatedAt,
        rowUpdatedAt,
      );

      this.database.prepare(`
        insert into device_credential_state (
          account_id,
          access_token_encrypted,
          refresh_token_encrypted,
          access_token_expires_at,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        accessTokenExpiresAt,
        input.connection.updatedAt,
        rowUpdatedAt,
      );

      this.database.prepare(`
        insert into device_observation_state (
          account_id,
          hosted_observed_updated_at,
          hosted_observed_token_version,
          last_webhook_at,
          last_sync_started_at,
          last_sync_completed_at,
          last_sync_error_at,
          last_error_code,
          last_error_message,
          next_reconcile_at,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        hostedObservedUpdatedAt,
        hostedObservedTokenVersion,
        input.localState.lastWebhookAt,
        input.localState.lastSyncStartedAt,
        input.localState.lastSyncCompletedAt,
        input.localState.lastSyncErrorAt,
        input.localState.lastErrorCode,
        input.localState.lastErrorMessage,
        input.localState.nextReconcileAt,
        input.connection.updatedAt,
        rowUpdatedAt,
      );

      return this.getAccountById(id)!;
    });
  }

  disconnectAccount(accountId: string, now: string): StoredDeviceSyncAccount {
    withImmediateTransaction(this.database, () => {
      this.database.prepare(`
        update device_connection
        set status = 'disconnected',
            disconnect_generation = disconnect_generation + 1,
            updated_at = ?
        where id = ?
      `).run(now, accountId);

      this.database.prepare(`
        update device_credential_state
        set access_token_encrypted = '',
            refresh_token_encrypted = null,
            access_token_expires_at = null,
            updated_at = ?
        where account_id = ?
      `).run(now, accountId);

      this.database.prepare(`
        update device_observation_state
        set last_sync_error_at = null,
            last_error_code = null,
            last_error_message = null,
            next_reconcile_at = null,
            updated_at = ?
        where account_id = ?
      `).run(now, accountId);
    });

    return this.getAccountById(accountId)!;
  }

  markWebhookReceived(accountId: string, now: string): void {
    this.database.prepare(`
      update device_observation_state
      set last_webhook_at = ?, updated_at = ?
      where account_id = ?
    `).run(now, now, accountId);
  }

  markSyncStarted(accountId: string, now: string): void {
    this.database.prepare(`
      update device_observation_state
      set last_sync_started_at = ?, updated_at = ?
      where account_id = ?
    `).run(now, now, accountId);
  }

  markSyncSucceeded(
    accountId: string,
    now: string,
    disconnectGeneration: number | null = null,
    options: { metadataPatch?: Record<string, unknown>; nextReconcileAt?: string | null } = {},
  ): boolean {
    const existing = this.getAccountById(accountId);

    if (!existing) {
      return false;
    }

    const metadata = sanitizeStoredDeviceSyncMetadata(
      options.metadataPatch ? { ...existing.metadata, ...options.metadataPatch } : existing.metadata,
    );
    const nextReconcileAt = Object.prototype.hasOwnProperty.call(options, "nextReconcileAt")
      ? options.nextReconcileAt ?? null
      : existing.nextReconcileAt;

    return withImmediateTransaction(this.database, () => {
      const connectionResult = this.database.prepare(`
        update device_connection
        set status = case when status = 'disconnected' then status else 'active' end,
            metadata_json = ?,
            updated_at = ?
        where id = ?
          and (? is null or (disconnect_generation = ? and status = 'active'))
      `).run(
        stringifyJson(metadata),
        now,
        accountId,
        disconnectGeneration ?? null,
        disconnectGeneration ?? null,
      ) as { changes: number };

      if ((connectionResult.changes ?? 0) === 0) {
        return false;
      }

      this.database.prepare(`
        update device_observation_state
        set next_reconcile_at = ?,
            last_sync_completed_at = ?,
            last_sync_error_at = null,
            last_error_code = null,
            last_error_message = null,
            updated_at = ?
        where account_id = ?
      `).run(
        nextReconcileAt,
        now,
        now,
        accountId,
      );

      return true;
    });
  }

  markSyncFailed(
    accountId: string,
    now: string,
    code: string,
    message: string,
    status: DeviceSyncAccountStatus | null | undefined,
  ): void {
    withImmediateTransaction(this.database, () => {
      this.database.prepare(`
        update device_connection
        set status = ?,
            updated_at = ?
        where id = ?
      `).run(status ?? this.getAccountById(accountId)?.status ?? "active", now, accountId);

      this.database.prepare(`
        update device_observation_state
        set last_sync_error_at = ?,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        where account_id = ?
      `).run(now, code, message, now, accountId);
    });
  }

  enqueueJob(input: EnqueueJobInput): DeviceSyncJobRecord {
    return withImmediateTransaction(this.database, () => this.enqueueJobInTransaction(input));
  }

  enqueueJobsAndCompleteWebhookTrace(input: {
    accountId: string;
    provider: string;
    traceId: string;
    jobs: readonly DeviceSyncJobInput[];
  }): DeviceSyncJobRecord[] {
    return withImmediateTransaction(this.database, () => {
      const queuedJobs = input.jobs.map((job) =>
        this.enqueueJobInTransaction({
          provider: input.provider,
          accountId: input.accountId,
          kind: job.kind,
          payload: job.payload ?? {},
          priority: job.priority ?? 0,
          availableAt: job.availableAt,
          maxAttempts: job.maxAttempts,
          dedupeKey: job.dedupeKey,
        }),
      );

      this.completeWebhookTrace(input.provider, input.traceId);
      return queuedJobs;
    });
  }

  getJobById(jobId: string): DeviceSyncJobRecord | null {
    const row = this.database.prepare(`select * from device_job where id = ?`).get(jobId) as StoredJobRow | undefined;
    return mapJobRow(row);
  }

  readNextActiveReconcileAt(): string | null {
    const row = this.database.prepare(`
      select observation.next_reconcile_at
      from device_observation_state as observation
      join device_connection as connection
        on connection.id = observation.account_id
      where connection.status = 'active'
        and observation.next_reconcile_at is not null
      order by observation.next_reconcile_at asc, observation.updated_at asc, connection.id asc
      limit 1
    `).get() as { next_reconcile_at?: string | null } | undefined;
    return row?.next_reconcile_at ?? null;
  }

  readNextJobWakeAt(): string | null {
    const row = this.database.prepare(`
      select wake_at
      from (
        select available_at as wake_at
        from device_job
        where status = 'queued'
        union all
        select lease_expires_at as wake_at
        from device_job
        where status = 'running'
          and lease_expires_at is not null
          and attempts < max_attempts
      )
      order by wake_at asc
      limit 1
    `).get() as { wake_at?: string | null } | undefined;
    return row?.wake_at ?? null;
  }

  claimDueJob(workerId: string, now: string, leaseMs: number): DeviceSyncJobRecord | null {
    return withImmediateTransaction(this.database, () => {
      const row = this.database.prepare(`
        select *
        from device_job as candidate
        where (
          (
            candidate.status = 'queued' and candidate.available_at <= ?
          ) or (
            candidate.status = 'running'
            and candidate.lease_expires_at is not null
            and candidate.lease_expires_at <= ?
            and candidate.attempts < candidate.max_attempts
          )
        )
        and not exists (
          select 1
          from device_job as blocking
          where blocking.account_id = candidate.account_id
            and blocking.id != candidate.id
            and blocking.status = 'running'
            and blocking.lease_expires_at is not null
            and blocking.lease_expires_at > ?
        )
        order by candidate.priority desc, candidate.available_at asc, candidate.created_at asc, candidate.id asc
        limit 1
      `).get(now, now, now) as StoredJobRow | undefined;

      if (!row) {
        return null;
      }

      const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
      this.database.prepare(`
        update device_job
        set status = 'running',
            lease_owner = ?,
            lease_expires_at = ?,
            attempts = attempts + 1,
            started_at = coalesce(started_at, ?),
            updated_at = ?
        where id = ?
      `).run(workerId, leaseExpiresAt, now, now, row.id);

      return this.getJobById(row.id);
    });
  }

  completeJob(jobId: string, now: string): void {
    this.database.prepare(`
      update device_job
      set status = 'succeeded',
          lease_owner = null,
          lease_expires_at = null,
          finished_at = ?,
          updated_at = ?
      where id = ?
    `).run(now, now, jobId);
  }

  completeJobIfOwned(jobId: string, workerId: string, now: string): boolean {
    const result = this.database.prepare(`
      update device_job
      set status = 'succeeded',
          lease_owner = null,
          lease_expires_at = null,
          finished_at = ?,
          updated_at = ?
      where id = ?
        and status = 'running'
        and lease_owner = ?
    `).run(now, now, jobId, workerId) as { changes: number };

    return (result.changes ?? 0) > 0;
  }

  failJob(
    jobId: string,
    now: string,
    code: string,
    message: string,
    retryAt: string | null,
    retryable: boolean,
  ): void {
    const job = this.getJobById(jobId);

    if (!job) {
      return;
    }

    if (job.status !== "queued" && job.status !== "running") {
      return;
    }

    if (retryable && job.attempts < job.maxAttempts) {
      this.database.prepare(`
        update device_job
        set status = 'queued',
            available_at = ?,
            lease_owner = null,
            lease_expires_at = null,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        where id = ?
      `).run(retryAt ?? now, code, message, now, jobId);
      return;
    }

    this.database.prepare(`
      update device_job
      set status = 'dead',
          lease_owner = null,
          lease_expires_at = null,
          last_error_code = ?,
          last_error_message = ?,
          finished_at = ?,
          updated_at = ?
      where id = ?
    `).run(code, message, now, now, jobId);
  }

  markPendingJobsDeadForAccount(accountId: string, now: string, code: string, message: string): number {
    const result = this.database.prepare(`
      update device_job
      set status = 'dead',
          lease_owner = null,
          lease_expires_at = null,
          last_error_code = ?,
          last_error_message = ?,
          finished_at = ?,
          updated_at = ?
      where account_id = ? and status in ('queued', 'running')
    `).run(code, message, now, now, accountId) as { changes: number };

    return result.changes ?? 0;
  }

  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult {
    return withImmediateTransaction(this.database, () => {
      const existing = this.database.prepare(`
        select provider, trace_id, status, processing_expires_at
        from webhook_trace
        where provider = ?
          and trace_id = ?
      `).get(input.provider, input.traceId) as StoredWebhookTraceRow | undefined;

      if (!existing) {
        this.database.prepare(`
          insert into webhook_trace (
            provider,
            trace_id,
            external_account_id,
            event_type,
            received_at,
            payload_json,
            status,
            processing_expires_at
          ) values (?, ?, ?, ?, ?, ?, 'processing', ?)
        `).run(
          input.provider,
          input.traceId,
          input.externalAccountId,
          input.eventType,
          input.receivedAt,
          stringifyJson(input.payload ?? {}),
          input.processingExpiresAt,
        );

        return "claimed";
      }

      if ((existing.status ?? "processed") === "processed") {
        return "processed";
      }

      if (
        existing.processing_expires_at
        && Date.parse(existing.processing_expires_at) > Date.parse(input.receivedAt)
      ) {
        return "processing";
      }

      const result = this.database.prepare(`
        update webhook_trace
        set external_account_id = ?,
            event_type = ?,
            received_at = ?,
            payload_json = ?,
            status = 'processing',
            processing_expires_at = ?
        where provider = ?
          and trace_id = ?
          and coalesce(status, 'processed') = 'processing'
          and (
            processing_expires_at is null
            or processing_expires_at <= ?
          )
      `).run(
        input.externalAccountId,
        input.eventType,
        input.receivedAt,
        stringifyJson(input.payload ?? {}),
        input.processingExpiresAt,
        input.provider,
        input.traceId,
        input.receivedAt,
      ) as { changes: number };

      return (result.changes ?? 0) > 0 ? "claimed" : "processing";
    });
  }

  completeWebhookTrace(provider: string, traceId: string): void {
    this.database.prepare(`
      update webhook_trace
      set status = 'processed',
          processing_expires_at = null
      where provider = ?
        and trace_id = ?
        and coalesce(status, 'processed') = 'processing'
    `).run(provider, traceId);
  }

  releaseWebhookTrace(provider: string, traceId: string): void {
    this.database.prepare(`
      delete from webhook_trace
      where provider = ?
        and trace_id = ?
        and coalesce(status, 'processed') = 'processing'
    `).run(provider, traceId);
  }

  private enqueueJobInTransaction(input: EnqueueJobInput): DeviceSyncJobRecord {
    if (input.dedupeKey) {
      const existing = this.database.prepare(`
        select *
        from device_job
        where account_id = ? and provider = ? and dedupe_key = ? and status in ('queued', 'running')
        order by created_at desc, id desc
        limit 1
      `).get(input.accountId, input.provider, input.dedupeKey) as StoredJobRow | undefined;

      if (existing) {
        return mapJobRow(existing)!;
      }
    }

    const now = toIsoTimestamp(new Date());
    const id = generatePrefixedId("dsj");
    this.database.prepare(`
      insert into device_job (
        id,
        provider,
        account_id,
        kind,
        payload_json,
        priority,
        available_at,
        attempts,
        max_attempts,
        dedupe_key,
        status,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'queued', ?, ?)
    `).run(
      id,
      input.provider,
      input.accountId,
      input.kind,
      stringifyJson(input.payload ?? {}),
      input.priority ?? 0,
      input.availableAt ?? now,
      input.maxAttempts ?? 5,
      input.dedupeKey ?? null,
      now,
      now,
    );

    return this.getJobById(id)!;
  }
}
