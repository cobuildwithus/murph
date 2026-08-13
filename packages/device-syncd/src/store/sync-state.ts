import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { mergeStoredDeviceSyncMetadataPatch, stringifyJson } from "../shared.ts";
import type { DeviceSyncAccountStatus, StoredDeviceSyncAccount } from "../types.ts";
import {
  decodeNextReconcileRow,
  getAccountById,
} from "./accounts.ts";

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
    updatesLastSyncCompletedAt?: boolean;
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
        last_sync_completed_at = case when ? = 1 then ? else last_sync_completed_at end,
        last_sync_error_at = null,
        last_error_code = null,
        last_error_message = null,
        local_connection_revision = ?,
        updated_at = ?
    where account_id = ?
  `).run(
    nextReconcileAt,
    options.updatesLastSyncCompletedAt === false ? 0 : 1,
    now,
    existing.localConnectionRevision + 1,
    now,
    accountId,
  );

  return true;
}

export function patchSyncContinuationMetadataInTransaction(
  database: DatabaseSync,
  accountId: string,
  now: string,
  disconnectGeneration: number | null,
  options: {
    localConnectionRevision: number;
    metadataPatch?: Record<string, unknown>;
  },
): StoredDeviceSyncAccount | null {
  const existing = getAccountById(database, accountId);

  if (
    !existing
    || existing.localConnectionRevision !== options.localConnectionRevision
    || (
      disconnectGeneration !== null
      && (
        existing.disconnectGeneration !== disconnectGeneration
        || existing.status !== "active"
      )
    )
  ) {
    return null;
  }

  const metadata = mergeStoredDeviceSyncMetadataPatch(existing.metadata, options.metadataPatch);
  const metadataJson = stringifyJson(metadata);
  if (metadataJson === stringifyJson(existing.metadata)) {
    return existing;
  }

  const connectionResult = database.prepare(`
    update device_connection
    set metadata_json = ?,
        updated_at = ?
    where id = ?
      and (? is null or (disconnect_generation = ? and status = 'active'))
  `).run(
    metadataJson,
    now,
    accountId,
    disconnectGeneration ?? null,
    disconnectGeneration ?? null,
  ) as { changes: number };

  if ((connectionResult.changes ?? 0) === 0) {
    return null;
  }

  database.prepare(`
    update device_observation_state
    set local_connection_revision = ?,
        updated_at = ?
    where account_id = ?
  `).run(existing.localConnectionRevision + 1, now, accountId);

  return getAccountById(database, accountId);
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
    updatesLastSyncCompletedAt?: boolean;
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
) {
  return withImmediateTransaction(database, () => {
    const existing = getAccountById(database, accountId);
    if (!existing) {
      return { account: null, applied: false };
    }
    if (expectedConnectedAt === null || existing.connectedAt !== expectedConnectedAt) {
      return { account: existing, applied: false };
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
      return { account: getAccountById(database, accountId), applied: false };
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
      set last_sync_error_at = ?,
          last_error_code = ?,
          last_error_message = ?,
          next_reconcile_at = null,
          local_connection_revision = local_connection_revision + 1,
          local_token_revision = local_token_revision + 1,
          updated_at = ?
      where account_id = ?
    `).run(
      now,
      code,
      message,
      now,
      accountId,
    );

    return { account: getAccountById(database, accountId), applied: true };
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
