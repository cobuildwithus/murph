import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import { sanitizeStoredDeviceSyncMetadata, stringifyJson } from "../shared.ts";
import type { DeviceSyncAccountStatus } from "../types.ts";
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

export function markSyncSucceeded(
  database: DatabaseSync,
  accountId: string,
  now: string,
  disconnectGeneration: number | null = null,
  options: { metadataPatch?: Record<string, unknown>; nextReconcileAt?: string | null } = {},
): boolean {
  const existing = getAccountById(database, accountId);

  if (!existing) {
    return false;
  }

  const metadata = sanitizeStoredDeviceSyncMetadata(
    options.metadataPatch ? { ...existing.metadata, ...options.metadataPatch } : existing.metadata,
  );
  const nextReconcileAt = Object.prototype.hasOwnProperty.call(options, "nextReconcileAt")
    ? options.nextReconcileAt ?? null
    : existing.nextReconcileAt;

  return withImmediateTransaction(database, () => {
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
      now,
      existing.localConnectionRevision + 1,
      now,
      accountId,
    );

    return true;
  });
}

export function markSyncFailed(
  database: DatabaseSync,
  accountId: string,
  now: string,
  code: string,
  message: string,
  status: DeviceSyncAccountStatus | null | undefined,
): void {
  withImmediateTransaction(database, () => {
    database.prepare(`
      update device_connection
      set status = ?,
          updated_at = ?
      where id = ?
    `).run(status ?? getAccountById(database, accountId)?.status ?? "active", now, accountId);

    database.prepare(`
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

export function markConnectionSetupFailed(
  database: DatabaseSync,
  accountId: string,
  now: string,
  code: string,
  message: string,
) {
  const existing = getAccountById(database, accountId);
  if (!existing) {
    return null;
  }

  return withImmediateTransaction(database, () => {
    database.prepare(`
      update device_connection
      set status = 'reauthorization_required',
          updated_at = ?
      where id = ?
    `).run(now, accountId);

    database.prepare(`
      update device_credential_state
      set access_token_encrypted = '',
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
          local_connection_revision = ?,
          local_token_revision = ?,
          updated_at = ?
      where account_id = ?
    `).run(
      now,
      code,
      message,
      existing.localConnectionRevision + 1,
      existing.localTokenRevision + 1,
      now,
      accountId,
    );

    return getAccountById(database, accountId);
  });
}

export function readNextActiveReconcileAt(database: DatabaseSync): string | null {
  const row = database.prepare(`
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
