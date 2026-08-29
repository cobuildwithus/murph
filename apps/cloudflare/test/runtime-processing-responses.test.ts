import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRuntimeProcessingRetryLater,
  HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA,
} from "../src/user-runner/runtime-processing-responses.ts";

type RuntimeProcessingRetryLaterInput = Parameters<
  typeof createRuntimeProcessingRetryLater
>[0];

describe("runtime processing retry telemetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("requires a stage only for container-busy retries", () => {
    const acceptRetryInput = (
      _input: RuntimeProcessingRetryLaterInput,
    ): void => undefined;
    const attributedBusyRetry = {
      reason: "container_busy",
      stage: "active_runtime_contention",
      userId: "member_123",
    } satisfies RuntimeProcessingRetryLaterInput;
    const unattributedNonBusyRetry = {
      reason: "container_rpc_error",
      userId: "member_123",
    } satisfies RuntimeProcessingRetryLaterInput;

    expect(attributedBusyRetry.stage).toBe("active_runtime_contention");
    expect("stage" in unattributedNonBusyRetry).toBe(false);

    // @ts-expect-error A container-busy retry must select a closed stage.
    acceptRetryInput({ reason: "container_busy", userId: "member_123" });
    acceptRetryInput({
      reason: "container_rpc_error",
      // @ts-expect-error Other retry reasons must not carry a busy stage.
      stage: "active_runtime_contention",
      userId: "member_123",
    });
    acceptRetryInput({
      reason: "container_busy",
      // @ts-expect-error Container-busy stages are a closed vocabulary.
      stage: "request_specific_state",
      userId: "member_123",
    });
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
    expect(structuredLog.details).not.toHaveProperty(
      "runtimeProcessingRetryStage",
    );
  });

  it("records the same finite container-busy stage in the log and blob dimension", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));
    vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const writeDataPoint = vi.fn();

    expect(createRuntimeProcessingRetryLater({
      analytics: { writeDataPoint },
      orchestrationAttemptId: "web-ingress-attempt-test",
      reason: "container_busy",
      stage: "cooperative_handoff_pending",
      userId: "member_123",
    })).toEqual({
      kind: "retry_later",
      retryAt: "2026-08-06T12:00:05.000Z",
    });
    expect(writeDataPoint).toHaveBeenCalledOnce();
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: [
        HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA,
        "container_busy",
        "cooperative_handoff_pending",
      ],
      doubles: [1, 5_000],
      indexes: ["container_busy"],
    });
    const serializedAnalytics = JSON.stringify(writeDataPoint.mock.calls);
    expect(serializedAnalytics).not.toContain("member_123");
    expect(serializedAnalytics).not.toContain("web-ingress-attempt-test");

    const structuredLog = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      details: Record<string, unknown>;
    };
    expect(structuredLog.details).toMatchObject({
      orchestrationAttemptId: "web-ingress-attempt-test",
      runtimeProcessingRetryReason: "container_busy",
      runtimeProcessingRetryStage: "cooperative_handoff_pending",
    });
  });

  it("keeps retry behavior unchanged when the telemetry binding throws", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));
    const analytics = {
      writeDataPoint() {
        throw new Error("analytics unavailable");
      },
    };

    expect(createRuntimeProcessingRetryLater({
      analytics,
      reason: "container_rpc_error",
      userId: "member_123",
    })).toEqual({
      kind: "retry_later",
      retryAt: "2026-08-06T12:00:30.000Z",
    });
    expect(createRuntimeProcessingRetryLater({
      analytics,
      reason: "container_busy",
      stage: "background_preemption_unavailable",
      userId: "member_123",
    })).toEqual({
      kind: "retry_later",
      retryAt: "2026-08-06T12:00:05.000Z",
    });
  });
});
