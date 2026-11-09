import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  HOSTED_STANDBY_INVENTORY_ANALYTICS_SCHEMA,
} from "../src/worker/standby-runner-coordinator-durable-object.ts";

const execFileAsync = promisify(execFile);
const coldStartReportPath = fileURLToPath(
  new URL("../scripts/cold-start-latency-report.sql", import.meta.url),
);
const standbyInventorySql = readFileSync(
  new URL("../scripts/standby-inventory.sql", import.meta.url),
  "utf8",
);
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && !readLocalPostgresConnection(databaseUrl)) {
  throw new Error(
    "The cold-start report PostgreSQL proof requires a local DATABASE_URL.",
  );
}

describe("hosted runtime operational report contracts", () => {
  it("keeps the standby inventory query aligned with the emitted Analytics Engine point", () => {
    expect(standbyInventorySql).toContain("FROM murph_hosted_standby_inventory");
    expect(standbyInventorySql).toContain(
      `blob1 = '${HOSTED_STANDBY_INVENTORY_ANALYTICS_SCHEMA}'`,
    );
    for (const column of [
      "blob2 AS event",
      "blob3 AS detail",
      "blob4 AS outcome",
      "double2 AS ready",
      "SUM(_sample_interval * double1) AS events",
      "quantileExactWeighted(0.95)(double5, _sample_interval)",
    ]) {
      expect(standbyInventorySql).toContain(column);
    }
    expect(standbyInventorySql).toContain("INTERVAL '7' DAY");
  });
});

describe.skipIf(!runPostgresProof)(
  "hosted runtime cold-start report PostgreSQL fixture",
  () => {
    it("classifies Temporal launch cohorts and omits ambiguous attempts", async () => {
      const connection = readLocalPostgresConnection(databaseUrl);
      if (!connection) {
        throw new Error("Expected a validated local PostgreSQL connection.");
      }
      const schemaName = `cold_start_report_${randomUUID().replaceAll("-", "")}`;

      try {
        const { stdout } = await runPsql(connection, [
          "--quiet",
          "--command",
          createFixtureSql(schemaName),
          "--command",
          `SET search_path TO "${schemaName}"`,
          "--csv",
          "--set",
          "window_hours=24",
          "--file",
          coldStartReportPath,
        ]);

        expect(stdout).toContain("temporal_only,1,4.000,4.000,4.000");
        expect(stdout).toContain("temporal_recovery,1,30.000,30.000,30.000");
        expect(stdout).toContain("legacy_unclassified,1,5.000,5.000,5.000");
      } finally {
        await runPsql(connection, [
          "--quiet",
          "--command",
          `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
        ]);
      }
    });
  },
);

interface LocalPostgresConnection {
  databaseName: string;
  environment: NodeJS.ProcessEnv;
}

function readLocalPostgresConnection(
  value: string,
): LocalPostgresConnection | null {
  if (!value) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:")
    || !["127.0.0.1", "::1", "localhost"].includes(parsed.hostname)
  ) {
    return null;
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (!databaseName) {
    return null;
  }

  return {
    databaseName,
    environment: {
      ...process.env,
      PGHOST: parsed.hostname,
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGPORT: parsed.port || "5432",
      PGUSER: decodeURIComponent(parsed.username),
    },
  };
}

async function runPsql(
  connection: LocalPostgresConnection,
  args: readonly string[],
) {
  return await execFileAsync(
    "psql",
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      connection.databaseName,
      ...args,
    ],
    {
      encoding: "utf8",
      env: connection.environment,
      maxBuffer: 1024 * 1024,
    },
  );
}

function createFixtureSql(schemaName: string): string {
  return `
    CREATE SCHEMA "${schemaName}";
    SET search_path TO "${schemaName}";
    CREATE TABLE hosted_ingress_latency_trace (
      id TEXT PRIMARY KEY,
      accepted_at TIMESTAMP(3) NOT NULL,
      runner_job_accepted_at TIMESTAMP(3),
      runtime_attempt_id TEXT,
      phase_breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    WITH clock AS (
      SELECT
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '10 minutes' AS t0
    ), fixture AS (
      SELECT
        t0,
        EXTRACT(EPOCH FROM (t0 - TIMESTAMP '1970-01-01')) * 1000 AS base_ms
      FROM clock
    )
    INSERT INTO hosted_ingress_latency_trace (
      id,
      accepted_at,
      runner_job_accepted_at,
      runtime_attempt_id,
      phase_breakdown_json
    )
    SELECT
      'temporal-recovery',
      t0 + INTERVAL '10 seconds',
      t0 + INTERVAL '40 seconds',
      'attempt-temporal-recovery',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 10000,
        'directEnsureRequestStartedAtEpochMs', base_ms + 10100,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-temporal-recovery'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'temporal-recovery-duplicate',
      t0 + INTERVAL '11 seconds',
      t0 + INTERVAL '40 seconds',
      'attempt-temporal-recovery',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 10000,
        'directEnsureRequestStartedAtEpochMs', base_ms + 10100,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-temporal-recovery'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'direct-owned-pre-runner-temporal-active-wake',
      t0 + INTERVAL '5 seconds',
      t0 + INTERVAL '6 seconds',
      'attempt-direct-causal',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 5000
      ))
    FROM fixture
    UNION ALL
    SELECT
      'temporal-owned-with-direct-wake',
      t0 + INTERVAL '12 seconds',
      t0 + INTERVAL '16 seconds',
      'attempt-temporal-owned-with-direct-wake',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 12000,
        'triggeredByWebDirect', false,
        'directEnsureRequestStartedAtEpochMs', base_ms + 12100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 12300,
        'directEnsureOrchestrationAttemptId', 'web-ingress-temporal-wake',
        'cloudflareRouteReceivedAtEpochMs', base_ms + 12200,
        'freshStartRequestedAtEpochMs', base_ms + 12400
      ))
    FROM fixture
    UNION ALL
    SELECT
      'temporal-owned-with-direct-wake-backlog',
      t0 + INTERVAL '12.5 seconds',
      t0 + INTERVAL '16 seconds',
      'attempt-temporal-owned-with-direct-wake',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 12000,
        'triggeredByWebDirect', false
      ))
    FROM fixture
    UNION ALL
    SELECT
      'temporal-owned-post-runner-active-wake',
      t0 + INTERVAL '17 seconds',
      t0 + INTERVAL '16 seconds',
      'attempt-temporal-owned-with-direct-wake',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 17000,
        'triggeredByWebDirect', false
      ))
    FROM fixture
    UNION ALL
    SELECT
      'temporal-legacy-unclassified',
      t0 + INTERVAL '12 seconds',
      t0 + INTERVAL '17 seconds',
      'attempt-temporal-legacy-unclassified',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 12000,
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 12100
      ))
    FROM fixture
    UNION ALL
    SELECT
      'temporal-conflict-temporal-owner',
      t0 + INTERVAL '13 seconds',
      t0 + INTERVAL '19 seconds',
      'attempt-temporal-conflicting-cohort',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 13000,
        'triggeredByWebDirect', false
      ))
    FROM fixture
    UNION ALL
    SELECT
      'temporal-conflict-direct-owner',
      t0 + INTERVAL '13.5 seconds',
      t0 + INTERVAL '19 seconds',
      'attempt-temporal-conflicting-cohort',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 13000,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-conflict'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'temporal-conflict-single-row',
      t0 + INTERVAL '13.5 seconds',
      t0 + INTERVAL '19 seconds',
      'attempt-temporal-conflict-single-row',
      jsonb_build_object('orchestration', jsonb_build_object(
        'temporalActivityStartedAtEpochMs', base_ms + 13000,
        'triggeredByWebDirect', false,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-conflict-single'
      ))
    FROM fixture;
  `;
}
