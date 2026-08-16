import { describe, expect, it } from "vitest";

import {
  advanceConnectionErrorCounterBaseline,
  calculateConnectionErrorDeltas,
  DatabaseMetricsParseError,
  evaluateDatabaseMetricSnapshot,
  parsePlanetScaleDatabaseMetricObservation,
  parsePlanetScaleDatabaseMetrics,
  readMissingConnectionErrorPorts,
} from "../src/database-health/metrics.ts";
import { buildMetricsBody } from "./helpers/database-health.ts";

const BRANCH_ID = "branch_test";

describe("PlanetScale database health metrics", () => {
  it("normalizes the requested connection signals for the configured branch", () => {
    const snapshot = parsePlanetScaleDatabaseMetrics(
      buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 7,
        directErrors: 4,
        postgresStates: {
          active: 40,
          idle: 6,
          "idle in transaction (aborted)": 1,
        },
        serverConnections: 46,
      }),
      BRANCH_ID,
    );

    expect(snapshot).toEqual({
      clientWaitSeconds: 7,
      clientWaitingConnections: 3,
      connectionErrorCounters: {
        '["5432","us-east"]': 4,
        '["6432","us-east"]': 0,
      },
      postgresConnections: 47,
      postgresConnectionStates: {
        active: 40,
        idle: 6,
        "idle in transaction (aborted)": 1,
      },
      postgresMaxConnections: 50,
      serverConnections: 46,
      serverPoolCapacity: 50,
      serverPoolSaturationRatio: 0.92,
      serverPoolStates: {
        active: 40,
        idle: 6,
      },
    });
  });

  it("alerts on wait, local server saturation, Postgres state, and connection-error deltas", () => {
    const snapshot = parsePlanetScaleDatabaseMetrics(
      buildMetricsBody({
        branchId: BRANCH_ID,
        clientWaitSeconds: 7,
        directErrors: 4,
        postgresStates: {
          active: 40,
          idle: 5,
          "idle in transaction (aborted)": 1,
        },
        serverConnections: 46,
      }),
      BRANCH_ID,
    );

    expect(evaluateDatabaseMetricSnapshot(snapshot, {
      "5432": 2,
      "6432": 0,
    })).toEqual([
      {
        kind: "client_wait",
        seconds: 7,
        waitingConnections: 3,
      },
      {
        connections: 46,
        kind: "server_pool_saturation",
        limit: 50,
        ratio: 0.92,
      },
      {
        connections: 46,
        kind: "postgres_connection_saturation",
        limit: 50,
        ratio: 0.92,
      },
      {
        count: 1,
        kind: "postgres_aborted_connections",
      },
      {
        count: 2,
        kind: "direct_migration_admission_failures",
      },
    ]);
  });

  it("evaluates server-pool saturation per pod instead of branch-wide capacity", () => {
    const constrainedPod = buildMetricsBody({
      branchId: BRANCH_ID,
      serverConnections: 9,
    }).replace(
      `planetscale_postgres_settings_max_connections{planetscale_database_branch_id="${BRANCH_ID}",planetscale_pod="pod-primary",planetscale_role="primary"} 50`,
      `planetscale_postgres_settings_max_connections{planetscale_database_branch_id="${BRANCH_ID}",planetscale_pod="pod-primary",planetscale_role="primary"} 10`,
    );
    const sparePodLabels =
      `planetscale_database_branch_id="${BRANCH_ID}",`
      + 'planetscale_pod="pod-spare",planetscale_role="primary"';
    const snapshot = parsePlanetScaleDatabaseMetrics(
      [
        constrainedPod,
        `planetscale_postgres_settings_max_connections{${sparePodLabels}} 100`,
        `planetscale_pgbouncer_current_connections{${sparePodLabels},planetscale_container="pgbouncer"} 0`,
        "",
      ].join("\n"),
      BRANCH_ID,
    );

    expect(snapshot).toMatchObject({
      postgresMaxConnections: 110,
      serverConnections: 9,
      serverPoolCapacity: 10,
      serverPoolSaturationRatio: 0.9,
    });
    expect(evaluateDatabaseMetricSnapshot(snapshot, {
      "5432": 0,
      "6432": 0,
    })).toContainEqual({
      connections: 9,
      kind: "server_pool_saturation",
      limit: 10,
      ratio: 0.9,
    });
    expect(evaluateDatabaseMetricSnapshot(snapshot, {
      "5432": 0,
      "6432": 0,
    })).not.toContainEqual(
      expect.objectContaining({
        kind: "postgres_connection_saturation",
      }),
    );
  });

  it("suppresses new and reset series independently for each expected port", () => {
    expect(calculateConnectionErrorDeltas(
      {
        '["5432","new-region"]': 9,
        '["5432","reset-region"]': 2,
        '["5432","stable-region"]': 8,
        '["6432","new-region"]': 12,
        '["6432","reset-region"]': 1,
        '["6432","stable-region"]': 6,
      },
      {
        '["5432","reset-region"]': 10,
        '["5432","stable-region"]': 5,
        '["6432","reset-region"]': 4,
        '["6432","stable-region"]': 4,
      },
    )).toEqual({
      "5432": 3,
      "6432": 2,
    });
    expect(calculateConnectionErrorDeltas(
      {
        '["5432","new-region"]': 9,
        '["6432","new-region"]': 12,
      },
      null,
    )).toEqual({
      "5432": 0,
      "6432": 0,
    });
  });

  it("suppresses the legacy direct-only key shape during baseline upgrade", () => {
    const current = {
      '["5432","us-east"]': 7,
      '["6432","us-east"]': 8,
    };

    expect(calculateConnectionErrorDeltas(
      current,
      { "us-east": 6 },
    )).toEqual({
      "5432": 0,
      "6432": 0,
    });
    expect(advanceConnectionErrorCounterBaseline(
      current,
      { "us-east": 6 },
    )).toEqual(current);
  });

  it("advances observed port baselines while retaining an omitted port", () => {
    const previous = {
      '["5432","removed-region"]': 9,
      '["5432","us-east"]': 5,
      '["6432","us-east"]': 8,
    };

    const afterDirectOnly = advanceConnectionErrorCounterBaseline(
      { '["5432","us-east"]': 7 },
      previous,
    );
    expect(afterDirectOnly).toEqual({
      '["5432","us-east"]': 7,
      '["6432","us-east"]': 8,
    });
    expect(calculateConnectionErrorDeltas(
      { '["6432","us-east"]': 10 },
      afterDirectOnly,
    )).toEqual({
      "5432": null,
      "6432": 2,
    });

    expect(advanceConnectionErrorCounterBaseline(
      { '["6432","us-east"]': 10 },
      afterDirectOnly,
    )).toEqual({
      '["5432","us-east"]': 7,
      '["6432","us-east"]': 10,
    });
  });

  it("keeps one missing expected port unknown while retaining the other baseline", () => {
    const body = buildMetricsBody({
      branchId: BRANCH_ID,
      directErrors: 5,
      pooledErrors: 8,
    }).replace(
      /^planetscale_edge_postgres_connection_errors_total\{[^\n]*planetscale_port="6432".*$/mu,
      "",
    );

    const observation = parsePlanetScaleDatabaseMetricObservation(
      body,
      BRANCH_ID,
    );

    expect(observation.missingMetrics).toContain(
      "planetscale_edge_postgres_connection_errors_total",
    );
    expect(observation.snapshot.connectionErrorCounters).toEqual({
      '["5432","us-east"]': 5,
    });
    expect(readMissingConnectionErrorPorts(
      observation.snapshot.connectionErrorCounters,
    )).toEqual(["6432"]);
    expect(readMissingConnectionErrorPorts(null)).toEqual(["5432", "6432"]);
    expect(calculateConnectionErrorDeltas(
      observation.snapshot.connectionErrorCounters ?? {},
      {
        '["5432","us-east"]': 3,
        '["6432","us-east"]': 7,
      },
    )).toEqual({
      "5432": 2,
      "6432": null,
    });
  });

  it("emits a distinct pooled application condition for positive port 6432 deltas", () => {
    const snapshot = parsePlanetScaleDatabaseMetrics(
      buildMetricsBody({ branchId: BRANCH_ID }),
      BRANCH_ID,
    );

    expect(evaluateDatabaseMetricSnapshot(snapshot, {
      "5432": 0,
      "6432": 3,
    })).toContainEqual({
      count: 3,
      kind: "pooled_application_connection_errors",
    });
  });

  it("identifies the canonical required metric families that are missing", () => {
    const missingMaxConnections = buildMetricsBody({
      branchId: BRANCH_ID,
    }).replace(
      /^planetscale_postgres_settings_max_connections.*$/mu,
      "",
    );

    try {
      parsePlanetScaleDatabaseMetrics(missingMaxConnections, BRANCH_ID);
      throw new Error("Expected required metrics parsing to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseMetricsParseError);
      if (!(error instanceof DatabaseMetricsParseError)) {
        throw error;
      }
      expect(error).toMatchObject({
        code: "required_metrics_missing",
        missingMetrics: [
          "planetscale_postgres_settings_max_connections",
        ],
      });
    }
  });

  it("fails closed when a selected label set is malformed", () => {

    const malformedLabels = buildMetricsBody({
      branchId: BRANCH_ID,
    }).replace(
      'planetscale_role="primary"',
      'planetscale_role="primary',
    );
    expect(() =>
      parsePlanetScaleDatabaseMetrics(malformedLabels, BRANCH_ID)
    ).toThrowError(DatabaseMetricsParseError);
  });
});
