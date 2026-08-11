import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordHostedRuntimeLogs: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runtime-log/store", () => ({
  recordHostedRuntimeLogs: mocks.recordHostedRuntimeLogs,
}));

import {
  HOSTED_RUNTIME_LOG_DATABASE_ENDPOINTS_MUST_MATCH_MESSAGE,
  HOSTED_RUNTIME_LOG_DATABASE_MUST_NOT_ALIAS_PRIMARY_MESSAGE,
  HOSTED_RUNTIME_LOG_DATABASE_URL_REQUIRED_MESSAGE,
  getHostedRuntimeLogPool,
  isHostedRuntimeLogDatabaseConfigured,
} from "@/src/lib/hosted-runtime-log/database";
import {
  writeHostedRuntimeLogs,
} from "@/src/lib/hosted-runtime-log/write";

describe("hosted runtime log write routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.recordHostedRuntimeLogs.mockResolvedValue(1);
  });

  it("requires isolated storage configuration in production", () => {
    expect(() => isHostedRuntimeLogDatabaseConfigured({
      NODE_ENV: "test",
      VERCEL_ENV: "production",
    })).toThrow(HOSTED_RUNTIME_LOG_DATABASE_URL_REQUIRED_MESSAGE);
  });

  it("rejects mismatched isolated endpoints and exact primary aliases", () => {
    expect(() => isHostedRuntimeLogDatabaseConfigured({
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://runtime-pool.test:6543/runtime_logs",
      HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL:
        "postgresql://runtime-direct.test:5432/other_logs",
      NODE_ENV: "test",
    })).toThrow(HOSTED_RUNTIME_LOG_DATABASE_ENDPOINTS_MUST_MATCH_MESSAGE);

    expect(() => isHostedRuntimeLogDatabaseConfigured({
      DATABASE_URL: "postgresql://app:one@database.test:5432/primary",
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://logs:two@database.test:5432/primary",
      NODE_ENV: "test",
    })).toThrow(HOSTED_RUNTIME_LOG_DATABASE_MUST_NOT_ALIAS_PRIMARY_MESSAGE);
  });

  it("returns zero without writing when the dedicated database is unconfigured", async () => {
    await expect(writeHostedRuntimeLogs(runtimeLogBatch())).resolves.toBe(0);
    expect(mocks.recordHostedRuntimeLogs).not.toHaveBeenCalled();
  });

  it("writes to the dedicated store when configured", async () => {
    vi.stubEnv(
      "HOSTED_RUNTIME_LOG_DATABASE_URL",
      "postgresql://runtime.test:5432/runtime_logs",
    );

    const input = runtimeLogBatch();
    await expect(writeHostedRuntimeLogs(input)).resolves.toBe(1);
    expect(mocks.recordHostedRuntimeLogs).toHaveBeenCalledWith(input);
  });

  it("keeps dedicated write failures visible", async () => {
    vi.stubEnv(
      "HOSTED_RUNTIME_LOG_DATABASE_URL",
      "postgresql://runtime.test:5432/runtime_logs",
    );
    mocks.recordHostedRuntimeLogs.mockRejectedValueOnce(
      new Error("isolated database unavailable"),
    );

    await expect(writeHostedRuntimeLogs(runtimeLogBatch())).rejects.toThrow(
      "isolated database unavailable",
    );
  });

  it("keeps PgBouncer startup parameters free of statement_timeout", async () => {
    vi.stubEnv(
      "HOSTED_RUNTIME_LOG_DATABASE_URL",
      "postgresql://runtime.test:6432/runtime_logs",
    );

    const pool = getHostedRuntimeLogPool();
    const options = Reflect.get(pool, "options");

    expect(options).toMatchObject({
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      max: 5,
      query_timeout: 12_000,
    });
    expect(options).not.toHaveProperty("statement_timeout");
    await pool.end();
  });
});

function runtimeLogBatch() {
  return {
    entries: [{
      at: "2026-07-29T00:00:00.000Z",
      component: "mailbox" as const,
      eventCode: "mailbox.imported" as const,
      level: "info" as const,
      phase: "import" as const,
    }],
    userId: "member_runtime_log_write_1",
  };
}
