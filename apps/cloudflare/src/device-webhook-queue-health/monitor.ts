import type { DurableObjectStorageLike } from "../user-runner/types.js";
import {
  DeviceWebhookQueueHealthStore,
  type DeviceWebhookQueueHealthCondition,
  type DeviceWebhookQueueHealthObservation,
  type DeviceWebhookQueueHealthState,
  type DeviceWebhookQueueMetricName,
  type DeviceWebhookQueueMetricSnapshot,
} from "./store.js";

const DEVICE_WEBHOOK_QUEUE_RUN_LEASE_MS = 2 * 60 * 1_000;
const DEVICE_WEBHOOK_QUEUE_STALL_AGE_MS = 15 * 60 * 1_000;
const DEVICE_WEBHOOK_QUEUE_ALERT_INTERVAL_MS = 60 * 60 * 1_000;
const DEVICE_WEBHOOK_QUEUE_METRICS_FAILURE_ALERT_COUNT = 2;

export interface DeviceWebhookQueueAlertSender {
  send(input: {
    idempotencyKey: string;
    message: string;
  }): Promise<void>;
}

export interface DeviceWebhookQueueHealthMonitorEnvironment {
  deadLetterQueue: Pick<Queue<unknown>, "metrics">;
  mainQueue: Pick<Queue<unknown>, "metrics">;
}

export interface DeviceWebhookQueueHealthMonitorResult {
  conditions: readonly DeviceWebhookQueueHealthCondition[];
  outcome:
    | "alert_deferred"
    | "alert_failed"
    | "alert_sent"
    | "healthy"
    | "run_in_progress";
  observationStatus: DeviceWebhookQueueHealthObservation["status"] | null;
}

interface DeviceWebhookQueueTransactionalStorage {
  sql?: NonNullable<DurableObjectStorageLike["sql"]>;
  transactionSync?<T>(callback: () => T): T;
}

type DeviceWebhookQueueNow = () => number;

export class DeviceWebhookQueueHealthMonitor {
  private readonly store: DeviceWebhookQueueHealthStore;
  private readonly transactionSync: (callback: () => void) => void;

  constructor(
    storage: DeviceWebhookQueueTransactionalStorage,
    private readonly environment: DeviceWebhookQueueHealthMonitorEnvironment,
    private readonly alertSender: DeviceWebhookQueueAlertSender,
    private readonly nowImplementation: DeviceWebhookQueueNow = Date.now,
  ) {
    const sql = storage.sql;
    const transactionSync = storage.transactionSync;
    if (!sql || !transactionSync) {
      throw new Error(
        "Device webhook Queue health monitor requires SQLite Durable Object storage.",
      );
    }
    this.store = new DeviceWebhookQueueHealthStore(sql);
    this.transactionSync = (callback) => {
      transactionSync.call(storage, callback);
    };
  }

  async runScheduledCheck(): Promise<DeviceWebhookQueueHealthMonitorResult> {
    const runStartedAtMs = normalizeTimestamp(this.nowImplementation());
    if (!this.store.claimRun(runStartedAtMs, DEVICE_WEBHOOK_QUEUE_RUN_LEASE_MS)) {
      return {
        conditions: [],
        outcome: "run_in_progress",
        observationStatus: null,
      };
    }

    try {
      const collected = await this.collectObservation();
      const observedAtMs = normalizeTimestamp(this.nowImplementation());
      let observation: DeviceWebhookQueueHealthObservation | null = null;
      this.transactionSync(() => {
        const priorState = this.store.readState();
        const consecutiveMetricsFailures = collected.failedQueues.length === 0
          ? 0
          : priorState.consecutiveMetricsFailures + 1;
        const nextObservation = buildObservation({
          ...collected,
          consecutiveMetricsFailures,
          observedAtMs,
        });
        this.store.recordObservation({
          consecutiveMetricsFailures,
          observation: nextObservation,
        });
        this.admitAlert(nextObservation);
        observation = nextObservation;
      });
      if (observation === null) {
        throw new Error("Device webhook Queue observation was not persisted.");
      }
      return await this.handlePendingAlert(observation);
    } finally {
      this.store.releaseRun();
    }
  }

  readLatestObservation(): DeviceWebhookQueueHealthObservation | null {
    return this.store.readLatestObservation();
  }

  readState(): DeviceWebhookQueueHealthState {
    return this.store.readState();
  }

  private async collectObservation(): Promise<{
    deadLetter: DeviceWebhookQueueMetricSnapshot | null;
    failedQueues: DeviceWebhookQueueMetricName[];
    main: DeviceWebhookQueueMetricSnapshot | null;
  }> {
    const [mainResult, deadLetterResult] = await Promise.allSettled([
      readQueueMetrics(this.environment.mainQueue, "main"),
      readQueueMetrics(this.environment.deadLetterQueue, "dead_letter"),
    ]);
    const failedQueues: DeviceWebhookQueueMetricName[] = [];
    if (mainResult.status === "rejected") {
      failedQueues.push("main");
    }
    if (deadLetterResult.status === "rejected") {
      failedQueues.push("dead_letter");
    }
    return {
      deadLetter: deadLetterResult.status === "fulfilled"
        ? deadLetterResult.value
        : null,
      failedQueues,
      main: mainResult.status === "fulfilled" ? mainResult.value : null,
    };
  }

  private admitAlert(observation: DeviceWebhookQueueHealthObservation): void {
    let state = this.store.readState();
    if (observation.conditions.length === 0) {
      return;
    }
    if (!state.incidentOpen) {
      state = this.store.openIncident();
    }
    if (state.pendingAlertIdempotencyKey !== null) {
      return;
    }
    const nowMs = observation.observedAtMs;
    if (
      state.lastAlertAttemptedAtMs !== null
      && nowMs - state.lastAlertAttemptedAtMs
        < DEVICE_WEBHOOK_QUEUE_ALERT_INTERVAL_MS
    ) {
      return;
    }
    const alertSequence = state.alertSequence + 1;
    this.store.createPendingAlert({
      idempotencyKey: [
        "device-webhook-queue-health",
        state.incidentSequence,
        alertSequence,
      ].join(":"),
      message: buildAlertMessage(observation),
    });
  }

  private async handlePendingAlert(
    observation: DeviceWebhookQueueHealthObservation,
  ): Promise<DeviceWebhookQueueHealthMonitorResult> {
    const state = this.store.readState();
    const pendingIdempotencyKey = state.pendingAlertIdempotencyKey;
    const pendingMessage = state.pendingAlertMessage;
    if (!pendingIdempotencyKey || !pendingMessage) {
      if (isHealthyObservation(observation) && state.incidentOpen) {
        this.store.closeIncident();
      }
      return {
        conditions: observation.conditions,
        outcome: isHealthyObservation(observation)
          ? "healthy"
          : "alert_deferred",
        observationStatus: observation.status,
      };
    }

    const attemptedAtMs = normalizeTimestamp(this.nowImplementation());
    if (
      state.lastAlertAttemptedAtMs !== null
      && attemptedAtMs - state.lastAlertAttemptedAtMs
        < DEVICE_WEBHOOK_QUEUE_ALERT_INTERVAL_MS
    ) {
      return {
        conditions: observation.conditions,
        outcome: "alert_deferred",
        observationStatus: observation.status,
      };
    }

    this.store.recordAlertAttempt(attemptedAtMs);
    try {
      await this.alertSender.send({
        idempotencyKey: pendingIdempotencyKey,
        message: pendingMessage,
      });
      this.transactionSync(() => {
        this.store.recordAlertSuccess();
        const latestObservation = this.store.readLatestObservation();
        if (latestObservation && isHealthyObservation(latestObservation)) {
          this.store.closeIncident();
        }
      });
      return {
        conditions: observation.conditions,
        outcome: "alert_sent",
        observationStatus: observation.status,
      };
    } catch {
      console.warn("Device webhook Queue health alert failed.", {
        failureCode: "alert_sender_failed",
      });
      return {
        conditions: observation.conditions,
        outcome: "alert_failed",
        observationStatus: observation.status,
      };
    }
  }
}

async function readQueueMetrics(
  queue: Pick<Queue<unknown>, "metrics">,
  queueName: DeviceWebhookQueueMetricName,
): Promise<DeviceWebhookQueueMetricSnapshot> {
  const metrics = await queue.metrics();
  if (
    !isNonNegativeSafeInteger(metrics.backlogCount)
    || !isNonNegativeSafeInteger(metrics.backlogBytes)
  ) {
    throw new Error(`Invalid ${queueName} Queue metrics.`);
  }
  const oldestMessageAtMs = metrics.oldestMessageTimestamp?.getTime() ?? null;
  if (
    oldestMessageAtMs !== null
    && !isNonNegativeSafeInteger(oldestMessageAtMs)
  ) {
    throw new Error(`Invalid ${queueName} Queue oldest-message timestamp.`);
  }
  if (
    queueName === "main"
    && metrics.backlogCount > 0
    && oldestMessageAtMs === null
  ) {
    throw new Error("Main Queue backlog is missing its oldest-message timestamp.");
  }
  return {
    backlogBytes: metrics.backlogBytes,
    backlogCount: metrics.backlogCount,
    oldestMessageAtMs,
  };
}

function buildObservation(input: {
  consecutiveMetricsFailures: number;
  deadLetter: DeviceWebhookQueueMetricSnapshot | null;
  failedQueues: readonly DeviceWebhookQueueMetricName[];
  main: DeviceWebhookQueueMetricSnapshot | null;
  observedAtMs: number;
}): DeviceWebhookQueueHealthObservation {
  const conditions: DeviceWebhookQueueHealthCondition[] = [];
  if (input.deadLetter && input.deadLetter.backlogCount > 0) {
    conditions.push({
      backlogCount: input.deadLetter.backlogCount,
      kind: "dead_letter_backlog",
    });
  }
  const oldestMainMessageAtMs = input.main?.oldestMessageAtMs ?? null;
  if (oldestMainMessageAtMs !== null) {
    const ageMs = Math.max(0, input.observedAtMs - oldestMainMessageAtMs);
    if (ageMs >= DEVICE_WEBHOOK_QUEUE_STALL_AGE_MS) {
      conditions.push({
        ageMs,
        kind: "main_queue_stalled",
        oldestMessageAtMs: oldestMainMessageAtMs,
      });
    }
  }
  if (
    input.failedQueues.length > 0
    && input.consecutiveMetricsFailures
      >= DEVICE_WEBHOOK_QUEUE_METRICS_FAILURE_ALERT_COUNT
  ) {
    conditions.push({
      consecutiveFailures: input.consecutiveMetricsFailures,
      failedQueues: [...input.failedQueues],
      kind: "queue_metrics_unavailable",
    });
  }
  return {
    conditions,
    deadLetter: input.deadLetter,
    failedQueues: [...input.failedQueues],
    main: input.main,
    observedAtMs: input.observedAtMs,
    status: input.failedQueues.length === 0
      ? "ok"
      : input.failedQueues.length === 2
      ? "failed"
      : "partial",
  };
}

function buildAlertMessage(
  observation: DeviceWebhookQueueHealthObservation,
): string {
  const details = observation.conditions.map((condition) => {
    if (condition.kind === "dead_letter_backlog") {
      return `- Dead-letter backlog: ${condition.backlogCount} message(s).`;
    }
    if (condition.kind === "main_queue_stalled") {
      return `- Oldest main-queue message age: ${formatMinutes(condition.ageMs)}.`;
    }
    return [
      "- Queue metrics unavailable for",
      `${condition.consecutiveFailures} consecutive checks`,
      `(${condition.failedQueues.join(", ")}).`,
    ].join(" ");
  });
  return [
    "Murph device webhook queue needs attention.",
    "",
    `Observed at: ${new Date(observation.observedAtMs).toISOString()}`,
    ...details,
  ].join("\n");
}

function formatMinutes(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function isHealthyObservation(
  observation: DeviceWebhookQueueHealthObservation,
): boolean {
  return observation.status === "ok" && observation.conditions.length === 0;
}

function normalizeTimestamp(value: number): number {
  if (!isNonNegativeSafeInteger(value)) {
    throw new Error("Device webhook Queue monitor timestamp is invalid.");
  }
  return value;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}
