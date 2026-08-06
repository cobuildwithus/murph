import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRuntimeProcessingRetryLater,
  HOSTED_RUNTIME_RETRY_ANALYTICS_SCHEMA,
} from "../src/user-runner/runtime-processing-responses.ts";

describe("runtime processing retry telemetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records one identifier-free data point on retry_later", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));
    const writeDataPoint = vi.fn();

    expect(createRuntimeProcessingRetryLater({
      analytics: { writeDataPoint },
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
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain("member_123");
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
