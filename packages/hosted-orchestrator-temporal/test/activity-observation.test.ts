import { describe, expect, it, vi, beforeEach } from "vitest";

const activityLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
  log: activityLog,
}));

import {
  HostedOrchestratorHttpResponseError,
  nonRetryableActivityError,
  observeHostedTemporalActivity,
} from "../src/activities/http-client.js";

describe("observeHostedTemporalActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs successful activity observations with scalar metadata only", async () => {
    await expect(observeHostedTemporalActivity({
      activity: "ensureRuntimeProcessing",
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    }, async () => ({
      kind: "runtime_processing_accepted",
      runtimeAttemptId: "runtime_attempt_test",
    }))).resolves.toMatchObject({
      kind: "runtime_processing_accepted",
    });

    expect(activityLog.info).toHaveBeenCalledWith(
      "Hosted Temporal activity completed.",
      {
        activity: "ensureRuntimeProcessing",
        component: "temporal.activity",
        durationMs: expect.any(Number),
        orchestrationAttemptId: "orchestration_attempt_test",
        reason: "nudge",
        resultKind: "runtime_processing_accepted",
        userId: "member_test",
      },
    );
    expect(JSON.stringify(activityLog.info.mock.calls)).not.toMatch(
      /payload|prompt|transcript|secret|mailbox_item/u,
    );
  });

  it("logs bounded safe failure codes without echoing free-form upstream codes", async () => {
    const unsafeUpstreamCode = "mailbox_item_unsafe prompt transcript secret";
    const error = new HostedOrchestratorHttpResponseError({
      code: unsafeUpstreamCode,
      label: "runtime ensure processing",
      status: 500,
    });

    await expect(observeHostedTemporalActivity({
      activity: "ensureRuntimeProcessing",
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    }, async () => {
      throw error;
    })).rejects.toBe(error);

    expect(activityLog.warn).toHaveBeenCalledWith(
      "Hosted Temporal activity failed.",
      {
        activity: "ensureRuntimeProcessing",
        component: "temporal.activity",
        durationMs: expect.any(Number),
        errorCode: "HostedOrchestratorHttpResponseError",
        nonRetryable: false,
        orchestrationAttemptId: "orchestration_attempt_test",
        reason: "nudge",
        resultKind: null,
        userId: "member_test",
      },
    );
    expect(JSON.stringify(activityLog.warn.mock.calls)).not.toContain(
      unsafeUpstreamCode,
    );
  });

  it("preserves safe non-retryable activity failure types", async () => {
    const error = nonRetryableActivityError(
      "hosted_orchestrator_invalid_protocol_response",
      "Invalid protocol response.",
    );

    await expect(observeHostedTemporalActivity({
      activity: "readRuntimeDemand",
      userId: "member_test",
    }, async () => {
      throw error;
    })).rejects.toBe(error);

    expect(activityLog.warn).toHaveBeenCalledWith(
      "Hosted Temporal activity failed.",
      expect.objectContaining({
        activity: "readRuntimeDemand",
        errorCode: "hosted_orchestrator_invalid_protocol_response",
        nonRetryable: true,
        orchestrationAttemptId: null,
        reason: null,
        resultKind: null,
        userId: "member_test",
      }),
    );
  });
});
