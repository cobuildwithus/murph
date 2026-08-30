import { afterEach, describe, expect, it, vi } from "vitest";

import { OperatorAlertLinqError } from "../src/operator-alert/linq.js";
import {
  OpenAiAuthorizationAlertDurableObject,
  type OpenAiAuthorizationAlertSender,
} from "../src/worker/openai-authorization-alert-durable-object.js";
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from "../src/user-runner/types.js";
import {
  createTestSqlStorage,
  type TestSqlStorageLike,
} from "./sql-storage.js";

const BASE_TIME_MS = Date.parse("2026-08-29T12:00:00.000Z");
const FIVE_MINUTES_MS = 5 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const ONE_HOUR_MS = 60 * 60_000;

type AlertInput = Parameters<OpenAiAuthorizationAlertSender["send"]>[0];

describe("OpenAiAuthorizationAlertDurableObject", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists and immediately dispatches the first incident page", async () => {
    const harness = createHarness();

    expect(harness.alert.reportFailure({
      observedAtMs: BASE_TIME_MS,
      status: 401,
    })).toEqual({ accepted: true });

    const persistedBeforeSend = harness.alert.readState();
    expect(harness.deliveries).toEqual([]);
    expect(persistedBeforeSend).toMatchObject({
      alertSequence: 1,
      failureCount: 1,
      firstFailureAtMs: BASE_TIME_MS,
      incidentOpen: true,
      incidentSequence: 1,
      lastFailureAtMs: BASE_TIME_MS,
      lastStatus: 401,
      pendingAlertIdempotencyKey:
        "openai-authorization-alert:incident-1:page-1",
      pendingAlertIncidentSequence: 1,
      pendingAlertSequence: 1,
      pendingRetryAtMs: BASE_TIME_MS + FIVE_MINUTES_MS,
    });
    expect(persistedBeforeSend.pendingAlertMessage).toBe(
      [
        "SEV1 OpenAI 401",
        "Aggregate count: 1",
        "First observed UTC: 2026-08-29T12:00:00.000Z",
        "Last observed UTC: 2026-08-29T12:00:00.000Z",
      ].join("\n"),
    );

    await harness.flushWaitUntil();

    expect(harness.deliveries).toEqual([{
      idempotencyKey: "openai-authorization-alert:incident-1:page-1",
      message: persistedBeforeSend.pendingAlertMessage,
    }]);
    expect(harness.alert.readState()).toMatchObject({
      alertSequence: 1,
      failureCount: 1,
      incidentOpen: true,
      lastSuccessfulPageAtMs: BASE_TIME_MS,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
      pendingRetryAtMs: null,
    });
    expect(harness.activeAlarm()).toBe(
      BASE_TIME_MS + FIFTEEN_MINUTES_MS,
    );
    expect(harness.waitUntilCount()).toBe(1);
  });

  it("coalesces failures without mutating the established incident bounds", async () => {
    const harness = createHarness();
    harness.alert.reportFailure({ observedAtMs: BASE_TIME_MS, status: 401 });
    await harness.flushWaitUntil();

    harness.setNow(BASE_TIME_MS + 60_000);
    harness.alert.reportFailure({
      observedAtMs: BASE_TIME_MS + 60_000,
      status: 403,
    });
    await harness.flushWaitUntil();

    harness.setNow(BASE_TIME_MS + 2 * 60_000);
    harness.alert.reportFailure({
      observedAtMs: BASE_TIME_MS + 2 * 60_000,
      status: 401,
    });
    await harness.flushWaitUntil();

    expect(harness.deliveries).toHaveLength(1);
    expect(harness.alert.readState()).toMatchObject({
      alertSequence: 1,
      failureCount: 3,
      firstFailureAtMs: BASE_TIME_MS,
      incidentOpen: true,
      lastFailureAtMs: BASE_TIME_MS + 2 * 60_000,
      lastStatus: 401,
      pendingAlertIdempotencyKey: null,
    });
    expect(harness.activeAlarm()).toBe(
      BASE_TIME_MS + 2 * 60_000 + FIFTEEN_MINUTES_MS,
    );
  });

  it("admits one hourly reminder only on a fresh qualifying failure", async () => {
    const harness = createHarness();
    harness.alert.reportFailure({ observedAtMs: BASE_TIME_MS, status: 401 });
    await harness.flushWaitUntil();

    for (const elapsedMs of [10, 20, 30, 40, 50, 59].map(
      (minutes) => minutes * 60_000,
    )) {
      harness.setNow(BASE_TIME_MS + elapsedMs);
      harness.alert.reportFailure({
        observedAtMs: BASE_TIME_MS + elapsedMs,
        status: 403,
      });
      await harness.flushWaitUntil();
      expect(harness.deliveries).toHaveLength(1);
    }

    harness.setNow(BASE_TIME_MS + ONE_HOUR_MS);
    harness.alert.reportFailure({
      observedAtMs: BASE_TIME_MS + ONE_HOUR_MS,
      status: 403,
    });
    const reminder = harness.alert.readState();
    expect(reminder.pendingAlertIdempotencyKey).toBe(
      "openai-authorization-alert:incident-1:page-2",
    );
    expect(reminder.pendingAlertMessage).toContain("Aggregate count: 8");
    await harness.flushWaitUntil();

    expect(harness.deliveries).toHaveLength(2);
    expect(harness.deliveries[1]).toEqual({
      idempotencyKey: "openai-authorization-alert:incident-1:page-2",
      message: reminder.pendingAlertMessage,
    });

    harness.alert.reportFailure({
      observedAtMs: BASE_TIME_MS + ONE_HOUR_MS,
      status: 401,
    });
    await harness.flushWaitUntil();
    expect(harness.deliveries).toHaveLength(2);
  });

  it("retries the exact failed effect from a recreated owner when due", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const firstOwner = createHarness({
      async send() {
        throw new OperatorAlertLinqError("linq_retryable_response");
      },
    });

    firstOwner.alert.reportFailure({
      observedAtMs: BASE_TIME_MS,
      status: 401,
    });
    firstOwner.setNow(BASE_TIME_MS + 1);
    firstOwner.alert.reportFailure({
      observedAtMs: BASE_TIME_MS + 1,
      status: 403,
    });
    await firstOwner.flushWaitUntil();

    const retryAtMs = BASE_TIME_MS + 1 + FIVE_MINUTES_MS;
    const failedState = firstOwner.alert.readState();
    expect(firstOwner.deliveries).toHaveLength(1);
    expect(failedState).toMatchObject({
      failureCount: 2,
      lastFailureAtMs: BASE_TIME_MS + 1,
      lastStatus: 403,
      pendingAlertIdempotencyKey:
        "openai-authorization-alert:incident-1:page-1",
      pendingRetryAtMs: retryAtMs,
    });
    expect(firstOwner.activeAlarm()).toBe(retryAtMs);
    expect(warning).toHaveBeenCalledWith(
      "OpenAI authorization alert operation failed.",
      { failureCode: "linq_retryable_response" },
    );

    const retriedEffect = firstOwner.deliveries[0];
    const recreatedOwner = createHarness({
      persistence: firstOwner.persistence,
    });
    recreatedOwner.setNow(retryAtMs - 1);
    recreatedOwner.alert.alarm();
    await recreatedOwner.flushWaitUntil();
    expect(recreatedOwner.deliveries).toEqual([]);

    recreatedOwner.setNow(retryAtMs);
    recreatedOwner.alert.alarm();
    await recreatedOwner.flushWaitUntil();

    expect(recreatedOwner.deliveries).toEqual([retriedEffect]);
    expect(recreatedOwner.alert.readState()).toMatchObject({
      alertSequence: 1,
      failureCount: 2,
      firstFailureAtMs: BASE_TIME_MS,
      incidentOpen: true,
      lastFailureAtMs: BASE_TIME_MS + 1,
      lastStatus: 403,
      lastSuccessfulPageAtMs: retryAtMs,
      pendingAlertIdempotencyKey: null,
      pendingAlertIncidentSequence: null,
      pendingAlertMessage: null,
      pendingAlertSequence: null,
      pendingRetryAtMs: null,
    });

    recreatedOwner.alert.alarm();
    await recreatedOwner.flushWaitUntil();
    expect(recreatedOwner.deliveries).toHaveLength(1);
  });

  it("closes after the quiet window and deletes the alarm", async () => {
    const harness = createHarness();
    harness.alert.reportFailure({ observedAtMs: BASE_TIME_MS, status: 401 });
    await harness.flushWaitUntil();

    harness.setNow(BASE_TIME_MS + FIFTEEN_MINUTES_MS);
    harness.alert.alarm();
    await harness.flushWaitUntil();

    expect(harness.alert.readState()).toMatchObject({
      alertSequence: 0,
      failureCount: 0,
      firstFailureAtMs: null,
      incidentOpen: false,
      incidentSequence: 1,
      lastFailureAtMs: null,
      lastStatus: null,
    });
    expect(harness.activeAlarm()).toBeNull();
    expect(harness.alarmOperations.at(-1)).toEqual({ kind: "delete" });
  });

  it("starts a new incident before recording a boundary observation", async () => {
    const harness = createHarness();
    harness.alert.reportFailure({ observedAtMs: BASE_TIME_MS, status: 401 });
    await harness.flushWaitUntil();

    harness.setNow(BASE_TIME_MS + FIFTEEN_MINUTES_MS);
    harness.alert.reportFailure({
      observedAtMs: BASE_TIME_MS + FIFTEEN_MINUTES_MS,
      status: 403,
    });

    expect(harness.alert.readState()).toMatchObject({
      alertSequence: 1,
      failureCount: 1,
      firstFailureAtMs: BASE_TIME_MS + FIFTEEN_MINUTES_MS,
      incidentOpen: true,
      incidentSequence: 2,
      lastFailureAtMs: BASE_TIME_MS + FIFTEEN_MINUTES_MS,
      lastStatus: 403,
      pendingAlertIdempotencyKey:
        "openai-authorization-alert:incident-2:page-1",
    });
    await harness.flushWaitUntil();
    expect(harness.deliveries).toHaveLength(2);
  });

  it("counts out-of-order observations without regressing timestamps or status", async () => {
    const harness = createHarness();
    harness.alert.reportFailure({ observedAtMs: BASE_TIME_MS, status: 401 });
    await harness.flushWaitUntil();

    harness.setNow(BASE_TIME_MS + 10 * 60_000);
    harness.alert.reportFailure({
      observedAtMs: BASE_TIME_MS + 10 * 60_000,
      status: 403,
    });
    await harness.flushWaitUntil();

    harness.setNow(BASE_TIME_MS + 11 * 60_000);
    harness.alert.reportFailure({
      observedAtMs: BASE_TIME_MS + 5 * 60_000,
      status: 401,
    });
    await harness.flushWaitUntil();

    expect(harness.deliveries).toHaveLength(1);
    expect(harness.alert.readState()).toMatchObject({
      failureCount: 3,
      firstFailureAtMs: BASE_TIME_MS,
      lastFailureAtMs: BASE_TIME_MS + 10 * 60_000,
      lastStatus: 403,
    });
    expect(harness.activeAlarm()).toBe(
      BASE_TIME_MS + 10 * 60_000 + FIFTEEN_MINUTES_MS,
    );
  });

  it("rejects invalid or expanded RPC input without changing durable state", () => {
    const harness = createHarness();
    const invalidInputs: unknown[] = [
      null,
      [],
      {},
      { observedAtMs: BASE_TIME_MS, status: 400 },
      { observedAtMs: -1, status: 401 },
      { observedAtMs: 1.5, status: 401 },
      { observedAtMs: Number.NaN, status: 401 },
      { observedAtMs: Number.MAX_SAFE_INTEGER + 1, status: 401 },
      {
        observedAtMs: BASE_TIME_MS,
        requestId: "must-not-cross-the-boundary",
        status: 401,
      },
      {
        member: { id: "must-not-cross-the-boundary" },
        observedAtMs: BASE_TIME_MS,
        status: 403,
      },
      {
        observedAtMs: BASE_TIME_MS,
        runner: "must-not-cross-the-boundary",
        status: 401,
      },
      {
        observedAtMs: BASE_TIME_MS,
        prompt: "must-not-cross-the-boundary",
        status: 401,
      },
      {
        observedAtMs: BASE_TIME_MS,
        providerPayload: {},
        status: 403,
      },
    ];

    for (const input of invalidInputs) {
      expect(() => harness.alert.reportFailure(input)).toThrow(
        "OpenAI authorization failure report is invalid.",
      );
    }
    expect(harness.alert.readState()).toMatchObject({
      failureCount: 0,
      incidentOpen: false,
      incidentSequence: 0,
      pendingAlertIdempotencyKey: null,
    });
    expect(harness.deliveries).toEqual([]);
    expect(harness.waitUntilCount()).toBe(0);
    expect(harness.activeAlarm()).toBeNull();
  });

  it("emits only bounded privacy-safe fixed message bytes", async () => {
    const harness = createHarness();
    harness.alert.reportFailure({ observedAtMs: BASE_TIME_MS, status: 403 });
    await harness.flushWaitUntil();

    const message = harness.deliveries[0]?.message;
    expect(message).toBeDefined();
    if (message === undefined) {
      throw new Error("Expected an operator alert message.");
    }
    expect(message).toMatch(
      /^SEV1 OpenAI (?:401|403)\nAggregate count: \d+\nFirst observed UTC: [^\n]+\nLast observed UTC: [^\n]+$/u,
    );
    expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(
      256,
    );
    expect(message).not.toMatch(/https?:|member|prompt|provider|request|runner/iu);
  });


  it("keeps one alarm on the earliest retry or closure and removes it when idle", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = createHarness({
      async send(_input, attempt) {
        if (attempt === 1) {
          throw new Error("private provider detail");
        }
      },
    });

    harness.alert.reportFailure({ observedAtMs: BASE_TIME_MS, status: 401 });
    await harness.flushWaitUntil();
    expect(harness.activeAlarm()).toBe(BASE_TIME_MS + FIVE_MINUTES_MS);

    harness.setNow(BASE_TIME_MS + FIVE_MINUTES_MS);
    harness.alert.alarm();
    await harness.flushWaitUntil();
    expect(harness.activeAlarm()).toBe(
      BASE_TIME_MS + FIFTEEN_MINUTES_MS,
    );

    harness.setNow(BASE_TIME_MS + FIFTEEN_MINUTES_MS);
    harness.alert.alarm();
    await harness.flushWaitUntil();
    expect(harness.activeAlarm()).toBeNull();
    expect(harness.alarmOperations).toEqual([
      { kind: "set", scheduledAtMs: BASE_TIME_MS + FIVE_MINUTES_MS },
      { kind: "set", scheduledAtMs: BASE_TIME_MS + 2 * FIVE_MINUTES_MS },
      { kind: "set", scheduledAtMs: BASE_TIME_MS + FIFTEEN_MINUTES_MS },
      { kind: "delete" },
    ]);
    expect(warning).toHaveBeenCalledWith(
      "OpenAI authorization alert operation failed.",
      { failureCode: "linq_transport_failed" },
    );
  });

  it("rejects a newer schema without downgrading its version", () => {
    const sql = createTestSqlStorage();
    sql.exec(`
      CREATE TABLE openai_authorization_alert_schema_meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);
    sql.exec(
      `INSERT INTO openai_authorization_alert_schema_meta (key, value)
       VALUES ('schema_version', ?)`,
      2,
    );

    expect(() => createHarness({ sql })).toThrow(
      "OpenAI authorization alert schema is newer than this Worker.",
    );
    expect(sql.exec<{ value: number }>(
      `SELECT value
       FROM openai_authorization_alert_schema_meta
       WHERE key = 'schema_version'`,
    ).one().value).toBe(2);
    expect(sql.exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).toArray().map((row) => row.name)).not.toContain(
      "openai_authorization_alert_meta",
    );
  });
});

type AlarmOperation =
  | { kind: "delete" }
  | { kind: "set"; scheduledAtMs: number };

interface HarnessPersistence {
  activeAlarm: number | null;
  alarmOperations: AlarmOperation[];
  sql: TestSqlStorageLike;
}

function createHarness(input: {
  persistence?: HarnessPersistence;
  send?: (
    input: AlertInput,
    attempt: number,
  ) => Promise<void>;
  sql?: TestSqlStorageLike;
} = {}): {
  activeAlarm(): number | null;
  alarmOperations: AlarmOperation[];
  alert: OpenAiAuthorizationAlertDurableObject;
  deliveries: AlertInput[];
  flushWaitUntil(): Promise<void>;
  persistence: HarnessPersistence;
  setNow(value: number): void;
  waitUntilCount(): number;
} {
  let nowMs = BASE_TIME_MS;
  let sendAttempt = 0;
  const persistence = input.persistence ?? {
    activeAlarm: null,
    alarmOperations: [],
    sql: input.sql ?? createTestSqlStorage(),
  };
  const deliveries: AlertInput[] = [];
  const waitUntilPromises: Promise<unknown>[] = [];
  let waitUntilCalls = 0;
  const storage: DurableObjectStorageLike = {
    async delete() {
      return false;
    },
    async deleteAlarm() {
      persistence.activeAlarm = null;
      persistence.alarmOperations.push({ kind: "delete" });
    },
    async get<T>() {
      return undefined as T | undefined;
    },
    async getAlarm() {
      return persistence.activeAlarm;
    },
    async put<T>(_key: string, _value: T) {},
    async setAlarm(scheduledTime) {
      persistence.activeAlarm = scheduledTime instanceof Date
        ? scheduledTime.getTime()
        : scheduledTime;
      persistence.alarmOperations.push({
        kind: "set",
        scheduledAtMs: persistence.activeAlarm,
      });
    },
    sql: persistence.sql,
    transactionSync: persistence.sql.transactionSync,
  };
  const state: DurableObjectStateLike = {
    storage,
    waitUntil(promise) {
      waitUntilCalls += 1;
      waitUntilPromises.push(promise);
    },
  };
  const sender: OpenAiAuthorizationAlertSender = {
    async send(alertInput) {
      const persistedInput = { ...alertInput };
      deliveries.push(persistedInput);
      sendAttempt += 1;
      await input.send?.(persistedInput, sendAttempt);
    },
  };
  const alert = new OpenAiAuthorizationAlertDurableObject(
    state,
    {},
    sender,
    () => nowMs,
  );

  return {
    activeAlarm: () => persistence.activeAlarm,
    alarmOperations: persistence.alarmOperations,
    alert,
    deliveries,
    async flushWaitUntil() {
      while (waitUntilPromises.length > 0) {
        await Promise.all(waitUntilPromises.splice(0));
      }
    },
    persistence,
    setNow(value) {
      nowMs = value;
    },
    waitUntilCount: () => waitUntilCalls,
  };
}
