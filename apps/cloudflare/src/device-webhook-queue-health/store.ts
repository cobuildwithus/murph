import type {
  DurableObjectSqlStorageLike,
  DurableObjectSqlValue,
} from "../user-runner/types.js";

const DEVICE_WEBHOOK_QUEUE_MONITOR_SCHEMA_VERSION = 1;

export type DeviceWebhookQueueHealthCondition =
  | {
      backlogCount: number;
      kind: "dead_letter_backlog";
    }
  | {
      ageMs: number;
      kind: "main_queue_stalled";
      oldestMessageAtMs: number;
    }
  | {
      consecutiveFailures: number;
      failedQueues: readonly DeviceWebhookQueueMetricName[];
      kind: "queue_metrics_unavailable";
    };

export type DeviceWebhookQueueMetricName = "dead_letter" | "main";

export interface DeviceWebhookQueueMetricSnapshot {
  backlogBytes: number;
  backlogCount: number;
  oldestMessageAtMs: number | null;
}

export interface DeviceWebhookQueueHealthObservation {
  conditions: readonly DeviceWebhookQueueHealthCondition[];
  deadLetter: DeviceWebhookQueueMetricSnapshot | null;
  failedQueues: readonly DeviceWebhookQueueMetricName[];
  main: DeviceWebhookQueueMetricSnapshot | null;
  observedAtMs: number;
  status: "failed" | "ok" | "partial";
}

export interface DeviceWebhookQueueHealthState {
  alertSequence: number;
  consecutiveMetricsFailures: number;
  incidentOpen: boolean;
  incidentSequence: number;
  lastAlertAttemptedAtMs: number | null;
  pendingAlertIdempotencyKey: string | null;
  pendingAlertMessage: string | null;
}

interface DeviceWebhookQueueMonitorMetaRow
  extends Record<string, DurableObjectSqlValue> {
  alert_sequence: number;
  consecutive_metrics_failures: number;
  incident_open: number;
  incident_sequence: number;
  last_alert_attempted_at_ms: number | null;
  pending_alert_idempotency_key: string | null;
  pending_alert_message: string | null;
  run_lease_until_ms: number;
}

interface DeviceWebhookQueueObservationRow
  extends Record<string, DurableObjectSqlValue> {
  conditions_json: string;
  dead_letter_backlog_bytes: number | null;
  dead_letter_backlog_count: number | null;
  dead_letter_oldest_message_at_ms: number | null;
  failed_queues_json: string;
  main_backlog_bytes: number | null;
  main_backlog_count: number | null;
  main_oldest_message_at_ms: number | null;
  observed_at_ms: number;
  status: string;
}

export class DeviceWebhookQueueHealthStore {
  constructor(private readonly sql: DurableObjectSqlStorageLike) {
    ensureDeviceWebhookQueueHealthSchema(sql);
  }

  claimRun(nowMs: number, leaseDurationMs: number): boolean {
    return this.sql.exec(
      `UPDATE device_webhook_queue_monitor_meta
       SET run_lease_until_ms = ?
       WHERE singleton = 1
         AND run_lease_until_ms <= ?`,
      nowMs + leaseDurationMs,
      nowMs,
    ).rowsWritten === 1;
  }

  releaseRun(): void {
    this.sql.exec(
      `UPDATE device_webhook_queue_monitor_meta
       SET run_lease_until_ms = 0
       WHERE singleton = 1`,
    );
  }

  readState(): DeviceWebhookQueueHealthState {
    const row = this.readMetaRow();
    return {
      alertSequence: row.alert_sequence,
      consecutiveMetricsFailures: row.consecutive_metrics_failures,
      incidentOpen: row.incident_open === 1,
      incidentSequence: row.incident_sequence,
      lastAlertAttemptedAtMs: row.last_alert_attempted_at_ms,
      pendingAlertIdempotencyKey: row.pending_alert_idempotency_key,
      pendingAlertMessage: row.pending_alert_message,
    };
  }

  readLatestObservation(): DeviceWebhookQueueHealthObservation | null {
    const row = this.sql.exec<DeviceWebhookQueueObservationRow>(
      `SELECT
         observed_at_ms,
         status,
         main_backlog_count,
         main_backlog_bytes,
         main_oldest_message_at_ms,
         dead_letter_backlog_count,
         dead_letter_backlog_bytes,
         dead_letter_oldest_message_at_ms,
         failed_queues_json,
         conditions_json
       FROM device_webhook_queue_monitor_observation
       WHERE singleton = 1`,
    ).toArray()[0];
    if (!row) {
      return null;
    }
    return parseObservation(row);
  }

  recordObservation(input: {
    consecutiveMetricsFailures: number;
    observation: DeviceWebhookQueueHealthObservation;
  }): void {
    const observation = input.observation;
    this.sql.exec(
      `UPDATE device_webhook_queue_monitor_meta
       SET consecutive_metrics_failures = ?
       WHERE singleton = 1`,
      input.consecutiveMetricsFailures,
    );
    this.sql.exec(
      `INSERT INTO device_webhook_queue_monitor_observation (
         singleton,
         observed_at_ms,
         status,
         main_backlog_count,
         main_backlog_bytes,
         main_oldest_message_at_ms,
         dead_letter_backlog_count,
         dead_letter_backlog_bytes,
         dead_letter_oldest_message_at_ms,
         failed_queues_json,
         conditions_json
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         observed_at_ms = excluded.observed_at_ms,
         status = excluded.status,
         main_backlog_count = excluded.main_backlog_count,
         main_backlog_bytes = excluded.main_backlog_bytes,
         main_oldest_message_at_ms = excluded.main_oldest_message_at_ms,
         dead_letter_backlog_count = excluded.dead_letter_backlog_count,
         dead_letter_backlog_bytes = excluded.dead_letter_backlog_bytes,
         dead_letter_oldest_message_at_ms =
           excluded.dead_letter_oldest_message_at_ms,
         failed_queues_json = excluded.failed_queues_json,
         conditions_json = excluded.conditions_json`,
      observation.observedAtMs,
      observation.status,
      observation.main?.backlogCount ?? null,
      observation.main?.backlogBytes ?? null,
      observation.main?.oldestMessageAtMs ?? null,
      observation.deadLetter?.backlogCount ?? null,
      observation.deadLetter?.backlogBytes ?? null,
      observation.deadLetter?.oldestMessageAtMs ?? null,
      JSON.stringify(observation.failedQueues),
      JSON.stringify(observation.conditions),
    );
  }

  openIncident(): DeviceWebhookQueueHealthState {
    this.sql.exec(
      `UPDATE device_webhook_queue_monitor_meta
       SET
         incident_open = 1,
         incident_sequence = incident_sequence + 1,
         alert_sequence = 0
       WHERE singleton = 1`,
    );
    return this.readState();
  }

  closeIncident(): void {
    this.sql.exec(
      `UPDATE device_webhook_queue_monitor_meta
       SET
         incident_open = 0,
         alert_sequence = 0
       WHERE singleton = 1
         AND pending_alert_idempotency_key IS NULL`,
    );
  }

  createPendingAlert(input: {
    idempotencyKey: string;
    message: string;
  }): DeviceWebhookQueueHealthState {
    this.sql.exec(
      `UPDATE device_webhook_queue_monitor_meta
       SET
         alert_sequence = alert_sequence + 1,
         pending_alert_idempotency_key = ?,
         pending_alert_message = ?
       WHERE singleton = 1
         AND pending_alert_idempotency_key IS NULL`,
      input.idempotencyKey,
      input.message,
    );
    return this.readState();
  }

  recordAlertAttempt(attemptedAtMs: number): void {
    this.sql.exec(
      `UPDATE device_webhook_queue_monitor_meta
       SET last_alert_attempted_at_ms = ?
       WHERE singleton = 1`,
      attemptedAtMs,
    );
  }

  recordAlertSuccess(): void {
    this.sql.exec(
      `UPDATE device_webhook_queue_monitor_meta
       SET
         pending_alert_idempotency_key = NULL,
         pending_alert_message = NULL
       WHERE singleton = 1`,
    );
  }

  private readMetaRow(): DeviceWebhookQueueMonitorMetaRow {
    const row = this.sql.exec<DeviceWebhookQueueMonitorMetaRow>(
      `SELECT
         run_lease_until_ms,
         consecutive_metrics_failures,
         incident_open,
         incident_sequence,
         alert_sequence,
         last_alert_attempted_at_ms,
         pending_alert_idempotency_key,
         pending_alert_message
       FROM device_webhook_queue_monitor_meta
       WHERE singleton = 1`,
    ).toArray()[0];
    if (!row) {
      throw new Error("Device webhook Queue monitor state is missing.");
    }
    return row;
  }
}

function ensureDeviceWebhookQueueHealthSchema(
  sql: DurableObjectSqlStorageLike,
): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS device_webhook_queue_monitor_schema_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS device_webhook_queue_monitor_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      run_lease_until_ms INTEGER NOT NULL DEFAULT 0,
      consecutive_metrics_failures INTEGER NOT NULL DEFAULT 0,
      incident_open INTEGER NOT NULL DEFAULT 0 CHECK (incident_open IN (0, 1)),
      incident_sequence INTEGER NOT NULL DEFAULT 0,
      alert_sequence INTEGER NOT NULL DEFAULT 0,
      last_alert_attempted_at_ms INTEGER,
      pending_alert_idempotency_key TEXT,
      pending_alert_message TEXT,
      CHECK (
        (pending_alert_idempotency_key IS NULL) =
        (pending_alert_message IS NULL)
      )
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS device_webhook_queue_monitor_observation (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      observed_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
      main_backlog_count INTEGER,
      main_backlog_bytes INTEGER,
      main_oldest_message_at_ms INTEGER,
      dead_letter_backlog_count INTEGER,
      dead_letter_backlog_bytes INTEGER,
      dead_letter_oldest_message_at_ms INTEGER,
      failed_queues_json TEXT NOT NULL,
      conditions_json TEXT NOT NULL
    )
  `);
  sql.exec(
    `INSERT INTO device_webhook_queue_monitor_meta (singleton)
     VALUES (1)
     ON CONFLICT(singleton) DO NOTHING`,
  );

  const versionRow = sql.exec<{ value: DurableObjectSqlValue }>(
    `SELECT value
     FROM device_webhook_queue_monitor_schema_meta
     WHERE key = 'schema_version'`,
  ).toArray()[0];
  const version = typeof versionRow?.value === "number"
    ? versionRow.value
    : 0;
  if (version > DEVICE_WEBHOOK_QUEUE_MONITOR_SCHEMA_VERSION) {
    throw new Error(
      "Device webhook Queue monitor schema is newer than this Worker.",
    );
  }
  sql.exec(
    `INSERT INTO device_webhook_queue_monitor_schema_meta (key, value)
     VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    DEVICE_WEBHOOK_QUEUE_MONITOR_SCHEMA_VERSION,
  );
}

function parseObservation(
  row: DeviceWebhookQueueObservationRow,
): DeviceWebhookQueueHealthObservation {
  const status = row.status;
  if (status !== "ok" && status !== "partial" && status !== "failed") {
    throw new Error("Stored device webhook Queue observation is invalid.");
  }
  const failedQueues = parseFailedQueues(row.failed_queues_json);
  return {
    conditions: parseConditions(row.conditions_json),
    deadLetter: parseMetricSnapshot({
      backlogBytes: row.dead_letter_backlog_bytes,
      backlogCount: row.dead_letter_backlog_count,
      oldestMessageAtMs: row.dead_letter_oldest_message_at_ms,
    }),
    failedQueues,
    main: parseMetricSnapshot({
      backlogBytes: row.main_backlog_bytes,
      backlogCount: row.main_backlog_count,
      oldestMessageAtMs: row.main_oldest_message_at_ms,
    }),
    observedAtMs: readNonNegativeSafeInteger(row.observed_at_ms),
    status,
  };
}

function parseMetricSnapshot(input: {
  backlogBytes: number | null;
  backlogCount: number | null;
  oldestMessageAtMs: number | null;
}): DeviceWebhookQueueMetricSnapshot | null {
  if (input.backlogBytes === null && input.backlogCount === null) {
    if (input.oldestMessageAtMs !== null) {
      throw new Error("Stored device webhook Queue metrics are invalid.");
    }
    return null;
  }
  if (input.backlogBytes === null || input.backlogCount === null) {
    throw new Error("Stored device webhook Queue metrics are invalid.");
  }
  return {
    backlogBytes: readNonNegativeSafeInteger(input.backlogBytes),
    backlogCount: readNonNegativeSafeInteger(input.backlogCount),
    oldestMessageAtMs: input.oldestMessageAtMs === null
      ? null
      : readNonNegativeSafeInteger(input.oldestMessageAtMs),
  };
}

function parseFailedQueues(value: string): DeviceWebhookQueueMetricName[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Stored device webhook Queue failures are invalid.");
  }
  const queues = parsed.filter(isQueueMetricName);
  if (queues.length !== parsed.length || new Set(queues).size !== queues.length) {
    throw new Error("Stored device webhook Queue failures are invalid.");
  }
  return queues;
}

function parseConditions(value: string): DeviceWebhookQueueHealthCondition[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Stored device webhook Queue conditions are invalid.");
  }
  const conditions = parsed.filter(isQueueHealthCondition);
  if (conditions.length !== parsed.length) {
    throw new Error("Stored device webhook Queue conditions are invalid.");
  }
  return conditions;
}

function isQueueMetricName(value: unknown): value is DeviceWebhookQueueMetricName {
  return value === "main" || value === "dead_letter";
}

function isQueueHealthCondition(
  value: unknown,
): value is DeviceWebhookQueueHealthCondition {
  if (!isObjectRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "dead_letter_backlog") {
    return isNonNegativeSafeInteger(value.backlogCount);
  }
  if (value.kind === "main_queue_stalled") {
    return isNonNegativeSafeInteger(value.ageMs)
      && isNonNegativeSafeInteger(value.oldestMessageAtMs);
  }
  if (value.kind === "queue_metrics_unavailable") {
    return isNonNegativeSafeInteger(value.consecutiveFailures)
      && Array.isArray(value.failedQueues)
      && value.failedQueues.every(isQueueMetricName)
      && new Set(value.failedQueues).size === value.failedQueues.length;
  }
  return false;
}

function readNonNegativeSafeInteger(value: number): number {
  if (!isNonNegativeSafeInteger(value)) {
    throw new Error("Stored device webhook Queue numeric state is invalid.");
  }
  return value;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
