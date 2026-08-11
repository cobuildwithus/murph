import { beforeEach, describe, expect, it, vi } from "vitest";

const pgMocks = vi.hoisted(() => {
  const createClient = () => ({
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    query: vi.fn(),
  });
  const client = createClient();
  const queuedClients: ReturnType<typeof createClient>[] = [];
  return {
    client,
    createClient,
    queuedClients,
    Client: vi.fn(function MockClient() {
      return queuedClients.shift() ?? client;
    }),
  };
});

vi.mock("pg", () => {
  const Pool = vi.fn();
  return {
    Client: pgMocks.Client,
    Pool,
    default: {
      Client: pgMocks.Client,
      Pool,
    },
  };
});

import { hostedRuntimeLogSubjectKey } from "@/src/lib/hosted-runtime-log/store";
import {
  ensureHostedRuntimeLogDatabaseForTest,
  listHostedRuntimeLogsForTest,
} from "./support/hosted-web-testkit";

beforeEach(() => {
  pgMocks.Client.mockClear();
  pgMocks.client.connect.mockClear();
  pgMocks.client.end.mockClear();
  pgMocks.client.query.mockReset();
  pgMocks.queuedClients.length = 0;
});

describe("ensureHostedRuntimeLogDatabaseForTest", () => {
  it("creates the dedicated database and applies the tracked SQL migrations", async () => {
    const adminClient = pgMocks.createClient();
    const migrationClient = pgMocks.createClient();
    adminClient.query.mockImplementation(async (text: string) => ({
      rows: text.includes("FROM pg_database") ? [{ exists: false }] : [],
    }));
    migrationClient.query.mockImplementation(async (text: string) => ({
      rows: text.includes("WHERE migration_name = $1") ? [{ exists: false }] : [],
    }));
    pgMocks.queuedClients.push(adminClient, migrationClient);

    await ensureHostedRuntimeLogDatabaseForTest({
      databaseUrl: "postgresql://127.0.0.1:5432/murph_runtime_logs_provision",
    });

    expect(adminClient.query).toHaveBeenCalledWith(
      'CREATE DATABASE "murph_runtime_logs_provision"',
    );
    expect(migrationClient.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE "hosted_runtime_log"'),
    );
    expect(migrationClient.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO \"_murph_e2e_runtime_log_migration\""),
      ["20260729000000_init/migration.sql"],
    );
    expect(adminClient.end).toHaveBeenCalledOnce();
    expect(migrationClient.end).toHaveBeenCalledOnce();
  });
});

describe("listHostedRuntimeLogsForTest", () => {
  it("fails loudly when the dedicated database is not configured", async () => {
    await expect(listHostedRuntimeLogsForTest({
      environment: { NODE_ENV: "test" },
      userId: "member_missing_runtime_logs",
    })).rejects.toThrow("HOSTED_RUNTIME_LOG_DATABASE_URL");

    expect(pgMocks.Client).not.toHaveBeenCalled();
  });

  it("queries the dedicated subject in ascending order with the requested scan window", async () => {
    pgMocks.client.query.mockResolvedValueOnce({
      rows: [
        {
          at: new Date("2026-08-07T13:00:00.000Z"),
          attemptId: "attempt_1",
          component: "runner",
          eventCode: "runner.provider_egress_diagnostic",
          level: "warn",
          phase: "provider_egress",
          redactedJson: { responseStatus: 401 },
        },
      ],
    });

    await expect(listHostedRuntimeLogsForTest({
      environment: {
        HOSTED_RUNTIME_LOG_DATABASE_URL:
          "postgresql://127.0.0.1:5432/murph_runtime_logs_test",
        NODE_ENV: "test",
      },
      fromAt: "2026-08-07T12:00:00.000Z",
      limit: 1_500,
      userId: "member_runtime_logs",
    })).resolves.toEqual([
      {
        at: "2026-08-07T13:00:00.000Z",
        attemptId: "attempt_1",
        component: "runner",
        eventCode: "runner.provider_egress_diagnostic",
        level: "warn",
        phase: "provider_egress",
        redactedJson: { responseStatus: 401 },
      },
    ]);

    expect(pgMocks.Client).toHaveBeenCalledWith({
      connectionString: "postgresql://127.0.0.1:5432/murph_runtime_logs_test",
    });
    expect(pgMocks.client.query).toHaveBeenCalledWith(
      expect.stringMatching(/ORDER BY at ASC, id ASC/u),
      [
        hostedRuntimeLogSubjectKey("member_runtime_logs"),
        new Date("2026-08-07T12:00:00.000Z"),
        1_500,
      ],
    );
    expect(pgMocks.client.end).toHaveBeenCalledOnce();
  });

  it("uses the established default limit and closes the client after query failure", async () => {
    pgMocks.client.query.mockRejectedValueOnce(new Error("runtime-log query failed"));

    await expect(listHostedRuntimeLogsForTest({
      environment: {
        HOSTED_RUNTIME_LOG_DATABASE_URL:
          "postgresql://127.0.0.1:5432/murph_runtime_logs_test",
        NODE_ENV: "test",
      },
      userId: "member_runtime_logs_failure",
    })).rejects.toThrow("runtime-log query failed");

    expect(pgMocks.client.query).toHaveBeenCalledWith(
      expect.any(String),
      [hostedRuntimeLogSubjectKey("member_runtime_logs_failure"), null, 1_000],
    );
    expect(pgMocks.client.end).toHaveBeenCalledOnce();
  });

  it("closes the client when connecting to the dedicated database fails", async () => {
    pgMocks.client.connect.mockRejectedValueOnce(new Error("runtime-log connection failed"));

    await expect(listHostedRuntimeLogsForTest({
      environment: {
        HOSTED_RUNTIME_LOG_DATABASE_URL:
          "postgresql://127.0.0.1:5432/murph_runtime_logs_test",
        NODE_ENV: "test",
      },
      userId: "member_runtime_logs_connect_failure",
    })).rejects.toThrow("runtime-log connection failed");

    expect(pgMocks.client.query).not.toHaveBeenCalled();
    expect(pgMocks.client.end).toHaveBeenCalledOnce();
  });
});
