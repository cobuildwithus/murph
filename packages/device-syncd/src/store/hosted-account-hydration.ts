import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { generatePrefixedId, sanitizeStoredDeviceSyncMetadata, stringifyJson } from "../shared.ts";
import type {
  DeviceSyncAccountStatus,
  ProviderAuthTokens,
  StoredDeviceSyncAccount,
} from "../types.ts";
import {
  getAccountByExternalAccount,
  getAccountById,
} from "./accounts.ts";

export interface HostedAccountHydrationInput {
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

export function resolveHydratedHostedAccountTokens(input: {
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
    const existing = getAccountByExternalAccount(
      database,
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
      database.prepare(`
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

      database.prepare(`
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

      return getAccountById(database, existing.id)!;
    }

    const id = generatePrefixedId("dsa");
    database.prepare(`
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

    database.prepare(`
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
