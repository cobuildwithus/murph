/**
 * Device job persistence owns queue dedupe plus lease/terminal transitions so
 * the main sqlite store can focus on account lifecycle rather than job state.
 */

import type { DatabaseSync } from "node:sqlite";

import { COMPANION_HRV_RMSSD_RESOURCE } from "@murphai/contracts";
import { withImmediateTransaction } from "@murphai/runtime-state/node";

import {
  generatePrefixedId,
  maybeParseJsonObject,
  stringifyJson,
  toIsoTimestamp,
} from "../shared.ts";
import {
  isDeviceSyncCredentialIndependentImportJob,
  type DeviceSyncCredentialIndependentImportJobClassifier,
} from "../hosted-runtime.ts";
import { isJunctionRetainedAcceptedWorkJob } from "../junction-resources.ts";
import type {
  DeviceSyncJobFailureDisposition,
  DeviceSyncJobFailureTransition,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
} from "../types.ts";

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

const EXPIRED_JOB_LEASE_ERROR_CODE = "LEASE_EXPIRED";
const EXPIRED_JOB_LEASE_ERROR_MESSAGE = "Device sync job lease expired before completion.";
export const DEVICE_SYNC_ACTIVE_DEDUPE_KEY_LOOKUP_LIMIT = 396;

function requireJobRowString(
  row: Record<string, unknown>,
  field: keyof StoredJobRow,
): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new TypeError(`Expected device_job.${field} to be a string.`);
  }
  return value;
}

function requireJobRowNumber(
  row: Record<string, unknown>,
  field: keyof StoredJobRow,
): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Expected device_job.${field} to be a number.`);
  }
  return value;
}

function readJobRowNullableString(
  row: Record<string, unknown>,
  field: keyof StoredJobRow,
): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`Expected device_job.${field} to be a string or null.`);
  }
  return value;
}

function decodeStoredJobRow(row: Record<string, unknown>): StoredJobRow {
  const status = requireJobRowString(row, "status");
  if (
    status !== "queued"
    && status !== "running"
    && status !== "succeeded"
    && status !== "dead"
  ) {
    throw new TypeError("Expected device_job.status to be a supported job status.");
  }

  return {
    account_id: requireJobRowString(row, "account_id"),
    attempts: requireJobRowNumber(row, "attempts"),
    available_at: requireJobRowString(row, "available_at"),
    created_at: requireJobRowString(row, "created_at"),
    dedupe_key: readJobRowNullableString(row, "dedupe_key"),
    finished_at: readJobRowNullableString(row, "finished_at"),
    id: requireJobRowString(row, "id"),
    kind: requireJobRowString(row, "kind"),
    last_error_code: readJobRowNullableString(row, "last_error_code"),
    last_error_message: readJobRowNullableString(row, "last_error_message"),
    lease_expires_at: readJobRowNullableString(row, "lease_expires_at"),
    lease_owner: readJobRowNullableString(row, "lease_owner"),
    max_attempts: requireJobRowNumber(row, "max_attempts"),
    payload_json: readJobRowNullableString(row, "payload_json"),
    priority: requireJobRowNumber(row, "priority"),
    provider: requireJobRowString(row, "provider"),
    started_at: readJobRowNullableString(row, "started_at"),
    status,
    updated_at: requireJobRowString(row, "updated_at"),
  };
}

function deadLetterExpiredExhaustedDeviceSyncJobs(database: DatabaseSync, now: string): void {
  database.prepare(`
    update device_job
    set status = 'dead',
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = ?,
        last_error_message = ?,
        finished_at = ?,
        updated_at = ?
    where status = 'running'
      and lease_expires_at is not null
      and lease_expires_at <= ?
      and attempts >= max_attempts
      and not (
        provider = 'junction'
        and kind = 'resource'
        and (
          coalesce(json_extract(payload_json, '$.resource'), '') = ?
          or json_type(payload_json, '$.calendarRefreshDay') = 'text'
        )
      )
  `).run(
    EXPIRED_JOB_LEASE_ERROR_CODE,
    EXPIRED_JOB_LEASE_ERROR_MESSAGE,
    now,
    now,
    now,
    COMPANION_HRV_RMSSD_RESOURCE,
  );
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

export function listPendingDeviceSyncJobsForAccount(input: {
  accountId: string;
  database: DatabaseSync;
  limit: number;
}): DeviceSyncJobRecord[] {
  const rows = input.database.prepare(`
    select *
    from device_job
    where account_id = ?
      and status in ('queued', 'running')
    order by created_at asc, id asc
    limit ?
  `).all(
    input.accountId,
    input.limit,
  ).map((row) => decodeStoredJobRow(row));
  return rows.flatMap((row) => {
    const job = mapJobRow(row);
    return job ? [job] : [];
  });
}

export function findActiveDeviceSyncJobDedupeKeys(input: {
  accountId: string;
  database: DatabaseSync;
  dedupeKeys: readonly string[];
  provider: string;
}): ReadonlySet<string> {
  const dedupeKeys = [...new Set(input.dedupeKeys)];
  if (dedupeKeys.length > DEVICE_SYNC_ACTIVE_DEDUPE_KEY_LOOKUP_LIMIT) {
    throw new TypeError(
      `Active device-sync dedupe lookup exceeds ${DEVICE_SYNC_ACTIVE_DEDUPE_KEY_LOOKUP_LIMIT} keys.`,
    );
  }
  if (dedupeKeys.length === 0) {
    return new Set();
  }
  const now = toIsoTimestamp(new Date());
  const placeholders = dedupeKeys.map(() => "?").join(", ");
  const rows = input.database.prepare(`
    select distinct dedupe_key
    from device_job
    where account_id = ?
      and provider = ?
      and dedupe_key in (${placeholders})
      and status in ('queued', 'running')
      and not (
        status = 'running'
        and lease_expires_at is not null
        and lease_expires_at <= ?
        and attempts >= max_attempts
        and not (
          provider = 'junction'
          and kind = 'resource'
          and coalesce(json_extract(payload_json, '$.resource'), '') = ?
        )
      )
  `).all(
    input.accountId,
    input.provider,
    ...dedupeKeys,
    now,
    COMPANION_HRV_RMSSD_RESOURCE,
  ) as { dedupe_key: string }[];
  return new Set(rows.map((row) => row.dedupe_key));
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
    )
    order by wake_at asc
    limit 1
  `).get() as { wake_at?: string | null } | undefined;
  return row?.wake_at ?? null;
}

export function readNextDeviceSyncJobWakeAtForAccount(
  database: DatabaseSync,
  accountId: string,
): string | null {
  const row = database.prepare(`
    select wake_at
    from (
      select available_at as wake_at
      from device_job
      where account_id = ?
        and status = 'queued'
      union all
      select lease_expires_at as wake_at
      from device_job
      where account_id = ?
        and status = 'running'
        and lease_expires_at is not null
    )
    order by wake_at asc
    limit 1
  `).get(accountId, accountId) as { wake_at?: string | null } | undefined;
  return row?.wake_at ?? null;
}

export function claimDueDeviceSyncJob(
  database: DatabaseSync,
  workerId: string,
  now: string,
  leaseMs: number,
  accountId?: string,
): DeviceSyncJobRecord | null {
  return withImmediateTransaction(database, () => {
    deadLetterExpiredExhaustedDeviceSyncJobs(database, now);

    const accountPredicate = accountId ? "and candidate.account_id = ?" : "";
    const claimParameters = accountId
      ? [now, now, COMPANION_HRV_RMSSD_RESOURCE, now, accountId]
      : [now, now, COMPANION_HRV_RMSSD_RESOURCE, now];
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
          and (
            candidate.attempts < candidate.max_attempts
            or (
              candidate.provider = 'junction'
              and candidate.kind = 'resource'
              and (
                coalesce(json_extract(candidate.payload_json, '$.resource'), '') = ?
                or json_type(candidate.payload_json, '$.calendarRefreshDay') = 'text'
              )
            )
          )
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
      ${accountPredicate}
      order by candidate.priority desc, candidate.available_at asc, candidate.created_at asc, candidate.id asc
      limit 1
    `).get(...claimParameters) as StoredJobRow | undefined;

    if (!row) {
      return null;
    }

    const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
    const isExpiredRetainedAcceptedWork = row.status === "running"
      && isJunctionRetainedAcceptedWorkJob({
        kind: row.kind,
        payload: maybeParseJsonObject(row.payload_json),
        provider: row.provider,
      });
    database.prepare(`
      update device_job
      set status = 'running',
          lease_owner = ?,
          lease_expires_at = ?,
          max_attempts = case when ? = 1 then max(max_attempts, attempts + 1) else max_attempts end,
          attempts = attempts + 1,
          started_at = coalesce(started_at, ?),
          updated_at = ?
      where id = ?
    `).run(workerId, leaseExpiresAt, isExpiredRetainedAcceptedWork ? 1 : 0, now, now, row.id);

    return getDeviceSyncJobById(database, row.id);
  });
}

export function listDueDeviceSyncJobBatchCandidates(
  database: DatabaseSync,
  input: {
    accountId: string;
    excludeJobId: string;
    limit: number;
    now: string;
    provider: string;
  },
): DeviceSyncJobRecord[] {
  const limit = Math.max(0, Math.floor(input.limit));
  if (limit <= 0) {
    return [];
  }

  const rows = database.prepare(`
    select *
    from device_job
    where account_id = ?
      and provider = ?
      and id != ?
      and (
        (
          status = 'queued'
          and available_at <= ?
        ) or (
          status = 'running'
          and lease_expires_at is not null
          and lease_expires_at <= ?
          and attempts < max_attempts
        )
      )
    order by priority desc, available_at asc, created_at asc, id asc
    limit ?
  `).all(
    input.accountId,
    input.provider,
    input.excludeJobId,
    input.now,
    input.now,
    limit,
  ) as Array<StoredJobRow & Record<string, unknown>>;

  return rows.flatMap((row) => {
    const job = mapJobRow(row);
    return job ? [job] : [];
  });
}

export function claimDeviceSyncJobBatchCandidatesIfSeedOwned(
  database: DatabaseSync,
  input: {
    accountId: string;
    jobIds: readonly string[];
    leaseMs: number;
    now: string;
    provider: string;
    seedJobId: string;
    workerId: string;
  },
): DeviceSyncJobRecord[] {
  const jobIds = [...new Set(input.jobIds)].filter((jobId) => jobId !== input.seedJobId);
  if (jobIds.length === 0) {
    return [];
  }

  return withImmediateTransaction(database, () => {
    const seed = database.prepare(`
      select id
      from device_job
      where id = ?
        and account_id = ?
        and provider = ?
        and status = 'running'
        and lease_owner = ?
        and lease_expires_at is not null
        and lease_expires_at > ?
      limit 1
    `).get(
      input.seedJobId,
      input.accountId,
      input.provider,
      input.workerId,
      input.now,
    ) as { id: string } | undefined;

    if (!seed) {
      return [];
    }

    const placeholders = jobIds.map(() => "?").join(", ");
    const eligible = database.prepare(`
      select count(*) as count
      from device_job
      where id in (${placeholders})
        and account_id = ?
        and provider = ?
        and (
          (
            status = 'queued'
            and available_at <= ?
          ) or (
            status = 'running'
            and lease_expires_at is not null
            and lease_expires_at <= ?
            and attempts < max_attempts
          )
        )
    `).get(
      ...jobIds,
      input.accountId,
      input.provider,
      input.now,
      input.now,
    ) as { count: number } | undefined;

    if ((eligible?.count ?? 0) !== jobIds.length) {
      return [];
    }

    const leaseExpiresAt = new Date(Date.parse(input.now) + input.leaseMs).toISOString();
    database.prepare(`
      update device_job
      set status = 'running',
          lease_owner = ?,
          lease_expires_at = ?,
          attempts = attempts + 1,
          started_at = coalesce(started_at, ?),
          updated_at = ?
      where id in (${placeholders})
        and account_id = ?
        and provider = ?
        and (
          (
            status = 'queued'
            and available_at <= ?
          ) or (
            status = 'running'
            and lease_expires_at is not null
            and lease_expires_at <= ?
            and attempts < max_attempts
          )
        )
    `).run(
      input.workerId,
      leaseExpiresAt,
      input.now,
      input.now,
      ...jobIds,
      input.accountId,
      input.provider,
      input.now,
      input.now,
    );

    return jobIds.flatMap((jobId) => {
      const claimed = getDeviceSyncJobById(database, jobId);
      return claimed ? [claimed] : [];
    });
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
      and lease_expires_at is not null
      and lease_expires_at > ?
  `).run(now, now, jobId, workerId, now) as { changes: number };

  return (result.changes ?? 0) > 0;
}

export function completeDeviceSyncJobsIfOwnedInTransaction(
  database: DatabaseSync,
  input: {
    jobIds: readonly string[];
    now: string;
    workerId: string;
  },
): boolean {
  const jobIds = [...new Set(input.jobIds)];
  if (jobIds.length === 0) {
    return false;
  }

  const placeholders = jobIds.map(() => "?").join(", ");
  const eligible = database.prepare(`
    select count(*) as count
    from device_job
    where id in (${placeholders})
      and status = 'running'
      and lease_owner = ?
      and lease_expires_at is not null
      and lease_expires_at > ?
  `).get(
    ...jobIds,
    input.workerId,
    input.now,
  ) as { count: number } | undefined;

  if ((eligible?.count ?? 0) !== jobIds.length) {
    return false;
  }

  database.prepare(`
    update device_job
    set status = 'succeeded',
        lease_owner = null,
        lease_expires_at = null,
        finished_at = ?,
        updated_at = ?
    where id in (${placeholders})
      and status = 'running'
      and lease_owner = ?
      and lease_expires_at is not null
      and lease_expires_at > ?
  `).run(
    input.now,
    input.now,
    ...jobIds,
    input.workerId,
    input.now,
  );

  return true;
}

export function completeDeviceSyncJobsIfOwned(
  database: DatabaseSync,
  input: {
    jobIds: readonly string[];
    now: string;
    workerId: string;
  },
): boolean {
  return withImmediateTransaction(database, () =>
    completeDeviceSyncJobsIfOwnedInTransaction(database, input)
  );
}

export function releaseDeviceSyncJobIfOwned(
  database: DatabaseSync,
  input: {
    jobId: string;
    now: string;
    workerId: string;
  },
): boolean {
  const result = database.prepare(`
    update device_job
    set status = 'queued',
        available_at = ?,
        lease_owner = null,
        lease_expires_at = null,
        attempts = max(attempts - 1, 0),
        updated_at = ?
    where id = ?
      and status = 'running'
      and lease_owner = ?
      and lease_expires_at is not null
      and lease_expires_at > ?
  `).run(input.now, input.now, input.jobId, input.workerId, input.now) as { changes: number };

  return (result.changes ?? 0) > 0;
}

export function wakeRetainedDeviceSyncJobsForAccount(
  database: DatabaseSync,
  input: { accountId: string; now: string },
): number {
  const result = database.prepare(`
    update device_job
    set available_at = min(available_at, ?),
        updated_at = ?
    where account_id = ?
      and status = 'queued'
      and last_error_code in (
        'CONNECTION_SETUP_PENDING',
        'ACCOUNT_DISCONNECTED',
        'ACCOUNT_REAUTHORIZATION_REQUIRED',
        'JUNCTION_CALENDAR_REFRESH_SOURCE_AUTHORITY_UNAVAILABLE'
      )
      and provider = 'junction'
      and kind = 'resource'
      and (
        json_extract(payload_json, '$.resource') = ?
        or json_type(payload_json, '$.calendarRefreshDay') = 'text'
      )
  `).run(
    input.now,
    input.now,
    input.accountId,
    COMPANION_HRV_RMSSD_RESOURCE,
  ) as { changes: number };
  return result.changes ?? 0;
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

export function failDeviceSyncJobIfOwned(
  database: DatabaseSync,
  input: {
    code: string;
    jobId: string;
    message: string;
    now: string;
    retryAt: string | null;
    retryable: boolean;
    replacementPayload?: Record<string, unknown>;
    retainUntilSuccess?: boolean;
    workerId: string;
  },
): DeviceSyncJobFailureTransition | null {
  if (input.retryable) {
    const replacementPayloadJson = input.replacementPayload === undefined
      ? null
      : stringifyJson(input.replacementPayload);
    const retryResult = database.prepare(`
      update device_job
      set status = 'queued',
          available_at = ?,
          max_attempts = case when ? = 1 then max(max_attempts, attempts + 1) else max_attempts end,
          payload_json = case when ? = 1 then ? else payload_json end,
          lease_owner = null,
          lease_expires_at = null,
          last_error_code = ?,
          last_error_message = ?,
          updated_at = ?
      where id = ?
        and status = 'running'
        and lease_owner = ?
        and lease_expires_at is not null
        and lease_expires_at > ?
        and (attempts < max_attempts or ? = 1)
      returning attempts, max_attempts
    `).get(
      input.retryAt ?? input.now,
      input.retainUntilSuccess ? 1 : 0,
      replacementPayloadJson === null ? 0 : 1,
      replacementPayloadJson,
      input.code,
      input.message,
      input.now,
      input.jobId,
      input.workerId,
      input.now,
      input.retainUntilSuccess ? 1 : 0,
    ) as Record<string, unknown> | undefined;

    if (retryResult) {
      return decodeDeviceSyncJobFailureTransition(retryResult, "queued");
    }
  }

  const deadResult = database.prepare(`
    update device_job
    set status = 'dead',
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = ?,
        last_error_message = ?,
        finished_at = ?,
        updated_at = ?
    where id = ?
      and status = 'running'
      and lease_owner = ?
      and lease_expires_at is not null
      and lease_expires_at > ?
    returning attempts, max_attempts
  `).get(
    input.code,
    input.message,
    input.now,
    input.now,
    input.jobId,
    input.workerId,
    input.now,
  ) as Record<string, unknown> | undefined;

  return deadResult
    ? decodeDeviceSyncJobFailureTransition(deadResult, "dead")
    : null;
}

function decodeDeviceSyncJobFailureTransition(
  row: Record<string, unknown>,
  disposition: DeviceSyncJobFailureDisposition,
): DeviceSyncJobFailureTransition {
  const attempts = requireJobRowNumber(row, "attempts");
  const maxAttempts = requireJobRowNumber(row, "max_attempts");

  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new TypeError("Expected device_job.attempts to be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < attempts) {
    throw new TypeError("Expected device_job.max_attempts to cover the committed attempt count.");
  }

  return {
    attempts,
    disposition,
    maxAttempts,
    remainingAttempts: disposition === "queued" ? maxAttempts - attempts : 0,
  };
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
    where account_id = ?
      and status in ('queued', 'running')
      and not (
        provider = 'junction'
        and kind = 'resource'
        and (
          json_extract(payload_json, '$.resource') = ?
          or json_type(payload_json, '$.calendarRefreshDay') = 'text'
        )
      )
  `).run(
    input.code,
    input.message,
    input.now,
    input.now,
    input.accountId,
    COMPANION_HRV_RMSSD_RESOURCE,
  ) as { changes: number };

  return result.changes ?? 0;
}

export function markCredentialScopedPendingDeviceSyncJobsDeadForAccount(
  database: DatabaseSync,
  input: {
    accountId: string;
    classifyProviderJob?: DeviceSyncCredentialIndependentImportJobClassifier;
    code: string;
    message: string;
    now: string;
  },
): number {
  const pending = database.prepare(`
    select id, provider, kind, payload_json
    from device_job
    where account_id = ?
      and status in ('queued', 'running')
  `).all(input.accountId) as Array<{
    id: string;
    kind: string;
    payload_json: string | null;
    provider: string;
  }>;
  const markDead = database.prepare(`
    update device_job
    set status = 'dead',
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = ?,
        last_error_message = ?,
        finished_at = ?,
        updated_at = ?
    where id = ?
      and account_id = ?
      and status in ('queued', 'running')
  `);
  let marked = 0;

  for (const job of pending) {
    const parsedJob = {
      kind: job.kind,
      payload: maybeParseJsonObject(job.payload_json),
      provider: job.provider,
    };
    if (
      isJunctionRetainedAcceptedWorkJob(parsedJob)
      || isDeviceSyncCredentialIndependentImportJob(parsedJob, input.classifyProviderJob)
    ) {
      continue;
    }

    const result = markDead.run(
      input.code,
      input.message,
      input.now,
      input.now,
      job.id,
      input.accountId,
    ) as { changes: number };
    marked += result.changes ?? 0;
  }

  return marked;
}

export function markPendingDeviceSyncJobsDeadForAccountIfCurrent(
  database: DatabaseSync,
  input: {
    accountId: string;
    code: string;
    expectedLocalConnectionRevision: number;
    expectedStatus: "disconnected" | "reauthorization_required";
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
    where account_id = ?
      and status in ('queued', 'running')
      and not (
        provider = 'junction'
        and kind = 'resource'
        and (
          json_extract(payload_json, '$.resource') = ?
          or json_type(payload_json, '$.calendarRefreshDay') = 'text'
        )
      )
      and exists (
        select 1
        from device_connection
        join device_observation_state
          on device_observation_state.account_id = device_connection.id
        where device_connection.id = device_job.account_id
          and device_connection.status = ?
          and device_observation_state.local_connection_revision = ?
      )
  `).run(
    input.code,
    input.message,
    input.now,
    input.now,
    input.accountId,
    COMPANION_HRV_RMSSD_RESOURCE,
    input.expectedStatus,
    input.expectedLocalConnectionRevision,
  ) as { changes: number };

  return result.changes ?? 0;
}

export function enqueueDeviceSyncJobInTransaction(
  database: DatabaseSync,
  input: DeviceSyncEnqueueJobInput,
): DeviceSyncJobRecord {
  const now = toIsoTimestamp(new Date());

  if (input.dedupeKey) {
    const existing = database.prepare(`
      select *
      from device_job
      where account_id = ?
        and provider = ?
        and dedupe_key = ?
        and status in ('queued', 'running')
        and not (
          status = 'running'
          and lease_expires_at is not null
          and lease_expires_at <= ?
          and attempts >= max_attempts
          and not (
            provider = 'junction'
            and kind = 'resource'
            and (
              coalesce(json_extract(payload_json, '$.resource'), '') = ?
              or json_type(payload_json, '$.calendarRefreshDay') = 'text'
            )
          )
        )
      order by created_at desc, id desc
      limit 1
    `).get(
      input.accountId,
      input.provider,
      input.dedupeKey,
      now,
      COMPANION_HRV_RMSSD_RESOURCE,
    ) as StoredJobRow | undefined;

    if (existing) {
      const existingJob = mapJobRow(existing)!;
      if (isJunctionRetainedAcceptedWorkJob(input)) {
        database.prepare(`
          update device_job
          set available_at = case
                when status = 'queued' then min(available_at, ?)
                else available_at
              end,
              max_attempts = max(max_attempts, attempts + 1),
              updated_at = ?
          where id = ?
            and status in ('queued', 'running')
        `).run(input.availableAt ?? now, now, existing.id);
        return getDeviceSyncJobById(database, existing.id) ?? existingJob;
      }
      return existingJob;
    }
  }

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
