import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  hostedRuntimeLogMigrateDeployCommand,
  resolveHostedRuntimeLogMigrationDatabaseUrl,
  runHostedRuntimeLogMigrateDeploy,
  verifyHostedRuntimeLogDatabaseEndpoints,
  type HostedRuntimeLogEndpointProbeClient,
  type HostedRuntimeLogEndpointProbeResult,
} from "../scripts/run-runtime-log-migrate-deploy";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("hosted runtime log database migration", () => {
  it("requires the pooled runtime endpoint for production", () => {
    expect(() => resolveHostedRuntimeLogMigrationDatabaseUrl({
      HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL:
        "postgresql://logs.example.test:5432/runtime_logs",
      VERCEL_ENV: "production",
    })).toThrow(/HOSTED_RUNTIME_LOG_DATABASE_URL is required/u);
  });

  it("requires a direct endpoint for production", () => {
    expect(() => resolveHostedRuntimeLogMigrationDatabaseUrl({
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://logs.example.test:5432/runtime_logs",
      VERCEL_ENV: "production",
    })).toThrow(/HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL is required/u);
  });

  it("requires the primary direct endpoint for production topology proof", () => {
    expect(() => resolveHostedRuntimeLogMigrationDatabaseUrl({
      DATABASE_URL: "postgresql://primary-pool.example.test:6543/murph",
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://logs-pool.example.test:6543/runtime_logs",
      HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL:
        "postgresql://logs-direct.example.test:5432/runtime_logs",
      VERCEL_ENV: "production",
    })).toThrow(/DIRECT_DATABASE_URL is required/u);
  });

  it("rejects runtime and direct endpoints that name different databases", () => {
    expect(() => resolveHostedRuntimeLogMigrationDatabaseUrl({
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://logs@logs-pool.example.test:6543/runtime_logs",
      HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL:
        "postgresql://logs@logs-direct.example.test:5432/other_runtime_logs",
    })).toThrow(/must name the same database/u);
  });

  it("rejects primary-database aliases and known pooler ports", () => {
    expect(() => resolveHostedRuntimeLogMigrationDatabaseUrl({
      DATABASE_URL: "postgresql://app:one@db.example.test:5432/murph",
      HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL:
        "postgresql://app:two@db.example.test:5432/murph?sslmode=require",
    })).toThrow(/must be distinct from DATABASE_URL/u);

    expect(() => resolveHostedRuntimeLogMigrationDatabaseUrl({
      DATABASE_URL: "postgresql://app@primary-pool.example.test:6543/murph",
      DIRECT_DATABASE_URL:
        "postgresql://app@primary-direct.example.test:5432/murph",
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://logs@logs-pool.example.test:6543/murph",
      HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL:
        "postgresql://logs@primary-direct.example.test:5432/murph",
    })).toThrow(/must be distinct from DATABASE_URL/u);

    expect(() => resolveHostedRuntimeLogMigrationDatabaseUrl({
      HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL:
        "postgresql://logs.example.test:6432/runtime_logs",
    })).toThrow(/known pooled Postgres port 6432/u);
  });

  it("verifies ownership before invoking the dedicated Prisma migration lane", async () => {
    const events: string[] = [];
    const calls: Array<{
      args: readonly string[];
      command: string;
      directUrl: string | undefined;
    }> = [];

    await runHostedRuntimeLogMigrateDeploy(
      {
        DATABASE_URL: "postgresql://primary.example.test:5432/murph",
        DIRECT_DATABASE_URL:
          "postgresql://primary.example.test:5432/murph",
        HOSTED_RUNTIME_LOG_DATABASE_URL:
          "postgresql://logs-pool.example.test:5432/runtime_logs",
        HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL:
          "postgresql://logs-direct.example.test:5432/runtime_logs",
        VERCEL_ENV: "production",
      },
      async (command, args, environment) => {
        events.push("run");
        calls.push({
          args,
          command,
          directUrl: environment.HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL,
        });
      },
      {
        async verifyDatabaseEndpoints(input) {
          events.push("endpoints");
          expect(input).toEqual({
            directDatabaseUrl:
              "postgresql://logs-direct.example.test:5432/runtime_logs",
            primaryDirectDatabaseUrl:
              "postgresql://primary.example.test:5432/murph",
            runtimeDatabaseUrl:
              "postgresql://logs-pool.example.test:5432/runtime_logs",
          });
        },
        async verifyMigrationOwner(databaseUrl) {
          events.push("verify");
          expect(databaseUrl).toContain("role%3Dpostgres");
        },
      },
    );

    expect(events).toEqual(["endpoints", "verify", "run"]);
    expect(calls).toEqual([{
      args: hostedRuntimeLogMigrateDeployCommand.args,
      command: hostedRuntimeLogMigrateDeployCommand.command,
      directUrl: expect.stringContaining("role%3Dpostgres"),
    }]);
  });

  it("proves pooled/direct identity and physical primary isolation", async () => {
    const clients = [
      new RuntimeLogProbeClient(),
      new RuntimeLogProbeClient(false),
      new RuntimeLogProbeClient(undefined, "222"),
      new RuntimeLogProbeClient(undefined, "111"),
    ];
    const createdUrls: string[] = [];

    await expect(verifyHostedRuntimeLogDatabaseEndpoints({
      directDatabaseUrl: "postgresql://logs-direct.test/runtime_logs",
      primaryDirectDatabaseUrl: "postgresql://primary.test/murph",
      runtimeDatabaseUrl: "postgresql://logs-pool.test/runtime_logs",
    }, (databaseUrl) => {
      createdUrls.push(databaseUrl);
      const client = clients.shift();
      if (!client) {
        throw new Error("Unexpected runtime-log topology probe client.");
      }
      return client;
    })).resolves.toBeUndefined();

    expect(createdUrls).toEqual([
      "postgresql://logs-pool.test/runtime_logs",
      "postgresql://logs-direct.test/runtime_logs",
      "postgresql://logs-direct.test/runtime_logs",
      "postgresql://primary.test/murph",
    ]);
    expect(clients).toHaveLength(0);
  });

  it("rejects split pooled/direct endpoints and shared physical clusters", async () => {
    await expect(verifyHostedRuntimeLogDatabaseEndpoints({
      directDatabaseUrl: "postgresql://logs-direct.test/runtime_logs",
      primaryDirectDatabaseUrl: "postgresql://primary.test/murph",
      runtimeDatabaseUrl: "postgresql://logs-pool.test/runtime_logs",
    }, createRuntimeLogProbeClientFactory([undefined, true]))).rejects.toThrow(
      /did not resolve to the same PostgreSQL database/u,
    );

    await expect(verifyHostedRuntimeLogDatabaseEndpoints({
      directDatabaseUrl: "postgresql://logs-direct.test/runtime_logs",
      primaryDirectDatabaseUrl: "postgresql://primary-direct.test/murph",
      runtimeDatabaseUrl: "postgresql://logs-pool.test/runtime_logs",
    }, createRuntimeLogProbeClientFactory([
      undefined,
      false,
      { systemIdentifier: "111" },
      { systemIdentifier: "111" },
    ]))).rejects.toThrow(/same PostgreSQL cluster as DIRECT_DATABASE_URL/u);
  });

  it("requires a bounded server-side timeout on the pooled runtime role", async () => {
    const clients = [
      new RuntimeLogProbeClient(undefined, undefined, false),
      new RuntimeLogProbeClient(),
    ];

    await expect(verifyHostedRuntimeLogDatabaseEndpoints({
      directDatabaseUrl: "postgresql://logs-direct.test/runtime_logs",
      primaryDirectDatabaseUrl: "postgresql://primary-direct.test/murph",
      runtimeDatabaseUrl: "postgresql://logs-pool.test/runtime_logs",
    }, () => {
      const client = clients.shift();
      if (!client) {
        throw new Error("Unexpected runtime-log topology probe client.");
      }
      return client;
    })).rejects.toThrow(
      /statement_timeout set to a positive value no greater than 10 seconds/u,
    );
  });

  it("fails closed when PostgreSQL cannot prove the cluster identity", async () => {
    await expect(verifyHostedRuntimeLogDatabaseEndpoints({
      directDatabaseUrl: "postgresql://logs-direct.test/runtime_logs",
      primaryDirectDatabaseUrl: "postgresql://primary-direct.test/murph",
      runtimeDatabaseUrl: "postgresql://logs-pool.test/runtime_logs",
    }, createRuntimeLogProbeClientFactory([
      undefined,
      false,
      { systemIdentifier: "" },
    ]))).rejects.toThrow(/cluster identity probe returned an invalid/u);
  });

  it("keeps the diagnostic schema isolated and free of raw member ids", async () => {
    const [schema, primarySchema, migration, cleanupMigration, contractMigration] =
      await Promise.all([
      readFile(path.join(appRoot, "prisma/runtime-logs/schema.prisma"), "utf8"),
      readFile(path.join(appRoot, "prisma/schema.prisma"), "utf8"),
      readFile(path.join(
        appRoot,
        "prisma/runtime-logs/migrations/20260729000000_init/migration.sql",
      ), "utf8"),
      readFile(path.join(
        appRoot,
        "prisma/migrations/20260729010000_hosted_account_cleanup_runtime_logs/migration.sql",
      ), "utf8"),
      readFile(path.join(
        appRoot,
        "prisma/contract-migrations/20260807162546_drop_hosted_runtime_log_after_drain/migration.sql",
      ), "utf8"),
    ]);

    expect(schema).toContain("model HostedRuntimeLog");
    expect(schema).not.toContain("model HostedRuntimeLogSubject");
    expect(schema).toContain("subjectKey");
    expect(schema).not.toContain("userId");
    expect(primarySchema).not.toContain("model HostedRuntimeLog {");
    expect(primarySchema).not.toContain("hostedRuntimeLogs");
    expect(migration).not.toContain('CREATE TABLE "hosted_runtime_log_subject"');
    expect(migration).toContain('CREATE TABLE "hosted_runtime_log"');
    expect(migration).toContain('"subject_key" TEXT NOT NULL');
    expect(migration).not.toContain('"user_id"');
    expect(migration).not.toContain('REFERENCES "hosted_member"');
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration.match(/CREATE INDEX/gu)).toHaveLength(3);
    expect(cleanupMigration).toContain(
      'ADD COLUMN "runtime_logs_completed_at" TIMESTAMP(3);',
    );
    expect(cleanupMigration).not.toContain(
      'runtime_logs_completed_at" TIMESTAMP(3) DEFAULT',
    );
    expect(cleanupMigration).toContain(
      'CREATE TRIGGER "hosted_account_deletion_cleanup_runtime_logs_delete_guard"',
    );
    expect(cleanupMigration).toContain(
      'IF OLD."runtime_logs_completed_at" IS NULL THEN',
    );
    expect(contractMigration.trim()).toBe(
      'DROP TABLE IF EXISTS "hosted_runtime_log";',
    );
  });

  it("routes live Web producers through the new owner and keeps device-sync apply and hot status reads log-free", async () => {
    const repoRoot = path.resolve(appRoot, "../..");
    const [
      callbackRoute,
      computerLog,
      deviceAuthority,
      workspaceStore,
      mailboxStore,
      runner,
    ] =
      await Promise.all([
        readFile(path.join(
          appRoot,
          "app/api/internal/hosted-runtime/log/route.ts",
        ), "utf8"),
        readFile(path.join(
          appRoot,
          "src/lib/computer-use/runtime-log.ts",
        ), "utf8"),
        readFile(path.join(
          appRoot,
          "src/lib/device-sync/hosted-runtime-authority.ts",
        ), "utf8"),
        readFile(path.join(
          appRoot,
          "src/lib/hosted-workspace/store.ts",
        ), "utf8"),
        readFile(path.join(
          appRoot,
          "src/lib/hosted-mailbox/store.ts",
        ), "utf8"),
        readFile(path.join(
          repoRoot,
          "apps/cloudflare/src/user-runner/hosted-user-runner.ts",
        ), "utf8"),
      ]);

    for (const producer of [callbackRoute, computerLog]) {
      expect(producer).toContain("hosted-runtime-log/write");
      expect(producer).not.toContain("recordHostedRuntimeLogTx");
    }
    expect(deviceAuthority).not.toContain("hosted-runtime-log/write");
    expect(deviceAuthority).not.toContain("device-sync.job_failed");
    expect(workspaceStore).not.toContain(
      "function recordHostedRuntimeLog(",
    );
    expect(workspaceStore).not.toContain(
      "function recordHostedRuntimeLogTx(",
    );
    expect(mailboxStore).not.toContain("recordHostedRuntimeLog");
    expect(mailboxStore).not.toContain('"mailbox.appended"');
    expect(runner.replace(/\s+/gu, " ")).toContain(
      "readHostedRuntimeStatusFromWeb(userId, { logLimit: 0 })",
    );
  });
});

class RuntimeLogProbeClient implements HostedRuntimeLogEndpointProbeClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  private connected = false;

  constructor(
    private readonly tryLockAcquired?: boolean,
    private readonly systemIdentifier?: string,
    private readonly statementTimeoutConfigured = true,
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async end(): Promise<void> {
    this.connected = false;
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<HostedRuntimeLogEndpointProbeResult> {
    if (!this.connected) {
      throw new Error("Runtime-log probe query ran before connect.");
    }
    this.queries.push({ text, values });
    if (text.includes("current_setting('statement_timeout')")) {
      return {
        rows: [{ configured: this.statementTimeoutConfigured }],
      };
    }
    if (text.includes("pg_try_advisory_xact_lock")) {
      if (this.tryLockAcquired === undefined) {
        throw new Error("Runtime-log probe client has no try-lock result.");
      }
      return {
        rows: [{ acquired: this.tryLockAcquired }],
      };
    }
    if (text.includes("pg_control_system")) {
      return {
        rows: [{ systemIdentifier: this.systemIdentifier }],
      };
    }
    return { rows: [] };
  }
}

function createRuntimeLogProbeClientFactory(
  probes: readonly (
    | boolean
    | undefined
    | { systemIdentifier: string }
  )[],
  createdUrls: string[] = [],
): (databaseUrl: string) => HostedRuntimeLogEndpointProbeClient {
  const clients = probes.map((probe) =>
    typeof probe === "object"
      ? new RuntimeLogProbeClient(undefined, probe.systemIdentifier)
      : new RuntimeLogProbeClient(probe)
  );
  return (databaseUrl) => {
    createdUrls.push(databaseUrl);
    const client = clients.shift();
    if (!client) {
      throw new Error("Unexpected runtime-log topology probe client.");
    }
    return client;
  };
}
