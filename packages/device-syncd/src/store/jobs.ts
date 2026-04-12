/**
 * Device job persistence owns queue dedupe plus lease/terminal transitions so
 * the main sqlite store can focus on account lifecycle rather than job state.
 */

import type { DatabaseSync } from "node:sqlite";

import { withImmediateTransaction } from "@murphai/runtime-state/node";

import {
  generatePrefixedId,
  maybeParseJsonObject,
  stringifyJson,
  toIsoTimestamp,
} from "../shared.ts";

import type { DeviceSyncJobInput, DeviceSyncJobRecord } from "../types.ts";

export interface DeviceSyncEnqueueJobInput extends DeviceSyncJobInput {
  provider: string;
  accountId: string;
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

export function getDeviceSyncJobById(database: DatabaseSync, jobId: string): DeviceSyncJobRecord | null {
  const row = database.prepare(`select * from device_job where id = ?`).get(jobId) as StoredJobRow | undefined;
  return mapJobRow(row);
}

export function readNextDeviceSyncJobWakeAt(database: DatabaseSync): string | null {
  const row = database.prepare(`
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

export function claimDueDeviceSyncJob(
  database: DatabaseSync,
  workerId: string,
  now: string,
  leaseMs: number,
): DeviceSyncJobRecord | null {
  return withImmediateTransaction(database, () => {
    const row = database.prepare(`
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
    database.prepare(`
      update device_job
      set status = 'running',
          lease_owner = ?,
          lease_expires_at = ?,
          attempts = attempts + 1,
          started_at = coalesce(started_at, ?),
          updated_at = ?
      where id = ?
    `).run(workerId, leaseExpiresAt, now, now, row.id);

    return getDeviceSyncJobById(database, row.id);
  });
}

export function completeDeviceSyncJob(database: DatabaseSync, jobId: string, now: string): void {
  database.prepare(`
    update device_job
    set status = 'succeeded',
        lease_owner = null,
        lease_expires_at = null,
        finished_at = ?,
        updated_at = ?
    where id = ?
  `).run(now, now, jobId);
}

export function completeDeviceSyncJobIfOwned(
  database: DatabaseSync,
  jobId: string,
  workerId: string,
  now: string,
): boolean {
  const result = database.prepare(`
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

export function failDeviceSyncJob(
  database: DatabaseSync,
  input: {
    code: string;
    jobId: string;
    message: string;
    now: string;
    retryAt: string | null;
    retryable: boolean;
  },
): void {
  const job = getDeviceSyncJobById(database, input.jobId);

  if (!job) {
    return;
  }

  if (job.status !== "queued" && job.status !== "running") {
    return;
  }

  if (input.retryable && job.attempts < job.maxAttempts) {
    database.prepare(`
      update device_job
      set status = 'queued',
          available_at = ?,
          lease_owner = null,
          lease_expires_at = null,
          last_error_code = ?,
          last_error_message = ?,
          updated_at = ?
      where id = ?
    `).run(input.retryAt ?? input.now, input.code, input.message, input.now, input.jobId);
    return;
  }

  database.prepare(`
    update device_job
    set status = 'dead',
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = ?,
        last_error_message = ?,
        finished_at = ?,
        updated_at = ?
    where id = ?
  `).run(input.code, input.message, input.now, input.now, input.jobId);
}

export function markPendingDeviceSyncJobsDeadForAccount(
  database: DatabaseSync,
  input: {
    accountId: string;
    code: string;
    message: string;
    now: string;
  },
): number {
  const result = database.prepare(`
    update device_job
    set status = 'dead',
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = ?,
        last_error_message = ?,
        finished_at = ?,
        updated_at = ?
    where account_id = ? and status in ('queued', 'running')
  `).run(input.code, input.message, input.now, input.now, input.accountId) as { changes: number };

  return result.changes ?? 0;
}

export function enqueueDeviceSyncJobInTransaction(
  database: DatabaseSync,
  input: DeviceSyncEnqueueJobInput,
): DeviceSyncJobRecord {
  if (input.dedupeKey) {
    const existing = database.prepare(`
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
  database.prepare(`
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

  return getDeviceSyncJobById(database, id)!;
}
