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
      incidentOpen: true,
      incidentSequence: 7,
      monitoringAlertObligation: null,
      pendingAlertIdempotencyKey: "murph-db-7-1",
      pendingAlertIncludesMonitoring: false,
      pendingAlertMessage: "existing alert",
    });
    expect(sql.exec<{ value: number }>(
      `SELECT value
       FROM database_health_schema_meta
       WHERE key = 'schema_version'`,
    ).one().value).toBe(2);
  });
});
