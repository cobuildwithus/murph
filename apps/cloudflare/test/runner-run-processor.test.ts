import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedExecutionRuntimeTimerWake,
  HostedRuntimeDrainRequest,
  HostedRunRecord,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV,
  HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR,
  type HostedAssistantDeliveryOutcome,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { createBrowserVaultReplica, createVaultReadModel } from "@murphai/query/browser";

import { createHostedBrowserVaultReplicaStore } from "../src/browser-vault-store.ts";
import * as runnerContainerModule from "../src/runner-container.ts";
import {
  RunnerRunProcessor,
  recordHostedRunBreadcrumbInWebBestEffort,
  recordHostedRunPhaseLogInWebBestEffort,
  recordHostedRunnerResultLogsInWebBestEffort,
  summarizeHostedAssistantDeliveryOutcomes,
} from "../src/user-runner/runner-run-processor.ts";
import { MemoryEncryptedR2Bucket, createTestRootKey } from "./test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createHostedRunRecord(input: {
  runId: string;
  status?: HostedRunRecord["status"];
  userId?: string;
}): HostedRunRecord {
  return {
    acquiredAt: "2026-04-20T09:00:00.000Z",
    attempt: 1,
    createdAt: "2026-04-20T09:00:00.000Z",
    eventCount: 0,
    eventKinds: [],
    eventSeqs: [],
    executorKind: "cloudflare-container",
    id: input.runId,
    ingressEventIds: [],
    inputCommittedSeq: "10",
    inputCursorVersion: "cursor-v1",
    status: input.status ?? "acquired",
    triggerKind: "runtime_timer",
    updatedAt: "2026-04-20T09:00:00.000Z",
    userId: input.userId ?? "user_123",
  };
}

function createRuntimeTimerWake(userId = "user_123"): HostedExecutionRuntimeTimerWake {
  return {
    eventId: "runtime-timer",
    kind: "runtime.timer",
    occurredAt: "2026-04-20T09:00:00.000Z",
    triggerKind: "runtime_timer",
    userId,
  };
}

function createReplicaPersistenceProcessor(input: {
  bucket: MemoryEncryptedR2Bucket;
  rootKey: Uint8Array;
}): RunnerRunProcessor {
  return new RunnerRunProcessor({
    applyHostedTransition: vi.fn(),
    bucket: input.bucket as never,
    ensureRunnerStores: vi.fn().mockResolvedValue({
      crypto: {
        rootKey: input.rootKey,
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
      beginRun: vi.fn().mockResolvedValue(undefined),
      completeRun: vi.fn().mockResolvedValue(undefined),
      failRun: vi.fn(),
      recordRunPhase: vi.fn().mockResolvedValue({}),
    },
    runtimeAlarmScheduler: {},
  } as never);
}

function createInvokeRunnerProcessor(input: {
  configSource?: Readonly<Record<string, string | undefined>>;
  forwardedEnvSource?: Readonly<Record<string, unknown>>;
  runnerSecrets?: Readonly<Record<string, string>>;
} = {}) {
  const readBundlesForRunner = vi.fn().mockResolvedValue(null);
  const readRunnerSecrets = vi.fn().mockResolvedValue(input.runnerSecrets ?? {});
  const ensureRunnerStores = vi.fn().mockResolvedValue({
    bundleSync: {
      readBundlesForRunner,
    },
    crypto: {
      keysById: {
        "k-current": createTestRootKey(41),
      },
      rootKey: createTestRootKey(41),
      rootKeyId: "k-current",
    },
    gatewayCache: {},
    runnerSecrets: {
      readRunnerSecrets,
    },
    userId: "user_123",
  });

  const processor = new RunnerRunProcessor({
    applyHostedTransition: vi.fn(),
    bucket: {} as never,
    ensureRunnerStores,
    env: {
      runnerTimeoutMs: 60_000,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: "{\"kty\":\"EC\"}",
      },
    },
    hostedWebBaseUrl: null,
    readRunnerRuntimeConfigSource: () => input.configSource ?? {},
    runnerContainerNamespace: {
      getByName: vi.fn(),
    },
    runnerRuntimeEnvSource: input.forwardedEnvSource ?? {},
    stateStore: {
      beginRun: vi.fn().mockResolvedValue(undefined),
      completeRun: vi.fn().mockResolvedValue(undefined),
      failRun: vi.fn(),
      recordRunPhase: vi.fn().mockResolvedValue({}),
    },
    runtimeAlarmScheduler: {},
  } as never);

  return {
    ensureRunnerStores,
    processor,
    readBundlesForRunner,
    readRunnerSecrets,
  };
}

function createRunContext(runId: string): {
  attempt: number;
  runId: string;
  startedAt: string;
} {
  return {
    attempt: 1,
    runId,
    startedAt: "2026-04-20T09:00:00.000Z",
  };
}

function createRunDrainRequest(runId: string): HostedRuntimeDrainRequest {
  return {
    acquiredAt: "2026-04-20T09:00:00.000Z",
    events: [],
    inputCommittedSeq: "10",
    inputCursorVersion: "cursor-v1",
    runId,
    triggerKind: "runtime_timer",
    userId: "user_123",
  };
}

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

  it("allows explicit log components and preserves provided error codes when no error object is passed", async () => {
    const recordLog = vi.fn().mockResolvedValue({
      log: null,
      logged: true,
    });

    await recordHostedRunBreadcrumbInWebBestEffort({
      baseUrl: "https://hosted.example",
      callbackSigning,
      component: "runtime",
      level: "warn",
      message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
      phase: "wake.running",
      recordLog,
      redacted: {
        errorCode: "runtime_error",
      },
      run: {
        attempt: 1,
        runId: "run-321",
        startedAt: new Date(Date.now() - 250).toISOString(),
      },
      runToken: "run-token-321",
      userId: "user-321",
      wakeEventId: "wake-321",
    });

    expect(recordLog).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        component: "runtime",
        redacted: expect.objectContaining({
          errorCode: "runtime_error",
        }),
      }),
    }));
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

describe("recordHostedRunnerResultLogsInWebBestEffort", () => {
  const callbackSigning = {
    keyId: "v1",
    privateKeyJwkJson: "{\"kty\":\"EC\"}",
  };

  it("forwards runtime-owned redacted log entries with their originating event ids", async () => {
    const recordLog = vi.fn().mockResolvedValue({
      log: null,
      logged: true,
    });

    await recordHostedRunnerResultLogsInWebBestEffort({
      baseUrl: "https://hosted.example",
      callbackSigning,
      recordLog,
      redactedLogEntries: [
        {
          component: "runtime",
          eventId: "wake-notification-1",
          level: "warn",
          message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
          phase: "wake.running",
          redacted: {
            errorCode: "runtime_error",
            notificationRouteChannel: "linq",
          },
        },
        {
          component: "runtime",
          eventId: "wake-notification-2",
          level: "info",
          message: "Hosted assistant notification finished.",
          phase: "wake.running",
          redacted: {
            notificationRouteChannel: "telegram",
          },
        },
      ],
      run: {
        attempt: 1,
        runId: "run-654",
        startedAt: new Date(Date.now() - 250).toISOString(),
      },
      runToken: "run-token-654",
      userId: "user-654",
      wakeEventId: "wake-batch",
    });

    expect(recordLog).toHaveBeenNthCalledWith(1, expect.objectContaining({
      body: expect.objectContaining({
        component: "runtime",
        message: "Hosted assistant notification failed and was skipped so the hosted run can continue.",
        redacted: expect.objectContaining({
          errorCode: "runtime_error",
          eventId: "wake-notification-1",
          notificationRouteChannel: "linq",
        }),
      }),
    }));
    expect(recordLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
      body: expect.objectContaining({
        component: "runtime",
        message: "Hosted assistant notification finished.",
        redacted: expect.objectContaining({
          eventId: "wake-notification-2",
          notificationRouteChannel: "telegram",
        }),
      }),
    }));
  });
});

describe("RunnerRunProcessor.executeRunDrain", () => {
  it("skips runner env resolution for batches without supported messaging activity targets", async () => {
    const { ensureRunnerStores, processor } = createInvokeRunnerProcessor();

    const activity = await processor.startRunMessagingActivity({
      events: [
        {
          ingressEventId: "ingress-runtime-timer",
          seq: "11",
          wake: createRuntimeTimerWake(),
        },
      ],
      run: createHostedRunRecord({
        runId: "run-no-messaging-target",
      }),
    });

    expect(activity).toBeNull();
    expect(ensureRunnerStores).not.toHaveBeenCalled();
  });

  it("keeps loopback Linq typing endpoints in the runner-owned messaging activity env", async () => {
    const { processor } = createInvokeRunnerProcessor({
      forwardedEnvSource: {
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://host.docker.internal:8787",
        HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "linq",
        LINQ_API_BASE_URL: "http://127.0.0.1:4011",
      },
    });

    const runtimeEnv = await Reflect.get(
      processor,
      "resolveRunnerMessagingActivityRuntimeEnv",
    ).call(processor, "user_123");

    expect(runtimeEnv).toEqual(expect.objectContaining({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
      LINQ_API_BASE_URL: "http://127.0.0.1:4011",
      NODE_ENV: "production",
    }));
  });

  it("always requires finalize for prepared snapshots, even without delivery effects", async () => {
    const beginRun = vi.fn().mockResolvedValue(undefined);
    const completeRun = vi.fn().mockResolvedValue(undefined);

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
        beginRun,
        completeRun,
        failRun: vi.fn(),
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

    const run = createHostedRunRecord({
      runId: "run_123",
    });
    const primaryWake = createRuntimeTimerWake();

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
    expect(beginRun).toHaveBeenCalledTimes(1);
    expect(completeRun).toHaveBeenCalledTimes(1);
  });

  it("leaves existing browser-vault replica objects untouched when a completed run returns no replica", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(33);
    const replicaStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
    });

    const existingReplicaRef = await replicaStore.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
        generatedAt: "2026-04-20T09:00:00.000Z",
        sourceBundleHash: "c".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });

    const processor = createReplicaPersistenceProcessor({
      bucket,
      rootKey,
    });

    (processor as any).advanceRunPhase = vi.fn().mockResolvedValue({});
    (processor as any).invokeRunner = vi.fn().mockResolvedValue({
      assistantDeliveryOutcomes: [],
      browserVaultReplica: null,
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

    const run = createHostedRunRecord({
      runId: "run_456",
    });
    const primaryWake = createRuntimeTimerWake();

    const result = await processor.executeRunDrain({
      currentBundleRef: null,
      events: [],
      primaryWake,
      run,
      runToken: "run-token",
    });

    expect(result).toMatchObject({
      browserVaultReplicaRef: null,
      finalizeRequired: false,
      state: "completed",
    });
    await expect(replicaStore.readBrowserVaultReplicaEnvelope(existingReplicaRef)).resolves.not.toBeNull();
    expect(bucket.deleted).toEqual([]);
  });

  it("marks outbound runtime jobs with executor-owned messaging activity only when requested", async () => {
    const { processor } = createInvokeRunnerProcessor();
    const invokeRunner = Reflect.get(processor, "invokeRunner").bind(processor) as (
      userId: string,
      currentBundleRef: null,
      wake: HostedExecutionRuntimeTimerWake,
      run: ReturnType<typeof createRunContext>,
      runDrain: HostedRuntimeDrainRequest,
      runToken?: string | null,
      options?: {
        messagingActivityOwnedByExecutor?: boolean;
      },
    ) => Promise<unknown>;
    const invokeHostedExecutionContainerRunner = vi.spyOn(
      runnerContainerModule,
      "invokeHostedExecutionContainerRunner",
    ).mockResolvedValue({
      assistantDeliveryOutcomes: [],
      browserVaultReplica: null,
      finalGatewayProjectionSnapshot: null,
      phase: "completed",
      result: {
        bundle: null,
        result: {
          eventsHandled: 0,
          nextWakeAt: null,
          summary: "Completed hosted run.",
        },
      },
    });

    await invokeRunner(
      "user_123",
      null,
      createRuntimeTimerWake(),
      createRunContext("run-owned"),
      createRunDrainRequest("run-owned"),
      "run-token",
      {
        messagingActivityOwnedByExecutor: true,
      },
    );
    await invokeRunner(
      "user_123",
      null,
      createRuntimeTimerWake(),
      createRunContext("run-runtime"),
      createRunDrainRequest("run-runtime"),
      "run-token",
      {
        messagingActivityOwnedByExecutor: false,
      },
    );

    expect(invokeHostedExecutionContainerRunner).toHaveBeenCalledTimes(2);
    expect(invokeHostedExecutionContainerRunner.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      job: expect.objectContaining({
        runtime: expect.objectContaining({
          forwardedEnv: expect.objectContaining({
            [HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV]:
              HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR,
          }),
        }),
      }),
    }));
    expect(invokeHostedExecutionContainerRunner.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      job: expect.objectContaining({
        runtime: expect.objectContaining({
          forwardedEnv: expect.not.objectContaining({
            [HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV]:
              HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR,
          }),
        }),
      }),
    }));
  });
});

describe("RunnerRunProcessor.finalizeRunDrain", () => {
  it("leaves existing browser-vault replica objects untouched when finalization returns no replica", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const rootKey = createTestRootKey(35);
    const replicaStore = createHostedBrowserVaultReplicaStore({
      bucket,
      rootKey,
    });

    const existingReplicaRef = await replicaStore.writeBrowserVaultReplica({
      replica: await createBrowserVaultReplica({
        generatedAt: "2026-04-20T09:00:00.000Z",
        sourceBundleHash: "d".repeat(64),
        vault: createVaultReadModel({
          entities: [],
          metadata: null,
          vaultRoot: "browser://vault",
        }),
      }),
      userId: "user_123",
    });

    const processor = createReplicaPersistenceProcessor({
      bucket,
      rootKey,
    });

    (processor as any).advanceRunPhase = vi.fn().mockResolvedValue({});
    (processor as any).invokeRunner = vi.fn().mockResolvedValue({
      assistantDeliveryOutcomes: [],
      browserVaultReplica: null,
      finalGatewayProjectionSnapshot: null,
      phase: "completed",
      result: {
        bundle: "bundle-encoded",
        result: {
          eventsHandled: 0,
          nextWakeAt: null,
          summary: "Finalized hosted run side effects.",
        },
      },
    });
    (processor as any).persistCompletedRunnerResult = vi.fn().mockResolvedValue(null);

    const result = await processor.finalizeRunDrain({
      currentBundleRef: null,
      primaryWake: createRuntimeTimerWake(),
      run: createHostedRunRecord({
        runId: "run_789",
        status: "finalizing",
      }),
      runToken: "run-token",
    });

    expect(result).toMatchObject({
      browserVaultReplicaRef: null,
      cursorSnapshotRef: null,
      finalizeRequired: false,
      state: "completed",
    });
    await expect(replicaStore.readBrowserVaultReplicaEnvelope(existingReplicaRef)).resolves.not.toBeNull();
    expect(bucket.deleted).toEqual([]);
  });
});
