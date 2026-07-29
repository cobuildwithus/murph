import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordDedicatedHostedRuntimeLogs: vi.fn(),
  recordLegacyHostedRuntimeLogs: vi.fn(),
}));

vi.mock("@/src/lib/hosted-runtime-log/store", () => ({
  recordHostedRuntimeLogs: mocks.recordDedicatedHostedRuntimeLogs,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  recordHostedRuntimeLogs: mocks.recordLegacyHostedRuntimeLogs,
}));

import {
  HOSTED_RUNTIME_LOG_DATABASE_ENDPOINTS_MUST_MATCH_MESSAGE,
  HOSTED_RUNTIME_LOG_DATABASE_MUST_BE_DEDICATED_MESSAGE,
  HOSTED_RUNTIME_LOG_DATABASE_URL_REQUIRED_MESSAGE,
  HOSTED_RUNTIME_LOG_STORAGE_MODE_REQUIRED_MESSAGE,
  isHostedRuntimeLogDatabaseConfigured,
  readHostedRuntimeLogStorageMode,
} from "@/src/lib/hosted-runtime-log/database";
import {
  writeHostedRuntimeLogs,
} from "@/src/lib/hosted-runtime-log/write";

describe("hosted runtime log write routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.recordDedicatedHostedRuntimeLogs.mockResolvedValue(1);
    mocks.recordLegacyHostedRuntimeLogs.mockResolvedValue(1);
  });

  it("requires explicit isolated storage configuration in production", () => {
    expect(() => readHostedRuntimeLogStorageMode({
      NODE_ENV: "test",
      VERCEL_ENV: "production",
    })).toThrow(HOSTED_RUNTIME_LOG_STORAGE_MODE_REQUIRED_MESSAGE);

    expect(() => isHostedRuntimeLogDatabaseConfigured({
      HOSTED_RUNTIME_LOG_STORAGE: "primary",
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
    })).toThrow(HOSTED_RUNTIME_LOG_DATABASE_MUST_BE_DEDICATED_MESSAGE);
  });

  it("writes only to the selected owner", async () => {
    vi.stubEnv("HOSTED_RUNTIME_LOG_STORAGE", "primary");
    await expect(writeHostedRuntimeLogs(runtimeLogBatch())).resolves.toBe(1);
    expect(mocks.recordLegacyHostedRuntimeLogs).toHaveBeenCalledOnce();
    expect(mocks.recordDedicatedHostedRuntimeLogs).not.toHaveBeenCalled();

    vi.clearAllMocks();
    vi.stubEnv("HOSTED_RUNTIME_LOG_STORAGE", "dedicated");
    vi.stubEnv(
      "HOSTED_RUNTIME_LOG_DATABASE_URL",
      "postgresql://runtime.test:5432/runtime_logs",
    );
    await expect(writeHostedRuntimeLogs(runtimeLogBatch())).resolves.toBe(1);
    expect(mocks.recordDedicatedHostedRuntimeLogs).toHaveBeenCalledOnce();
    expect(mocks.recordLegacyHostedRuntimeLogs).not.toHaveBeenCalled();
  });

  it("never falls back to primary after an isolated write failure", async () => {
    vi.stubEnv("HOSTED_RUNTIME_LOG_STORAGE", "dedicated");
    vi.stubEnv(
      "HOSTED_RUNTIME_LOG_DATABASE_URL",
      "postgresql://runtime.test:5432/runtime_logs",
    );
    mocks.recordDedicatedHostedRuntimeLogs.mockRejectedValueOnce(
      new Error("isolated database unavailable"),
    );

    await expect(writeHostedRuntimeLogs(runtimeLogBatch())).rejects.toThrow(
      "isolated database unavailable",
    );
    expect(mocks.recordLegacyHostedRuntimeLogs).not.toHaveBeenCalled();
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
