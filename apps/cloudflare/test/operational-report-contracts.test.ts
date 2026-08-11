import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA,
} from "../src/user-runner/runtime-processing-responses.ts";

const execFileAsync = promisify(execFile);
const coldStartReportPath = fileURLToPath(
  new URL("../scripts/cold-start-latency-report.sql", import.meta.url),
);
const coldStartReportSql = readFileSync(coldStartReportPath, "utf8");
const retryReasonsSql = readFileSync(
  new URL("../scripts/runtime-retry-reasons.sql", import.meta.url),
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
  it("keeps the retry query aligned with the emitted Analytics Engine point", () => {
    expect(retryReasonsSql).toContain(
      `blob1 = '${HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA}'`,
    );
    expect(retryReasonsSql).toContain("index1 AS reason");
    expect(retryReasonsSql).toContain("SUM(_sample_interval * double1)");
    expect(retryReasonsSql).toContain("SUM(_sample_interval * double2)");
    expect(retryReasonsSql).toContain("INTERVAL '1' DAY");
  });

  it("keeps direct cold starts causal and phase samples chronology-safe", () => {
    expect(coldStartReportSql).toContain(
      "PARTITION BY runtime_attempt_id",
    );
    expect(coldStartReportSql).toContain("causal_candidate_count = 1");
    expect(coldStartReportSql).toContain(
      "directEnsureResponseReceivedAtEpochMs",
    );
    expect(coldStartReportSql).toContain(
      "direct_orchestration_attempt_id = runtime_orchestration_attempt_id",
    );
    expect(coldStartReportSql).not.toContain("abs(route_received_ms");
    expect(coldStartReportSql).toContain(
      "runner_job_accepted_at >= accepted_at",
    );
    expect(coldStartReportSql).toContain("stamp_candidate_count = 1");
    expect(coldStartReportSql).toContain(
      "WHERE runner_job_accepted_ms >= activity_started_ms",
    );
    expect(coldStartReportSql).toContain("AND cohort IS NOT NULL");
    expect(coldStartReportSql).toContain("ELSE NULL");
    expect(coldStartReportSql).toContain("SELECT DISTINCT\n    runtime_attempt_id");
    expect(coldStartReportSql).toContain("WHERE phase.duration_ms >= 0");
    expect(coldStartReportSql).toContain("'web_direct_cold'");
    expect(coldStartReportSql).toContain("'temporal_recovery'");
    expect(coldStartReportSql).toContain("'legacy_unclassified'");
    expect(coldStartReportSql).toContain(
      "triggeredByWebDirect}' = 'false'",
    );
    expect(coldStartReportSql).not.toContain("web_direct_existing_runtime");
    expect(coldStartReportSql).toContain(
      "GREATEST(fresh_start_container_ready_ms, fresh_start_invocation_prepared_ms)",
    );
    expect(coldStartReportSql).toContain("shellPrewarmSource}' = 'linq-typing-started'");
    expect(coldStartReportSql).toContain(
      "trace.reply_runtime_attempt_id = trace.runtime_attempt_id",
    );
    expect(coldStartReportSql).toContain("causal_candidate_count = 1");
    expect(coldStartReportSql).toContain("Causal typing hint -> ingress accepted");
    expect(coldStartReportSql).not.toContain("shellPrewarmLastHintAtEpochMs");
  });
});

describe.skipIf(!runPostgresProof)(
  "hosted runtime cold-start report PostgreSQL fixture",
  () => {
    it("selects one causal direct row and omits ambiguous, missing, or invalid samples", async () => {
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
        expect(stdout).toContain("web_direct_cold,2,6.000,6.900,7.000");
        expect(stdout).not.toContain("web_direct_existing_runtime");
        expect(stdout).toContain(
          "Cloudflare route -> UserRunner RPC,1,100.0,100.0,100.0",
        );
        expect(stdout).toContain(
          "Health-data admission callback,1,100.0,100.0,100.0",
        );
        expect(stdout).toContain(
          "Accepted -> runner job,2,6000.0,6900.0,7000.0",
        );
      } finally {
        await runPsql(connection, [
          "--quiet",
          "--command",
          `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
        ]);
      }
    });

    it("attributes typing prewarm metrics to one causal trace and excludes ambiguous sources", async () => {
      const connection = readLocalPostgresConnection(databaseUrl);
      if (!connection) {
        throw new Error("Expected a validated local PostgreSQL connection.");
      }
      const schemaName = `typing_prewarm_report_${randomUUID().replaceAll("-", "")}`;

      try {
        const { stdout } = await runPsql(connection, [
          "--quiet",
          "--command",
          createShellPrewarmFixtureSql(schemaName),
          "--command",
          `SET search_path TO "${schemaName}"`,
          "--csv",
          "--set",
          "window_hours=24",
          "--file",
          coldStartReportPath,
        ]);

        expect(stdout).toContain(
          "prewarm_cold_start_observed,Causal typing hint -> ingress accepted,1,500.0,500.0,500.0",
        );
        expect(stdout).toContain(
          "prewarm_cold_start_observed,Ingress accepted -> runner job,1,1000.0,1000.0,1000.0",
        );
        expect(stdout).toContain(
          "prewarm_cold_start_observed,Ingress accepted -> provider start,1,2000.0,2000.0,2000.0",
        );
        expect(stdout).toContain(
          "prewarm_cold_start_observed,Ingress accepted -> reply accepted,1,3000.0,3000.0,3000.0",
        );
        expect(stdout).toContain(
          "no_observed_prewarm,Ingress accepted -> reply accepted,1,4000.0,4000.0,4000.0",
        );
        expect(stdout).not.toContain("prewarm_failed,");
        expect(stdout).not.toContain("prewarm_start_issued_warm,");
        expect(stdout).not.toContain("prewarm_superseded,");
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

function createShellPrewarmFixtureSql(schemaName: string): string {
  return `
    CREATE SCHEMA "${schemaName}";
    SET search_path TO "${schemaName}";
    CREATE TABLE hosted_ingress_latency_trace (
      id TEXT PRIMARY KEY,
      accepted_at TIMESTAMP(3) NOT NULL,
      runner_job_accepted_at TIMESTAMP(3),
      provider_start_at TIMESTAMP(3),
      runtime_attempt_id TEXT,
      reply_runtime_attempt_id TEXT,
      linq_delivery_id TEXT,
      source TEXT NOT NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      phase_breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE hosted_linq_delivery (
      id TEXT PRIMARY KEY,
      accepted_at TIMESTAMP(3)
    );
    WITH clock AS (
      SELECT date_trunc(
        'milliseconds',
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '10 minutes'
      ) AS t0
    )
    INSERT INTO hosted_linq_delivery (id, accepted_at)
    SELECT 'delivery-backlog', t0 + INTERVAL '11 seconds' FROM clock
    UNION ALL SELECT 'delivery-cold', t0 + INTERVAL '4 seconds' FROM clock
    UNION ALL SELECT 'delivery-baseline', t0 + INTERVAL '14 seconds' FROM clock
    UNION ALL SELECT 'delivery-ambiguous-a', t0 + INTERVAL '24 seconds' FROM clock
    UNION ALL SELECT 'delivery-ambiguous-b', t0 + INTERVAL '25 seconds' FROM clock
    UNION ALL SELECT 'delivery-handoff', t0 + INTERVAL '34 seconds' FROM clock
    UNION ALL SELECT 'delivery-instant', t0 + INTERVAL '44 seconds' FROM clock
    UNION ALL SELECT 'delivery-unknown', t0 + INTERVAL '54 seconds' FROM clock
    UNION ALL SELECT 'delivery-negative', t0 + INTERVAL '64 seconds' FROM clock;
    WITH clock AS (
      SELECT
        date_trunc(
          'milliseconds',
          (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '10 minutes'
        ) AS t0
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
      provider_start_at,
      runtime_attempt_id,
      reply_runtime_attempt_id,
      linq_delivery_id,
      source,
      phase_breakdown_json
    )
    SELECT
      'typing-backlog',
      t0,
      t0 + INTERVAL '9 seconds',
      t0 + INTERVAL '10 seconds',
      'attempt-cold',
      'attempt-cold',
      'delivery-backlog',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'freshStartRequestedAtEpochMs', base_ms + 100
      ))
    FROM fixture
    UNION ALL
    SELECT
      'typing-cold-causal',
      t0 + INTERVAL '1 second',
      t0 + INTERVAL '2 seconds',
      t0 + INTERVAL '3 seconds',
      'attempt-cold',
      'attempt-cold',
      'delivery-cold',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 1100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 1200,
        'directEnsureOrchestrationAttemptId', 'web-ingress-cold',
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-cold',
        'freshStartRequestedAtEpochMs', base_ms + 1300,
        'shellPrewarmFirstHintAtEpochMs', base_ms + 500,
        'shellPrewarmHintCount', 3,
        'shellPrewarmOutcome', 'cold_start_observed',
        'shellPrewarmSource', 'linq-typing-started'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'no-prewarm-causal',
      t0 + INTERVAL '10 seconds',
      t0 + INTERVAL '12 seconds',
      t0 + INTERVAL '13 seconds',
      'attempt-baseline',
      'attempt-baseline',
      'delivery-baseline',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 10100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 10200,
        'directEnsureOrchestrationAttemptId', 'web-ingress-baseline',
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-baseline',
        'freshStartRequestedAtEpochMs', base_ms + 10300
      ))
    FROM fixture
    UNION ALL
    SELECT
      'typing-ambiguous-a',
      t0 + INTERVAL '20 seconds',
      t0 + INTERVAL '22 seconds',
      t0 + INTERVAL '23 seconds',
      'attempt-ambiguous',
      'attempt-ambiguous',
      'delivery-ambiguous-a',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 20100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 20200,
        'directEnsureOrchestrationAttemptId', 'web-ingress-ambiguous',
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-ambiguous',
        'freshStartRequestedAtEpochMs', base_ms + 20300,
        'shellPrewarmFirstHintAtEpochMs', base_ms + 19500,
        'shellPrewarmOutcome', 'failed',
        'shellPrewarmSource', 'linq-typing-started'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'typing-ambiguous-b',
      t0 + INTERVAL '21 seconds',
      t0 + INTERVAL '23 seconds',
      t0 + INTERVAL '24 seconds',
      'attempt-ambiguous',
      'attempt-ambiguous',
      'delivery-ambiguous-b',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 21100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 21200,
        'directEnsureOrchestrationAttemptId', 'web-ingress-ambiguous',
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-ambiguous',
        'freshStartRequestedAtEpochMs', base_ms + 21300,
        'shellPrewarmFirstHintAtEpochMs', base_ms + 19500,
        'shellPrewarmOutcome', 'failed',
        'shellPrewarmSource', 'linq-typing-started'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'typing-handoff',
      t0 + INTERVAL '30 seconds',
      t0 + INTERVAL '32 seconds',
      t0 + INTERVAL '33 seconds',
      'attempt-handoff-origin',
      'attempt-handoff-reply',
      'delivery-handoff',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 30100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 30200,
        'directEnsureOrchestrationAttemptId', 'web-ingress-handoff',
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-handoff',
        'freshStartRequestedAtEpochMs', base_ms + 30300,
        'shellPrewarmFirstHintAtEpochMs', base_ms + 29500,
        'shellPrewarmOutcome', 'superseded',
        'shellPrewarmSource', 'linq-typing-started'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'instant-start',
      t0 + INTERVAL '40 seconds',
      t0 + INTERVAL '42 seconds',
      t0 + INTERVAL '43 seconds',
      'attempt-instant',
      'attempt-instant',
      'delivery-instant',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 40100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 40200,
        'directEnsureOrchestrationAttemptId', 'web-ingress-instant',
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-instant',
        'freshStartRequestedAtEpochMs', base_ms + 40300,
        'shellPrewarmFirstHintAtEpochMs', base_ms + 39500,
        'shellPrewarmOutcome', 'start_issued_warm',
        'shellPrewarmSource', 'linq-instant-start'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'legacy-unknown-source',
      t0 + INTERVAL '50 seconds',
      t0 + INTERVAL '52 seconds',
      t0 + INTERVAL '53 seconds',
      'attempt-unknown',
      'attempt-unknown',
      'delivery-unknown',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 50100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 50200,
        'directEnsureOrchestrationAttemptId', 'web-ingress-unknown',
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-unknown',
        'freshStartRequestedAtEpochMs', base_ms + 50300,
        'shellPrewarmFirstHintAtEpochMs', base_ms + 49500,
        'shellPrewarmOutcome', 'start_issued_warm',
        'shellPrewarmSource', 'unknown'
      ))
    FROM fixture
    UNION ALL
    SELECT
      'typing-negative-chronology',
      t0 + INTERVAL '60 seconds',
      t0 + INTERVAL '62 seconds',
      t0 + INTERVAL '63 seconds',
      'attempt-negative',
      'attempt-negative',
      'delivery-negative',
      'linq',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 60100,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 60200,
        'directEnsureOrchestrationAttemptId', 'web-ingress-negative',
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-negative',
        'freshStartRequestedAtEpochMs', base_ms + 60300,
        'shellPrewarmFirstHintAtEpochMs', base_ms + 60500,
        'shellPrewarmOutcome', 'cold_start_observed',
        'shellPrewarmSource', 'linq-typing-started'
      ))
    FROM fixture;
  `;
}

function createFixtureSql(schemaName: string): string {
  return `
    CREATE SCHEMA "${schemaName}";
    SET search_path TO "${schemaName}";
    CREATE TABLE hosted_ingress_latency_trace (
      id TEXT PRIMARY KEY,
      accepted_at TIMESTAMP(3) NOT NULL,
      runner_job_accepted_at TIMESTAMP(3),
      provider_start_at TIMESTAMP(3),
      runtime_attempt_id TEXT,
      reply_runtime_attempt_id TEXT,
      linq_delivery_id TEXT,
      source TEXT NOT NULL DEFAULT 'fixture',
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      phase_breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE hosted_linq_delivery (
      id TEXT PRIMARY KEY,
      accepted_at TIMESTAMP(3)
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
      'direct-backlog',
      t0,
      t0 + INTERVAL '6 seconds',
      'attempt-direct-causal',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 1500,
        'cloudflareRouteReceivedAtEpochMs', base_ms + 1600,
        'freshStartRequestedAtEpochMs', base_ms + 2000
      ))
    FROM fixture
    UNION ALL
    SELECT
      'direct-causal',
      t0 + INTERVAL '1 second',
      t0 + INTERVAL '6 seconds',
      'attempt-direct-causal',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 1500,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 1700,
        'directEnsureOrchestrationAttemptId', 'web-ingress-causal',
        'cloudflareRouteReceivedAtEpochMs', base_ms + 1600,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-causal',
        'userRunnerRpcStartedAtEpochMs', base_ms + 1700,
        'runtimeConsentLockAcquiredAtEpochMs', base_ms + 1800,
        'healthDataAdmissionReadStartedAtEpochMs', base_ms + 1810,
        'healthDataAdmissionReadFinishedAtEpochMs', base_ms + 1910,
        'userRunnerEnsureStartedAtEpochMs', base_ms + 1920,
        'runnerStateBindStartedAtEpochMs', base_ms + 1930,
        'runnerStateBindFinishedAtEpochMs', base_ms + 2030,
        'runnerStateReadStartedAtEpochMs', base_ms + 2040,
        'runnerStateReadFinishedAtEpochMs', base_ms + 2140,
        'freshStartRequestedAtEpochMs', base_ms + 2240,
        'freshStartFenceBoundAtEpochMs', base_ms + 2250,
        'freshStartContainerReadyAtEpochMs', base_ms + 4250,
        'freshStartInvocationPreparedAtEpochMs', base_ms + 3250,
        'freshStartInvocationAcceptedAtEpochMs', base_ms + 4250
      ))
    FROM fixture
    UNION ALL
    SELECT
      'direct-reversed-phase',
      t0 + INTERVAL '2 seconds',
      t0 + INTERVAL '9 seconds',
      'attempt-direct-reversed',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 2500,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 2700,
        'directEnsureOrchestrationAttemptId', 'web-ingress-reversed',
        'cloudflareRouteReceivedAtEpochMs', base_ms + 2600,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-reversed',
        'userRunnerRpcStartedAtEpochMs', base_ms + 2550,
        'freshStartRequestedAtEpochMs', base_ms + 2800
      ))
    FROM fixture
    UNION ALL
    SELECT
      'direct-inherited-invocation-mismatch',
      t0 + INTERVAL '3 seconds',
      t0 + INTERVAL '10 seconds',
      'attempt-direct-inherited',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 3500,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 3700,
        'directEnsureOrchestrationAttemptId', 'web-ingress-later-b',
        'cloudflareRouteReceivedAtEpochMs', base_ms + 3600,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-earlier-a',
        'freshStartRequestedAtEpochMs', base_ms + 3800
      ))
    FROM fixture
    UNION ALL
    SELECT
      'direct-missing-phases',
      t0 + INTERVAL '4 seconds',
      t0 + INTERVAL '13 seconds',
      'attempt-direct-missing',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'freshStartRequestedAtEpochMs', base_ms + 4200
      ))
    FROM fixture
    UNION ALL
    SELECT
      'direct-existing-runtime',
      t0 + INTERVAL '6 seconds',
      t0 + INTERVAL '5 seconds',
      'attempt-direct-existing',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 6500,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 6700,
        'cloudflareRouteReceivedAtEpochMs', base_ms + 6600
      ))
    FROM fixture
    UNION ALL
    SELECT
      'direct-race-one',
      t0 + INTERVAL '7 seconds',
      t0 + INTERVAL '14 seconds',
      'attempt-direct-race',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 7500,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 7700,
        'directEnsureOrchestrationAttemptId', 'web-ingress-race',
        'cloudflareRouteReceivedAtEpochMs', base_ms + 7600,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-race',
        'freshStartRequestedAtEpochMs', base_ms + 7800
      ))
    FROM fixture
    UNION ALL
    SELECT
      'direct-race-two',
      t0 + INTERVAL '8 seconds',
      t0 + INTERVAL '14 seconds',
      'attempt-direct-race',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 8500,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 8700,
        'directEnsureOrchestrationAttemptId', 'web-ingress-race',
        'cloudflareRouteReceivedAtEpochMs', base_ms + 8600,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-race',
        'freshStartRequestedAtEpochMs', base_ms + 8800
      ))
    FROM fixture
    UNION ALL
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
    FROM fixture
    UNION ALL
    SELECT
      'unclassified',
      t0 + INTERVAL '13 seconds',
      t0 + INTERVAL '19 seconds',
      'attempt-unclassified',
      '{"orchestration":{}}'::jsonb
    FROM fixture
    UNION ALL
    SELECT
      'invalid-chronology',
      t0 + INTERVAL '14 seconds',
      t0 + INTERVAL '13 seconds',
      'attempt-invalid',
      jsonb_build_object('orchestration', jsonb_build_object(
        'triggeredByWebDirect', true,
        'directEnsureRequestStartedAtEpochMs', base_ms + 14500,
        'directEnsureResponseReceivedAtEpochMs', base_ms + 14700,
        'directEnsureOrchestrationAttemptId', 'web-ingress-invalid',
        'cloudflareRouteReceivedAtEpochMs', base_ms + 14600,
        'runtimeInvocationOrchestrationAttemptId', 'web-ingress-invalid',
        'freshStartRequestedAtEpochMs', base_ms + 14800
      ))
    FROM fixture
    UNION ALL
    SELECT
      'missing-runner-job',
      t0 + INTERVAL '16 seconds',
      NULL,
      'attempt-missing-runner-job',
      '{"orchestration":{}}'::jsonb
    FROM fixture;
  `;
}
