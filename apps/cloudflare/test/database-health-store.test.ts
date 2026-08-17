import { describe, expect, it } from "vitest";

import { DatabaseHealthStore } from "../src/database-health/store.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

describe("database health store", () => {
  it("adds monitoring obligations without disturbing version-one alert state", () => {
    const sql = createTestSqlStorage();
    sql.exec(`
      CREATE TABLE database_health_schema_meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);
    sql.exec(`
      INSERT INTO database_health_schema_meta (key, value)
      VALUES ('schema_version', 1)
    `);
    sql.exec(`
      CREATE TABLE database_health_meta (
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
      INSERT INTO database_health_meta (
        singleton,
        incident_open,
        incident_sequence,
        alert_sequence,
        pending_alert_idempotency_key,
        pending_alert_message
      ) VALUES (1, 1, 7, 1, 'murph-db-7-1', 'existing alert')
    `);

    const store = new DatabaseHealthStore(sql);

    expect(store.readAlertState()).toMatchObject({
      alertSequence: 1,
      deferredPooledErrorCheckedAtMs: null,
      deferredPooledErrorCount: 0,
      incidentOpen: true,
      incidentSequence: 7,
      monitoringAlertObligation: null,
      pendingAlertIdempotencyKey: "murph-db-7-1",
      pendingAlertIncludesMonitoring: false,
      pendingAlertMessage: "existing alert",
    });
    expect(sql.exec<{ name: string }>(
      "PRAGMA table_info(database_health_meta)",
    ).toArray().map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "deferred_pooled_error_count",
        "deferred_pooled_error_checked_at_ms",
      ]),
    );
    expect(sql.exec<{ value: number }>(
      `SELECT value
       FROM database_health_schema_meta
       WHERE key = 'schema_version'`,
    ).one().value).toBe(1);
  });

  it("stores rollback-compatible evidence with a generalized baseline", () => {
    const sql = createTestSqlStorage();
    const store = new DatabaseHealthStore(sql);
    const connectionErrorCounterBaseline = {
      '["5432","us-east"]': 7,
      '["6432","us-east"]': 8,
    };

    store.recordFailedSample({
      connectionErrorCounterBaseline,
      connectionErrorDelta: 2,
      conditions: [
        { count: 2, kind: "direct_migration_admission_failures" },
      ],
      failureCode: "required_metrics_missing",
      monitoringEvidence: {
        availability: "incomplete",
        connectionErrorEvidence: {
          missingPortAttempts: { "5432": 0, "6432": 0 },
          parsedAttempts: 1,
        },
        missingMetrics: [
          "planetscale_postgres_settings_max_connections",
        ],
      },
      observedAtMs: 300_000,
      snapshot: {
        clientWaitSeconds: 0,
        clientWaitingConnections: 0,
        connectionErrorCounters: {
          '["5432","us-east"]': 7,
        },
        postgresConnections: 10,
        postgresConnectionStates: { active: 5, idle: 5 },
        postgresMaxConnections: 50,
        serverConnections: 10,
        serverPoolCapacity: 50,
        serverPoolSaturationRatio: 0.2,
        serverPoolStates: { active: 5, idle: 5 },
      },
    });

    expect(store.readLatestConnectionErrorCounterBaseline()).toEqual(
      connectionErrorCounterBaseline,
    );
    expect(store.readLatestMonitoringEvidence()).toEqual({
      availability: "incomplete",
      connectionErrorEvidence: {
        missingPortAttempts: { "5432": 0, "6432": 0 },
        parsedAttempts: 1,
      },
      missingMetrics: [
        "planetscale_postgres_settings_max_connections",
      ],
    });
    expect(store.readRecentSamples()).toEqual([
      expect.objectContaining({
        connectionErrorDelta: 2,
        failureCode: "required_metrics_missing",
      }),
    ]);
  });

  it("adds bounded monitoring evidence to version-one sample history", () => {
    const sql = createTestSqlStorage();
    sql.exec(`
      CREATE TABLE database_health_schema_meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);
    sql.exec(`
      INSERT INTO database_health_schema_meta (key, value)
      VALUES ('schema_version', 1)
    `);
    sql.exec(`
      CREATE TABLE database_health_samples (
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
        conditions_json TEXT NOT NULL
      )
    `);
    sql.exec(`
      INSERT INTO database_health_samples (
        observed_at_ms,
        scrape_status,
        failure_code,
        server_pool_states_json,
        postgres_connection_states_json,
        direct_connection_error_counters_json,
        conditions_json
      ) VALUES (300000, 'failed', 'required_metrics_missing', '{}', '{}', '{}', '[]')
    `);

    const store = new DatabaseHealthStore(sql);

    expect(store.readLatestMonitoringEvidence()).toEqual({
      availability: "incomplete",
      connectionErrorEvidence: null,
      missingMetrics: [],
    });
    expect(sql.exec<{ name: string }>(
      "PRAGMA table_info(database_health_samples)",
    ).toArray().map((column) => column.name))
      .toContain("monitoring_evidence_json");
    expect(sql.exec<{ value: number }>(
      `SELECT value
       FROM database_health_schema_meta
       WHERE key = 'schema_version'`,
    ).one().value).toBe(1);
  });

  it("recognizes a telemetry pending body acknowledged by a rollback Worker", () => {
    const sql = createTestSqlStorage();
    const store = new DatabaseHealthStore(sql);
    store.openIncident();
    store.recordMonitoringAlertObligation({
      checkedAtMs: 600_000,
      connectionErrorEvidence: {
        missingPortAttempts: { "5432": 0, "6432": 0 },
        parsedAttempts: 2,
      },
      failures: 2,
      incompleteChecks: 2,
      missingMetrics: [
        "planetscale_postgres_settings_max_connections",
      ],
      unavailableChecks: 0,
    });
    store.createPendingAlert({
      idempotencyKey: "murph-db-1-1",
      includesMonitoring: true,
      message: "telemetry alert",
    });

    sql.exec(
      `UPDATE database_health_meta
       SET
         pending_alert_idempotency_key = NULL,
         pending_alert_message = NULL
       WHERE singleton = 1`,
    );

    expect(store.readAlertState()).toMatchObject({
      monitoringAlertObligation: null,
      pendingAlertIncludesMonitoring: false,
      pendingAlertIdempotencyKey: null,
      pendingAlertMessage: null,
    });
  });

  it("reads legacy monitoring obligations without port evidence", () => {
    const sql = createTestSqlStorage();
    const store = new DatabaseHealthStore(sql);
    sql.exec(
      `UPDATE database_health_meta
       SET monitoring_alert_owed_json = ?
       WHERE singleton = 1`,
      JSON.stringify({
        checkedAtMs: 600_000,
        failures: 2,
        incompleteChecks: 2,
        missingMetrics: [
          "planetscale_edge_postgres_connection_errors_total",
        ],
        unavailableChecks: 0,
      }),
    );

    expect(store.readAlertState().monitoringAlertObligation).toEqual({
      checkedAtMs: 600_000,
      connectionErrorEvidence: null,
      failures: 2,
      incompleteChecks: 2,
      missingMetrics: [
        "planetscale_edge_postgres_connection_errors_total",
      ],
      unavailableChecks: 0,
    });
  });

  it("reads legacy single-port monitoring obligations", () => {
    const sql = createTestSqlStorage();
    const store = new DatabaseHealthStore(sql);
    sql.exec(
      `UPDATE database_health_meta
       SET monitoring_alert_owed_json = ?
       WHERE singleton = 1`,
      JSON.stringify({
        checkedAtMs: 600_000,
        connectionErrorEvidence: {
          missingPortAttempts: { "5432": 2, "6432": 0 },
          parsedAttempts: 2,
        },
        failures: 2,
        incompleteChecks: 2,
        missingMetrics: [
          "planetscale_edge_postgres_connection_errors_total",
        ],
        unavailableChecks: 0,
      }),
    );

    expect(store.readAlertState().monitoringAlertObligation).toMatchObject({
      connectionErrorEvidence: {
        missingPortAttempts: { "5432": 2, "6432": 0 },
        parsedAttempts: 2,
      },
      missingMetrics: [
        "planetscale_edge_postgres_connection_errors_total",
      ],
    });
  });

  it("rejects parsed evidence on an all-unavailable monitoring obligation", () => {
    const sql = createTestSqlStorage();
    const store = new DatabaseHealthStore(sql);
    sql.exec(
      `UPDATE database_health_meta
       SET monitoring_alert_owed_json = ?
       WHERE singleton = 1`,
      JSON.stringify({
        checkedAtMs: 600_000,
        connectionErrorEvidence: {
          missingPortAttempts: { "5432": 0, "6432": 0 },
          parsedAttempts: 1,
        },
        failures: 2,
        incompleteChecks: 0,
        missingMetrics: [],
        unavailableChecks: 2,
      }),
    );

    expect(() => store.readAlertState()).toThrow(
      /database monitoring alert obligation/u,
    );
  });

  it.each([
    {
      name: "port evidence without the connection-error family",
      value: {
        availability: "incomplete",
        connectionErrorEvidence: {
          missingPortAttempts: { "5432": 0, "6432": 1 },
          parsedAttempts: 1,
        },
        missingMetrics: [
          "planetscale_postgres_settings_max_connections",
        ],
      },
    },
    {
      name: "connection-error family without a missing-port count",
      value: {
        availability: "incomplete",
        connectionErrorEvidence: {
          missingPortAttempts: { "5432": 0, "6432": 0 },
          parsedAttempts: 1,
        },
        missingMetrics: [
          "planetscale_edge_postgres_connection_errors_total",
        ],
      },
    },
    {
      name: "unknown port",
      value: {
        availability: "incomplete",
        connectionErrorEvidence: {
          missingPortAttempts: { "5432": 0, "6432": 1, "9999": 1 },
          parsedAttempts: 1,
        },
        missingMetrics: [
          "planetscale_edge_postgres_connection_errors_total",
        ],
      },
    },
    {
      name: "excess parsed attempts",
      value: {
        availability: "incomplete",
        connectionErrorEvidence: {
          missingPortAttempts: { "5432": 0, "6432": 3 },
          parsedAttempts: 3,
        },
        missingMetrics: [
          "planetscale_edge_postgres_connection_errors_total",
        ],
      },
    },
    {
      name: "port evidence on an unavailable collection",
      value: {
        availability: "unavailable",
        connectionErrorEvidence: {
          missingPortAttempts: { "5432": 0, "6432": 1 },
          parsedAttempts: 1,
        },
        missingMetrics: [],
      },
    },
  ])("rejects invalid monitoring evidence: $name", ({ value }) => {
    const sql = createTestSqlStorage();
    const store = new DatabaseHealthStore(sql);
    sql.exec(
      `INSERT INTO database_health_samples (
         observed_at_ms,
         scrape_status,
         failure_code,
         server_pool_states_json,
         postgres_connection_states_json,
         direct_connection_error_counters_json,
         monitoring_evidence_json,
         conditions_json
       ) VALUES (300000, 'failed', 'required_metrics_missing', '{}', '{}', '{}', ?, '[]')`,
      JSON.stringify(value),
    );

    expect(() => store.readLatestMonitoringEvidence()).toThrow(
      /database monitoring/u,
    );
  });
});
