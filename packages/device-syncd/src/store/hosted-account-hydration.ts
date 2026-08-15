import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import {
  generatePrefixedId,
  isBlockedStoredDeviceSyncMetadataKey,
  sanitizeStoredDeviceSyncMetadata,
  stringifyJson,
} from "../shared.ts";
import type {
  DeviceAccountCredential,
  DeviceAccountCredentialKind,
  DeviceSyncAccountSetupPhase,
  DeviceSyncAccountStatus,
  ProviderAuthTokens,
  StoredDeviceSyncAccount,
} from "../types.ts";
import type { DeviceSyncCredentialIndependentImportJobClassifier } from "../hosted-runtime.ts";
import {
  consolidateLegacyHostedAccount,
  getAccountByExternalAccount,
  getAccountByHostedConnectionId,
  getAccountById,
  getHostedConnectionIdForAccountId,
  listUnboundAccountsByConnectionEpoch,
} from "./accounts.ts";
import {
  markCredentialScopedPendingDeviceSyncJobsDeadForAccount,
  wakeRetainedDeviceSyncJobsForAccount,
} from "./jobs.ts";

type EncryptedProviderAuthTokens = ProviderAuthTokens & {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
};

type HostedAccountCredentialInput = DeviceAccountCredential & {
  credentialMetadata?: Record<string, unknown>;
};

export interface HostedAccountHydrationInput {
  advanceHostedObservedConnectionRevision?: boolean;
  classifyProviderJob?: DeviceSyncCredentialIndependentImportJobClassifier;
  clearTokens?: boolean;
  connection: {
    connectedAt: string;
    displayName: string | null;
    externalAccountId: string;
    metadata: Record<string, unknown>;
    provider: string;
    scopes: string[];
    setupExpiresAt?: string | null;
    setupPhase?: DeviceSyncAccountSetupPhase | null;
    status: DeviceSyncAccountStatus;
    updatedAt: string;
  };
  hostedConnectionId?: string | null;
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
  tokens?: EncryptedProviderAuthTokens;
  credential?: HostedAccountCredentialInput;
}

interface ResolvedHostedCredentialColumns {
  credentialKind: DeviceAccountCredentialKind;
  providerConfigKey: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: string | null;
  credentialMetadataJson: string;
}

function normalizeMetadataKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isRawHostedDeviceSyncIdentifierMetadataKey(normalizedKey: string): boolean {
  if (normalizedKey.includes("hash") || normalizedKey.includes("blindindex")) {
    return false;
  }

  return normalizedKey.includes("ownerid")
    || normalizedKey.includes("userid")
    || normalizedKey.includes("clientuserid");
}

function sanitizeHostedConnectionMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sanitized = sanitizeStoredDeviceSyncMetadata(value);

  for (const key of Object.keys(sanitized)) {
    const normalizedKey = normalizeMetadataKey(key);
    if (
      normalizedKey.includes("hmacsecret")
      || normalizedKey.includes("webhooksecret")
      || isRawHostedDeviceSyncIdentifierMetadataKey(normalizedKey)
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
      || isRawHostedDeviceSyncIdentifierMetadataKey(normalizedKey)
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

function buildCredentialMetadata(credential: HostedAccountCredentialInput): Record<string, unknown> {
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

function readStoredCredentialKind(account: StoredDeviceSyncAccount | null): DeviceAccountCredentialKind {
  const value = account?.credential.kind;

  if (value === "provider_config" || value === "none" || value === "oauth_tokens") {
    return value;
  }

  return "oauth_tokens";
}

function readStoredProviderConfigKey(account: StoredDeviceSyncAccount | null): string | null {
  const value = account?.credential.kind === "provider_config"
    ? account.credential.providerConfigKey
    : null;
  return typeof value === "string" && value ? value : null;
}

function readStoredCredentialMetadata(account: StoredDeviceSyncAccount | null): Record<string, unknown> {
  const value = account?.credential.credentialMetadata;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
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

function getHostedHydrationTokenInput(
  input: HostedAccountHydrationInput,
): HostedAccountHydrationInput["tokens"] {
  if (input.tokens) {
    return input.tokens;
  }

  if (input.credential?.kind === "oauth_tokens") {
    return requireEncryptedProviderAuthTokens(
      input.credential.tokens,
      "Hosted OAuth credential hydration requires encrypted access token fields.",
    );
  }

  return undefined;
}

function buildCredentialColumnsFromCredential(
  credential: HostedAccountCredentialInput,
): ResolvedHostedCredentialColumns {
  if (credential.kind === "oauth_tokens") {
    const tokens = requireEncryptedProviderAuthTokens(
      credential.tokens,
      "Hosted OAuth credential hydration requires encrypted access token fields.",
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
      throw new TypeError("Hosted provider-config hydration requires providerConfigKey.");
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

function buildCredentialColumnsFromExisting(
  existing: StoredDeviceSyncAccount | null,
): ResolvedHostedCredentialColumns {
  const credentialKind = readStoredCredentialKind(existing);
  const credentialMetadataJson = stringifyJson(readStoredCredentialMetadata(existing));

  if (credentialKind === "provider_config") {
    return {
      credentialKind,
      providerConfigKey: readStoredProviderConfigKey(existing),
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialMetadataJson,
    };
  }

  if (credentialKind === "none") {
    return {
      credentialKind,
      providerConfigKey: null,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialMetadataJson,
    };
  }

  if (existing?.credential.kind === "oauth_tokens") {
    return {
      credentialKind: "oauth_tokens",
      providerConfigKey: null,
      accessTokenEncrypted: existing.credential.accessTokenEncrypted,
      refreshTokenEncrypted: existing.credential.refreshTokenEncrypted,
      accessTokenExpiresAt: existing.credential.accessTokenExpiresAt,
      credentialMetadataJson,
    };
  }

  return {
    credentialKind: "none",
    providerConfigKey: null,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessTokenExpiresAt: null,
    credentialMetadataJson,
  };
}

function buildClearedCredentialColumnsFromExisting(
  existing: StoredDeviceSyncAccount | null,
): ResolvedHostedCredentialColumns {
  const credentialKind = readStoredCredentialKind(existing);
  const credentialMetadataJson = stringifyJson(readStoredCredentialMetadata(existing));

  if (credentialKind === "provider_config") {
    return {
      credentialKind,
      providerConfigKey: readStoredProviderConfigKey(existing),
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialMetadataJson,
    };
  }

  if (credentialKind === "none") {
    return {
      credentialKind,
      providerConfigKey: null,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      credentialMetadataJson,
    };
  }

  return {
    credentialKind: "none",
    providerConfigKey: null,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessTokenExpiresAt: null,
    credentialMetadataJson,
  };
}

function resolveHydratedHostedAccountCredential(input: {
  acceptNonTokenCredential: boolean;
  connectionAccepted: boolean;
  existing: StoredDeviceSyncAccount | null;
  hydration: HostedAccountHydrationInput;
  inputTokens: HostedAccountHydrationInput["tokens"];
  shouldClearTokens: boolean;
}): ResolvedHostedCredentialColumns {
  if (input.inputTokens) {
    if (input.hydration.credential?.kind === "oauth_tokens") {
      return buildCredentialColumnsFromCredential(input.hydration.credential);
    }

    return {
      credentialKind: "oauth_tokens",
      providerConfigKey: null,
      accessTokenEncrypted: input.inputTokens.accessTokenEncrypted,
      refreshTokenEncrypted: input.inputTokens.refreshTokenEncrypted ?? null,
      accessTokenExpiresAt: input.inputTokens.accessTokenExpiresAt ?? null,
      credentialMetadataJson: stringifyJson(
        buildCredentialMetadata({
          kind: "oauth_tokens",
          tokens: input.inputTokens,
        }),
      ),
    };
  }

  if (
    input.connectionAccepted
    && input.acceptNonTokenCredential
    && input.hydration.credential
    && input.hydration.credential.kind !== "oauth_tokens"
  ) {
    return buildCredentialColumnsFromCredential(input.hydration.credential);
  }

  if (input.shouldClearTokens) {
    return buildClearedCredentialColumnsFromExisting(input.existing);
  }

  return buildCredentialColumnsFromExisting(input.existing);
}

export function resolveHydratedHostedAccountTokens(input: {
  existing: StoredDeviceSyncAccount | null;
  inputTokens: HostedAccountHydrationInput["tokens"];
  shouldClearTokens: boolean;
}): {
  accessTokenEncrypted: string | null;
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
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
    };
  }

  if (input.existing?.credential.kind !== "oauth_tokens") {
    return {
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
    };
  }

  return {
    accessTokenEncrypted: input.existing.credential.accessTokenEncrypted,
    refreshTokenEncrypted: input.existing.credential.refreshTokenEncrypted,
    accessTokenExpiresAt: input.existing.credential.accessTokenExpiresAt,
  };
}

export type HostedHydratedTokenPayloadAction = "apply_bundle" | "clear" | "keep";

export function resolveHostedAccountHydrationPlan(input: {
  existing: StoredDeviceSyncAccount | null;
  hydration: HostedAccountHydrationInput;
  connectionStateReplayed: boolean;
  connectionStateStale: boolean;
  tokenStateReplayed: boolean;
  tokenStateStale: boolean;
}): {
  advanceTokenObservation: boolean;
  acceptNonTokenCredential: boolean;
  connectionAccepted: boolean;
  tokenPayloadAction: HostedHydratedTokenPayloadAction;
} {
  const connectionAccepted = input.existing === null || (!input.connectionStateStale && !input.connectionStateReplayed);
  const inputTokens = getHostedHydrationTokenInput(input.hydration);
  const tokenBundleReplacesNonOauthCredential = inputTokens !== undefined
    && input.existing !== null
    && input.existing.credential.kind !== "oauth_tokens";
  const tokenAccepted = tokenBundleReplacesNonOauthCredential
    ? connectionAccepted
    : !input.tokenStateStale && !input.tokenStateReplayed;
  const nonTokenCredentialReplacesOauthTokens = input.hydration.credential !== undefined
    && input.hydration.credential.kind !== "oauth_tokens"
    && input.existing?.credential.kind === "oauth_tokens";
  const disconnectedHostedClearRequested = input.hydration.connection.status === "disconnected"
    && inputTokens === undefined
    && (
      input.hydration.credential === undefined
      || input.hydration.credential.kind === "none"
    );
  const tokenClearRequested = input.hydration.clearTokens === true
    || disconnectedHostedClearRequested
    || (nonTokenCredentialReplacesOauthTokens && inputTokens === undefined);
  const tokenClearAccepted = !input.tokenStateStale
    && connectionAccepted
    && (disconnectedHostedClearRequested || !input.tokenStateReplayed);

  let tokenPayloadAction: HostedHydratedTokenPayloadAction = "keep";

  if (inputTokens !== undefined && tokenAccepted) {
    tokenPayloadAction = "apply_bundle";
  } else if (tokenClearRequested && inputTokens === undefined && tokenClearAccepted) {
    tokenPayloadAction = "clear";
  }

  return {
    advanceTokenObservation: tokenAccepted
      && input.hydration.hostedObservedTokenVersion !== null
      && tokenPayloadAction !== "clear",
    acceptNonTokenCredential: connectionAccepted
      && (!nonTokenCredentialReplacesOauthTokens || tokenPayloadAction === "clear"),
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

export function isStaleHostedObservedUpdatedAt(
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

export function isReplayedHostedObservedUpdatedAt(input: {
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

export function isStaleHostedObservedTokenVersion(
  previousObservedTokenVersion: number | null,
  nextObservedTokenVersion: number | null,
): boolean {
  return typeof previousObservedTokenVersion === "number"
    && typeof nextObservedTokenVersion === "number"
    && nextObservedTokenVersion < previousObservedTokenVersion;
}

export function isReplayedHostedObservedTokenVersion(input: {
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

export function hydrateHostedAccount(
  database: DatabaseSync,
  input: HostedAccountHydrationInput,
): StoredDeviceSyncAccount | null {
  return withImmediateTransaction(database, () => {
    const hostedConnectionId = normalizeHostedConnectionId(input.hostedConnectionId);
    const existingByHostedConnection = hostedConnectionId
      ? getAccountByHostedConnectionId(database, hostedConnectionId)
      : null;
    const existingByExternalAccount = getAccountByExternalAccount(
      database,
      input.connection.provider,
      input.connection.externalAccountId,
    );
    const terminalPrivacyScrub = isTerminalHostedPrivacyScrub(
      input.connection,
      hostedConnectionId,
    );
    const externalAccountHostedConnectionId = existingByExternalAccount
      ? getHostedConnectionIdForAccountId(database, existingByExternalAccount.id)
      : null;
    const unboundEpochAccounts = terminalPrivacyScrub
      ? listUnboundAccountsByConnectionEpoch(
          database,
          input.connection.provider,
          input.connection.connectedAt,
        )
      : [];
    if (
      existingByHostedConnection
      && existingByHostedConnection.provider !== input.connection.provider
    ) {
      throw new TypeError("Hosted device-sync connection cannot change providers.");
    }
    if (
      hostedConnectionId
      && externalAccountHostedConnectionId
      && externalAccountHostedConnectionId !== hostedConnectionId
    ) {
      throw new TypeError(
        "Hosted device-sync account is already bound to another hosted connection.",
      );
    }
    const recognizedBoundTerminalFork = Boolean(
      terminalPrivacyScrub
      && existingByHostedConnection
      && existingByExternalAccount
      && existingByHostedConnection.id !== existingByExternalAccount.id
      && unboundEpochAccounts.length === 1
      && unboundEpochAccounts[0]?.id === existingByExternalAccount.id
    );
    if (
      existingByHostedConnection
      && existingByExternalAccount
      && existingByHostedConnection.id !== existingByExternalAccount.id
      && !recognizedBoundTerminalFork
    ) {
      throw new TypeError(
        "Hosted device-sync connection identity conflicts with another local account.",
      );
    }
    if (
      recognizedBoundTerminalFork
      && existingByHostedConnection
      && existingByExternalAccount
    ) {
      consolidateLegacyHostedAccount(
        database,
        existingByHostedConnection.id,
        existingByExternalAccount.id,
      );
    }
    let existing = existingByHostedConnection ?? existingByExternalAccount;
    if (!existing && terminalPrivacyScrub) {
      if (
        unboundEpochAccounts.length > 1
        || unboundEpochAccounts[0]?.externalAccountId.startsWith("opaque:") === true
      ) {
        throw new TypeError("Hosted device-sync legacy connection identity is ambiguous.");
      }
      existing = unboundEpochAccounts[0] ?? null;
    }
    if (existing && terminalPrivacyScrub && !recognizedBoundTerminalFork) {
      const legacySiblings = unboundEpochAccounts.filter(
        (account) => account.id !== existing.id,
      );
      if (
        legacySiblings.length > 1
        || legacySiblings[0]?.externalAccountId.startsWith("opaque:") === true
      ) {
        throw new TypeError("Hosted device-sync legacy connection identity is ambiguous.");
      }
      if (legacySiblings[0]) {
        consolidateLegacyHostedAccount(database, existing.id, legacySiblings[0].id);
      }
    }

    if (!existing && getHostedHydrationTokenInput(input) === undefined && input.credential === undefined) {
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
    const inputTokens = getHostedHydrationTokenInput(input);
    const credentialColumns = resolveHydratedHostedAccountCredential({
      acceptNonTokenCredential: hydrationPlan.acceptNonTokenCredential,
      connectionAccepted: hydrationPlan.connectionAccepted,
      shouldClearTokens,
      existing,
      hydration: input,
      inputTokens: hydrationPlan.tokenPayloadAction === "apply_bundle" ? inputTokens : undefined,
    });
    const hostedObservedUpdatedAt = hydrationPlan.connectionAccepted
      ? input.hostedObservedUpdatedAt ?? existing?.hostedObservedUpdatedAt ?? null
      : existing?.hostedObservedUpdatedAt ?? null;
    const hostedObservedConnectionRevision = hydrationPlan.connectionAccepted
      && input.advanceHostedObservedConnectionRevision !== false
      ? existing?.localConnectionRevision ?? 0
      : existing?.hostedObservedConnectionRevision ?? 0;
    const hostedObservedTokenVersion = shouldClearTokens
      ? input.hostedObservedTokenVersion
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
    const setupPhase = hydrationPlan.connectionAccepted
      ? input.connection.setupPhase ?? null
      : existing?.setupPhase ?? input.connection.setupPhase ?? null;
    const setupExpiresAt = hydrationPlan.connectionAccepted
      ? input.connection.setupExpiresAt ?? null
      : existing?.setupExpiresAt ?? input.connection.setupExpiresAt ?? null;
    const scopes = hydrationPlan.connectionAccepted
      ? input.connection.scopes
      : existing?.scopes ?? input.connection.scopes;
    const metadata = sanitizeHostedConnectionMetadata(
      hydrationPlan.connectionAccepted
        ? input.connection.metadata
        : existing?.metadata ?? input.connection.metadata,
    );
    const connectedAt = hydrationPlan.connectionAccepted
      ? input.connection.connectedAt
      : existing?.connectedAt ?? input.connection.connectedAt;
    const externalAccountId = hydrationPlan.connectionAccepted
      ? input.connection.externalAccountId
      : existing?.externalAccountId ?? input.connection.externalAccountId;
    const disconnectGeneration = existing
      ? hydrationPlan.connectionAccepted && status === "disconnected" && existing.status !== "disconnected"
        ? existing.disconnectGeneration + 1
        : existing.disconnectGeneration
      : status === "disconnected"
        ? 1
        : 0;

    if (existing) {
      const connectionEpochReplaced = status === "active"
        && hydrationPlan.connectionAccepted
        && existing.connectedAt !== connectedAt;
      database.prepare(`
        update device_connection
        set hosted_connection_id = coalesce(?, hosted_connection_id),
            external_account_id = ?,
            display_name = ?,
            status = ?,
            setup_phase = ?,
            setup_expires_at = ?,
            scopes_json = ?,
            disconnect_generation = ?,
            metadata_json = ?,
            connected_at = ?,
            updated_at = ?
        where id = ?
      `).run(
        hostedConnectionId,
        externalAccountId,
        displayName,
        status,
        setupPhase,
        setupExpiresAt,
        stringifyJson(scopes),
        disconnectGeneration,
        stringifyJson(metadata),
        connectedAt,
        rowUpdatedAt,
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
        credentialColumns.credentialKind,
        credentialColumns.providerConfigKey,
        credentialColumns.accessTokenEncrypted,
        credentialColumns.refreshTokenEncrypted,
        credentialColumns.accessTokenExpiresAt,
        credentialColumns.credentialMetadataJson,
        rowUpdatedAt,
        existing.id,
      );

      database.prepare(`
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

      if (connectionEpochReplaced) {
        markCredentialScopedPendingDeviceSyncJobsDeadForAccount(database, {
          accountId: existing.id,
          classifyProviderJob: input.classifyProviderJob,
          code: "HOSTED_CONNECTION_EPOCH_REPLACED",
          message: "Device-sync work belonged to a replaced hosted connection epoch.",
          now: rowUpdatedAt,
        });
      }
      if (status === "active" && setupPhase === "source_confirmed") {
        wakeRetainedDeviceSyncJobsForAccount(database, {
          accountId: existing.id,
          now: rowUpdatedAt,
        });
      }

      return getAccountById(database, existing.id)!;
    }

    const id = generatePrefixedId("dsa");
    database.prepare(`
      insert into device_connection (
        id,
        hosted_connection_id,
        provider,
        external_account_id,
        display_name,
        status,
        setup_phase,
        setup_expires_at,
        scopes_json,
        disconnect_generation,
        metadata_json,
        connected_at,
        created_at,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      hostedConnectionId,
      input.connection.provider,
      input.connection.externalAccountId,
      displayName,
      status,
      setupPhase,
      setupExpiresAt,
      stringifyJson(scopes),
      disconnectGeneration,
      stringifyJson(metadata),
      connectedAt,
      input.connection.updatedAt,
      rowUpdatedAt,
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
      credentialColumns.credentialKind,
      credentialColumns.providerConfigKey,
      credentialColumns.accessTokenEncrypted,
      credentialColumns.refreshTokenEncrypted,
      credentialColumns.accessTokenExpiresAt,
      credentialColumns.credentialMetadataJson,
      input.connection.updatedAt,
      rowUpdatedAt,
    );

    database.prepare(`
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

    return getAccountById(database, id)!;
  });
}

function normalizeHostedConnectionId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isTerminalHostedPrivacyScrub(
  connection: HostedAccountHydrationInput["connection"],
  hostedConnectionId: string | null,
): boolean {
  return hostedConnectionId !== null
    && connection.status !== "active"
    && connection.externalAccountId === `opaque:${hostedConnectionId}`;
}
