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
  failDeviceSyncJobIfOwned,
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
  ConsumeOAuthStateResult,
  DeviceSyncWebhookTraceClaimResult,
  DeviceSyncAccountStatus,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncServiceSummary,
  OAuthStateRecord,
  ProviderAuthTokens,
  StoredDeviceSyncAccount,
} from "./types.ts";

type SqliteRow = Record<string, unknown>;

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
  hosted_observed_connection_revision: number;
  hosted_observed_token_version: number | null;
  hosted_observed_token_revision: number;
  local_connection_revision: number;
  local_token_revision: number;
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

interface DeviceSyncSummaryRow {
  accounts_total: number;
  accounts_active: number;
  jobs_queued: number;
  jobs_running: number;
  jobs_dead: number;
  oauth_states: number;
  webhook_traces: number;
}

interface NextReconcileRow {
  next_reconcile_at: string | null;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${field} to be a string.`);
  }
  return value;
}

function expectNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return expectString(value, field);
}

function expectNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`Expected ${field} to be a number.`);
  }
  return value;
}

function expectNullableNumber(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  return expectNumber(value, field);
}

function parseStoredStringArray(value: string | null, field: string): string[] {
  if (value === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError(`Expected ${field} to contain a valid JSON array.`);
  }

  if (!Array.isArray(parsed)) {
    throw new TypeError(`Expected ${field} to contain a JSON array.`);
  }

  if (!parsed.every((entry) => typeof entry === "string")) {
    throw new TypeError(`Expected ${field} to contain only strings.`);
  }

  return parsed;
}

function decodeStoredAccountRow(row: SqliteRow): StoredAccountRow {
  return {
    id: expectString(row.id, "device_connection.id"),
    provider: expectString(row.provider, "device_connection.provider"),
    external_account_id: expectString(
      row.external_account_id,
      "device_connection.external_account_id",
    ),
    display_name: expectNullableString(row.display_name, "device_connection.display_name"),
    status: expectString(row.status, "device_connection.status") as DeviceSyncAccountStatus,
    scopes_json: expectNullableString(row.scopes_json, "device_connection.scopes_json"),
    disconnect_generation: expectNumber(
      row.disconnect_generation,
      "device_connection.disconnect_generation",
    ),
    access_token_encrypted: expectString(
      row.access_token_encrypted,
      "device_credential_state.access_token_encrypted",
    ),
    refresh_token_encrypted: expectNullableString(
      row.refresh_token_encrypted,
      "device_credential_state.refresh_token_encrypted",
    ),
    access_token_expires_at: expectNullableString(
      row.access_token_expires_at,
      "device_credential_state.access_token_expires_at",
    ),
    hosted_observed_updated_at: expectNullableString(
      row.hosted_observed_updated_at,
      "device_observation_state.hosted_observed_updated_at",
    ),
    hosted_observed_connection_revision: expectNumber(
      row.hosted_observed_connection_revision,
      "device_observation_state.hosted_observed_connection_revision",
    ),
    hosted_observed_token_version: expectNullableNumber(
      row.hosted_observed_token_version,
      "device_observation_state.hosted_observed_token_version",
    ),
    hosted_observed_token_revision: expectNumber(
      row.hosted_observed_token_revision,
      "device_observation_state.hosted_observed_token_revision",
    ),
    local_connection_revision: expectNumber(
      row.local_connection_revision,
      "device_observation_state.local_connection_revision",
    ),
    local_token_revision: expectNumber(
      row.local_token_revision,
      "device_observation_state.local_token_revision",
    ),
    metadata_json: expectNullableString(row.metadata_json, "device_connection.metadata_json"),
    connected_at: expectString(row.connected_at, "device_connection.connected_at"),
    last_webhook_at: expectNullableString(
      row.last_webhook_at,
      "device_observation_state.last_webhook_at",
    ),
    last_sync_started_at: expectNullableString(
      row.last_sync_started_at,
      "device_observation_state.last_sync_started_at",
    ),
    last_sync_completed_at: expectNullableString(
      row.last_sync_completed_at,
      "device_observation_state.last_sync_completed_at",
    ),
    last_sync_error_at: expectNullableString(
      row.last_sync_error_at,
      "device_observation_state.last_sync_error_at",
    ),
    last_error_code: expectNullableString(
      row.last_error_code,
      "device_observation_state.last_error_code",
    ),
    last_error_message: expectNullableString(
      row.last_error_message,
      "device_observation_state.last_error_message",
    ),
    next_reconcile_at: expectNullableString(
      row.next_reconcile_at,
      "device_observation_state.next_reconcile_at",
    ),
    created_at: expectString(row.created_at, "device_connection.created_at"),
    updated_at: expectString(row.updated_at, "device_connection.updated_at"),
  };
}

function decodeDeviceSyncSummaryRow(row: SqliteRow): DeviceSyncSummaryRow {
  return {
    accounts_total: expectNumber(row.accounts_total, "device_sync_summary.accounts_total"),
    accounts_active: expectNumber(row.accounts_active, "device_sync_summary.accounts_active"),
    jobs_queued: expectNumber(row.jobs_queued, "device_sync_summary.jobs_queued"),
    jobs_running: expectNumber(row.jobs_running, "device_sync_summary.jobs_running"),
    jobs_dead: expectNumber(row.jobs_dead, "device_sync_summary.jobs_dead"),
    oauth_states: expectNumber(row.oauth_states, "device_sync_summary.oauth_states"),
    webhook_traces: expectNumber(row.webhook_traces, "device_sync_summary.webhook_traces"),
  };
}

function decodeNextReconcileRow(row: SqliteRow): NextReconcileRow {
  return {
    next_reconcile_at: expectNullableString(
      row.next_reconcile_at,
      "device_observation_state.next_reconcile_at",
    ),
  };
}

function mapAccountRow(row: StoredAccountRow): StoredDeviceSyncAccount {

  return {
    id: row.id,
    provider: row.provider,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    status: row.status,
    scopes: parseStoredStringArray(row.scopes_json, "device_connection.scopes_json"),
    disconnectGeneration: row.disconnect_generation,
    accessTokenEncrypted: row.access_token_encrypted,
    hostedObservedConnectionRevision: row.hosted_observed_connection_revision,
    hostedObservedTokenRevision: row.hosted_observed_token_revision,
    hostedObservedTokenVersion: row.hosted_observed_token_version,
    hostedObservedUpdatedAt: row.hosted_observed_updated_at,
    localConnectionRevision: row.local_connection_revision,
    localTokenRevision: row.local_token_revision,
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

type HostedHydratedTokenPayloadAction = "apply_bundle" | "clear" | "keep";

function resolveHostedAccountHydrationPlan(input: {
  existing: StoredDeviceSyncAccount | null;
  hydration: HostedAccountHydrationInput;
  connectionStateReplayed: boolean;
  connectionStateStale: boolean;
  tokenStateReplayed: boolean;
  tokenStateStale: boolean;
}): {
  advanceTokenObservation: boolean;
  connectionAccepted: boolean;
  tokenPayloadAction: HostedHydratedTokenPayloadAction;
} {
  const connectionAccepted = input.existing === null || (!input.connectionStateStale && !input.connectionStateReplayed);
  const tokenAccepted = !input.tokenStateStale && !input.tokenStateReplayed;
  const tokenClearRequested = input.hydration.clearTokens === true
    || (input.hydration.connection.status === "disconnected" && input.hydration.tokens === undefined);

  let tokenPayloadAction: HostedHydratedTokenPayloadAction = "keep";

  if (input.hydration.tokens !== undefined && tokenAccepted) {
    tokenPayloadAction = "apply_bundle";
  } else if (tokenClearRequested && input.hydration.tokens === undefined && connectionAccepted && tokenAccepted) {
    tokenPayloadAction = "clear";
  }

  return {
    advanceTokenObservation: tokenAccepted
      && input.hydration.hostedObservedTokenVersion !== null
      && tokenPayloadAction !== "clear",
    connectionAccepted,
    tokenPayloadAction,
  };
}

function parseIsoMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
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

function isStaleHostedObservedUpdatedAt(
  previousObservedUpdatedAt: string | null,
  nextObservedUpdatedAt: string | null,
): boolean {
  if (
    !previousObservedUpdatedAt
    || !nextObservedUpdatedAt
    || previousObservedUpdatedAt === nextObservedUpdatedAt
  ) {
    return false;
  }

  const previousObservedUpdatedAtMs = parseIsoMs(previousObservedUpdatedAt);
  const nextObservedUpdatedAtMs = parseIsoMs(nextObservedUpdatedAt);

  return previousObservedUpdatedAtMs !== null
    && nextObservedUpdatedAtMs !== null
    && nextObservedUpdatedAtMs < previousObservedUpdatedAtMs;
}

function isReplayedHostedObservedUpdatedAt(input: {
  localConnectionRevision: number;
  nextObservedUpdatedAt: string | null;
  hostedObservedConnectionRevision: number;
  previousObservedUpdatedAt: string | null;
}): boolean {
  return Boolean(
    input.previousObservedUpdatedAt
      && input.nextObservedUpdatedAt
      && input.previousObservedUpdatedAt === input.nextObservedUpdatedAt
      && input.localConnectionRevision !== input.hostedObservedConnectionRevision,
  );
}

function isStaleHostedObservedTokenVersion(
  previousObservedTokenVersion: number | null,
  nextObservedTokenVersion: number | null,
): boolean {
  return typeof previousObservedTokenVersion === "number"
    && typeof nextObservedTokenVersion === "number"
    && nextObservedTokenVersion < previousObservedTokenVersion;
}

function isReplayedHostedObservedTokenVersion(input: {
  hostedObservedTokenRevision: number;
  localTokenRevision: number;
  nextObservedTokenVersion: number | null;
  previousObservedTokenVersion: number | null;
}): boolean {
  return typeof input.previousObservedTokenVersion === "number"
    && typeof input.nextObservedTokenVersion === "number"
    && input.previousObservedTokenVersion === input.nextObservedTokenVersion
    && input.localTokenRevision !== input.hostedObservedTokenRevision;
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
    observation.hosted_observed_connection_revision as hosted_observed_connection_revision,
    observation.hosted_observed_token_version as hosted_observed_token_version,
    observation.hosted_observed_token_revision as hosted_observed_token_revision,
    observation.local_connection_revision as local_connection_revision,
    observation.local_token_revision as local_token_revision,
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
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    const database = openSqliteRuntimeDatabase(databasePath);
    this.database = database;

    try {
      applySqliteRuntimeMigrations(database, {
        migrations: [
          {
            version: DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION,
            migrate(candidateDatabase: DatabaseSync) {
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
    `).get();
    if (!row) {
      throw new Error("Failed to summarize device sync store.");
    }
    const decodedRow = decodeDeviceSyncSummaryRow(row);

    return {
      accountsTotal: decodedRow.accounts_total,
      accountsActive: decodedRow.accounts_active,
      jobsQueued: decodedRow.jobs_queued,
      jobsRunning: decodedRow.jobs_running,
      jobsDead: decodedRow.jobs_dead,
      oauthStates: decodedRow.oauth_states,
      webhookTraces: decodedRow.webhook_traces,
    };
  }

  createOAuthState(input: OAuthStateRecord): OAuthStateRecord {
    return createOAuthState(this.database, input);
  }

  deleteExpiredOAuthStates(now: string): number {
    return deleteExpiredOAuthStates(this.database, now);
  }

  consumeOAuthState(state: string, now: string, expectedProvider?: string): ConsumeOAuthStateResult {
    return consumeOAuthState(this.database, state, now, expectedProvider);
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
        `).all()).map((row) => decodeStoredAccountRow(row));

    return rows.map((row) => mapAccountRow(row));
  }

  getAccountById(accountId: string): StoredDeviceSyncAccount | null {
    const row = this.database.prepare(`
      ${ACCOUNT_ROW_SELECT}
      where connection.id = ?
    `).get(accountId);

    return row ? mapAccountRow(decodeStoredAccountRow(row)) : null;
  }

  getAccountByExternalAccount(provider: string, externalAccountId: string): StoredDeviceSyncAccount | null {
    const row = this.database.prepare(`
      ${ACCOUNT_ROW_SELECT}
      where connection.provider = ? and connection.external_account_id = ?
    `).get(provider, externalAccountId);

    return row ? mapAccountRow(decodeStoredAccountRow(row)) : null;
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
              local_connection_revision = ?,
              local_token_revision = ?,
              last_sync_error_at = null,
              last_error_code = null,
              last_error_message = null,
              updated_at = ?
          where account_id = ?
        `).run(
          input.nextReconcileAt ?? null,
          existing.localConnectionRevision + 1,
          existing.localTokenRevision + 1,
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
          hosted_observed_connection_revision,
          hosted_observed_token_version,
          hosted_observed_token_revision,
          local_connection_revision,
          local_token_revision,
          last_webhook_at,
          last_sync_started_at,
          last_sync_completed_at,
          last_sync_error_at,
          last_error_code,
          last_error_message,
          next_reconcile_at,
          created_at,
          updated_at
        ) values (?, null, 0, null, 0, 0, 0, null, null, null, null, null, null, ?, ?, ?)
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
            local_connection_revision = ?,
            last_sync_error_at = ?,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        where account_id = ?
      `).run(
        nextReconcileAt,
        existing.localConnectionRevision + 1,
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
    return withImmediateTransaction(this.database, () => {
      const existing = this.getAccountById(accountId);

      if (!existing) {
        return null;
      }

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

      this.database.prepare(`
        update device_observation_state
        set local_token_revision = ?,
            updated_at = ?
        where account_id = ?
      `).run(
        existing.localTokenRevision + 1,
        now,
        accountId,
      );

      return this.getAccountById(accountId)!;
    });
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

      const connectionStateStale = isStaleHostedObservedUpdatedAt(
        existing?.hostedObservedUpdatedAt ?? null,
        input.hostedObservedUpdatedAt ?? null,
      );
      const connectionStateReplayed = isReplayedHostedObservedUpdatedAt({
        localConnectionRevision: existing?.localConnectionRevision ?? 0,
        nextObservedUpdatedAt: input.hostedObservedUpdatedAt ?? null,
        hostedObservedConnectionRevision: existing?.hostedObservedConnectionRevision ?? 0,
        previousObservedUpdatedAt: existing?.hostedObservedUpdatedAt ?? null,
      });
      const tokenStateStale = isStaleHostedObservedTokenVersion(
        existing?.hostedObservedTokenVersion ?? null,
        input.hostedObservedTokenVersion ?? null,
      );
      const tokenStateReplayed = isReplayedHostedObservedTokenVersion({
        hostedObservedTokenRevision: existing?.hostedObservedTokenRevision ?? 0,
        localTokenRevision: existing?.localTokenRevision ?? 0,
        nextObservedTokenVersion: input.hostedObservedTokenVersion ?? null,
        previousObservedTokenVersion: existing?.hostedObservedTokenVersion ?? null,
      });
      const hydrationPlan = resolveHostedAccountHydrationPlan({
        existing,
        hydration: input,
        connectionStateReplayed,
        connectionStateStale,
        tokenStateReplayed,
        tokenStateStale,
      });
      const shouldClearTokens = hydrationPlan.tokenPayloadAction === "clear";
      const connectionUpdatedAt = hydrationPlan.connectionAccepted
        ? input.connection.updatedAt
        : existing?.updatedAt ?? input.connection.updatedAt;
      const rowUpdatedAt = latestIsoTimestamp(existing?.updatedAt ?? null, connectionUpdatedAt)
        ?? connectionUpdatedAt;
      const { accessTokenEncrypted, refreshTokenEncrypted, accessTokenExpiresAt } = resolveHydratedHostedAccountTokens({
        existing,
        inputTokens: hydrationPlan.tokenPayloadAction === "apply_bundle" ? input.tokens : undefined,
        shouldClearTokens,
      });
      const hostedObservedUpdatedAt = hydrationPlan.connectionAccepted
        ? input.hostedObservedUpdatedAt ?? existing?.hostedObservedUpdatedAt ?? null
        : existing?.hostedObservedUpdatedAt ?? null;
      const hostedObservedConnectionRevision = hydrationPlan.connectionAccepted
        ? existing?.localConnectionRevision ?? 0
        : existing?.hostedObservedConnectionRevision ?? 0;
      const hostedObservedTokenVersion = shouldClearTokens
        ? null
        : hydrationPlan.advanceTokenObservation
          ? input.hostedObservedTokenVersion
          : existing?.hostedObservedTokenVersion ?? null;
      const hostedObservedTokenRevision = shouldClearTokens || hydrationPlan.advanceTokenObservation
        ? existing?.localTokenRevision ?? 0
        : existing?.hostedObservedTokenRevision ?? 0;
      const displayName = hydrationPlan.connectionAccepted
        ? input.connection.displayName
        : existing?.displayName ?? input.connection.displayName;
      const status = hydrationPlan.connectionAccepted
        ? input.connection.status
        : existing?.status ?? input.connection.status;
      const scopes = hydrationPlan.connectionAccepted
        ? input.connection.scopes
        : existing?.scopes ?? input.connection.scopes;
      const metadata = sanitizeStoredDeviceSyncMetadata(
        hydrationPlan.connectionAccepted
          ? input.connection.metadata
          : existing?.metadata ?? input.connection.metadata,
      );
      const connectedAt = hydrationPlan.connectionAccepted
        ? input.connection.connectedAt
        : existing?.connectedAt ?? input.connection.connectedAt;
      const disconnectGeneration = existing
        ? hydrationPlan.connectionAccepted && status === "disconnected" && existing.status !== "disconnected"
          ? existing.disconnectGeneration + 1
          : existing.disconnectGeneration
        : status === "disconnected"
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
          displayName,
          status,
          stringifyJson(scopes),
          disconnectGeneration,
          stringifyJson(metadata),
          connectedAt,
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
              hosted_observed_connection_revision = ?,
              hosted_observed_token_version = ?,
              hosted_observed_token_revision = ?,
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
          hostedObservedConnectionRevision,
          hostedObservedTokenVersion,
          hostedObservedTokenRevision,
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
        displayName,
        status,
        stringifyJson(scopes),
        disconnectGeneration,
        stringifyJson(metadata),
        connectedAt,
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
          hosted_observed_connection_revision,
          hosted_observed_token_version,
          hosted_observed_token_revision,
          last_webhook_at,
          last_sync_started_at,
          last_sync_completed_at,
          last_sync_error_at,
          last_error_code,
          last_error_message,
          next_reconcile_at,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        hostedObservedUpdatedAt,
        hostedObservedConnectionRevision,
        hostedObservedTokenVersion,
        hostedObservedTokenRevision,
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
            local_connection_revision = local_connection_revision + 1,
            local_token_revision = local_token_revision + 1,
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
            local_connection_revision = ?,
            updated_at = ?
        where account_id = ?
      `).run(
        nextReconcileAt,
        now,
        existing.localConnectionRevision + 1,
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
            local_connection_revision = local_connection_revision + 1,
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
    `).get();
    return row ? decodeNextReconcileRow(row).next_reconcile_at : null;
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

  failJobIfOwned(
    jobId: string,
    workerId: string,
    now: string,
    code: string,
    message: string,
    retryAt: string | null,
    retryable: boolean,
  ): boolean {
    return failDeviceSyncJobIfOwned(this.database, {
      code,
      jobId,
      message,
      now,
      retryAt,
      retryable,
      workerId,
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
