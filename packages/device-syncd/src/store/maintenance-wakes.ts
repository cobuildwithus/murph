/**
 * Device-sync-owned maintenance wakes cover global follow-up work that is not
 * tied to a device account or provider job row.
 */

import type { DatabaseSync } from "node:sqlite";

export const DEVICE_SYNC_DENSE_RAW_RETENTION_WAKE_KEY = "dense_raw_retention";

export function readNextDeviceSyncMaintenanceWakeAt(database: DatabaseSync): string | null {
  const row = database.prepare(`
    select next_wake_at
    from device_maintenance_wake
    order by next_wake_at asc, key asc
    limit 1
  `).get() as { next_wake_at?: string | null } | undefined;
  return row?.next_wake_at ?? null;
}

export function setDeviceSyncDenseRawRetentionWakeAt(
  database: DatabaseSync,
  nextWakeAt: string | null,
  now: string,
): void {
  if (!nextWakeAt) {
    database.prepare(`
      delete from device_maintenance_wake
      where key = ?
    `).run(DEVICE_SYNC_DENSE_RAW_RETENTION_WAKE_KEY);
    return;
  }

  database.prepare(`
    insert into device_maintenance_wake (
      key,
      next_wake_at,
      created_at,
      updated_at
    )
    values (?, ?, ?, ?)
    on conflict(key) do update set
      next_wake_at = excluded.next_wake_at,
      updated_at = excluded.updated_at
  `).run(
    DEVICE_SYNC_DENSE_RAW_RETENTION_WAKE_KEY,
    nextWakeAt,
    now,
    now,
  );
}
