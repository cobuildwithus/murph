import type { DatabaseSync } from "node:sqlite";

import {
  applySqliteRuntimeMigrations,
  openSqliteRuntimeDatabase,
  withImmediateTransaction,
} from "@murphai/runtime-state/node";

import {
  generatePrefixedId,
  maybeParseJsonObject,
  sanitizeStoredDeviceSyncMetadata,
  stringifyJson,
  toIsoTimestamp,
} from "./shared.ts";
import type { DeviceSyncEnqueueJobInput } from "./store/jobs.ts";
import {
  claimDueDeviceSyncJob,
  completeDeviceSyncJob,
  completeDeviceSyncJobIfOwned,
  enqueueDeviceSyncJobInTransaction,
  failDeviceSyncJob,
  getDeviceSyncJobById,
  markPendingDeviceSyncJobsDeadForAccount,
  readNextDeviceSyncJobWakeAt,
} from "./store/jobs.ts";
import {
  consumeOAuthState,
  createOAuthState,
  deleteExpiredOAuthStates,
} from "./store/oauth-states.ts";
import {
  assertNoLegacyDeviceSyncStore,
  DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
  ensureDeviceSyncStoreSchema,
} from "./store/schema.ts";
import {
  claimDeviceSyncWebhookTrace,
  completeDeviceSyncWebhookTrace,
  releaseDeviceSyncWebhookTrace,
} from "./store/webhook-traces.ts";

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
    const database = openSqliteRuntimeDatabase(databasePath);
    this.database = database;

    try {
      assertNoLegacyDeviceSyncStore(database);
      applySqliteRuntimeMigrations(database, {
        migrations: [
          {
            version: DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
            migrate(candidateDatabase) {
              ensureDeviceSyncStoreSchema(candidateDatabase);
            },
          },
        ],
        schemaVersion: DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
        storeName: "device sync runtime",
      });
    } catch (error) {
      database.close();
      throw error;
    }
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
    return createOAuthState(this.database, input);
  }

  deleteExpiredOAuthStates(now: string): number {
    return deleteExpiredOAuthStates(this.database, now);
  }

  consumeOAuthState(state: string, now: string): OAuthStateRecord | null {
    return consumeOAuthState(this.database, state, now);
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

  enqueueJob(input: DeviceSyncEnqueueJobInput): DeviceSyncJobRecord {
    return withImmediateTransaction(this.database, () =>
      enqueueDeviceSyncJobInTransaction(this.database, input)
    );
  }

  enqueueJobsAndCompleteWebhookTrace(input: {
    accountId: string;
    provider: string;
    traceId: string;
    jobs: readonly DeviceSyncJobInput[];
  }): DeviceSyncJobRecord[] {
    return withImmediateTransaction(this.database, () => {
      const queuedJobs = input.jobs.map((job) =>
        enqueueDeviceSyncJobInTransaction(this.database, {
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

      completeDeviceSyncWebhookTrace(this.database, input.provider, input.traceId);
      return queuedJobs;
    });
  }

  getJobById(jobId: string): DeviceSyncJobRecord | null {
    return getDeviceSyncJobById(this.database, jobId);
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
    return readNextDeviceSyncJobWakeAt(this.database);
  }

  claimDueJob(workerId: string, now: string, leaseMs: number): DeviceSyncJobRecord | null {
    return claimDueDeviceSyncJob(this.database, workerId, now, leaseMs);
  }

  completeJob(jobId: string, now: string): void {
    completeDeviceSyncJob(this.database, jobId, now);
  }

  completeJobIfOwned(jobId: string, workerId: string, now: string): boolean {
    return completeDeviceSyncJobIfOwned(this.database, jobId, workerId, now);
  }

  failJob(
    jobId: string,
    now: string,
    code: string,
    message: string,
    retryAt: string | null,
    retryable: boolean,
  ): void {
    failDeviceSyncJob(this.database, {
      code,
      jobId,
      message,
      now,
      retryAt,
      retryable,
    });
  }

  markPendingJobsDeadForAccount(accountId: string, now: string, code: string, message: string): number {
    return markPendingDeviceSyncJobsDeadForAccount(this.database, {
      accountId,
      code,
      message,
      now,
    });
  }

  claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): DeviceSyncWebhookTraceClaimResult {
    return claimDeviceSyncWebhookTrace(this.database, input);
  }

  completeWebhookTrace(provider: string, traceId: string): void {
    completeDeviceSyncWebhookTrace(this.database, provider, traceId);
  }

  releaseWebhookTrace(provider: string, traceId: string): void {
    releaseDeviceSyncWebhookTrace(this.database, provider, traceId);
  }
}
