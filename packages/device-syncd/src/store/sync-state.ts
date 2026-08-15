import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { deviceSyncError } from "../errors.ts";
import { mergeStoredDeviceSyncMetadataPatch, stringifyJson } from "../shared.ts";
import type { DeviceSyncAccountStatus, OAuthStateConsumeClaim } from "../types.ts";
import {
  decodeNextReconcileRow,
  getAccountById,
} from "./accounts.ts";
import { resolveOAuthStateWithoutProviderAuthority } from "./oauth-states.ts";

export function markWebhookReceived(database: DatabaseSync, accountId: string, now: string): void {
  database.prepare(`
    update device_observation_state
    set last_webhook_at = ?, updated_at = ?
    where account_id = ?
  `).run(now, now, accountId);
}

export function markSyncStarted(database: DatabaseSync, accountId: string, now: string): void {
  database.prepare(`
    update device_observation_state
    set last_sync_started_at = ?, updated_at = ?
    where account_id = ?
  `).run(now, now, accountId);
}

export function markSyncSucceededInTransaction(
  database: DatabaseSync,
  accountId: string,
  now: string,
  disconnectGeneration: number | null = null,
  options: {
    localConnectionRevision?: number | null;
    metadataPatch?: Record<string, unknown>;
    nextReconcileAt?: string | null;
    preserveLastSyncCompletedAt?: boolean;
  } = {},
): boolean {
  const existing = getAccountById(database, accountId);

  if (!existing) {
    return false;
  }

  const expectedLocalConnectionRevision = options.localConnectionRevision ?? null;
  if (
    expectedLocalConnectionRevision !== null
    && existing.localConnectionRevision !== expectedLocalConnectionRevision
  ) {
    return false;
  }

  const metadata = mergeStoredDeviceSyncMetadataPatch(existing.metadata, options.metadataPatch);
  const nextReconcileAt = Object.prototype.hasOwnProperty.call(options, "nextReconcileAt")
    ? options.nextReconcileAt ?? null
    : existing.nextReconcileAt;
  const lastSyncCompletedAt = options.preserveLastSyncCompletedAt === true
    ? existing.lastSyncCompletedAt
    : now;

  const connectionResult = database.prepare(`
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

  database.prepare(`
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
    lastSyncCompletedAt,
    existing.localConnectionRevision + 1,
    now,
    accountId,
  );

  return true;
}

export function markSyncSucceeded(
  database: DatabaseSync,
  accountId: string,
  now: string,
  disconnectGeneration: number | null = null,
  options: {
    localConnectionRevision?: number | null;
    metadataPatch?: Record<string, unknown>;
    nextReconcileAt?: string | null;
    preserveLastSyncCompletedAt?: boolean;
  } = {},
): boolean {
  return withImmediateTransaction(database, () =>
    markSyncSucceededInTransaction(database, accountId, now, disconnectGeneration, options)
  );
}

export function markSyncFailed(
  database: DatabaseSync,
  accountId: string,
  now: string,
  code: string,
  message: string,
  status: DeviceSyncAccountStatus | null | undefined,
  options: {
    disconnectGeneration?: number | null;
    localConnectionRevision?: number | null;
    metadataPatch?: Record<string, unknown>;
  } = {},
): boolean {
  return withImmediateTransaction(database, () => {
    const existing = getAccountById(database, accountId);

    if (!existing) {
      return false;
    }

    const expectedDisconnectGeneration = options.disconnectGeneration ?? null;
    if (
      expectedDisconnectGeneration !== null
      && (
        existing.status !== "active"
        || existing.disconnectGeneration !== expectedDisconnectGeneration
      )
    ) {
      return false;
    }

    const expectedLocalConnectionRevision = options.localConnectionRevision ?? null;
    if (
      expectedLocalConnectionRevision !== null
      && existing.localConnectionRevision !== expectedLocalConnectionRevision
    ) {
      return false;
    }

    const nextStatus = status ?? existing.status;
    const terminalFailure = nextStatus === "reauthorization_required" || nextStatus === "disconnected";
    const metadataPatch = options.metadataPatch;

    if (metadataPatch && Object.keys(metadataPatch).length > 0) {
      const metadata = mergeStoredDeviceSyncMetadataPatch(existing.metadata, metadataPatch);
      database.prepare(`
        update device_connection
        set status = ?,
            metadata_json = ?,
            updated_at = ?
        where id = ?
      `).run(nextStatus, stringifyJson(metadata), now, accountId);
    } else {
      database.prepare(`
        update device_connection
        set status = ?,
            updated_at = ?
        where id = ?
      `).run(nextStatus, now, accountId);
    }

    database.prepare(`
      update device_observation_state
      set last_sync_error_at = ?,
          last_error_code = ?,
          last_error_message = ?,
          next_reconcile_at = case when ? then null else next_reconcile_at end,
          local_connection_revision = local_connection_revision + 1,
          updated_at = ?
      where account_id = ?
    `).run(now, code, message, terminalFailure ? 1 : 0, now, accountId);

    return true;
  });
}

export function markConnectionSetupFailed(
  database: DatabaseSync,
  accountId: string,
  expectedConnectedAt: string | null,
  now: string,
  code: string,
  message: string,
  oauthClaim?: OAuthStateConsumeClaim,
) {
  return withImmediateTransaction(database, () => {
    const existing = getAccountById(database, accountId);
    if (!existing) {
      return {
        account: null,
        applied: false,
        blockedByRefreshLease: false,
        oauthTokenVersion: null,
      };
    }
    if (expectedConnectedAt === null || existing.connectedAt !== expectedConnectedAt) {
      return {
        account: existing,
        applied: false,
        blockedByRefreshLease: false,
        oauthTokenVersion: existing.credential.kind === "oauth_tokens"
          ? existing.localTokenRevision
          : null,
      };
    }

    const connectionResult = database.prepare(`
      update device_connection
      set status = 'reauthorization_required',
          setup_phase = 'failed',
          setup_expires_at = null,
          updated_at = ?
      where id = ?
        and status <> 'disconnected'
    `).run(now, accountId) as { changes: number };

    if ((connectionResult.changes ?? 0) === 0) {
      const account = getAccountById(database, accountId);
      return {
        account,
        applied: false,
        blockedByRefreshLease: false,
        oauthTokenVersion: account?.credential.kind === "oauth_tokens"
          ? account.localTokenRevision
          : null,
      };
    }

    database.prepare(`
      update device_observation_state
      set last_sync_error_at = ?,
          last_error_code = ?,
          last_error_message = ?,
          next_reconcile_at = null,
          local_connection_revision = local_connection_revision + 1,
          updated_at = ?
      where account_id = ?
    `).run(
      now,
      code,
      message,
      now,
      accountId,
    );

    const account = getAccountById(database, accountId);
    if (
      oauthClaim
      && !resolveOAuthStateWithoutProviderAuthority(database, oauthClaim)
    ) {
      throw deviceSyncError({
        code: "OAUTH_STATE_CHANGED",
        message: "OAuth callback ownership changed before its durable failure outcome committed.",
        retryable: true,
        httpStatus: 409,
      });
    }
    return {
      account,
      applied: true,
      blockedByRefreshLease: false,
      oauthTokenVersion: account?.credential.kind === "oauth_tokens"
        ? account.localTokenRevision
        : null,
    };
  });
}

export function clearOAuthCredentialAfterConfirmedRevoke(
  database: DatabaseSync,
  accountId: string,
  expectedConnectedAt: string,
  expectedTokenVersion: number,
  now: string,
): boolean {
  return withImmediateTransaction(database, () => {
    const existing = getAccountById(database, accountId);
    if (
      !existing
      || existing.connectedAt !== expectedConnectedAt
      || existing.status !== "reauthorization_required"
      || existing.setupPhase !== "failed"
      || existing.credential.kind !== "oauth_tokens"
      || existing.localTokenRevision !== expectedTokenVersion
    ) {
      return false;
    }

    database.prepare(`
      update device_credential_state
      set credential_kind = 'none',
          credential_metadata_json = '{}',
          provider_config_key = null,
          access_token_encrypted = null,
          refresh_token_encrypted = null,
          access_token_expires_at = null,
          updated_at = ?
      where account_id = ?
        and credential_kind = 'oauth_tokens'
    `).run(now, accountId);

    database.prepare(`
      update device_observation_state
      set local_connection_revision = local_connection_revision + 1,
          local_token_revision = local_token_revision + 1,
          updated_at = ?
      where account_id = ?
    `).run(now, accountId);

    return true;
  });
}

export function readNextActiveReconcileAt(database: DatabaseSync): string | null {
  const row = database.prepare(`
    select observation.next_reconcile_at
    from device_observation_state as observation
    join device_connection as connection
      on connection.id = observation.account_id
    where connection.status = 'active'
      and (
        connection.setup_phase is null
        or connection.setup_phase not in ('pending_link', 'link_returned')
      )
      and observation.next_reconcile_at is not null
    order by observation.next_reconcile_at asc, observation.updated_at asc, connection.id asc
    limit 1
  `).get();
  return row ? decodeNextReconcileRow(row).next_reconcile_at : null;
}
