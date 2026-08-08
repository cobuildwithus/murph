import {
  deleteExpiredHostedRuntimeLogs,
  deleteHostedRuntimeLogDataForUsers,
  hostedRuntimeLogLockKey,
  hostedRuntimeLogSubjectKey,
  recordHostedRuntimeLogs,
  type HostedRuntimeLogSqlClient,
  type HostedRuntimeLogSqlDatabase,
  type HostedRuntimeLogSqlResult,
} from "@/src/lib/hosted-runtime-log/store";
import type {
  HostedRuntimeLogEntry,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, it, vi } from "vitest";

interface SqlCall {
  text: string;
  values: readonly unknown[];
}

interface QueuedSqlResult {
  error?: Error;
  rowCount?: number;
  rows?: Record<string, unknown>[];
}

class FakeSqlClient implements HostedRuntimeLogSqlClient {
  readonly calls: SqlCall[] = [];
  readonly results: QueuedSqlResult[];
  released = false;

  constructor(results: QueuedSqlResult[]) {
    this.results = [...results];
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<HostedRuntimeLogSqlResult<Row>> {
    this.calls.push({ text, values });
    const result = this.results.shift() ?? {};
    if (result.error) {
      throw result.error;
    }
    return {
      rowCount: result.rowCount ?? 0,
      rows: (result.rows ?? []) as Row[],
    };
  }

  release(): void {
    this.released = true;
  }
}

class FakeSqlDatabase implements HostedRuntimeLogSqlDatabase {
  readonly calls: SqlCall[] = [];
  readonly client: FakeSqlClient;
  readonly results: QueuedSqlResult[];
  connectCount = 0;

  constructor(input: {
    clientResults?: QueuedSqlResult[];
    results?: QueuedSqlResult[];
  } = {}) {
    this.client = new FakeSqlClient(input.clientResults ?? []);
    this.results = [...(input.results ?? [])];
  }

  async connect(): Promise<HostedRuntimeLogSqlClient> {
    this.connectCount += 1;
    return this.client;
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<HostedRuntimeLogSqlResult<Row>> {
    this.calls.push({ text, values });
    const result = this.results.shift() ?? {};
    if (result.error) {
      throw result.error;
    }
    return {
      rowCount: result.rowCount ?? 0,
      rows: (result.rows ?? []) as Row[],
    };
  }
}

describe("dedicated hosted runtime log store", () => {
  it("derives stable opaque subject and signed advisory-lock keys", () => {
    const first = hostedRuntimeLogSubjectKey("member_alpha");
    const second = hostedRuntimeLogSubjectKey("member_alpha");
    const other = hostedRuntimeLogSubjectKey("member_beta");
    const lockKey = hostedRuntimeLogLockKey(first);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(first).not.toContain("member_alpha");
    expect(other).not.toBe(first);
    expect(lockKey).toMatch(/^-?[0-9]+$/u);
    expect(BigInt(lockKey)).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(BigInt(lockKey)).toBeLessThan(2n ** 63n);
  });

  it("locks, rechecks primary member authority, and writes one validated batch", async () => {
    const userId = "member_runtime_logs_1";
    const subjectKey = hostedRuntimeLogSubjectKey(userId);
    const isUserActive = vi.fn(async () => true);
    const database = new FakeSqlDatabase({
      clientResults: [
        {},
        {},
        { rowCount: 2 },
        {},
      ],
    });

    const detailedEntry: HostedRuntimeLogEntry = {
      ...runtimeEntry("mailbox.imported"),
      attemptId: "attempt_runtime_logs_1",
      checkpointVersion: "13",
      errorCode: "RUNTIME_LOG_TEST",
      leaseGeneration: "11",
      mailboxLane: "conversation",
      mailboxSeqEnd: "17",
      mailboxSeqStart: "14",
      outboxIntentRef: "intent_runtime_logs_1",
      redactedJson: { testMarker: "bounded" },
      workspaceVersion: "12",
    };
    const count = await recordHostedRuntimeLogs({
      database,
      entries: [detailedEntry, runtimeEntry("mailbox.imported")],
      isUserActive,
      userId,
    });

    expect(count).toBe(2);
    expect(isUserActive).toHaveBeenCalledWith(userId);
    expect(database.connectCount).toBe(1);
    expect(database.client.released).toBe(true);
    expect(database.client.calls.map((call) => compactSql(call.text))).toEqual([
      "BEGIN",
      "SELECT pg_advisory_xact_lock($1::bigint)",
      expect.stringContaining("INSERT INTO hosted_runtime_log"),
      "COMMIT",
    ]);
    expect(database.client.calls[1]?.values).toEqual([
      hostedRuntimeLogLockKey(subjectKey),
    ]);
    const insert = database.client.calls[2]!;
    expect(insert.values).toHaveLength(34);
    expect(insert.values.filter((value) => value === subjectKey)).toHaveLength(2);
    expect(insert.values.slice(7, 17)).toEqual([
      "attempt_runtime_logs_1",
      "11",
      "12",
      "13",
      "conversation",
      "14",
      "17",
      "intent_runtime_logs_1",
      "RUNTIME_LOG_TEST",
      JSON.stringify({ testMarker: "bounded" }),
    ]);
    expect(insert.text).not.toContain(userId);
  });

  it("does not open a transaction for an empty diagnostic batch", async () => {
    const database = new FakeSqlDatabase();

    await expect(recordHostedRuntimeLogs({
      database,
      entries: [],
      isUserActive: async () => true,
      userId: "member_runtime_logs_empty",
    })).resolves.toBe(0);

    expect(database.connectCount).toBe(0);
    expect(database.calls).toHaveLength(0);
  });

  it("validates the whole batch before opening a transaction", async () => {
    const database = new FakeSqlDatabase();
    await expect(Reflect.apply(recordHostedRuntimeLogs, undefined, [{
      database,
      entries: [
        runtimeEntry("mailbox.imported"),
        {
          ...runtimeEntry("mailbox.imported"),
          level: "fatal",
        },
      ],
      isUserActive: async () => true,
      userId: "member_runtime_logs_invalid",
    }])).rejects.toThrow(/level/u);

    expect(database.connectCount).toBe(0);
  });

  it("drops delayed batches when the primary member is suspended or gone", async () => {
    const isUserActive = vi.fn(async () => false);
    const database = new FakeSqlDatabase({
      clientResults: [{}, {}, {}],
    });

    await expect(recordHostedRuntimeLogs({
      database,
      entries: [runtimeEntry("mailbox.imported")],
      isUserActive,
      userId: "member_runtime_logs_deleted",
    })).resolves.toBe(0);

    expect(isUserActive).toHaveBeenCalledOnce();
    expect(database.client.calls.map((call) => compactSql(call.text))).toEqual([
      "BEGIN",
      "SELECT pg_advisory_xact_lock($1::bigint)",
      "COMMIT",
    ]);
  });

  it("locks subjects deterministically and deletes by full subject key", async () => {
    const userIds = ["member_z", "member_a", "member_z"];
    const subjects = [...new Set(userIds)].map((userId) => {
      const subjectKey = hostedRuntimeLogSubjectKey(userId);
      return {
        lockKey: hostedRuntimeLogLockKey(subjectKey),
        subjectKey,
      };
    }).sort((left, right) => {
      const difference = BigInt(left.lockKey) - BigInt(right.lockKey);
      return difference < 0n ? -1 : difference > 0n ? 1 :
        left.subjectKey.localeCompare(right.subjectKey);
    });
    const database = new FakeSqlDatabase({
      clientResults: [
        {},
        {},
        { rowCount: 7 },
        {},
      ],
    });

    await expect(deleteHostedRuntimeLogDataForUsers({
      database,
      userIds,
    })).resolves.toBe(7);

    const lockSql = compactSql(database.client.calls[1]!.text);
    expect(lockSql).toContain("WITH ordered_locks AS MATERIALIZED");
    expect(lockSql).toContain(
      "FROM unnest($1::bigint[]) AS subject_locks(lock_key) ORDER BY lock_key",
    );
    expect(lockSql).toContain(
      "SELECT pg_advisory_xact_lock(lock_key) FROM ordered_locks ORDER BY lock_key",
    );
    expect(database.client.calls[1]!.values).toEqual([
      [...new Set(subjects.map((subject) => subject.lockKey))],
    ]);
    expect(compactSql(database.client.calls[2]!.text)).toContain(
      "DELETE FROM hosted_runtime_log WHERE subject_key = ANY($1::text[])",
    );
    expect(database.client.calls[2]?.values).toEqual([
      subjects.map((subject) => subject.subjectKey),
    ]);
  });

  it("bounds account-deletion lock and statement waits inside the transaction", async () => {
    const database = new FakeSqlDatabase({
      clientResults: [
        {},
        {},
        {},
        { rowCount: 1 },
        {},
      ],
    });

    await expect(deleteHostedRuntimeLogDataForUsers({
      database,
      timeoutMs: 4_000,
      userIds: ["member_timeout"],
    })).resolves.toBe(1);

    expect(compactSql(database.client.calls[1]!.text)).toContain(
      "set_config('lock_timeout', $1, true)",
    );
    const timeoutValue = database.client.calls[1]!.values[0];
    expect(timeoutValue).toMatch(/^[0-9]+ms$/u);
    const timeoutMs = Number(String(timeoutValue).replace(/ms$/u, ""));
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(2_000);
    const lockSql = compactSql(database.client.calls[2]!.text);
    expect(lockSql).toContain("WITH ordered_locks AS MATERIALIZED");
    expect(lockSql).toContain(
      "SELECT pg_advisory_xact_lock(lock_key) FROM ordered_locks ORDER BY lock_key",
    );
  });

  it("rolls back and releases the client when a diagnostic insert fails", async () => {
    const database = new FakeSqlDatabase({
      clientResults: [
        {},
        {},
        { error: new Error("secondary unavailable") },
        {},
      ],
    });

    await expect(recordHostedRuntimeLogs({
      database,
      entries: [runtimeEntry("mailbox.imported")],
      isUserActive: async () => true,
      userId: "member_runtime_logs_failure",
    })).rejects.toThrow("secondary unavailable");

    expect(compactSql(database.client.calls.at(-1)!.text)).toBe("ROLLBACK");
    expect(database.client.released).toBe(true);
  });

  it("keeps retention bounded and serial", async () => {
    const database = new FakeSqlDatabase({
      results: [
        { rowCount: 5_000 },
        { rowCount: 5_000 },
        { rowCount: 3 },
      ],
    });

    const deleted = await deleteExpiredHostedRuntimeLogs({
      batchSize: 5_000,
      database,
      maxBatches: 4,
      retentionCutoff: new Date("2026-07-15T00:00:00.000Z"),
      verboseCutoff: new Date("2026-07-22T00:00:00.000Z"),
    });

    expect(deleted).toBe(10_003);
    expect(database.calls).toHaveLength(3);
    for (const call of database.calls) {
      expect(call.values[2]).toBe(5_000);
      expect(compactSql(call.text)).toContain("ORDER BY at ASC, id ASC LIMIT $3");
    }
  });
});

function runtimeEntry(eventCode: "mailbox.imported"): HostedRuntimeLogEntry {
  return {
    at: "2026-07-29T00:00:00.000Z",
    component: "mailbox",
    eventCode,
    level: "info",
    phase: "import",
  };
}

function compactSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
