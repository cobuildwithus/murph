import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedAssistantDeliveryOutcome } from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  recordHostedRunPhaseLogInWebBestEffort,
  summarizeHostedAssistantDeliveryOutcomes,
} from "../src/user-runner/runner-wake-processor.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runner wake processor delivery summaries", () => {
  it("includes the first non-sent delivery message in the finalize summary", () => {
    const summary = summarizeHostedAssistantDeliveryOutcomes([
      {
        deliveryChannel: "linq",
        deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
        deliveryErrorMessage: "Linq request POST /chats/stale/messages failed with HTTP 404. Chat not found",
        deliveryStatus: "failed",
        effectFingerprint: "dedupe-1",
        effectId: "outbox-1",
        journalMethod: null,
        journalStatus: null,
        providerMessageId: null,
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      } satisfies HostedAssistantDeliveryOutcome,
    ]);

    expect(summary).toEqual({
      assistantDeliveryOutcomeCount: 1,
      assistantDeliverySentCount: 0,
      assistantDeliveryNonSentCount: 1,
      assistantDeliveryFirstNonSentChannel: "linq",
      assistantDeliveryFirstNonSentCode: "LINQ_API_REQUEST_FAILED",
      assistantDeliveryFirstNonSentMessage:
        "Linq request POST /chats/stale/messages failed with HTTP 404. Chat not found",
      assistantDeliveryFirstNonSentStatus: "failed",
    });
  });
});

describe("recordHostedRunPhaseLogInWebBestEffort", () => {
  const callbackSigning = {
    keyId: "v1",
    privateKeyJwkJson: "{\"kty\":\"EC\"}",
  };

  it("writes a redacted hosted run log with the run token when available", async () => {
    const recordLog = vi.fn().mockResolvedValue({
      log: null,
      logged: true,
    });

    await recordHostedRunPhaseLogInWebBestEffort({
      baseUrl: "https://hosted.example",
      callbackSigning,
      error: new Error("boom"),
      level: "warn",
      message: "Hosted run drain deferred because the runtime is not configured yet. boom",
      phase: "retry.scheduled",
      recordLog,
      run: {
        attempt: 2,
        runId: "run-123",
        startedAt: new Date(Date.now() - 1_000).toISOString(),
      },
      runToken: "run-token-123",
      userId: "user-123",
      wakeEventId: "wake-123",
    });

    expect(recordLog).toHaveBeenCalledTimes(1);
    expect(recordLog).toHaveBeenCalledWith({
      baseUrl: "https://hosted.example",
      body: expect.objectContaining({
        component: "cloudflare-runner",
        level: "warn",
        message: "Hosted run drain deferred because the runtime is not configured yet. boom",
        phase: "retry.scheduled",
        redacted: expect.objectContaining({
          errorCode: expect.any(String),
          eventId: "wake-123",
          runElapsedMs: expect.any(Number),
        }),
        runId: "run-123",
        runToken: "run-token-123",
      }),
      boundUserId: "user-123",
      callbackSigning,
      timeoutMs: 2_000,
    });
  });

  it("swallows logging failures and emits a warning structured log", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      recordHostedRunPhaseLogInWebBestEffort({
        baseUrl: "https://hosted.example",
        callbackSigning,
        message: "Hosted run finalized committed side effects.",
        phase: "completed",
        recordLog: vi.fn().mockRejectedValue(new Error("network down")),
        run: {
          attempt: 1,
          runId: "run-456",
          startedAt: new Date(Date.now() - 500).toISOString(),
        },
        userId: "user-456",
        wakeEventId: "wake-456",
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0] ?? "{}")) as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({
      component: "cloudflare-runner",
      eventId: "wake-456",
      level: "warn",
      message: expect.stringContaining(
        "Hosted run phase log write to web failed; continuing with runner-local observability only.",
      ),
      phase: "completed",
      userId: "user-456",
    }));
  });

  it("skips the web log write when the hosted web base URL is unavailable", async () => {
    const recordLog = vi.fn();

    await recordHostedRunPhaseLogInWebBestEffort({
      baseUrl: null,
      callbackSigning,
      message: "Running hosted run drain from the web-owned run ledger.",
      phase: "wake.running",
      recordLog,
      run: {
        attempt: 1,
        runId: "run-789",
        startedAt: new Date().toISOString(),
      },
      userId: "user-789",
      wakeEventId: "wake-789",
    });

    expect(recordLog).not.toHaveBeenCalled();
  });
});
