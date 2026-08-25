import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRuntimeProcessingRetryLater,
  HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA,
} from "../src/user-runner/runtime-processing-responses.ts";

describe("runtime processing retry telemetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps Analytics Engine identifier-free while correlating the structured retry log", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));
    vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const writeDataPoint = vi.fn();

    expect(createRuntimeProcessingRetryLater({
      analytics: { writeDataPoint },
      orchestrationAttemptId: "web-ingress-attempt-test",
      reason: "container_rpc_timeout",
      userId: "member_123",
    })).toEqual({
      kind: "retry_later",
      retryAt: "2026-08-06T12:00:10.000Z",
    });
    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: [HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA, "container_rpc_timeout"],
      doubles: [1, 10_000],
      indexes: ["container_rpc_timeout"],
    });
    const serializedAnalytics = JSON.stringify(writeDataPoint.mock.calls);
    expect(serializedAnalytics).not.toContain("member_123");
    expect(serializedAnalytics).not.toContain("web-ingress-attempt-test");

    const structuredLog = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      details: Record<string, unknown>;
    };
    expect(structuredLog.details).toMatchObject({
      orchestrationAttemptId: "web-ingress-attempt-test",
      runtimeProcessingRetryReason: "container_rpc_timeout",
    });
  });

  it("keeps retry behavior unchanged when the telemetry binding throws", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));

    expect(createRuntimeProcessingRetryLater({
      analytics: {
        writeDataPoint() {
          throw new Error("analytics unavailable");
        },
      },
      reason: "container_rpc_error",
      userId: "member_123",
    })).toEqual({
      kind: "retry_later",
      retryAt: "2026-08-06T12:00:30.000Z",
    });
  });
});
