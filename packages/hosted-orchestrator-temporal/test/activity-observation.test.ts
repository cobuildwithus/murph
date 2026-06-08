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
      action: "woken",
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-05-21T12:00:30.000Z",
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
        prewarmAttemptId: null,
        reason: "nudge",
        resultAction: "woken",
        resultKind: "runtime_processing_accepted",
        userIdPresent: true,
      },
    );
    expect(JSON.stringify(activityLog.info.mock.calls)).not.toMatch(
      /payload|prompt|transcript|secret|mailbox_item/u,
    );
    expect(JSON.stringify(activityLog.info.mock.calls)).not.toContain(
      "member_test",
    );
  });

  it("logs retry-later observations without Cloudflare-local causes", async () => {
    await expect(observeHostedTemporalActivity({
      activity: "ensureRuntimeProcessing",
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "retry",
      userId: "member_test",
    }, async () => ({
      kind: "retry_later",
      retryAt: "2026-05-21T12:00:00.000Z",
    }))).resolves.toMatchObject({
      kind: "retry_later",
    });

    expect(activityLog.info).toHaveBeenCalledWith(
      "Hosted Temporal activity completed.",
      {
        activity: "ensureRuntimeProcessing",
        component: "temporal.activity",
        durationMs: expect.any(Number),
        orchestrationAttemptId: "orchestration_attempt_test",
        prewarmAttemptId: null,
        reason: "retry",
        resultAction: null,
        resultKind: "retry_later",
        userIdPresent: true,
      },
    );
  });

  it("does not log free-form result detail strings", async () => {
    const unsafeResultDetail = "unsafe prompt payload transcript secret";

    await expect(observeHostedTemporalActivity({
      activity: "ensureRuntimeProcessing",
      orchestrationAttemptId: "orchestration_attempt_test",
      reason: "nudge",
      userId: "member_test",
    }, async () => ({
      action: unsafeResultDetail,
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: "2026-05-21T12:00:30.000Z",
      runtimeAttemptId: "runtime_attempt_test",
    }))).resolves.toMatchObject({
      kind: "runtime_processing_accepted",
    });

    expect(activityLog.info).toHaveBeenCalledWith(
      "Hosted Temporal activity completed.",
      expect.objectContaining({
        resultAction: null,
        resultKind: "runtime_processing_accepted",
      }),
    );
    expect(JSON.stringify(activityLog.info.mock.calls)).not.toContain(
      unsafeResultDetail,
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
        prewarmAttemptId: null,
        reason: "nudge",
        resultAction: null,
        resultKind: null,
        userIdPresent: true,
      },
    );
    expect(JSON.stringify(activityLog.warn.mock.calls)).not.toContain(
      unsafeUpstreamCode,
    );
    expect(JSON.stringify(activityLog.warn.mock.calls)).not.toContain(
      "member_test",
    );
  });

  it("preserves safe non-retryable activity failure types", async () => {
    const error = nonRetryableActivityError(
      "hosted_orchestrator_invalid_protocol_response",
      "Invalid protocol response.",
    );

    await expect(observeHostedTemporalActivity({
      activity: "readRuntimeReconciliationFacts",
      userId: "member_test",
    }, async () => {
      throw error;
    })).rejects.toBe(error);

    expect(activityLog.warn).toHaveBeenCalledWith(
      "Hosted Temporal activity failed.",
      expect.objectContaining({
        activity: "readRuntimeReconciliationFacts",
        errorCode: "hosted_orchestrator_invalid_protocol_response",
        nonRetryable: true,
        orchestrationAttemptId: null,
        prewarmAttemptId: null,
        reason: null,
        resultAction: null,
        resultKind: null,
        userIdPresent: true,
      }),
    );
  });
});
