import "server-only";

import { randomUUID } from "node:crypto";

import {
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedMailboxLane,
  HostedRuntimeLogComponent,
  HostedRuntimeLogEntry,
  HostedRuntimeLogEventCode,
  HostedRuntimeLogLevel,
  HostedRuntimeLogPhase,
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import {
  getHostedRuntimeLogPool,
  isHostedRuntimeLogDatabaseConfigured,
} from "./database";
import { getPrisma } from "../prisma";
import {
  hostedRuntimeLogLockKey,
  hostedRuntimeLogSubjectKey,
} from "./subject-key";

export { hostedRuntimeLogLockKey, hostedRuntimeLogSubjectKey } from "./subject-key";

const HOSTED_RUNTIME_LOG_TABLE = "hosted_runtime_log";
const HOSTED_RUNTIME_LOG_FIELD_COUNT = 17;

export interface HostedRuntimeLogRecord {
  at: string;
  attemptId: string | null;
  checkpointVersion: string | null;
  component: HostedRuntimeLogComponent;
  createdAt: string;
  errorCode: string | null;
  eventCode: HostedRuntimeLogEventCode;
  id: string;
  leaseGeneration: string | null;
  level: HostedRuntimeLogLevel;
  mailboxLane: HostedMailboxLane | null;
  mailboxSeqEnd: string | null;
  mailboxSeqStart: string | null;
  outboxIntentRef: string | null;
  phase: HostedRuntimeLogPhase;
  redactedJson: HostedRuntimeRedactedJson | null;
  userId: string;
  workspaceVersion: string | null;
}

export interface HostedRuntimeTurnTimingLogRow {
  at: string;
  attemptId: string | null;
  id: string;
  redactedJson: unknown;
}

interface HostedRuntimeLogRow extends Record<string, unknown> {
  at: Date | string;
  attemptId: string | null;
  checkpointVersion: bigint | number | string | null;
  component: string;
  createdAt: Date | string;
  errorCode: string | null;
  eventCode: string;
  id: string;
  leaseGeneration: bigint | number | string | null;
  level: string;
  mailboxLane: string | null;
  mailboxSeqEnd: bigint | number | string | null;
  mailboxSeqStart: bigint | number | string | null;
  outboxIntentRef: string | null;
  phase: string;
  redactedJson: unknown;
  workspaceVersion: bigint | number | string | null;
}

interface HostedRuntimeTimingRow extends Record<string, unknown> {
  at: Date | string;
  attemptId: string | null;
  id: string;
  redactedJson: unknown;
}

export interface HostedRuntimeLogSqlResult<Row extends Record<string, unknown>> {
  rowCount: number | null;
  rows: Row[];
}

export interface HostedRuntimeLogSqlClient {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<HostedRuntimeLogSqlResult<Row>>;
  release(): void;
}

export interface HostedRuntimeLogSqlDatabase {
  connect(): Promise<HostedRuntimeLogSqlClient>;
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<HostedRuntimeLogSqlResult<Row>>;
}

export async function recordHostedRuntimeLogs(input: {
  database?: HostedRuntimeLogSqlDatabase;
  entries: readonly HostedRuntimeLogEntry[];
  isUserActive?: (userId: string) => Promise<boolean>;
  userId: string;
}): Promise<number> {
  const entries = parseHostedRuntimeLogRequest({ entries: [...input.entries] }).entries;
  if (entries.length === 0) {
    return 0;
  }

  const userId = requireHostedRuntimeLogUserId(input.userId);
  const subjectKey = hostedRuntimeLogSubjectKey(userId);
  const database = input.database ?? readDefaultHostedRuntimeLogDatabase();
  const isUserActive = input.isUserActive ?? readHostedRuntimeLogUserActive;

  return withHostedRuntimeLogTransaction(database, async (client) => {
    await lockHostedRuntimeLogSubject(client, hostedRuntimeLogLockKey(subjectKey));
    if (!await isUserActive(userId)) {
      return 0;
    }

    const { text, values } = buildHostedRuntimeLogInsert({ entries, subjectKey });
    const inserted = await client.query<Record<string, never>>(text, values);
    return inserted.rowCount ?? 0;
  });
}

export async function listHostedRuntimeLogs(input: {
  database?: HostedRuntimeLogSqlDatabase;
  limit?: number;
  userId: string;
}): Promise<HostedRuntimeLogRecord[]> {
  const database = input.database ?? readDefaultHostedRuntimeLogDatabase();
  const limit = normalizeHostedRuntimeLogLimit(input.limit ?? 20);
  const userId = requireHostedRuntimeLogUserId(input.userId);
  const subjectKey = hostedRuntimeLogSubjectKey(userId);
  const result = await database.query<HostedRuntimeLogRow>(`
    SELECT
      id,
      at,
      level,
      component,
      phase,
      event_code AS "eventCode",
      attempt_id AS "attemptId",
      lease_generation AS "leaseGeneration",
      workspace_version AS "workspaceVersion",
      checkpoint_version AS "checkpointVersion",
      mailbox_lane AS "mailboxLane",
      mailbox_seq_start AS "mailboxSeqStart",
      mailbox_seq_end AS "mailboxSeqEnd",
      outbox_intent_ref AS "outboxIntentRef",
      error_code AS "errorCode",
      redacted_json AS "redactedJson",
      created_at AS "createdAt"
    FROM ${HOSTED_RUNTIME_LOG_TABLE}
    WHERE subject_key = $1
    ORDER BY at DESC, id DESC
    LIMIT $2
  `, [subjectKey, limit]);

  return result.rows.map((row) => projectHostedRuntimeLogRow(row, userId));
}

export async function listHostedRuntimeTurnTimingLogs(input: {
  attemptIds: readonly string[];
  database?: HostedRuntimeLogSqlDatabase;
  from: Date;
  limit: number;
  to: Date;
}): Promise<HostedRuntimeTurnTimingLogRow[]> {
  const attemptIds = [...new Set(input.attemptIds.map(requireHostedRuntimeLogAttemptId))];
  if (attemptIds.length === 0) {
    return [];
  }
  const limit = normalizePositiveInteger(input.limit, "Hosted runtime timing log limit");
  const database = input.database ?? readDefaultHostedRuntimeLogDatabase();
  const result = await database.query<HostedRuntimeTimingRow>(`
    SELECT
      id,
      at,
      attempt_id AS "attemptId",
      redacted_json AS "redactedJson"
    FROM ${HOSTED_RUNTIME_LOG_TABLE}
    WHERE at >= $1
      AND at <= $2
      AND attempt_id = ANY($3::text[])
      AND event_code = 'assistant.automation_detail'
      AND redacted_json->>'schema' = 'murph.assistant-turn-timing.v1'
      AND redacted_json->>'type' = 'assistant.turn.timing'
      AND redacted_json->>'turnTimingStage' = 'reply-dispatched'
    ORDER BY at DESC, id DESC
    LIMIT $4
  `, [input.from, input.to, attemptIds, limit]);

  return result.rows.map((row) => ({
    at: requireDate(row.at, "Hosted runtime timing log at").toISOString(),
    attemptId: normalizeNullableString(row.attemptId),
    id: requireOpaqueString(row.id, "Hosted runtime timing log id"),
    redactedJson: normalizeHostedRuntimeRedactedJson(row.redactedJson),
  }));
}

/**
 * Account deletion commits the primary suspension fence before entering this
 * owner. Both deletion and append then take the same transaction-scoped
 * advisory lock in the isolated database. If append wins, cleanup deletes its
 * committed row. If deletion wins, the delayed append subsequently re-reads
 * primary member authority and observes suspended or missing state.
 */
export async function deleteHostedRuntimeLogDataForUsers(input: {
  database?: HostedRuntimeLogSqlDatabase;
  timeoutMs?: number;
  userIds: readonly string[];
}): Promise<number> {
  if (!input.database && !isHostedRuntimeLogDatabaseConfigured()) {
    return 0;
  }

  const subjects = [...new Set(input.userIds.map(requireHostedRuntimeLogUserId))]
    .map((userId) => {
      const subjectKey = hostedRuntimeLogSubjectKey(userId);
      return {
        lockKey: hostedRuntimeLogLockKey(subjectKey),
        subjectKey,
      };
    })
    .sort(compareHostedRuntimeLogSubjects);
  if (subjects.length === 0) {
    return 0;
  }

  const database = input.database ?? readDefaultHostedRuntimeLogDatabase();
  const timeoutMs = input.timeoutMs === undefined
    ? null
    : normalizePositiveInteger(
        input.timeoutMs,
        "Hosted runtime log deletion timeout",
      );
  const deadlineAtMs = timeoutMs === null ? null : Date.now() + timeoutMs;

  return withHostedRuntimeLogTransaction(database, async (client) => {
    if (deadlineAtMs !== null) {
      // Connection checkout and BEGIN consume the same caller-owned target
      // budget. Divide only the time still remaining between ordered lock
      // acquisition and deletion, so a degraded pool cannot silently extend an
      // account-deletion response beyond the target deadline.
      const remainingMs = deadlineAtMs - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          "Hosted runtime log deletion deadline expired before lock acquisition.",
        );
      }
      const statementTimeoutMs = Math.max(1, Math.floor(remainingMs / 2));
      const timeout = `${String(statementTimeoutMs)}ms`;
      await client.query<Record<string, never>>(
        "SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $1, true)",
        [timeout],
      );
    }
    await lockHostedRuntimeLogSubjects(
      client,
      [...new Set(subjects.map((subject) => subject.lockKey))],
    );
    const deleted = await client.query<Record<string, never>>(
      `DELETE FROM ${HOSTED_RUNTIME_LOG_TABLE} WHERE subject_key = ANY($1::text[])`,
      [subjects.map((subject) => subject.subjectKey)],
    );
    return deleted.rowCount ?? 0;
  });
}

export async function deleteExpiredHostedRuntimeLogs(input: {
  batchSize: number;
  database?: HostedRuntimeLogSqlDatabase;
  maxBatches: number;
  retentionCutoff: Date;
  verboseCutoff: Date;
}): Promise<number> {
  const database = input.database ?? readDefaultHostedRuntimeLogDatabase();
  const batchSize = normalizePositiveInteger(
    input.batchSize,
    "Hosted runtime log retention batch size",
  );
  const maxBatches = normalizePositiveInteger(
    input.maxBatches,
    "Hosted runtime log retention max batches",
  );

  return runHostedRuntimeLogBatches(maxBatches, batchSize, async () => {
    const deleted = await database.query<Record<string, never>>(`
      WITH doomed AS (
        SELECT id
        FROM ${HOSTED_RUNTIME_LOG_TABLE}
        WHERE at < $1
          AND (at < $2 OR level NOT IN ('warn', 'error'))
        ORDER BY at ASC, id ASC
        LIMIT $3
      )
      DELETE FROM ${HOSTED_RUNTIME_LOG_TABLE} AS runtime_log
      USING doomed
      WHERE runtime_log.id = doomed.id
    `, [input.verboseCutoff, input.retentionCutoff, batchSize]);
    return deleted.rowCount ?? 0;
  });
}

function compareHostedRuntimeLogSubjects(
  left: { lockKey: string; subjectKey: string },
  right: { lockKey: string; subjectKey: string },
): number {
  const lockDifference = BigInt(left.lockKey) - BigInt(right.lockKey);
  if (lockDifference < 0n) {
    return -1;
  }
  if (lockDifference > 0n) {
    return 1;
  }
  return left.subjectKey.localeCompare(right.subjectKey);
}

async function lockHostedRuntimeLogSubject(
  client: HostedRuntimeLogSqlClient,
  lockKey: string,
): Promise<void> {
  await client.query<Record<string, never>>(
    "SELECT pg_advisory_xact_lock($1::bigint)",
    [lockKey],
  );
}

async function lockHostedRuntimeLogSubjects(
  client: HostedRuntimeLogSqlClient,
  lockKeys: readonly string[],
): Promise<void> {
  await client.query<Record<string, never>>(
    `
      WITH ordered_locks AS MATERIALIZED (
        SELECT lock_key
        FROM unnest($1::bigint[]) AS subject_locks(lock_key)
        ORDER BY lock_key
      )
      SELECT pg_advisory_xact_lock(lock_key)
      FROM ordered_locks
      ORDER BY lock_key
    `,
    [lockKeys],
  );
}

async function readHostedRuntimeLogUserActive(userId: string): Promise<boolean> {
  const member = await getPrisma().hostedMember.findUnique({
    select: { suspendedAt: true },
    where: { id: userId },
  });
  return member !== null && member.suspendedAt === null;
}

function buildHostedRuntimeLogInsert(input: {
  entries: readonly HostedRuntimeLogEntry[];
  subjectKey: string;
}): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const rows = input.entries.map((entry, rowIndex) => {
    const offset = rowIndex * HOSTED_RUNTIME_LOG_FIELD_COUNT;
    values.push(
      randomUUID(),
      input.subjectKey,
      entry.at,
      entry.level,
      entry.component,
      entry.phase,
      entry.eventCode,
      entry.attemptId ?? null,
      entry.leaseGeneration ?? null,
      entry.workspaceVersion ?? null,
      entry.checkpointVersion ?? null,
      entry.mailboxLane ?? null,
      entry.mailboxSeqStart ?? null,
      entry.mailboxSeqEnd ?? null,
      entry.outboxIntentRef ?? null,
      entry.errorCode ?? null,
      entry.redactedJson === undefined || entry.redactedJson === null
        ? null
        : JSON.stringify(entry.redactedJson),
    );
    const parameter = (index: number) => `$${offset + index}`;
    return `(
      ${parameter(1)}, ${parameter(2)}, ${parameter(3)}::timestamptz,
      ${parameter(4)}, ${parameter(5)}, ${parameter(6)}, ${parameter(7)},
      ${parameter(8)}, ${parameter(9)}::bigint, ${parameter(10)}::bigint,
      ${parameter(11)}::bigint, ${parameter(12)}, ${parameter(13)}::bigint,
      ${parameter(14)}::bigint, ${parameter(15)}, ${parameter(16)},
      ${parameter(17)}::jsonb
    )`;
  });

  return {
    text: `
      INSERT INTO ${HOSTED_RUNTIME_LOG_TABLE} (
        id, subject_key, at, level, component, phase, event_code, attempt_id,
        lease_generation, workspace_version, checkpoint_version, mailbox_lane,
        mailbox_seq_start, mailbox_seq_end, outbox_intent_ref, error_code,
        redacted_json
      ) VALUES ${rows.join(",")}
    `,
    values,
  };
}

function projectHostedRuntimeLogRow(
  row: HostedRuntimeLogRow,
  userId: string,
): HostedRuntimeLogRecord {
  const parsed = parseHostedRuntimeLogRequest({
    entries: [{
      at: requireDate(row.at, "Hosted runtime log row at").toISOString(),
      component: row.component,
      eventCode: row.eventCode,
      level: row.level,
      phase: row.phase,
      ...(row.attemptId === null ? {} : { attemptId: row.attemptId }),
      ...(row.checkpointVersion === null
        ? {}
        : { checkpointVersion: normalizeBigIntString(row.checkpointVersion) }),
      ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
      ...(row.leaseGeneration === null
        ? {}
        : { leaseGeneration: normalizeBigIntString(row.leaseGeneration) }),
      ...(row.mailboxLane === null ? {} : { mailboxLane: row.mailboxLane }),
      ...(row.mailboxSeqEnd === null
        ? {}
        : { mailboxSeqEnd: normalizeBigIntString(row.mailboxSeqEnd) }),
      ...(row.mailboxSeqStart === null
        ? {}
        : { mailboxSeqStart: normalizeBigIntString(row.mailboxSeqStart) }),
      ...(row.outboxIntentRef === null ? {} : { outboxIntentRef: row.outboxIntentRef }),
      ...(row.redactedJson === null ? {} : { redactedJson: row.redactedJson }),
      ...(row.workspaceVersion === null
        ? {}
        : { workspaceVersion: normalizeBigIntString(row.workspaceVersion) }),
    }],
  }).entries[0]!;

  return {
    at: parsed.at,
    attemptId: parsed.attemptId ?? null,
    checkpointVersion: parsed.checkpointVersion ?? null,
    component: parsed.component,
    createdAt: requireDate(
      row.createdAt,
      "Hosted runtime log row createdAt",
    ).toISOString(),
    errorCode: parsed.errorCode ?? null,
    eventCode: parsed.eventCode,
    id: requireOpaqueString(row.id, "Hosted runtime log row id"),
    leaseGeneration: parsed.leaseGeneration ?? null,
    level: parsed.level,
    mailboxLane: parsed.mailboxLane ?? null,
    mailboxSeqEnd: parsed.mailboxSeqEnd ?? null,
    mailboxSeqStart: parsed.mailboxSeqStart ?? null,
    outboxIntentRef: parsed.outboxIntentRef ?? null,
    phase: parsed.phase,
    redactedJson: parsed.redactedJson ?? null,
    userId,
    workspaceVersion: parsed.workspaceVersion ?? null,
  };
}

async function withHostedRuntimeLogTransaction<Result>(
  database: HostedRuntimeLogSqlDatabase,
  run: (client: HostedRuntimeLogSqlClient) => Promise<Result>,
): Promise<Result> {
  const client = await database.connect();
  try {
    await client.query<Record<string, never>>("BEGIN");
    const result = await run(client);
    await client.query<Record<string, never>>("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query<Record<string, never>>("ROLLBACK");
    } catch {
      // Preserve the original storage failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

function readDefaultHostedRuntimeLogDatabase(): HostedRuntimeLogSqlDatabase {
  const pool = getHostedRuntimeLogPool();
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends Record<string, unknown>>(
          text: string,
          values?: readonly unknown[],
        ): Promise<HostedRuntimeLogSqlResult<Row>> {
          const result = await client.query<Row>(text, values ? [...values] : undefined);
          return { rowCount: result.rowCount, rows: result.rows };
        },
        release() {
          client.release();
        },
      };
    },
    async query<Row extends Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<HostedRuntimeLogSqlResult<Row>> {
      const result = await pool.query<Row>(text, values ? [...values] : undefined);
      return { rowCount: result.rowCount, rows: result.rows };
    },
  };
}

async function runHostedRuntimeLogBatches(
  maxBatches: number,
  batchSize: number,
  mutate: () => Promise<number>,
): Promise<number> {
  let affected = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const count = await mutate();
    affected += count;
    if (count < batchSize) {
      break;
    }
  }
  return affected;
}

function normalizeHostedRuntimeLogLimit(value: number): number {
  return Math.min(normalizePositiveInteger(value, "Hosted runtime log limit"), 50);
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function requireHostedRuntimeLogUserId(value: string): string {
  return requireOpaqueString(value, "Hosted runtime log userId");
}

function requireHostedRuntimeLogAttemptId(value: string): string {
  return requireOpaqueString(value, "Hosted runtime log attemptId");
}

function requireOpaqueString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 1_024) {
    throw new TypeError(`${label} must be a non-empty bounded string.`);
  }
  return normalized;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeBigIntString(value: bigint | number | string): string {
  try {
    return BigInt(value).toString();
  } catch {
    throw new TypeError("Hosted runtime log bigint field must be an integer.");
  }
}

function requireDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid date.`);
  }
  return date;
}

function normalizeHostedRuntimeRedactedJson(
  value: unknown,
): HostedRuntimeRedactedJson | null {
  const parsed = parseHostedRuntimeRedactedJson(
    value,
    "Hosted runtime timing log redactedJson",
  );
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
}
