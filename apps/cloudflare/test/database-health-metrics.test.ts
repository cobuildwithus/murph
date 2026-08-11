import { describe, expect, it } from "vitest";

import {
  calculateDirectConnectionErrorDelta,
  DatabaseMetricsParseError,
  evaluateDatabaseMetricSnapshot,
  parsePlanetScaleDatabaseMetrics,
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
      directConnectionErrorCounters: {
        "us-east": 4,
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

  it("alerts on wait, local server saturation, Postgres state, and direct-error deltas", () => {
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

    expect(evaluateDatabaseMetricSnapshot(snapshot, 2)).toEqual([
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
    expect(evaluateDatabaseMetricSnapshot(snapshot, 0)).toContainEqual({
      connections: 9,
      kind: "server_pool_saturation",
      limit: 10,
      ratio: 0.9,
    });
    expect(evaluateDatabaseMetricSnapshot(snapshot, 0)).not.toContainEqual(
      expect.objectContaining({
        kind: "postgres_connection_saturation",
      }),
    );
  });

  it("does not turn a new or reset direct-error series into a false admission failure", () => {
    expect(calculateDirectConnectionErrorDelta(
      {
        "new-region": 9,
        "reset-region": 2,
        "stable-region": 8,
      },
      {
        "reset-region": 10,
        "stable-region": 5,
      },
    )).toBe(3);
    expect(calculateDirectConnectionErrorDelta(
      { "new-region": 9 },
      null,
    )).toBe(0);
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
