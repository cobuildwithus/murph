import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedExecutionRuntimeTimerWake,
  HostedRunRecord,
} from "@murphai/hosted-execution/contracts";
import type { HostedAssistantDeliveryOutcome } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { BrowserVaultSnapshot } from "@murphai/query/browser";

import { createHostedBrowserVaultSnapshotStore } from "../src/browser-vault-store.ts";
import {
  RunnerRunProcessor,
  recordHostedRunBreadcrumbInWebBestEffort,
  recordHostedRunPhaseLogInWebBestEffort,
  summarizeHostedAssistantDeliveryOutcomes,
} from "../src/user-runner/runner-run-processor.ts";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

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

describe("recordHostedRunBreadcrumbInWebBestEffort", () => {
  const callbackSigning = {
    keyId: "v1",
    privateKeyJwkJson: "{\"kty\":\"EC\"}",
  };

  it("writes a redacted hosted run log with the run token when available", async () => {
    const recordLog = vi.fn().mockResolvedValue({
      log: null,
      logged: true,
    });

    await recordHostedRunBreadcrumbInWebBestEffort({
      baseUrl: "https://hosted.example",
      callbackSigning,
      error: new Error("boom"),
      level: "warn",
      message: "Cloudflare runner invocation failed while preparing the hosted run snapshot.",
      phase: "runtime_failed",
      recordLog,
      redacted: {
        reason: "runner_invocation_failed",
      },
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
        message: "Cloudflare runner invocation failed while preparing the hosted run snapshot.",
        phase: "runtime_failed",
        redacted: expect.objectContaining({
          errorCode: expect.any(String),
          reason: "runner_invocation_failed",
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
      recordHostedRunBreadcrumbInWebBestEffort({
        baseUrl: "https://hosted.example",
        callbackSigning,
        message: "Cloudflare finished hosted run finalization.",
        phase: "finalize_finished",
        recordLog: vi.fn().mockRejectedValue(new Error("network down")),
        run: {
          attempt: 1,
          runId: "run-456",
          startedAt: new Date(Date.now() - 500).toISOString(),
        },
        runToken: "run-token-456",
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
      phase: "retry.scheduled",
      userId: "user-456",
    }));
  });

  it("skips the web log write when the hosted web base URL is unavailable", async () => {
    const recordLog = vi.fn();

    await recordHostedRunBreadcrumbInWebBestEffort({
      baseUrl: null,
      callbackSigning,
      message: "Cloudflare acquired a hosted run from the web-owned run ledger.",
      phase: "acquired",
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

describe("recordHostedRunPhaseLogInWebBestEffort", () => {
  const callbackSigning = {
    keyId: "v1",
    privateKeyJwkJson: "{\"kty\":\"EC\"}",
  };

  it("adds the wake event id to redacted phase logs without storing raw error text", async () => {
    const recordLog = vi.fn().mockResolvedValue({
      log: null,
      logged: true,
    });

    await recordHostedRunPhaseLogInWebBestEffort({
      baseUrl: "https://hosted.example",
      callbackSigning,
      error: new Error("boom"),
      level: "warn",
      message: "Hosted run drain failed after invoking the runtime.",
      phase: "retry.scheduled",
      recordLog,
      run: {
        attempt: 1,
        runId: "run-999",
        startedAt: new Date(Date.now() - 250).toISOString(),
      },
      runToken: "run-token-999",
      userId: "user-999",
      wakeEventId: "wake-999",
    });

    expect(recordLog).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        message: "Hosted run drain failed after invoking the runtime.",
        redacted: expect.objectContaining({
          eventId: "wake-999",
          errorCode: expect.any(String),
        }),
      }),
    }));
  });
});

describe("RunnerRunProcessor.executeRunDrain", () => {
  it("always requires finalize for prepared snapshots, even without delivery effects", async () => {
    const beginWakeRun = vi.fn().mockResolvedValue(undefined);
    const completeWakeRun = vi.fn().mockResolvedValue(undefined);

    const processor = new RunnerRunProcessor({
      applyHostedTransition: vi.fn(),
      bucket: {} as never,
      ensureRunnerStores: vi.fn(),
      env: {
        runnerTimeoutMs: 60_000,
        webCallbackSigning: {
          keyId: "v1",
          privateKeyJwkJson: "{\"kty\":\"EC\"}",
        },
      },
      hostedWebBaseUrl: null,
      readRunnerRuntimeConfigSource: () => ({}),
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      stateStore: {
        beginWakeRun,
        completeWakeRun,
        failWakeRun: vi.fn(),
        recordRunPhase: vi.fn().mockResolvedValue({}),
      },
      runtimeAlarmScheduler: {},
    } as never);

    (processor as any).advanceRunPhase = vi.fn().mockResolvedValue({});
    (processor as any).invokeRunner = vi.fn().mockResolvedValue({
      committedAssistantDeliveryEffects: [],
      committedGatewayProjectionSnapshot: null,
      phase: "prepared",
      result: {
        bundle: "bundle-encoded",
        result: {
          eventsHandled: 0,
          nextWakeAt: null,
          summary: "Prepared hosted run snapshot.",
        },
      },
    });
    (processor as any).persistCompletedRunnerResult = vi.fn().mockResolvedValue(null);
    (processor as any).readRecentActiveRunLease = vi.fn().mockResolvedValue(null);

    const run: HostedRunRecord = {
      acquiredAt: "2026-04-20T09:00:00.000Z",
      attempt: 1,
      createdAt: "2026-04-20T09:00:00.000Z",
      eventCount: 0,
      eventKinds: [],
      eventSeqs: [],
      executorKind: "cloudflare-container",
      id: "run_123",
      inputCommittedSeq: "10",
      inputCursorVersion: "cursor-v1",
      status: "acquired",
      triggerKind: "runtime_timer",
      updatedAt: "2026-04-20T09:00:00.000Z",
      userId: "user_123",
      wakeIds: [],
    };
    const primaryWake: HostedExecutionRuntimeTimerWake = {
      eventId: "runtime-timer",
      kind: "runtime.timer",
      occurredAt: "2026-04-20T09:00:00.000Z",
      triggerKind: "runtime_timer",
      userId: "user_123",
    };

    const result = await processor.executeRunDrain({
      currentBundleRef: null,
      events: [],
      primaryWake,
      run,
      runToken: "run-token",
    });

    expect(result).toMatchObject({
      cursorSnapshotRef: null,
      finalizeRequired: true,
      nextRuntimeWakeAt: null,
      redactedSummary: {
        assistantDeliveryEffectCount: 0,
        eventsHandled: 0,
        phase: "prepared",
        summary: "Prepared hosted run snapshot.",
      },
      state: "completed",
    });
    expect(beginWakeRun).toHaveBeenCalledTimes(1);
    expect(completeWakeRun).toHaveBeenCalledTimes(1);
  });

  it("deletes stale browser-vault snapshot sidecars when a completed run returns no snapshot", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(33);
    const snapshotStore = createHostedBrowserVaultSnapshotStore({
      bucket,
      key: rootKey,
      keyId: "k-current",
    });

    await snapshotStore.writeBrowserVaultSnapshot("user_123", {
      generatedAt: "2026-04-20T09:00:00.000Z",
      history: {
        timeline: [],
      },
      overview: {
        metrics: [],
        recentJournals: [],
        trackedExperiments: [],
        weeklySampleSummaries: [],
      },
      schema: "murph.browser-vault-dashboard-snapshot.v2",
      signals: {
        activity: [],
        assistantSummary: {
          highlights: [],
          latestDate: null,
        },
        bodyState: [],
        recovery: [],
        sleep: [],
        sourceHealth: [],
      },
      sourceVersion: "c".repeat(64),
    } satisfies BrowserVaultSnapshot);

    const processor = new RunnerRunProcessor({
      applyHostedTransition: vi.fn(),
      bucket: bucket as never,
      ensureRunnerStores: vi.fn().mockResolvedValue({
        crypto: {
          rootKey,
          rootKeyId: "k-current",
        },
      }),
      env: {
        runnerTimeoutMs: 60_000,
        webCallbackSigning: {
          keyId: "v1",
          privateKeyJwkJson: "{\"kty\":\"EC\"}",
        },
      },
      hostedWebBaseUrl: null,
      readRunnerRuntimeConfigSource: () => ({}),
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      stateStore: {
        beginWakeRun: vi.fn().mockResolvedValue(undefined),
        completeWakeRun: vi.fn().mockResolvedValue(undefined),
        failWakeRun: vi.fn(),
        recordRunPhase: vi.fn().mockResolvedValue({}),
      },
      runtimeAlarmScheduler: {},
    } as never);

    (processor as any).advanceRunPhase = vi.fn().mockResolvedValue({});
    (processor as any).invokeRunner = vi.fn().mockResolvedValue({
      assistantDeliveryOutcomes: [],
      browserVaultSnapshot: null,
      finalGatewayProjectionSnapshot: null,
      phase: "completed",
      result: {
        bundle: "bundle-encoded",
        result: {
          eventsHandled: 0,
          nextWakeAt: null,
          summary: "Finalized hosted run snapshot.",
        },
      },
    });
    (processor as any).persistCompletedRunnerResult = vi.fn().mockResolvedValue(null);
    (processor as any).readRecentActiveRunLease = vi.fn().mockResolvedValue(null);

    const run: HostedRunRecord = {
      acquiredAt: "2026-04-20T09:00:00.000Z",
      attempt: 1,
      createdAt: "2026-04-20T09:00:00.000Z",
      eventCount: 0,
      eventKinds: [],
      eventSeqs: [],
      executorKind: "cloudflare-container",
      id: "run_456",
      inputCommittedSeq: "10",
      inputCursorVersion: "cursor-v1",
      status: "acquired",
      triggerKind: "runtime_timer",
      updatedAt: "2026-04-20T09:00:00.000Z",
      userId: "user_123",
      wakeIds: [],
    };
    const primaryWake: HostedExecutionRuntimeTimerWake = {
      eventId: "runtime-timer",
      kind: "runtime.timer",
      occurredAt: "2026-04-20T09:00:00.000Z",
      triggerKind: "runtime_timer",
      userId: "user_123",
    };

    await processor.executeRunDrain({
      currentBundleRef: null,
      events: [],
      primaryWake,
      run,
      runToken: "run-token",
    });

    await expect(snapshotStore.readBrowserVaultSnapshotEnvelope("user_123")).resolves.toBeNull();
    expect(bucket.deleted).toHaveLength(1);
  });
});
