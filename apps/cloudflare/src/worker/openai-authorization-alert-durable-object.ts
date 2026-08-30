import { DurableObject } from "cloudflare:workers";

import {
  classifyOperatorLinqAlertFailure,
  sendOperatorLinqAlert,
} from "../operator-alert/linq.js";
import type {
  DurableObjectSqlStorageLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "../user-runner/types.js";

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const OPENAI_AUTHORIZATION_ALERT_SCHEMA_VERSION = 1;
const OPENAI_AUTHORIZATION_ALERT_RETRY_MS = 5 * 60_000;
const OPENAI_AUTHORIZATION_ALERT_QUIET_MS = 15 * 60_000;
const OPENAI_AUTHORIZATION_ALERT_REMINDER_MS = 60 * 60_000;
const OPENAI_AUTHORIZATION_ALERT_MESSAGE_MAX_BYTES = 256;
const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

export type OpenAiAuthorizationFailureStatus = 401 | 403;

export interface OpenAiAuthorizationAlertEnvironment {
  HOSTED_DATABASE_ALERT_LINQ_CHAT_ID?: string;
  HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID?: string;
  LINQ_API_BASE_URL?: string;
  LINQ_API_TOKEN?: string;
}

export interface OpenAiAuthorizationAlertSender {
  send(input: {
    idempotencyKey: string;
    message: string;
  }): Promise<void>;
}

export interface OpenAiAuthorizationAlertState {
  alertSequence: number;
  failureCount: number;
  firstFailureAtMs: number | null;
  incidentOpen: boolean;
  incidentSequence: number;
  lastFailureAtMs: number | null;
  lastStatus: OpenAiAuthorizationFailureStatus | null;
  lastSuccessfulPageAtMs: number | null;
  pendingAlertIdempotencyKey: string | null;
  pendingAlertIncidentSequence: number | null;
  pendingAlertMessage: string | null;
  pendingAlertSequence: number | null;
  pendingRetryAtMs: number | null;
}

interface OpenAiAuthorizationAlertMetaRow
  extends Record<string, DurableObjectSqlValue> {
  alert_sequence: number;
  failure_count: number;
  first_failure_at_ms: number | null;
  incident_open: number;
  incident_sequence: number;
  last_failure_at_ms: number | null;
  last_status: number | null;
  last_successful_page_at_ms: number | null;
  pending_alert_idempotency_key: string | null;
  pending_alert_incident_sequence: number | null;
  pending_alert_message: string | null;
  pending_alert_sequence: number | null;
  pending_retry_at_ms: number | null;
}

interface OpenAiAuthorizationFailureReport {
  observedAtMs: number;
  status: OpenAiAuthorizationFailureStatus;
}

interface ClaimedOpenAiAuthorizationAlert {
  idempotencyKey: string;
  incidentSequence: number;
  message: string;
  sequence: number;
}

type TransactionSync = <T>(callback: () => T) => T;

type FixedFailureCode =
  | "alarm_update_failed"
  | "linq_duplicate_recipient"
  | "linq_health_suppressed"
  | "linq_health_unavailable"
  | "linq_rejected_response"
  | "linq_retryable_response"
  | "linq_transport_failed"
  | "state_transition_failed";

export class OpenAiAuthorizationAlertDurableObject extends DurableObject {
  private readonly alertSender: OpenAiAuthorizationAlertSender;
  private backgroundWork: Promise<void> = Promise.resolve();
  private readonly deleteAlarm: () => Promise<void>;
  private readonly getAlarm: () => Promise<number | null>;
  private readonly nowImplementation: () => number;
  private readonly setAlarm: (scheduledTime: number | Date) => Promise<void>;
  private readonly state: DurableObjectStateLike;
  private readonly store: OpenAiAuthorizationAlertStore;
  private readonly transactionSync: TransactionSync;

  constructor(
    state: DurableObjectStateLike,
    environment: OpenAiAuthorizationAlertEnvironment,
    alertSender: OpenAiAuthorizationAlertSender =
      createOperatorAlertSender(environment),
    nowImplementation: () => number = Date.now,
  ) {
    super(state as never, environment as never);
    const sql = state.storage.sql;
    const transactionSync = state.storage.transactionSync;
    const deleteAlarm = state.storage.deleteAlarm;
    if (!sql || !transactionSync || !deleteAlarm) {
      throw new Error(
        "OpenAI authorization alert requires SQLite Durable Object storage.",
      );
    }

    this.alertSender = alertSender;
    this.deleteAlarm = deleteAlarm.bind(state.storage);
    this.getAlarm = state.storage.getAlarm.bind(state.storage);
    this.nowImplementation = nowImplementation;
    this.setAlarm = state.storage.setAlarm.bind(state.storage);
    this.state = state;
    this.store = new OpenAiAuthorizationAlertStore(sql);
    this.transactionSync = transactionSync.bind(state.storage);
  }

  reportFailure(input: unknown): { accepted: true } {
    const report = parseFailureReport(input);
    const nowMs = normalizeTimestamp(this.nowImplementation());
    let claimedAlert: ClaimedOpenAiAuthorizationAlert | null;
    try {
      claimedAlert = this.transactionSync(() => {
        const priorState = this.store.readState();
        const beginsNewIncident = priorState.incidentOpen
          && priorState.lastFailureAtMs !== null
          && report.observedAtMs - priorState.lastFailureAtMs
            >= OPENAI_AUTHORIZATION_ALERT_QUIET_MS;
        if (beginsNewIncident) {
          this.store.closeIncident();
        }

        const stateBeforeRecord = this.store.readState();
        const isFreshFailure = !stateBeforeRecord.incidentOpen
          || stateBeforeRecord.lastFailureAtMs === null
          || report.observedAtMs > stateBeforeRecord.lastFailureAtMs;
        if (stateBeforeRecord.incidentOpen) {
          this.store.recordFailure(report);
        } else {
          this.store.openIncident(report);
        }

        const recordedState = this.store.readState();
        if (
          shouldAdmitPage({
            isFreshFailure,
            receivedAtMs: nowMs,
            state: recordedState,
          })
        ) {
          this.store.createPendingAlert({
            idempotencyKey: buildIdempotencyKey(recordedState),
            message: buildAlertMessage(recordedState),
            retryAtMs: nowMs,
          });
        }
        return this.store.claimPendingAlert(nowMs);
      });
    } catch {
      warnFixedFailure("state_transition_failed");
      throw new Error("OpenAI authorization alert state transition failed.");
    }

    this.startBackgroundWork(claimedAlert);
    return { accepted: true };
  }

  alarm(): void {
    const nowMs = normalizeTimestamp(this.nowImplementation());
    let claimedAlert: ClaimedOpenAiAuthorizationAlert | null;
    try {
      claimedAlert = this.transactionSync(() => {
        const state = this.store.readState();
        if (
          state.incidentOpen
          && state.lastFailureAtMs !== null
          && nowMs - state.lastFailureAtMs
            >= OPENAI_AUTHORIZATION_ALERT_QUIET_MS
        ) {
          this.store.closeIncident();
        }
        return this.store.claimPendingAlert(nowMs);
      });
    } catch {
      warnFixedFailure("state_transition_failed");
      throw new Error("OpenAI authorization alert state transition failed.");
    }
    this.startBackgroundWork(claimedAlert);
  }

  readState(): OpenAiAuthorizationAlertState {
    return this.store.readState();
  }

  private startBackgroundWork(
    claimedAlert: ClaimedOpenAiAuthorizationAlert | null,
  ): void {
    const work = this.backgroundWork
      .then(async () => await this.runBackgroundWork(claimedAlert))
      .catch(() => {
        warnFixedFailure("state_transition_failed");
      });
    this.backgroundWork = work;
    this.state.waitUntil(work);
  }

  private async runBackgroundWork(
    initialClaim: ClaimedOpenAiAuthorizationAlert | null,
  ): Promise<void> {
    await this.reconcileAlarmSafely();
    let claimedAlert = initialClaim;
    while (claimedAlert) {
      const activeClaim = claimedAlert;
      if (!this.store.isClaimCurrent(activeClaim)) {
        claimedAlert = null;
        await this.reconcileAlarmSafely();
        continue;
      }
      try {
        await this.alertSender.send({
          idempotencyKey: activeClaim.idempotencyKey,
          message: activeClaim.message,
        });
      } catch (error) {
        const failedAtMs = normalizeTimestamp(this.nowImplementation());
        warnFixedFailure(normalizeLinqFailureCode(error));
        try {
          this.transactionSync(() => {
            this.store.recordAlertFailure({
              failedAtMs,
              idempotencyKey: activeClaim.idempotencyKey,
              incidentSequence: activeClaim.incidentSequence,
              message: activeClaim.message,
              sequence: activeClaim.sequence,
            });
          });
        } catch {
          warnFixedFailure("state_transition_failed");
        }
        claimedAlert = null;
        await this.reconcileAlarmSafely();
        continue;
      }

      const succeededAtMs = normalizeTimestamp(this.nowImplementation());
      try {
        claimedAlert = this.transactionSync(() => {
          const completed = this.store.recordAlertSuccess({
            idempotencyKey: activeClaim.idempotencyKey,
            incidentSequence: activeClaim.incidentSequence,
            message: activeClaim.message,
            sequence: activeClaim.sequence,
            succeededAtMs,
          });
          if (!completed) {
            return null;
          }

          const state = this.store.readState();
          if (
            state.incidentOpen
            && state.alertSequence === 0
            && state.pendingAlertIdempotencyKey === null
          ) {
            this.store.createPendingAlert({
              idempotencyKey: buildIdempotencyKey(state),
              message: buildAlertMessage(state),
              retryAtMs: succeededAtMs,
            });
          }
          return this.store.claimPendingAlert(succeededAtMs);
        });
      } catch {
        warnFixedFailure("state_transition_failed");
        claimedAlert = null;
      }
      await this.reconcileAlarmSafely();
    }
  }

  private async reconcileAlarmSafely(): Promise<void> {
    try {
      const desiredAlarm = computeDesiredAlarm(this.store.readState());
      const currentAlarm = await this.getAlarm();
      if (desiredAlarm === null) {
        await this.deleteAlarm();
        return;
      }
      if (currentAlarm !== desiredAlarm) {
        await this.setAlarm(desiredAlarm);
      }
    } catch {
      warnFixedFailure("alarm_update_failed");
    }
  }
}

class OpenAiAuthorizationAlertStore {
  constructor(private readonly sql: DurableObjectSqlStorageLike) {
    ensureOpenAiAuthorizationAlertSchema(sql);
  }

  claimPendingAlert(nowMs: number): ClaimedOpenAiAuthorizationAlert | null {
    const state = this.readState();
    if (
      state.pendingAlertIdempotencyKey === null
      || state.pendingAlertIncidentSequence === null
      || state.pendingAlertMessage === null
      || state.pendingAlertSequence === null
      || state.pendingRetryAtMs === null
      || state.pendingRetryAtMs > nowMs
    ) {
      return null;
    }

    const claimed = this.sql.exec(
      `UPDATE openai_authorization_alert_meta
       SET pending_retry_at_ms = ?
       WHERE singleton = 1
         AND pending_alert_incident_sequence = ?
         AND pending_alert_sequence = ?
         AND pending_alert_idempotency_key = ?
         AND pending_alert_message = ?
         AND pending_retry_at_ms <= ?`,
      addTimestampDelay(nowMs, OPENAI_AUTHORIZATION_ALERT_RETRY_MS),
      state.pendingAlertIncidentSequence,
      state.pendingAlertSequence,
      state.pendingAlertIdempotencyKey,
      state.pendingAlertMessage,
      nowMs,
    ).rowsWritten === 1;
    if (!claimed) {
      return null;
    }

    return {
      idempotencyKey: state.pendingAlertIdempotencyKey,
      incidentSequence: state.pendingAlertIncidentSequence,
      message: state.pendingAlertMessage,
      sequence: state.pendingAlertSequence,
    };
  }

  isClaimCurrent(claim: ClaimedOpenAiAuthorizationAlert): boolean {
    const state = this.readState();
    return state.pendingAlertIdempotencyKey === claim.idempotencyKey
      && state.pendingAlertIncidentSequence === claim.incidentSequence
      && state.pendingAlertMessage === claim.message
      && state.pendingAlertSequence === claim.sequence;
  }

  closeIncident(): void {
    this.sql.exec(
      `UPDATE openai_authorization_alert_meta
       SET
         incident_open = 0,
         alert_sequence = 0,
         failure_count = 0,
         first_failure_at_ms = NULL,
         last_failure_at_ms = NULL,
         last_status = NULL
       WHERE singleton = 1`,
    );
  }

  createPendingAlert(input: {
    idempotencyKey: string;
    message: string;
    retryAtMs: number;
  }): void {
    const result = this.sql.exec(
      `UPDATE openai_authorization_alert_meta
       SET
         alert_sequence = alert_sequence + 1,
         pending_alert_incident_sequence = incident_sequence,
         pending_alert_sequence = alert_sequence + 1,
         pending_alert_idempotency_key = ?,
         pending_alert_message = ?,
         pending_retry_at_ms = ?
       WHERE singleton = 1
         AND incident_open = 1
         AND pending_alert_idempotency_key IS NULL`,
      input.idempotencyKey,
      input.message,
      input.retryAtMs,
    );
    if (result.rowsWritten !== 1) {
      throw new Error("OpenAI authorization alert admission failed.");
    }
  }

  openIncident(report: OpenAiAuthorizationFailureReport): void {
    this.sql.exec(
      `UPDATE openai_authorization_alert_meta
       SET
         incident_open = 1,
         incident_sequence = incident_sequence + 1,
         alert_sequence = 0,
         failure_count = 1,
         first_failure_at_ms = ?,
         last_failure_at_ms = ?,
         last_status = ?
       WHERE singleton = 1`,
      report.observedAtMs,
      report.observedAtMs,
      report.status,
    );
  }

  readState(): OpenAiAuthorizationAlertState {
    const row = this.sql.exec<OpenAiAuthorizationAlertMetaRow>(
      `SELECT
         incident_open,
         incident_sequence,
         alert_sequence,
         failure_count,
         first_failure_at_ms,
         last_failure_at_ms,
         last_status,
         last_successful_page_at_ms,
         pending_alert_incident_sequence,
         pending_alert_sequence,
         pending_alert_idempotency_key,
         pending_alert_message,
         pending_retry_at_ms
       FROM openai_authorization_alert_meta
       WHERE singleton = 1`,
    ).toArray()[0];
    if (!row) {
      throw new Error("OpenAI authorization alert state is missing.");
    }
    const lastStatus = row.last_status;
    if (lastStatus !== null && lastStatus !== 401 && lastStatus !== 403) {
      throw new Error("Stored OpenAI authorization alert status is invalid.");
    }
    return {
      alertSequence: row.alert_sequence,
      failureCount: row.failure_count,
      firstFailureAtMs: row.first_failure_at_ms,
      incidentOpen: row.incident_open === 1,
      incidentSequence: row.incident_sequence,
      lastFailureAtMs: row.last_failure_at_ms,
      lastStatus,
      lastSuccessfulPageAtMs: row.last_successful_page_at_ms,
      pendingAlertIdempotencyKey: row.pending_alert_idempotency_key,
      pendingAlertIncidentSequence: row.pending_alert_incident_sequence,
      pendingAlertMessage: row.pending_alert_message,
      pendingAlertSequence: row.pending_alert_sequence,
      pendingRetryAtMs: row.pending_retry_at_ms,
    };
  }

  recordAlertFailure(input: {
    failedAtMs: number;
    idempotencyKey: string;
    incidentSequence: number;
    message: string;
    sequence: number;
  }): boolean {
    return this.sql.exec(
      `UPDATE openai_authorization_alert_meta
       SET pending_retry_at_ms = ?
       WHERE singleton = 1
         AND pending_alert_incident_sequence = ?
         AND pending_alert_sequence = ?
         AND pending_alert_idempotency_key = ?
         AND pending_alert_message = ?`,
      addTimestampDelay(
        input.failedAtMs,
        OPENAI_AUTHORIZATION_ALERT_RETRY_MS,
      ),
      input.incidentSequence,
      input.sequence,
      input.idempotencyKey,
      input.message,
    ).rowsWritten === 1;
  }

  recordAlertSuccess(input: {
    idempotencyKey: string;
    incidentSequence: number;
    message: string;
    sequence: number;
    succeededAtMs: number;
  }): boolean {
    return this.sql.exec(
      `UPDATE openai_authorization_alert_meta
       SET
         last_successful_page_at_ms = CASE
           WHEN last_successful_page_at_ms IS NULL
             OR ? > last_successful_page_at_ms THEN ?
           ELSE last_successful_page_at_ms
         END,
         pending_alert_incident_sequence = NULL,
         pending_alert_sequence = NULL,
         pending_alert_idempotency_key = NULL,
         pending_alert_message = NULL,
         pending_retry_at_ms = NULL
       WHERE singleton = 1
         AND pending_alert_incident_sequence = ?
         AND pending_alert_sequence = ?
         AND pending_alert_idempotency_key = ?
         AND pending_alert_message = ?`,
      input.succeededAtMs,
      input.succeededAtMs,
      input.incidentSequence,
      input.sequence,
      input.idempotencyKey,
      input.message,
    ).rowsWritten === 1;
  }

  recordFailure(report: OpenAiAuthorizationFailureReport): void {
    this.sql.exec(
      `UPDATE openai_authorization_alert_meta
       SET
         failure_count = failure_count + 1,
         last_failure_at_ms = CASE
           WHEN ? > last_failure_at_ms THEN ?
           ELSE last_failure_at_ms
         END,
         last_status = CASE
           WHEN ? >= last_failure_at_ms THEN ?
           ELSE last_status
         END
       WHERE singleton = 1
         AND incident_open = 1`,
      report.observedAtMs,
      report.observedAtMs,
      report.observedAtMs,
      report.status,
    );
  }
}

function ensureOpenAiAuthorizationAlertSchema(
  sql: DurableObjectSqlStorageLike,
): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS openai_authorization_alert_schema_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )
  `);
  const versionRow = sql.exec<{ value: DurableObjectSqlValue }>(
    `SELECT value
     FROM openai_authorization_alert_schema_meta
     WHERE key = 'schema_version'`,
  ).toArray()[0];
  const version = versionRow === undefined ? 0 : versionRow.value;
  if (
    typeof version !== "number"
    || !Number.isSafeInteger(version)
    || version < 0
  ) {
    throw new Error("OpenAI authorization alert schema version is invalid.");
  }
  if (version > OPENAI_AUTHORIZATION_ALERT_SCHEMA_VERSION) {
    throw new Error(
      "OpenAI authorization alert schema is newer than this Worker.",
    );
  }

  sql.exec(`
    CREATE TABLE IF NOT EXISTS openai_authorization_alert_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      incident_open INTEGER NOT NULL DEFAULT 0 CHECK (incident_open IN (0, 1)),
      incident_sequence INTEGER NOT NULL DEFAULT 0 CHECK (incident_sequence >= 0),
      alert_sequence INTEGER NOT NULL DEFAULT 0 CHECK (alert_sequence >= 0),
      failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
      first_failure_at_ms INTEGER,
      last_failure_at_ms INTEGER,
      last_status INTEGER CHECK (last_status IN (401, 403)),
      last_successful_page_at_ms INTEGER,
      pending_alert_incident_sequence INTEGER,
      pending_alert_sequence INTEGER,
      pending_alert_idempotency_key TEXT,
      pending_alert_message TEXT,
      pending_retry_at_ms INTEGER,
      CHECK (
        (
          incident_open = 0
          AND alert_sequence = 0
          AND failure_count = 0
          AND first_failure_at_ms IS NULL
          AND last_failure_at_ms IS NULL
          AND last_status IS NULL
        )
        OR
        (
          incident_open = 1
          AND failure_count >= 1
          AND first_failure_at_ms IS NOT NULL
          AND last_failure_at_ms IS NOT NULL
          AND last_status IS NOT NULL
          AND first_failure_at_ms <= last_failure_at_ms
        )
      ),
      CHECK (
        (
          pending_alert_incident_sequence IS NULL
          AND pending_alert_sequence IS NULL
          AND pending_alert_idempotency_key IS NULL
          AND pending_alert_message IS NULL
          AND pending_retry_at_ms IS NULL
        )
        OR
        (
          pending_alert_incident_sequence IS NOT NULL
          AND pending_alert_sequence IS NOT NULL
          AND pending_alert_idempotency_key IS NOT NULL
          AND pending_alert_message IS NOT NULL
          AND pending_retry_at_ms IS NOT NULL
        )
      )
    )
  `);
  sql.exec(`
    INSERT INTO openai_authorization_alert_meta (singleton)
    VALUES (1)
    ON CONFLICT(singleton) DO NOTHING
  `);
  sql.exec(
    `INSERT INTO openai_authorization_alert_schema_meta (key, value)
     VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    OPENAI_AUTHORIZATION_ALERT_SCHEMA_VERSION,
  );
}

function parseFailureReport(input: unknown): OpenAiAuthorizationFailureReport {
  if (!isObjectRecord(input)) {
    throw new TypeError("OpenAI authorization failure report is invalid.");
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 2
    || !keys.every((key) => key === "observedAtMs" || key === "status")
  ) {
    throw new TypeError("OpenAI authorization failure report is invalid.");
  }

  const status = input.status;
  const observedAtMs = input.observedAtMs;
  if (
    (status !== 401 && status !== 403)
    || !isValidTimestamp(observedAtMs)
  ) {
    throw new TypeError("OpenAI authorization failure report is invalid.");
  }
  return { observedAtMs, status };
}

function shouldAdmitPage(input: {
  isFreshFailure: boolean;
  receivedAtMs: number;
  state: OpenAiAuthorizationAlertState;
}): boolean {
  if (
    !input.state.incidentOpen
    || input.state.pendingAlertIdempotencyKey !== null
  ) {
    return false;
  }
  if (input.state.alertSequence === 0) {
    return true;
  }
  const lastSuccessfulPageAtMs = input.state.lastSuccessfulPageAtMs;
  return input.isFreshFailure
    && lastSuccessfulPageAtMs !== null
    && input.receivedAtMs - lastSuccessfulPageAtMs
      >= OPENAI_AUTHORIZATION_ALERT_REMINDER_MS;
}

function buildIdempotencyKey(
  state: OpenAiAuthorizationAlertState,
): string {
  return [
    "openai-authorization-alert",
    `incident-${state.incidentSequence}`,
    `page-${state.alertSequence + 1}`,
  ].join(":");
}

function buildAlertMessage(state: OpenAiAuthorizationAlertState): string {
  if (
    !state.incidentOpen
    || state.failureCount < 1
    || state.firstFailureAtMs === null
    || state.lastFailureAtMs === null
    || state.lastStatus === null
  ) {
    throw new Error("OpenAI authorization alert incident is incomplete.");
  }
  const message = [
    `SEV1 OpenAI ${state.lastStatus}`,
    `Aggregate count: ${state.failureCount}`,
    `First observed UTC: ${formatUtcTimestamp(state.firstFailureAtMs)}`,
    `Last observed UTC: ${formatUtcTimestamp(state.lastFailureAtMs)}`,
  ].join("\n");
  if (
    new TextEncoder().encode(message).byteLength
      > OPENAI_AUTHORIZATION_ALERT_MESSAGE_MAX_BYTES
  ) {
    throw new Error("OpenAI authorization alert message is too large.");
  }
  return message;
}

function computeDesiredAlarm(
  state: OpenAiAuthorizationAlertState,
): number | null {
  const candidates: number[] = [];
  if (
    state.pendingRetryAtMs !== null
    && state.pendingAlertIdempotencyKey !== null
  ) {
    candidates.push(state.pendingRetryAtMs);
  }
  if (state.incidentOpen && state.lastFailureAtMs !== null) {
    candidates.push(
      addTimestampDelay(
        state.lastFailureAtMs,
        OPENAI_AUTHORIZATION_ALERT_QUIET_MS,
      ),
    );
  }
  if (candidates.length === 0) {
    return null;
  }
  return Math.min(...candidates);
}

function createOperatorAlertSender(
  environment: OpenAiAuthorizationAlertEnvironment,
): OpenAiAuthorizationAlertSender {
  const apiBaseUrl = environment.LINQ_API_BASE_URL?.trim()
    || DEFAULT_LINQ_API_BASE_URL;
  const apiToken = readRequiredEnvironmentValue(
    environment.LINQ_API_TOKEN,
    "LINQ_API_TOKEN",
  );
  const chatIds: readonly [primary: string, secondary: string] = [
    readRequiredEnvironmentValue(
      environment.HOSTED_DATABASE_ALERT_LINQ_CHAT_ID,
      "HOSTED_DATABASE_ALERT_LINQ_CHAT_ID",
    ),
    readRequiredEnvironmentValue(
      environment.HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID,
      "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID",
    ),
  ];
  return {
    async send(input): Promise<void> {
      await sendOperatorLinqAlert({
        apiBaseUrl,
        apiToken,
        chatIds,
        idempotencyKey: input.idempotencyKey,
        message: input.message,
      });
    },
  };
}

function readRequiredEnvironmentValue(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required for OpenAI authorization alerts.`);
  }
  return normalized;
}

function normalizeLinqFailureCode(error: unknown): FixedFailureCode {
  const code = classifyOperatorLinqAlertFailure(error);
  switch (code) {
    case "linq_duplicate_recipient":
    case "linq_health_suppressed":
    case "linq_health_unavailable":
    case "linq_rejected_response":
    case "linq_retryable_response":
    case "linq_transport_failed":
      return code;
    default:
      return "linq_transport_failed";
  }
}

function warnFixedFailure(failureCode: FixedFailureCode): void {
  console.warn("OpenAI authorization alert operation failed.", {
    failureCode,
  });
}

function formatUtcTimestamp(value: number): string {
  return new Date(value).toISOString();
}

function addTimestampDelay(timestampMs: number, delayMs: number): number {
  return Math.min(MAX_DATE_TIMESTAMP_MS, timestampMs + delayMs);
}

function normalizeTimestamp(value: number): number {
  if (!isValidTimestamp(value)) {
    throw new Error("OpenAI authorization alert timestamp is invalid.");
  }
  return value;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_DATE_TIMESTAMP_MS;
}

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
