import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { deviceSyncError } from "../errors.ts";
import { mergeGuardedJunctionHistoricalBackfillMetadata } from "../junction-historical-backfill-progress.ts";
import { resolveDeviceProviderMatchKeys } from "../provider-match.ts";
import { shouldPreserveEstablishedDeviceSyncConnection } from "../public-account.ts";
import {
  generatePrefixedId,
  isBlockedStoredDeviceSyncMetadataKey,
  maybeParseJsonObject,
  sanitizeStoredDeviceSyncMetadata,
  stringifyJson,
  toIsoTimestamp,
} from "../shared.ts";
import type {
  DeviceAccountCredential,
  DeviceAccountCredentialKind,
  DeviceSyncAccountSetupPhase,
  DeviceSyncAccountStatus,
  ProviderAuthTokens,
  StoredDeviceSyncAccountCredential,
  StoredDeviceSyncAccount,
  ListDeviceSyncAccountsInput,
  OAuthStateConsumeClaim,
  UpsertPublicDeviceSyncExistingAccountGuard,
  UpsertPublicDeviceSyncExistingAccountPolicy,
} from "../types.ts";
import { resolveOAuthStateWithoutProviderAuthority } from "./oauth-states.ts";

type SqliteRow = Record<string, unknown>;

type EncryptedProviderAuthTokens = ProviderAuthTokens & {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
};

type StorageDeviceAccountCredential = DeviceAccountCredential & {
  credentialMetadata?: Record<string, unknown>;
};

export interface AccountUpsertInput {
  provider: string;
  externalAccountId: string;
  displayName?: string | null;
  status?: DeviceSyncAccountStatus;
  setupPhase?: DeviceSyncAccountSetupPhase | null;
  setupExpiresAt?: string | null;
  scopes?: string[];
  tokens?: EncryptedProviderAuthTokens;
  credential?: StorageDeviceAccountCredential;
  metadata?: Record<string, unknown>;
  existingAccountGuard?: UpsertPublicDeviceSyncExistingAccountGuard | null;
  existingAccountPolicy?: UpsertPublicDeviceSyncExistingAccountPolicy;
  connectedAt: string;
  nextReconcileAt?: string | null;
  oauthClaim?: OAuthStateConsumeClaim;
}

export interface AccountPatchInput {
  displayName?: string | null;
  status?: DeviceSyncAccountStatus;
  setupPhase?: DeviceSyncAccountSetupPhase | null;
  setupExpiresAt?: string | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  nextReconcileAt?: string | null;
  clearErrors?: boolean;
}

export interface StoredAccountRow {
  id: string;
  provider: string;
  external_account_id: string;
  display_name: string | null;
  status: DeviceSyncAccountStatus;
  setup_phase: DeviceSyncAccountSetupPhase | null;
  setup_expires_at: string | null;
  scopes_json: string | null;
  disconnect_generation: number;
  credential_kind: DeviceAccountCredentialKind;
  provider_config_key: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  access_token_expires_at: string | null;
  credential_metadata_json: string | null;
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

export interface DeviceSyncSummaryRow {
  accounts_total: number;
  accounts_active: number;
  jobs_queued: number;
  jobs_running: number;
  jobs_dead: number;
  oauth_states: number;
  webhook_traces: number;
}

export interface NextReconcileRow {
  next_reconcile_at: string | null;
}

export const ACCOUNT_ROW_SELECT = `
  select
    connection.id as id,
    connection.provider as provider,
    connection.external_account_id as external_account_id,
    connection.display_name as display_name,
    connection.status as status,
    connection.setup_phase as setup_phase,
    connection.setup_expires_at as setup_expires_at,
    connection.scopes_json as scopes_json,
    connection.disconnect_generation as disconnect_generation,
    credential.credential_kind as credential_kind,
    credential.provider_config_key as provider_config_key,
    credential.access_token_encrypted as access_token_encrypted,
    credential.refresh_token_encrypted as refresh_token_encrypted,
    credential.access_token_expires_at as access_token_expires_at,
    credential.credential_metadata_json as credential_metadata_json,
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

function expectDeviceAccountCredentialKind(
  value: unknown,
  field: string,
): DeviceAccountCredentialKind {
  if (value === "oauth_tokens" || value === "provider_config" || value === "none") {
    return value;
  }

  throw new TypeError(`Expected ${field} to be a supported device account credential kind.`);
}

function expectDeviceSyncAccountStatus(
  value: unknown,
  field: string,
): DeviceSyncAccountStatus {
  if (value === "active" || value === "reauthorization_required" || value === "disconnected") {
    return value;
  }

  throw new TypeError(`Expected ${field} to be a supported device account status.`);
}

function expectNullableDeviceSyncAccountSetupPhase(
  value: unknown,
  field: string,
): DeviceSyncAccountSetupPhase | null {
  if (value === null) {
    return null;
  }

  if (
    value === "pending_link"
    || value === "link_returned"
    || value === "source_confirmed"
    || value === "failed"
  ) {
    return value;
  }

  throw new TypeError(`Expected ${field} to be a supported device account setup phase.`);
}

function normalizeMetadataKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isRawDeviceSyncIdentifierMetadataKey(normalizedKey: string): boolean {
  if (normalizedKey.includes("hash") || normalizedKey.includes("blindindex")) {
    return false;
  }

  return normalizedKey.includes("ownerid")
    || normalizedKey.includes("userid")
    || normalizedKey.includes("clientuserid");
}

function sanitizeStoredDeviceSyncAccountMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sanitized = sanitizeStoredDeviceSyncMetadata(value);

  for (const key of Object.keys(sanitized)) {
    const normalizedKey = normalizeMetadataKey(key);
    if (
      normalizedKey.includes("hmacsecret")
      || normalizedKey.includes("webhooksecret")
      || isRawDeviceSyncIdentifierMetadataKey(normalizedKey)
    ) {
      delete sanitized[key];
    }
  }

  return sanitized;
}

function sanitizeCredentialMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sanitized = sanitizeStoredDeviceSyncMetadata(value);

  for (const key of Object.keys(sanitized)) {
    const normalizedKey = normalizeMetadataKey(key);
    if (
      normalizedKey.includes("hmacsecret")
      || normalizedKey.includes("webhooksecret")
      || isRawDeviceSyncIdentifierMetadataKey(normalizedKey)
    ) {
      delete sanitized[key];
    }
  }

  return sanitized;
}

function sanitizeCredentialSubject(
  value: object | null | undefined,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const subject: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (Object.keys(subject).length >= 16) {
      break;
    }

    const key = rawKey.trim();

    if (
      !key
      || key.length > 64
      || isBlockedStoredDeviceSyncMetadataKey(key)
    ) {
      continue;
    }

    if (typeof rawValue === "string" && rawValue.length <= 256) {
      subject[key] = rawValue;
    }
  }

  return subject;
}

function sanitizeStoredCredentialMetadata(
  kind: DeviceAccountCredentialKind,
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (kind !== "provider_config") {
    return sanitizeCredentialMetadata(value);
  }

  const metadata = sanitizeCredentialMetadata(value);
  const subjectValue = value && typeof value === "object" && !Array.isArray(value)
    ? value.subject
    : undefined;
  const subject = subjectValue && typeof subjectValue === "object" && !Array.isArray(subjectValue)
    ? sanitizeCredentialSubject(subjectValue)
    : {};

  return Object.keys(subject).length > 0
    ? {
        ...metadata,
        subject,
      }
    : metadata;
}

function parseCredentialMetadataJson(
  value: string | null,
  kind: DeviceAccountCredentialKind,
): Record<string, unknown> {
  return sanitizeStoredCredentialMetadata(kind, maybeParseJsonObject(value));
}

function buildCredentialMetadata(credential: StorageDeviceAccountCredential): Record<string, unknown> {
  const metadata = sanitizeCredentialMetadata(credential.credentialMetadata ?? {});

  if (credential.kind !== "provider_config") {
    return metadata;
  }

  const subject = sanitizeCredentialSubject(credential.subject);
  return Object.keys(subject).length > 0
    ? {
        ...metadata,
        subject,
      }
    : metadata;
}

interface ResolvedAccountCredentialColumns {
  credentialKind: DeviceAccountCredentialKind;
  providerConfigKey: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: string | null;
  credentialMetadataJson: string;
}

function hasEncryptedProviderAuthTokens(
  tokens: ProviderAuthTokens,
): tokens is EncryptedProviderAuthTokens {
  const accessTokenEncrypted = Reflect.get(tokens, "accessTokenEncrypted");
  const refreshTokenEncrypted = Reflect.get(tokens, "refreshTokenEncrypted");

  return typeof accessTokenEncrypted === "string"
    && (
      refreshTokenEncrypted === undefined
      || refreshTokenEncrypted === null
      || typeof refreshTokenEncrypted === "string"
    );
}

function requireEncryptedProviderAuthTokens(
  tokens: ProviderAuthTokens,
  message: string,
): EncryptedProviderAuthTokens {
  if (hasEncryptedProviderAuthTokens(tokens)) {
    return tokens;
  }

  throw new TypeError(message);
}

function resolveAccountCredentialInput(input: AccountUpsertInput): ResolvedAccountCredentialColumns {
  const credential = input.credential
    ?? (input.tokens
      ? {
          kind: "oauth_tokens",
          tokens: input.tokens,
        } satisfies StorageDeviceAccountCredential
      : null);

  if (!credential) {
    throw new TypeError("Device sync account upsert requires tokens or a credential.");
  }

  if (credential.kind === "oauth_tokens") {
    const tokens = requireEncryptedProviderAuthTokens(
      credential.tokens,
      "OAuth token device account credentials require encrypted access token fields.",
    );

    return {
      credentialKind: "oauth_tokens",
      providerConfigKey: null,
      accessTokenEncrypted: tokens.accessTokenEncrypted,
      refreshTokenEncrypted: tokens.refreshTokenEncrypted ?? null,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
      credentialMetadataJson: stringifyJson(buildCredentialMetadata(credential)),
    };
  }

  if (credential.kind === "provider_config") {
    const providerConfigKey = credential.providerConfigKey.trim();
    if (!providerConfigKey) {
      throw new TypeError("Provider-config device account credentials require providerConfigKey.");
    }

    return {
      credentialKind: "provider_config",
      providerConfigKey,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialMetadataJson: stringifyJson(buildCredentialMetadata(credential)),
    };
  }

  return {
    credentialKind: "none",
    providerConfigKey: null,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessTokenExpiresAt: null,
    credentialMetadataJson: stringifyJson(buildCredentialMetadata(credential)),
  };
}

function validateStoredCredentialRow(row: StoredAccountRow): void {
  if (row.credential_kind === "oauth_tokens") {
    if (row.provider_config_key !== null || !row.access_token_encrypted) {
      throw new TypeError("Stored OAuth token credential rows require an access token and no provider config key.");
    }
    return;
  }

  if (row.access_token_encrypted !== null) {
    throw new TypeError("Stored non-token credential rows must not contain access tokens.");
  }

  if (row.refresh_token_encrypted !== null || row.access_token_expires_at !== null) {
    throw new TypeError("Stored non-token credential rows must not contain token bundle fields.");
  }

  if (row.credential_kind === "provider_config") {
    if (!row.provider_config_key) {
      throw new TypeError("Stored provider-config credential rows require provider_config_key.");
    }
    return;
  }

  if (row.provider_config_key !== null) {
    throw new TypeError("Stored none credential rows must not contain provider_config_key.");
  }
}

function buildStoredAccountCredential(row: StoredAccountRow): StoredDeviceSyncAccountCredential {
  const credentialMetadata = parseCredentialMetadataJson(row.credential_metadata_json, row.credential_kind);

  if (row.credential_kind === "oauth_tokens") {
    if (!row.access_token_encrypted) {
      throw new TypeError("Stored OAuth token credential rows require an access token.");
    }

    return {
      kind: "oauth_tokens",
      accessTokenEncrypted: row.access_token_encrypted,
      refreshTokenEncrypted: row.refresh_token_encrypted,
      accessTokenExpiresAt: row.access_token_expires_at,
      credentialMetadata,
    };
  }

  if (row.credential_kind === "provider_config") {
    if (!row.provider_config_key) {
      throw new TypeError("Stored provider-config credential rows require provider_config_key.");
    }

    return {
      kind: "provider_config",
      providerConfigKey: row.provider_config_key,
      credentialMetadata,
    };
  }

  return {
    kind: "none",
    credentialMetadata,
  };
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

export function decodeStoredAccountRow(row: SqliteRow): StoredAccountRow {
  const decoded: StoredAccountRow = {
    id: expectString(row.id, "device_connection.id"),
    provider: expectString(row.provider, "device_connection.provider"),
    external_account_id: expectString(
      row.external_account_id,
      "device_connection.external_account_id",
    ),
    display_name: expectNullableString(row.display_name, "device_connection.display_name"),
    status: expectDeviceSyncAccountStatus(row.status, "device_connection.status"),
    setup_phase: expectNullableDeviceSyncAccountSetupPhase(
      row.setup_phase,
      "device_connection.setup_phase",
    ),
    setup_expires_at: expectNullableString(
      row.setup_expires_at,
      "device_connection.setup_expires_at",
    ),
    scopes_json: expectNullableString(row.scopes_json, "device_connection.scopes_json"),
    disconnect_generation: expectNumber(
      row.disconnect_generation,
      "device_connection.disconnect_generation",
    ),
    credential_kind: expectDeviceAccountCredentialKind(
      row.credential_kind,
      "device_credential_state.credential_kind",
    ),
    provider_config_key: expectNullableString(
      row.provider_config_key,
      "device_credential_state.provider_config_key",
    ),
    access_token_encrypted: expectNullableString(
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
    credential_metadata_json: expectNullableString(
      row.credential_metadata_json,
      "device_credential_state.credential_metadata_json",
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

  validateStoredCredentialRow(decoded);
  return decoded;
}

export function decodeDeviceSyncSummaryRow(row: SqliteRow): DeviceSyncSummaryRow {
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

export function decodeNextReconcileRow(row: SqliteRow): NextReconcileRow {
  return {
    next_reconcile_at: expectNullableString(
      row.next_reconcile_at,
      "device_observation_state.next_reconcile_at",
    ),
  };
}

export function mapAccountRow(row: StoredAccountRow): StoredDeviceSyncAccount {
  return {
    id: row.id,
    provider: row.provider,
    externalAccountId: row.external_account_id,
    displayName: row.display_name,
    status: row.status,
    setupPhase: row.setup_phase,
    setupExpiresAt: row.setup_expires_at,
    scopes: parseStoredStringArray(row.scopes_json, "device_connection.scopes_json"),
    disconnectGeneration: row.disconnect_generation,
    credential: buildStoredAccountCredential(row),
    hostedObservedConnectionRevision: row.hosted_observed_connection_revision,
    hostedObservedTokenRevision: row.hosted_observed_token_revision,
    hostedObservedTokenVersion: row.hosted_observed_token_version,
    hostedObservedUpdatedAt: row.hosted_observed_updated_at,
    localConnectionRevision: row.local_connection_revision,
    localTokenRevision: row.local_token_revision,
    accessTokenExpiresAt: row.access_token_expires_at,
    metadata: sanitizeStoredDeviceSyncAccountMetadata(maybeParseJsonObject(row.metadata_json)),
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

export function listAccounts(
  database: DatabaseSync,
  input: ListDeviceSyncAccountsInput = {},
): StoredDeviceSyncAccount[] {
  const conditions: string[] = [];
  const params: string[] = [];

  if (input.provider) {
    const providerKeys = resolveDeviceProviderMatchKeys(input.provider);
    if (providerKeys.length === 0) {
      conditions.push("1 = 0");
    } else {
      const providerPlaceholders = sqlPlaceholders(providerKeys);
      conditions.push(`(
        connection.provider in (${providerPlaceholders})
        or exists (
          select 1
          from device_connection_source source
          where source.connection_id = connection.id
            and source.source_provider_slug in (${providerPlaceholders})
            and source.status <> 'disconnected'
        )
      )`);
      params.push(...providerKeys, ...providerKeys);
    }
  }

  if (input.sourceProviderSlug) {
    const sourceProviderKeys = resolveDeviceProviderMatchKeys(input.sourceProviderSlug);
    if (sourceProviderKeys.length === 0) {
      conditions.push("1 = 0");
    } else {
      conditions.push(`
        exists (
          select 1
          from device_connection_source source
          where source.connection_id = connection.id
            and source.source_provider_slug in (${sqlPlaceholders(sourceProviderKeys)})
            and source.status <> 'disconnected'
        )
      `);
      params.push(...sourceProviderKeys);
    }
  }

  const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  const rows = (conditions.length > 0
    ? database.prepare(`
        ${ACCOUNT_ROW_SELECT}
        ${whereClause}
        order by updated_at desc, connection.id desc
      `).all(...params)
    : database.prepare(`
        ${ACCOUNT_ROW_SELECT}
        order by updated_at desc, connection.id desc
      `).all()).map((row) => decodeStoredAccountRow(row));

  return rows.map((row) => mapAccountRow(row));
}

function sqlPlaceholders(values: readonly unknown[]): string {
  if (values.length === 0) {
    throw new TypeError("Expected at least one SQL placeholder value.");
  }

  return values.map(() => "?").join(", ");
}

export function getAccountById(database: DatabaseSync, accountId: string): StoredDeviceSyncAccount | null {
  const row = database.prepare(`
    ${ACCOUNT_ROW_SELECT}
    where connection.id = ?
  `).get(accountId);

  return row ? mapAccountRow(decodeStoredAccountRow(row)) : null;
}

export function getAccountByExternalAccount(
  database: DatabaseSync,
  provider: string,
  externalAccountId: string,
): StoredDeviceSyncAccount | null {
  const row = database.prepare(`
    ${ACCOUNT_ROW_SELECT}
    where connection.provider = ? and connection.external_account_id = ?
  `).get(provider, externalAccountId);

  return row ? mapAccountRow(decodeStoredAccountRow(row)) : null;
}

export function getAccountByHostedConnectionId(
  database: DatabaseSync,
  hostedConnectionId: string,
): StoredDeviceSyncAccount | null {
  const row = database.prepare(`
    ${ACCOUNT_ROW_SELECT}
    where connection.hosted_connection_id = ?
  `).get(hostedConnectionId);

  return row ? mapAccountRow(decodeStoredAccountRow(row)) : null;
}

export function getHostedConnectionIdForAccountId(
  database: DatabaseSync,
  accountId: string,
): string | null {
  const row = database.prepare(`
    select hosted_connection_id
    from device_connection
    where id = ?
  `).get(accountId) as SqliteRow | undefined;

  return row
    ? expectNullableString(row.hosted_connection_id, "device_connection.hosted_connection_id")
    : null;
}

export function listUnboundAccountsByConnectionEpoch(
  database: DatabaseSync,
  provider: string,
  connectedAt: string,
): StoredDeviceSyncAccount[] {
  const rows = database.prepare(`
    ${ACCOUNT_ROW_SELECT}
    where connection.hosted_connection_id is null
      and connection.provider = ?
      and connection.connected_at = ?
    order by connection.id asc
  `).all(provider, connectedAt).map((row) => decodeStoredAccountRow(row));

  return rows.map((row) => mapAccountRow(row));
}

export function getUnboundAccountByConnectionEpoch(
  database: DatabaseSync,
  provider: string,
  connectedAt: string,
): StoredDeviceSyncAccount | null {
  const accounts = listUnboundAccountsByConnectionEpoch(database, provider, connectedAt);

  if (
    accounts.length > 1
    || accounts[0]?.externalAccountId.startsWith("opaque:") === true
  ) {
    throw new TypeError("Hosted device-sync legacy connection identity is ambiguous.");
  }

  return accounts[0] ?? null;
}

export function consolidateLegacyHostedAccount(
  database: DatabaseSync,
  canonicalAccountId: string,
  legacyAccountId: string,
): void {
  if (canonicalAccountId === legacyAccountId) {
    return;
  }

  database.prepare(`
    delete from device_connection_source
    where connection_id = ?
      and source_instance_key in (
        select source_instance_key
        from device_connection_source
        where connection_id = ?
      )
  `).run(legacyAccountId, canonicalAccountId);
  database.prepare(`
    update device_connection_source
    set connection_id = ?
    where connection_id = ?
  `).run(canonicalAccountId, legacyAccountId);
  database.prepare(`
    update device_job
    set account_id = ?
    where account_id = ?
  `).run(canonicalAccountId, legacyAccountId);
  database.prepare("delete from device_connection where id = ?").run(legacyAccountId);
}

export function upsertAccount(
  database: DatabaseSync,
  input: AccountUpsertInput,
): StoredDeviceSyncAccount {
  return withImmediateTransaction(database, () => {
    const existing = getAccountByExternalAccount(database, input.provider, input.externalAccountId);
    const now = input.connectedAt;
    const status = input.status ?? existing?.status ?? "active";
    const setupPhase = Object.prototype.hasOwnProperty.call(input, "setupPhase")
      ? input.setupPhase ?? null
      : existing?.setupPhase ?? null;
    const setupExpiresAt = Object.prototype.hasOwnProperty.call(input, "setupExpiresAt")
      ? input.setupExpiresAt ?? null
      : existing?.setupExpiresAt ?? null;
    const scopesJson = stringifyJson(input.scopes ?? []);
    const replacementMetadata = sanitizeStoredDeviceSyncAccountMetadata(input.metadata ?? {});

    if (existing) {
      assertAccountUpsertExistingGuard(existing, input.existingAccountGuard ?? null);
      if (
        shouldPreserveEstablishedDeviceSyncConnection(
          existing,
          input.existingAccountPolicy ?? "replace",
        )
      ) {
        requireExactOAuthClaimResolution(database, input.oauthClaim);
        return existing;
      }
      const credential = resolveAccountCredentialInput(input);
      const metadata = input.provider === "junction" && input.existingAccountGuard
        ? mergeGuardedJunctionHistoricalBackfillMetadata({
            existingMetadata: existing.metadata,
            replacementMetadata,
          })
        : replacementMetadata;
      const metadataJson = stringifyJson(sanitizeStoredDeviceSyncAccountMetadata(metadata));

      database.prepare(`
        update device_connection
        set display_name = ?,
            status = ?,
            setup_phase = ?,
            setup_expires_at = ?,
            scopes_json = ?,
            metadata_json = ?,
            connected_at = ?,
            updated_at = ?
        where id = ?
      `).run(
        input.displayName ?? null,
        status,
        setupPhase,
        setupExpiresAt,
        scopesJson,
        metadataJson,
        input.connectedAt,
        now,
        existing.id,
      );

      database.prepare(`
        update device_credential_state
        set credential_kind = ?,
            provider_config_key = ?,
            access_token_encrypted = ?,
            refresh_token_encrypted = ?,
            access_token_expires_at = ?,
            credential_metadata_json = ?,
            updated_at = ?
        where account_id = ?
      `).run(
        credential.credentialKind,
        credential.providerConfigKey,
        credential.accessTokenEncrypted,
        credential.refreshTokenEncrypted,
        credential.accessTokenExpiresAt,
        credential.credentialMetadataJson,
        now,
        existing.id,
      );

      database.prepare(`
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

      const updated = getAccountById(database, existing.id)!;
      requireExactOAuthClaimResolution(database, input.oauthClaim);
      return updated;
    }

    assertAccountUpsertExistingGuard(null, input.existingAccountGuard ?? null);
    const credential = resolveAccountCredentialInput(input);
    const metadataJson = stringifyJson(replacementMetadata);

    const id = generatePrefixedId("dsa");
    database.prepare(`
      insert into device_connection (
        id,
        provider,
        external_account_id,
        display_name,
        status,
        setup_phase,
        setup_expires_at,
        scopes_json,
        metadata_json,
        connected_at,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.provider,
      input.externalAccountId,
      input.displayName ?? null,
      status,
      setupPhase,
      setupExpiresAt,
      scopesJson,
      metadataJson,
      input.connectedAt,
      now,
      now,
    );

    database.prepare(`
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
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      credential.credentialKind,
      credential.providerConfigKey,
      credential.accessTokenEncrypted,
      credential.refreshTokenEncrypted,
      credential.accessTokenExpiresAt,
      credential.credentialMetadataJson,
      now,
      now,
    );

    database.prepare(`
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

    const created = getAccountById(database, id)!;
    requireExactOAuthClaimResolution(database, input.oauthClaim);
    return created;
  });
}

function requireExactOAuthClaimResolution(
  database: DatabaseSync,
  claim: OAuthStateConsumeClaim | undefined,
): void {
  if (!claim) {
    return;
  }
  if (!resolveOAuthStateWithoutProviderAuthority(database, claim)) {
    throw deviceSyncError({
      code: "OAUTH_STATE_CHANGED",
      message: "OAuth callback ownership changed before its durable connection outcome committed.",
      retryable: true,
      httpStatus: 409,
    });
  }
}

function assertAccountUpsertExistingGuard(
  existing: StoredDeviceSyncAccount | null,
  guard: UpsertPublicDeviceSyncExistingAccountGuard | null,
): void {
  if (!guard) {
    return;
  }

  if (!existing || existing.id !== guard.expectedAccountId) {
    throw deviceSyncError({
      code: "CONNECTION_SEEDED_ACCOUNT_MISMATCH",
      message: "Device sync connection callback referenced an unexpected seeded account.",
      retryable: false,
      httpStatus: 400,
    });
  }

  if (guard.rejectIfDisconnected && existing.status === "disconnected") {
    throw deviceSyncError({
      code: "CONNECTION_ALREADY_DISCONNECTED",
      message: "Device sync connection callback was received after the seeded account was disconnected.",
      retryable: false,
      httpStatus: 409,
    });
  }

  if (existing.connectedAt !== guard.expectedConnectedAt) {
    throw deviceSyncError({
      code: "CONNECTION_SEEDED_ACCOUNT_CHANGED",
      message: "Device sync connection changed after this connection flow started.",
      retryable: false,
      httpStatus: 409,
    });
  }
}

export function patchAccount(
  database: DatabaseSync,
  accountId: string,
  patch: AccountPatchInput,
): StoredDeviceSyncAccount {
  return withImmediateTransaction(database, () => {
    const existing = getAccountById(database, accountId);

    if (!existing) {
      throw new TypeError(`Unknown account ${accountId}`);
    }

    const now = toIsoTimestamp(new Date());
    const metadata = sanitizeStoredDeviceSyncAccountMetadata(
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
    const setupPhase = Object.prototype.hasOwnProperty.call(patch, "setupPhase")
      ? patch.setupPhase ?? null
      : existing.setupPhase ?? null;
    const setupExpiresAt = Object.prototype.hasOwnProperty.call(patch, "setupExpiresAt")
      ? patch.setupExpiresAt ?? null
      : existing.setupExpiresAt ?? null;

    database.prepare(`
      update device_connection
      set display_name = ?,
          status = ?,
          setup_phase = ?,
          setup_expires_at = ?,
          scopes_json = ?,
          metadata_json = ?,
          updated_at = ?
      where id = ?
    `).run(
      displayName,
      patch.status ?? existing.status,
      setupPhase,
      setupExpiresAt,
      stringifyJson(scopes),
      stringifyJson(metadata),
      now,
      existing.id,
    );

    database.prepare(`
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

    return getAccountById(database, existing.id)!;
  });
}

export function updateAccountTokens(
  database: DatabaseSync,
  accountId: string,
  tokens: EncryptedProviderAuthTokens,
  disconnectGeneration?: number,
): StoredDeviceSyncAccount | null {
  return withImmediateTransaction(database, () => {
    const existing = getAccountById(database, accountId);

    if (!existing) {
      return null;
    }

    const now = toIsoTimestamp(new Date());
    const result = database.prepare(`
      update device_credential_state
      set access_token_encrypted = ?,
          refresh_token_encrypted = ?,
          access_token_expires_at = ?,
          updated_at = ?
      where account_id = ?
        and credential_kind = 'oauth_tokens'
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

    database.prepare(`
      update device_observation_state
      set local_token_revision = ?,
          updated_at = ?
      where account_id = ?
    `).run(
      existing.localTokenRevision + 1,
      now,
      accountId,
    );

    return getAccountById(database, accountId)!;
  });
}

export function disconnectAccountIfCurrentInTransaction(
  database: DatabaseSync,
  accountId: string,
  now: string,
  expectedLocalConnectionRevision: number | null,
  expectedStatus: DeviceSyncAccountStatus | null,
  expectedConnectedAt: string | null,
): StoredDeviceSyncAccount | null {
  const connectionResult = database.prepare(`
    update device_connection
    set status = 'disconnected',
        setup_phase = null,
        setup_expires_at = null,
        disconnect_generation = disconnect_generation + 1,
        updated_at = ?
    where id = ?
      and (? is null or status = ?)
      and (? is null or connected_at = ?)
      and (? is null or exists (
        select 1
        from device_observation_state
        where device_observation_state.account_id = device_connection.id
          and device_observation_state.local_connection_revision = ?
      ))
  `).run(
    now,
    accountId,
    expectedStatus,
    expectedStatus,
    expectedConnectedAt,
    expectedConnectedAt,
    expectedLocalConnectionRevision,
    expectedLocalConnectionRevision,
  ) as { changes: number };

  if ((connectionResult.changes ?? 0) === 0) {
    return null;
  }

  database.prepare(`
    update device_credential_state
    set credential_kind = case
          when credential_kind = 'oauth_tokens' then 'none'
          else credential_kind
        end,
        provider_config_key = case
          when credential_kind = 'oauth_tokens' then null
          else provider_config_key
        end,
        access_token_encrypted = null,
        refresh_token_encrypted = null,
        access_token_expires_at = null,
        updated_at = ?
    where account_id = ?
  `).run(now, accountId);

  database.prepare(`
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

  return getAccountById(database, accountId);
}

export function disconnectAccount(
  database: DatabaseSync,
  accountId: string,
  now: string,
): StoredDeviceSyncAccount {
  return withImmediateTransaction(database, () =>
    disconnectAccountIfCurrentInTransaction(database, accountId, now, null, null, null)
  )!;
}
