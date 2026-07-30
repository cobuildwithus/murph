import type {
  DurableObjectSqlStorageLike,
  DurableObjectSqlValue,
} from "../user-runner/types.js";
import type {
  DatabaseHealthCondition,
  DatabaseMetricSnapshot,
} from "./metrics.js";

const DATABASE_HEALTH_SCHEMA_VERSION = 1;

export interface DatabaseHealthAlertState {
  alertSequence: number;
  consecutiveScrapeFailures: number;
  deferredDirectErrorCheckedAtMs: number | null;
  deferredDirectErrorCount: number;
  incidentOpen: boolean;
  incidentSequence: number;
  lastAlertAttemptedAtMs: number | null;
  pendingAlertIdempotencyKey: string | null;
  pendingAlertMessage: string | null;
}

export interface DatabaseHealthStoredSample {
  clientWaitSeconds: number | null;
  conditions: DatabaseHealthCondition[];
  directConnectionErrorDelta: number | null;
  failureCode: string | null;
  observedAtMs: number;
  postgresConnections: number | null;
  postgresMaxConnections: number | null;
  scrapeStatus: "failed" | "ok";
  serverConnections: number | null;
  serverPoolCapacity: number | null;
  serverPoolSaturationRatio: number | null;
}

interface DatabaseHealthMetaRow extends Record<string, DurableObjectSqlValue> {
  alert_sequence: number;
  consecutive_scrape_failures: number;
  deferred_direct_error_checked_at_ms: number | null;
  deferred_direct_error_count: number;
  incident_open: number;
  incident_sequence: number;
  last_alert_attempted_at_ms: number | null;
  pending_alert_idempotency_key: string | null;
  pending_alert_message: string | null;
  run_lease_until_ms: number;
}

interface DatabaseHealthCounterRow extends Record<string, DurableObjectSqlValue> {
  direct_connection_error_counters_json: string;
}

interface DatabaseHealthSampleRow extends Record<string, DurableObjectSqlValue> {
  client_wait_seconds: number | null;
  conditions_json: string;
  direct_connection_error_delta: number | null;
  failure_code: string | null;
  observed_at_ms: number;
  postgres_connections: number | null;
  postgres_max_connections: number | null;
  scrape_status: string;
  server_connections: number | null;
  server_pool_capacity: number | null;
  server_pool_saturation_ratio: number | null;
}

export class DatabaseHealthStore {
  constructor(private readonly sql: DurableObjectSqlStorageLike) {
    ensureDatabaseHealthSchema(sql);
  }

  claimRun(nowMs: number, leaseDurationMs: number): boolean {
    const row = this.readMetaRow();
    if (row.run_lease_until_ms > nowMs) {
      return false;
    }
    this.sql.exec(
      `UPDATE database_health_meta
       SET run_lease_until_ms = ?
       WHERE singleton = 1`,
      nowMs + leaseDurationMs,
    );
    return true;
  }

  releaseRun(): void {
    this.sql.exec(
      `UPDATE database_health_meta
       SET run_lease_until_ms = 0
       WHERE singleton = 1`,
    );
  }

  readAlertState(): DatabaseHealthAlertState {
    const row = this.readMetaRow();
    return {
      alertSequence: row.alert_sequence,
      consecutiveScrapeFailures: row.consecutive_scrape_failures,
      deferredDirectErrorCheckedAtMs:
        row.deferred_direct_error_checked_at_ms,
      deferredDirectErrorCount: row.deferred_direct_error_count,
      incidentOpen: row.incident_open === 1,
      incidentSequence: row.incident_sequence,
      lastAlertAttemptedAtMs: row.last_alert_attempted_at_ms,
      pendingAlertIdempotencyKey: row.pending_alert_idempotency_key,
      pendingAlertMessage: row.pending_alert_message,
    };
  }

  setConsecutiveScrapeFailures(failures: number): void {
    this.sql.exec(
      `UPDATE database_health_meta
       SET consecutive_scrape_failures = ?
       WHERE singleton = 1`,
      failures,
    );
  }

  openIncident(): DatabaseHealthAlertState {
    this.sql.exec(
      `UPDATE database_health_meta
       SET
         incident_open = 1,
         incident_sequence = incident_sequence + 1,
         alert_sequence = 0,
         pending_alert_idempotency_key = NULL,
         pending_alert_message = NULL
       WHERE singleton = 1`,
    );
    return this.readAlertState();
  }

  closeIncident(): void {
    this.sql.exec(
      `UPDATE database_health_meta
       SET
         incident_open = 0,
         alert_sequence = 0,
         pending_alert_idempotency_key = NULL,
         pending_alert_message = NULL
       WHERE singleton = 1`,
    );
  }

  createPendingAlert(input: {
    idempotencyKey: string;
    message: string;
  }): DatabaseHealthAlertState {
    this.sql.exec(
      `UPDATE database_health_meta
       SET
         alert_sequence = alert_sequence + 1,
         pending_alert_idempotency_key = ?,
         pending_alert_message = ?,
         deferred_direct_error_count = 0,
         deferred_direct_error_checked_at_ms = NULL
       WHERE singleton = 1`,
      input.idempotencyKey,
      input.message,
    );
    return this.readAlertState();
  }

  deferDirectConnectionErrors(input: {
    checkedAtMs: number;
    count: number;
  }): DatabaseHealthAlertState {
    this.sql.exec(
      `UPDATE database_health_meta
       SET
         deferred_direct_error_count =
           deferred_direct_error_count + ?,
         deferred_direct_error_checked_at_ms = ?
       WHERE singleton = 1`,
      input.count,
      input.checkedAtMs,
    );
    return this.readAlertState();
  }

  recordAlertAttempt(attemptedAtMs: number): void {
    this.sql.exec(
      `UPDATE database_health_meta
       SET last_alert_attempted_at_ms = ?
       WHERE singleton = 1`,
      attemptedAtMs,
    );
  }

  recordAlertSuccess(): void {
    this.sql.exec(
      `UPDATE database_health_meta
       SET
         pending_alert_idempotency_key = NULL,
         pending_alert_message = NULL
       WHERE singleton = 1`,
    );
  }

  readLatestDirectConnectionErrorCounters(): Record<string, number> | null {
    const row = this.sql.exec<DatabaseHealthCounterRow>(
      `SELECT direct_connection_error_counters_json
       FROM database_health_samples
       WHERE scrape_status = 'ok'
       ORDER BY observed_at_ms DESC
       LIMIT 1`,
    ).toArray()[0];
    return row
      ? parseNumberRecord(row.direct_connection_error_counters_json)
      : null;
  }

  recordSuccessfulSample(input: {
    conditions: readonly DatabaseHealthCondition[];
    directConnectionErrorDelta: number;
    observedAtMs: number;
    snapshot: DatabaseMetricSnapshot;
  }): void {
    this.sql.exec(
      `INSERT INTO database_health_samples (
         observed_at_ms,
         scrape_status,
         failure_code,
         client_wait_seconds,
         client_waiting_connections,
         server_connections,
         server_pool_capacity,
         server_pool_saturation_ratio,
         server_pool_states_json,
         postgres_connections,
         postgres_max_connections,
         postgres_connection_states_json,
         direct_connection_error_delta,
         direct_connection_error_counters_json,
         conditions_json
       ) VALUES (?, 'ok', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(observed_at_ms) DO UPDATE SET
         scrape_status = excluded.scrape_status,
         failure_code = excluded.failure_code,
         client_wait_seconds = excluded.client_wait_seconds,
         client_waiting_connections = excluded.client_waiting_connections,
         server_connections = excluded.server_connections,
         server_pool_capacity = excluded.server_pool_capacity,
         server_pool_saturation_ratio = excluded.server_pool_saturation_ratio,
         server_pool_states_json = excluded.server_pool_states_json,
         postgres_connections = excluded.postgres_connections,
         postgres_max_connections = excluded.postgres_max_connections,
         postgres_connection_states_json = excluded.postgres_connection_states_json,
         direct_connection_error_delta = excluded.direct_connection_error_delta,
         direct_connection_error_counters_json =
           excluded.direct_connection_error_counters_json,
         conditions_json = excluded.conditions_json`,
      input.observedAtMs,
      input.snapshot.clientWaitSeconds,
      input.snapshot.clientWaitingConnections,
      input.snapshot.serverConnections,
      input.snapshot.serverPoolCapacity,
      input.snapshot.serverPoolSaturationRatio,
      JSON.stringify(input.snapshot.serverPoolStates),
      input.snapshot.postgresConnections,
      input.snapshot.postgresMaxConnections,
      JSON.stringify(input.snapshot.postgresConnectionStates),
      input.directConnectionErrorDelta,
      JSON.stringify(input.snapshot.directConnectionErrorCounters),
      JSON.stringify(input.conditions),
    );
  }

  recordFailedSample(input: {
    conditions: readonly DatabaseHealthCondition[];
    failureCode: string;
    observedAtMs: number;
  }): void {
    this.sql.exec(
      `INSERT INTO database_health_samples (
         observed_at_ms,
         scrape_status,
         failure_code,
         server_pool_states_json,
         postgres_connection_states_json,
         direct_connection_error_counters_json,
         conditions_json
       ) VALUES (?, 'failed', ?, '{}', '{}', '{}', ?)
       ON CONFLICT(observed_at_ms) DO UPDATE SET
         scrape_status = excluded.scrape_status,
         failure_code = excluded.failure_code,
         client_wait_seconds = NULL,
         client_waiting_connections = NULL,
         server_connections = NULL,
         server_pool_capacity = NULL,
         server_pool_saturation_ratio = NULL,
         server_pool_states_json = excluded.server_pool_states_json,
         postgres_connections = NULL,
         postgres_max_connections = NULL,
         postgres_connection_states_json =
           excluded.postgres_connection_states_json,
         direct_connection_error_delta = NULL,
         direct_connection_error_counters_json =
           excluded.direct_connection_error_counters_json,
         conditions_json = excluded.conditions_json`,
      input.observedAtMs,
      input.failureCode,
      JSON.stringify(input.conditions),
    );
  }

  pruneSamples(beforeMs: number): void {
    this.sql.exec(
      "DELETE FROM database_health_samples WHERE observed_at_ms < ?",
      beforeMs,
    );
  }

  readRecentSamples(limit = 10): DatabaseHealthStoredSample[] {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    return this.sql.exec<DatabaseHealthSampleRow>(
      `SELECT
         observed_at_ms,
         scrape_status,
         failure_code,
         client_wait_seconds,
         server_connections,
         server_pool_capacity,
         server_pool_saturation_ratio,
         postgres_connections,
         postgres_max_connections,
         direct_connection_error_delta,
         conditions_json
       FROM database_health_samples
       ORDER BY observed_at_ms DESC
       LIMIT ?`,
      safeLimit,
    ).toArray().map((row) => ({
      clientWaitSeconds: row.client_wait_seconds,
      conditions: parseConditions(row.conditions_json),
      directConnectionErrorDelta: row.direct_connection_error_delta,
      failureCode: row.failure_code,
      observedAtMs: row.observed_at_ms,
      postgresConnections: row.postgres_connections,
      postgresMaxConnections: row.postgres_max_connections,
      scrapeStatus: row.scrape_status === "ok" ? "ok" : "failed",
      serverConnections: row.server_connections,
      serverPoolCapacity: row.server_pool_capacity,
      serverPoolSaturationRatio: row.server_pool_saturation_ratio,
    }));
  }

  private readMetaRow(): DatabaseHealthMetaRow {
    return this.sql.exec<DatabaseHealthMetaRow>(
      `SELECT
         run_lease_until_ms,
         consecutive_scrape_failures,
         incident_open,
         incident_sequence,
         alert_sequence,
         deferred_direct_error_count,
         deferred_direct_error_checked_at_ms,
         last_alert_attempted_at_ms,
         pending_alert_idempotency_key,
         pending_alert_message
       FROM database_health_meta
       WHERE singleton = 1`,
    ).one();
  }
}

function ensureDatabaseHealthSchema(sql: DurableObjectSqlStorageLike): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS database_health_schema_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS database_health_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      run_lease_until_ms INTEGER NOT NULL DEFAULT 0,
      consecutive_scrape_failures INTEGER NOT NULL DEFAULT 0,
      incident_open INTEGER NOT NULL DEFAULT 0 CHECK (incident_open IN (0, 1)),
      incident_sequence INTEGER NOT NULL DEFAULT 0,
      alert_sequence INTEGER NOT NULL DEFAULT 0,
      deferred_direct_error_count INTEGER NOT NULL DEFAULT 0,
      deferred_direct_error_checked_at_ms INTEGER,
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
    CREATE TABLE IF NOT EXISTS database_health_samples (
      observed_at_ms INTEGER PRIMARY KEY,
      scrape_status TEXT NOT NULL CHECK (scrape_status IN ('ok', 'failed')),
      failure_code TEXT,
      client_wait_seconds REAL,
      client_waiting_connections INTEGER,
      server_connections INTEGER,
      server_pool_capacity INTEGER,
      server_pool_saturation_ratio REAL,
      server_pool_states_json TEXT NOT NULL,
      postgres_connections INTEGER,
      postgres_max_connections INTEGER,
      postgres_connection_states_json TEXT NOT NULL,
      direct_connection_error_delta INTEGER,
      direct_connection_error_counters_json TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      CHECK (
        (scrape_status = 'ok' AND failure_code IS NULL)
        OR
        (scrape_status = 'failed' AND failure_code IS NOT NULL)
      )
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS database_health_samples_status_observed_idx
      ON database_health_samples(scrape_status, observed_at_ms DESC)
  `);
  sql.exec(`
    INSERT INTO database_health_meta (singleton)
    VALUES (1)
    ON CONFLICT(singleton) DO NOTHING
  `);

  const versionRow = sql.exec<{ value: DurableObjectSqlValue }>(
    `SELECT value
     FROM database_health_schema_meta
     WHERE key = 'schema_version'`,
  ).toArray()[0];
  const version = typeof versionRow?.value === "number"
    ? versionRow.value
    : 0;
  if (version > DATABASE_HEALTH_SCHEMA_VERSION) {
    throw new Error(
      "Database health Durable Object schema is newer than this Worker.",
    );
  }
  sql.exec(
    `INSERT INTO database_health_schema_meta (key, value)
     VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    DATABASE_HEALTH_SCHEMA_VERSION,
  );
}

function parseNumberRecord(value: string): Record<string, number> {
  const parsed: unknown = JSON.parse(value);
  if (!isObjectRecord(parsed)) {
    throw new Error("Stored database health counters are invalid.");
  }

  const entries: Array<[string, number]> = [];
  for (const [key, candidate] of Object.entries(parsed)) {
    if (
      typeof candidate !== "number"
      || !Number.isFinite(candidate)
      || candidate < 0
    ) {
      throw new Error("Stored database health counter is invalid.");
    }
    entries.push([key, candidate]);
  }
  return Object.fromEntries(entries);
}

function parseConditions(value: string): DatabaseHealthCondition[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter(isDatabaseHealthCondition)
    : [];
}

function isDatabaseHealthCondition(
  value: unknown,
): value is DatabaseHealthCondition {
  return isObjectRecord(value) && typeof value.kind === "string";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
