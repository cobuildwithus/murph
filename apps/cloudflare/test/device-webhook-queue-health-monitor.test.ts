import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeviceWebhookQueueHealthMonitor,
  type DeviceWebhookQueueAlertSender,
} from "../src/device-webhook-queue-health/monitor.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;
const ONE_HOUR_MS = 60 * 60 * 1_000;

describe("device webhook Queue health monitor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("records typed healthy metrics without admitting a page", async () => {
    const harness = createHarness();

    await expect(harness.run()).resolves.toEqual({
      conditions: [],
      observationStatus: "ok",
      outcome: "healthy",
    });

    expect(harness.monitor.readLatestObservation()).toEqual({
      conditions: [],
      deadLetter: {
        backlogBytes: 0,
        backlogCount: 0,
        oldestMessageAtMs: null,
      },
      failedQueues: [],
      main: {
        backlogBytes: 0,
        backlogCount: 0,
        oldestMessageAtMs: null,
      },
      observedAtMs: FIVE_MINUTES_MS,
      status: "ok",
    });
    expect(harness.sent).toEqual([]);
  });

  it("pages immediately for dead-letter backlog and repeats only after one hour", async () => {
    const harness = createHarness({
      deadLetterMetrics: [metrics({ backlogCount: 3 })],
    });

    await expect(harness.run()).resolves.toMatchObject({
      conditions: [{ backlogCount: 3, kind: "dead_letter_backlog" }],
      outcome: "alert_sent",
    });
    expect(harness.sent).toEqual([
      expect.objectContaining({
        idempotencyKey: "device-webhook-queue-health:1:1",
        message: expect.stringContaining("Dead-letter backlog: 3 message(s)."),
      }),
    ]);
    expect(harness.monitor.readState()).toMatchObject({
      alertSequence: 1,
      incidentOpen: true,
      incidentSequence: 1,
      lastAlertSucceededAtMs: FIVE_MINUTES_MS,
      pendingAlertIdempotencyKey: null,
    });

    harness.setNow(FIVE_MINUTES_MS + FIVE_MINUTES_MS);
    harness.setDeadLetterMetrics(metrics({ backlogCount: 3 }));
    await expect(harness.run()).resolves.toMatchObject({
      outcome: "alert_deferred",
    });
    expect(harness.sent).toHaveLength(1);

    harness.setNow(FIVE_MINUTES_MS + ONE_HOUR_MS);
    harness.setDeadLetterMetrics(metrics({ backlogCount: 3 }));
    await expect(harness.run()).resolves.toMatchObject({
      outcome: "alert_sent",
    });
    expect(harness.sent[1]).toMatchObject({
      idempotencyKey: "device-webhook-queue-health:1:2",
    });
  });

  it("pages for a main Queue message that is at least fifteen minutes old", async () => {
    const harness = createHarness({
      mainMetrics: [metrics({
        backlogCount: 1,
        oldestMessageAtMs: FIVE_MINUTES_MS,
      })],
      nowMs: 20 * 60 * 1_000,
    });

    await expect(harness.run()).resolves.toMatchObject({
      conditions: [{
        ageMs: FIFTEEN_MINUTES_MS,
        kind: "main_queue_stalled",
        oldestMessageAtMs: FIVE_MINUTES_MS,
      }],
      outcome: "alert_sent",
    });
    expect(harness.sent[0]?.message).toContain(
      "Oldest main-queue message age: 15 minutes.",
    );
  });

  it("preserves backlog metrics when Cloudflare cannot determine message age", async () => {
    const unknownAgeMetrics = metrics({
      backlogBytes: 1_024,
      backlogCount: 5,
    });
    const harness = createHarness({
      mainMetrics: [unknownAgeMetrics, unknownAgeMetrics],
    });

    await expect(harness.run()).resolves.toEqual({
      conditions: [],
      observationStatus: "ok",
      outcome: "healthy",
    });

    harness.setNow(FIVE_MINUTES_MS * 2);
    await expect(harness.run()).resolves.toEqual({
      conditions: [],
      observationStatus: "ok",
      outcome: "healthy",
    });

    expect(harness.monitor.readLatestObservation()).toMatchObject({
      failedQueues: [],
      main: {
        backlogBytes: 1_024,
        backlogCount: 5,
        oldestMessageAtMs: null,
      },
      status: "ok",
    });
    expect(harness.monitor.readState().consecutiveMetricsFailures).toBe(0);
    expect(harness.sent).toEqual([]);
  });

  it("requires two consecutive metric failures before paging monitoring loss", async () => {
    const harness = createHarness({
      mainMetrics: [new Error("synthetic metrics failure")],
    });

    await expect(harness.run()).resolves.toEqual({
      conditions: [],
      observationStatus: "partial",
      outcome: "alert_deferred",
    });
    expect(harness.monitor.readState().consecutiveMetricsFailures).toBe(1);
    expect(harness.sent).toEqual([]);

    harness.setNow(FIVE_MINUTES_MS * 2);
    harness.setMainMetrics(new Error("synthetic metrics failure"));
    await expect(harness.run()).resolves.toMatchObject({
      conditions: [{
        consecutiveFailures: 2,
        failedQueues: ["main"],
        kind: "queue_metrics_unavailable",
      }],
      outcome: "alert_sent",
    });
    expect(harness.sent[0]?.message).toContain(
      "Queue metrics unavailable for 2 consecutive checks (main).",
    );
  });

  it("retains one exact pending page until the sender succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const firstBody = metrics({ backlogCount: 2 });
    const harness = createHarness({
      deadLetterMetrics: [firstBody],
      sendResults: [new Error("synthetic send failure")],
    });

    await expect(harness.run()).resolves.toMatchObject({ outcome: "alert_failed" });
    const pending = harness.monitor.readState();
    expect(pending.pendingAlertIdempotencyKey).toBe(
      "device-webhook-queue-health:1:1",
    );
    expect(pending.pendingAlertMessage).toContain(
      "Dead-letter backlog: 2 message(s).",
    );
    expect(pending.lastAlertSucceededAtMs).toBeNull();

    harness.setNow(FIVE_MINUTES_MS * 2);
    harness.setDeadLetterMetrics(metrics({ backlogCount: 0 }));
    await expect(harness.run()).resolves.toMatchObject({
      outcome: "alert_sent",
    });
    expect(harness.sent[1]).toEqual({
      idempotencyKey: pending.pendingAlertIdempotencyKey,
      message: pending.pendingAlertMessage,
    });
    expect(harness.monitor.readState()).toMatchObject({
      incidentOpen: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("retries the exact pending page on the next check after monitor restart", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const harness = createHarness({
      deadLetterMetrics: [metrics({ backlogCount: 1 })],
      sendResults: [new Error("synthetic send failure")],
    });

    await harness.run();
    const beforeRestart = harness.monitor.readState();
    harness.restart();
    harness.setNow(FIVE_MINUTES_MS * 2);
    harness.setDeadLetterMetrics(metrics({ backlogCount: 5 }));

    await expect(harness.run()).resolves.toMatchObject({
      outcome: "alert_sent",
    });
    expect(harness.sent[1]).toEqual({
      idempotencyKey: beforeRestart.pendingAlertIdempotencyKey,
      message: beforeRestart.pendingAlertMessage,
    });
  });

  it("pages a newly opened incident independently of the prior incident", async () => {
    const harness = createHarness({
      deadLetterMetrics: [metrics({ backlogCount: 1 })],
    });

    await expect(harness.run()).resolves.toMatchObject({ outcome: "alert_sent" });

    harness.setNow(FIVE_MINUTES_MS * 2);
    harness.setDeadLetterMetrics(metrics());
    await expect(harness.run()).resolves.toMatchObject({ outcome: "healthy" });

    harness.setNow(FIVE_MINUTES_MS * 3);
    harness.setDeadLetterMetrics(metrics({ backlogCount: 2 }));
    await expect(harness.run()).resolves.toMatchObject({ outcome: "alert_sent" });
    expect(harness.sent).toEqual([
      expect.objectContaining({
        idempotencyKey: "device-webhook-queue-health:1:1",
      }),
      expect.objectContaining({
        idempotencyKey: "device-webhook-queue-health:2:1",
      }),
    ]);
  });

  it("coalesces overlapping cron delivery with the durable run lease", async () => {
    const metricsStarted = createDeferred<void>();
    const metricsResult = createDeferred<QueueMetrics>();
    const harness = createHarness({
      mainMetrics: [async () => {
        metricsStarted.resolve();
        return await metricsResult.promise;
      }],
    });

    const firstRun = harness.run();
    await metricsStarted.promise;
    await expect(harness.run()).resolves.toEqual({
      conditions: [],
      observationStatus: null,
      outcome: "run_in_progress",
    });
    metricsResult.resolve(metrics());
    await expect(firstRun).resolves.toMatchObject({ outcome: "healthy" });
  });
});

type MetricsResult =
  | Error
  | QueueMetrics
  | (() => Promise<QueueMetrics>);

function createHarness(input: {
  deadLetterMetrics?: MetricsResult[];
  mainMetrics?: MetricsResult[];
  nowMs?: number;
  sendResults?: Array<Error | undefined>;
} = {}) {
  const sql = createTestSqlStorage();
  let nowMs = input.nowMs ?? FIVE_MINUTES_MS;
  const mainMetrics = [...(input.mainMetrics ?? [metrics()])];
  const deadLetterMetrics = [...(input.deadLetterMetrics ?? [metrics()])];
  const sendResults = [...(input.sendResults ?? [])];
  const sent: Array<{ idempotencyKey: string; message: string }> = [];
  const alertSender: DeviceWebhookQueueAlertSender = {
    async send(alert): Promise<void> {
      sent.push(alert);
      const result = sendResults.shift();
      if (result) {
        throw result;
      }
    },
  };
  const queue = (results: MetricsResult[]) => ({
    async metrics(): Promise<QueueMetrics> {
      const next = results.shift() ?? metrics();
      if (next instanceof Error) {
        throw next;
      }
      return typeof next === "function" ? await next() : next;
    },
  });
  const storage = {
    sql,
    transactionSync<T>(callback: () => T): T {
      return sql.transactionSync(callback);
    },
  };
  const createMonitor = () => new DeviceWebhookQueueHealthMonitor(
    storage,
    {
      deadLetterQueue: queue(deadLetterMetrics),
      mainQueue: queue(mainMetrics),
    },
    alertSender,
    () => nowMs,
  );
  let monitor = createMonitor();

  return {
    get monitor() {
      return monitor;
    },
    restart() {
      monitor = createMonitor();
    },
    run() {
      return monitor.runScheduledCheck();
    },
    sent,
    setDeadLetterMetrics(value: MetricsResult) {
      deadLetterMetrics.push(value);
    },
    setMainMetrics(value: MetricsResult) {
      mainMetrics.push(value);
    },
    setNow(value: number) {
      nowMs = value;
    },
  };
}

function metrics(input: {
  backlogBytes?: number;
  backlogCount?: number;
  oldestMessageAtMs?: number;
} = {}): QueueMetrics {
  return {
    backlogBytes: input.backlogBytes ?? 0,
    backlogCount: input.backlogCount ?? 0,
    ...(input.oldestMessageAtMs === undefined
      ? {}
      : { oldestMessageTimestamp: new Date(input.oldestMessageAtMs) }),
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
} {
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}
