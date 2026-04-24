import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import { buildHostedAssistantDeliveryEffect } from "@murphai/hosted-execution/side-effects";

import {
  createHostedRuntimeArtifactStoreStub,
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const HOSTED_RUN_CONTEXT = {
  attempt: 1,
  runId: "run_123",
  startedAt: "2026-04-08T00:00:00.000Z",
} as const;

const mocks = vi.hoisted(() => ({
  closeHostedRuntimeDeviceSyncService: vi.fn(),
  collectHostedAssistantDeliverySideEffects: vi.fn(),
  createConfiguredDeviceSyncProvidersFromConfigs: vi.fn(),
  createDeviceSyncRegistry: vi.fn(),
  createHostedRuntimeDeviceSyncService: vi.fn(),
  createHostedArtifactUploadSink: vi.fn(),
  decodeHostedBundleBase64: vi.fn(),
  drainHostedCommittedAssistantDeliveriesAfterCommit: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  encodeHostedBundleBase64: vi.fn(),
  executeHostedIngressEvent: vi.fn(),
  exportGatewayProjectionSnapshotLocal: vi.fn(),
  exportHostedBrowserVaultReplica: vi.fn(),
  exportHostedPendingAssistantUsage: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listHostedBundleArtifacts: vi.fn(),
  refreshAssistantStatusSnapshot: vi.fn(),
  runHostedAssistantRuntimeTimerLane: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
  runHostedNoopSystemWakeLane: vi.fn(),
  snapshotHostedExecutionContext: vi.fn(),
  stopLinqChatTypingIndicator: vi.fn(),
}));

vi.mock("@murphai/runtime-state/node", async () => {
  const actual = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );
  return {
    ...actual,
    decodeHostedBundleBase64: mocks.decodeHostedBundleBase64,
    encodeHostedBundleBase64: mocks.encodeHostedBundleBase64,
    listHostedBundleArtifacts: mocks.listHostedBundleArtifacts,
    snapshotHostedExecutionContext: mocks.snapshotHostedExecutionContext,
  };
});

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("@murphai/assistant-engine", () => ({
  refreshAssistantStatusSnapshot: mocks.refreshAssistantStatusSnapshot,
}));

vi.mock("@murphai/operator-config/linq-runtime", async () => {
  const actual = await vi.importActual<typeof import("@murphai/operator-config/linq-runtime")>(
    "@murphai/operator-config/linq-runtime",
  );
  return {
    ...actual,
    stopLinqChatTypingIndicator: mocks.stopLinqChatTypingIndicator,
  };
});

vi.mock("@murphai/device-syncd/config", () => ({
  createConfiguredDeviceSyncProvidersFromConfigs:
    mocks.createConfiguredDeviceSyncProvidersFromConfigs,
}));

vi.mock("@murphai/device-syncd/registry", () => ({
  createDeviceSyncRegistry: mocks.createDeviceSyncRegistry,
}));

vi.mock("../src/device-sync-service.ts", () => ({
  closeHostedRuntimeDeviceSyncService: mocks.closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService: mocks.createHostedRuntimeDeviceSyncService,
}));

vi.mock("@murphai/assistant-engine/gateway-local-adapter", () => ({
  assistantGatewayLocalProjectionSourceReader: Symbol(
    "assistantGatewayLocalProjectionSourceReader",
  ),
}));

vi.mock("@murphai/gateway-local", () => ({
  exportGatewayProjectionSnapshotLocal: mocks.exportGatewayProjectionSnapshotLocal,
}));

vi.mock("../src/hosted-runtime/artifacts.ts", () => ({
  createHostedArtifactUploadSink: mocks.createHostedArtifactUploadSink,
}));

vi.mock("../src/hosted-runtime/callbacks.ts", () => ({
  collectHostedAssistantDeliverySideEffects:
    mocks.collectHostedAssistantDeliverySideEffects,
  drainHostedCommittedAssistantDeliveriesAfterCommit:
    mocks.drainHostedCommittedAssistantDeliveriesAfterCommit,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget:
    mocks.hydrateHostedExecutionDefaultTarget,
}));

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedIngressEvent: mocks.executeHostedIngressEvent,
}));

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedAssistantRuntimeTimerLane: mocks.runHostedAssistantRuntimeTimerLane,
  runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
  runHostedNoopSystemWakeLane: mocks.runHostedNoopSystemWakeLane,
}));

vi.mock("../src/hosted-runtime/usage.ts", () => ({
  exportHostedPendingAssistantUsage: mocks.exportHostedPendingAssistantUsage,
}));

vi.mock("../src/hosted-runtime/browser-vault.ts", () => ({
  exportHostedBrowserVaultReplica: mocks.exportHostedBrowserVaultReplica,
}));

import {
  completeHostedRunDrainAfterCommit,
  executeHostedRunDrainForCommit,
} from "../src/hosted-runtime/execution.ts";

const incomingBundle = Uint8Array.from([1, 2, 3]);
const committedBundle = Uint8Array.from([4, 5, 6]);

const hostedDeliveryEffect = buildHostedAssistantDeliveryEffect({
  dedupeKey: "dedupe_123",
  effectId: "intent_123",
  payload: {
    actorId: "actor_123",
    bindingDeliveryKind: "participant",
    bindingDeliveryTarget: "chat_123",
    channel: "telegram",
    explicitTarget: null,
    idempotencyKey: "assistant-outbox:intent_123",
    identityId: "identity_123",
    message: "hello from hosted",
    replyToMessageId: null,
    sessionId: "session_123",
    subject: null,
    threadId: "thread_123",
    threadIsDirect: true,
    transportIdempotent: false,
    turnId: "turn_123",
  },
});

function createRuntime(overrides: {
  deviceSyncConfig?: ReturnType<typeof createHostedRuntimeResolvedConfig>["deviceSync"];
} = {}) {
  const { artifactStore } = createHostedRuntimeArtifactStoreStub();

  return {
    commitTimeoutMs: 45_000,
    forwardedEnv: {},
    platform: {
      artifactStore,
      deviceSyncPort: null,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageExportPort: null,
    },
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig({
      deviceSync:
        overrides.deviceSyncConfig === undefined ? null : overrides.deviceSyncConfig,
    }),
    userEnv: {},
  };
}

function createRestored() {
  return {
    assistantStateRoot: "/tmp/vault-root/.assistant-state",
    operatorHomeRoot: "/tmp/operator-home",
    vaultRoot: "/tmp/vault-root",
  };
}

function createExecutionContext() {
  return {
    hosted: {
      issueDeviceConnectLink: vi.fn(),
      memberId: "member_123",
      userEnvKeys: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.closeHostedRuntimeDeviceSyncService.mockImplementation((service: { close?: () => void }) => {
    service.close?.();
  });

  mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
    hostedDeliveryEffect,
  ]);
  mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue([]);
  mocks.createDeviceSyncRegistry.mockReturnValue({
    list() {
      return [];
    },
  });
  mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
    close: vi.fn(),
    getNextWakeAt: vi.fn(() => null),
  });
  mocks.createHostedArtifactUploadSink.mockReturnValue(Symbol("artifact-sink"));
  mocks.decodeHostedBundleBase64.mockImplementation((bundle: string | null) => {
    if (bundle === "incoming-bundle") {
      return incomingBundle;
    }
    if (bundle === "committed-bundle") {
      return committedBundle;
    }
    if (bundle === "bundle-that-breaks-listing") {
      return Uint8Array.from([7, 7, 7]);
    }
    return null;
  });
  mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockResolvedValue([
    {
      deliveryChannel: "telegram",
      deliveryErrorCode: null,
      deliveryStatus: "sent",
      effectFingerprint: hostedDeliveryEffect.fingerprint,
      effectId: hostedDeliveryEffect.effectId,
      providerMessageId: "telegram_message_123",
      providerThreadId: "thread_123",
      retryable: false,
      target: "chat_123",
      targetKind: "participant" as const,
    },
  ]);
  mocks.encodeHostedBundleBase64.mockImplementation((bytes: Uint8Array) =>
    Buffer.from(bytes).toString("base64"),
  );
  mocks.executeHostedIngressEvent.mockResolvedValue({
    bootstrapResult: null,
    conversationMetrics: null,
    ingressLane: "member-activated",
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.exportGatewayProjectionSnapshotLocal.mockResolvedValue({
    conversations: [],
    generatedAt: "2026-04-08T00:10:00.000Z",
    messages: [],
    permissions: [],
    schema: "murph.gateway-projection-snapshot.v1",
  });
  mocks.exportHostedBrowserVaultReplica.mockResolvedValue({
    assistantSummary: {
      highlights: [],
      latestDate: null,
    },
    entities: [],
    generatedAt: "2026-04-08T00:10:00.000Z",
    metricDayRows: [],
    metricRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: "health-vault-browser-v1",
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    schema: "murph.browser-vault-replica.v1",
    searchRows: [],
    source: {
      dataVersion: "b".repeat(64),
      sourceBundleHash: "a".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  });
  mocks.exportHostedPendingAssistantUsage.mockResolvedValue({
    exported: 1,
    failed: 0,
    pending: 0,
  });
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (executionContext) =>
    executionContext,
  );
  mocks.listHostedBundleArtifacts.mockReturnValue([]);
  mocks.refreshAssistantStatusSnapshot.mockResolvedValue(undefined);
  mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValue({
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
  });
  mocks.runHostedDeviceSyncWakeLane.mockResolvedValue({
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
  });
  mocks.runHostedNoopSystemWakeLane.mockReturnValue({
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
  });
  mocks.snapshotHostedExecutionContext.mockResolvedValue({
    bundle: Uint8Array.from([9, 9, 9]),
  });
});

describe("assistant-runtime execution coverage", () => {
  it("preserves the earliest device-sync wake after a conversation wake, clamps stale timestamps, and drains stale due work locally", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
      const close = vi.fn();
      mocks.executeHostedIngressEvent.mockResolvedValueOnce({
        bootstrapResult: null,
        conversationMetrics: {
          nextWakeAt: null,
          parserProcessed: 2,
        },
        ingressLane: "conversation-message",
        shareImportResult: null,
        shareImportTitle: null,
      });
      mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue([
        { provider: "oura" },
      ]);
      mocks.createDeviceSyncRegistry.mockReturnValue({
        list() {
          return [{ provider: "oura" }];
        },
      });
      mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
        close,
        getNextWakeAt() {
          return "2026-04-08T00:05:00.000Z";
        },
      });

      const result = await executeHostedRunDrainForCommit({
        executionContext: createExecutionContext(),
        request: {
          bundle: "incoming-bundle",
          run: HOSTED_RUN_CONTEXT,
          runDrain: {
            acquiredAt: "2026-04-08T00:00:00.000Z",
            events: [
              {
                seq: "24",
                wake: buildHostedExecutionLinqConversationMessageWake({
                  eventId: "evt_linq_message",
                  linqMessage: {
                    chatId: "chat_123",
                    from: "+15551234567",
                    isFromMe: false,
                    messageId: "linq_message_123",
                    parts: [{ type: "text", value: "hello" }],
                  },
                  occurredAt: "2026-04-08T00:00:00.000Z",
                  phoneLookupKey: "15551234567",
                  userId: "member_123",
                }),
                ingressEventId: "wake_24",
              },
            ],
            inputCommittedSeq: "24",
            inputCursorVersion: "4",
            runId: "run_123",
            triggerKind: "external_ingress",
            userId: "member_123",
          },
        },
        restored: createRestored(),
        runtime: createRuntime({
          deviceSyncConfig: {
            providerConfigs: {},
            publicBaseUrl: "https://device-sync.example.test",
            secret: "device-sync-secret",
          },
        }),
        runtimeEnv: {},
      });

      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
      expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
      expect(mocks.createConfiguredDeviceSyncProvidersFromConfigs).toHaveBeenCalledWith({});
      expect(close).toHaveBeenCalledTimes(1);
      assert.equal(result.committedResult.result.nextWakeAt, null);
      assert.match(result.committedResult.result.summary, /conversation\.message/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs and continues when preserved device-sync wake resolution fails", async () => {
    mocks.executeHostedIngressEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      ingressLane: "conversation-message",
      shareImportResult: null,
      shareImportTitle: null,
    });
    mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockImplementation(() => {
      throw new Error("device sync init failed");
    });

    const result = await executeHostedRunDrainForCommit({
      executionContext: createExecutionContext(),
      request: {
        bundle: "incoming-bundle",
        run: HOSTED_RUN_CONTEXT,
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          committedResult: {
            bundle: "committed-bundle",
            result: {
              eventsHandled: 7,
              nextWakeAt: "2026-04-08T00:05:00.000Z",
              redactedDetails: {
                maintenance: "device-sync",
              },
              redactedLogEntries: [
                {
                  component: "runtime",
                  eventId: "evt_runtime_timer",
                  level: "info",
                  message: "prepared summary log",
                  phase: "commit.recorded",
                  redacted: {
                    lane: "maintenance",
                  },
                },
              ],
              summary: "Prepared runtime drain preserved metadata.",
            },
          },
          events: [
            {
              seq: "24",
              wake: buildHostedExecutionLinqConversationMessageWake({
                eventId: "evt_linq_message_error",
                linqMessage: {
                  chatId: "chat_123",
                  from: "+15551234567",
                  isFromMe: false,
                  messageId: "linq_message_456",
                  parts: [{ type: "text", value: "hello" }],
                },
                occurredAt: "2026-04-08T00:00:00.000Z",
                phoneLookupKey: "15551234567",
                userId: "member_123",
              }),
              ingressEventId: "wake_24",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "external_ingress",
          userId: "member_123",
        },
      },
      restored: createRestored(),
      runtime: createRuntime({
        deviceSyncConfig: {
          providerConfigs: {},
          publicBaseUrl: "https://device-sync.example.test",
          secret: "device-sync-secret",
        },
      }),
      runtimeEnv: {},
    });

    assert.equal(result.committedResult.result.nextWakeAt, null);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not resolve the preserved device-sync wake after conversation wake handling; continuing without it.",
      }),
    );
  });

  it("drains committed side effects, snapshots final state, and preserves untouched artifacts", async () => {
    mocks.listHostedBundleArtifacts.mockReturnValue([
      {
        path: "raw/already-materialized.bin",
        ref: {
          sha256: "sha_materialized",
        },
        root: "vault",
      },
      {
        path: "raw/preserved.bin",
        ref: {
          sha256: "sha_preserved",
        },
        root: "vault",
      },
    ]);

    const result = await completeHostedRunDrainAfterCommit({
      materializedArtifactPaths: new Set(["vault/raw/already-materialized.bin"]),
      request: {
        bundle: "committed-bundle",
        run: HOSTED_RUN_CONTEXT,
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          committedResult: {
            bundle: "committed-bundle",
            result: {
              eventsHandled: 7,
              nextWakeAt: "2026-04-08T00:05:00.000Z",
              redactedDetails: {
                maintenance: "device-sync",
              },
              redactedLogEntries: [
                {
                  component: "runtime",
                  eventId: "evt_runtime_timer",
                  level: "info",
                  message: "prepared summary log",
                  phase: "commit.recorded",
                  redacted: {
                    lane: "maintenance",
                  },
                },
              ],
              summary: "Prepared runtime drain preserved metadata.",
            },
          },
          events: [
            {
              seq: "24",
              wake: buildHostedExecutionRuntimeTimerWake({
                eventId: "evt_runtime_timer",
                occurredAt: "2026-04-08T00:00:00.000Z",
                triggerKind: "runtime_timer",
                userId: "member_123",
              }),
              ingressEventId: "wake_24",
            },
          ],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "runtime_timer",
          userId: "member_123",
          resumeFinalize: true,
        },
      },
      restored: createRestored(),
      runtime: createRuntime(),
      wake: buildHostedExecutionRuntimeTimerWake({
        eventId: "evt_runtime_timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      }),
    });

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      "/tmp/vault-root",
    );
    expect(mocks.drainHostedCommittedAssistantDeliveriesAfterCommit).toHaveBeenCalledWith({
      assistantDeliveryEffects: [hostedDeliveryEffect],
      effectsPort: expect.objectContaining({
        deletePreparedAssistantDelivery: expect.any(Function),
        readAssistantDeliveryRecord: expect.any(Function),
        readRawEmailMessage: expect.any(Function),
        sendEmail: expect.any(Function),
        writeAssistantDeliveryRecord: expect.any(Function),
      }),
      forwardedEnv: {},
      platformEnv: {},
      vaultRoot: "/tmp/vault-root",
      wake: buildHostedExecutionRuntimeTimerWake({
        eventId: "evt_runtime_timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      }),
    });
    expect(mocks.createHostedArtifactUploadSink).toHaveBeenCalledWith({
      artifactStore: expect.any(Object),
      knownArtifactHashes: new Set(["sha_materialized", "sha_preserved"]),
    });
    expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledWith({
      artifactSink: expect.any(Symbol),
      materializedArtifactPaths: new Set(["vault/raw/already-materialized.bin"]),
      operatorHomeRoot: "/tmp/operator-home",
      preservedArtifacts: [
        {
          path: "raw/preserved.bin",
          ref: {
            sha256: "sha_preserved",
          },
          root: "vault",
        },
      ],
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.exportHostedPendingAssistantUsage).toHaveBeenCalledWith({
      usageExportPort: null,
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.refreshAssistantStatusSnapshot).toHaveBeenCalledWith("/tmp/vault-root");
    expect(mocks.exportHostedBrowserVaultReplica).toHaveBeenCalledWith({
      sourceBundleHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      vaultRoot: "/tmp/vault-root",
    });
    assert.equal(result.phase, "completed");
    assert.deepEqual(result.result.result, {
      eventsHandled: 7,
      nextWakeAt: "2026-04-08T00:05:00.000Z",
      redactedDetails: {
        maintenance: "device-sync",
      },
      redactedLogEntries: [
        {
          component: "runtime",
          eventId: "evt_runtime_timer",
          level: "info",
          message: "prepared summary log",
          phase: "commit.recorded",
          redacted: {
            lane: "maintenance",
          },
        },
      ],
      summary: "Prepared runtime drain preserved metadata.",
    });
    assert.deepEqual(result.assistantDeliveryOutcomes, [
      {
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryStatus: "sent",
        effectFingerprint: hostedDeliveryEffect.fingerprint,
        effectId: hostedDeliveryEffect.effectId,
        providerMessageId: "telegram_message_123",
        providerThreadId: "thread_123",
        retryable: false,
        target: "chat_123",
        targetKind: "participant",
      },
    ]);
  });

  it("stops executor-owned Linq typing before post-send exports continue", async () => {
    const steps: string[] = [];
    const runtime = createRuntime();
    runtime.forwardedEnv = {
      HOSTED_RUN_MESSAGING_ACTIVITY_OWNER: "executor",
      LINQ_API_TOKEN: "linq-token",
    };
    mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockImplementationOnce(async () => {
      steps.push("drain");
      return [
        {
          deliveryChannel: "linq",
          deliveryErrorCode: null,
          deliveryStatus: "sent",
          effectFingerprint: hostedDeliveryEffect.fingerprint,
          effectId: hostedDeliveryEffect.effectId,
          providerMessageId: "linq_message_123",
          providerThreadId: "chat_123",
          retryable: false,
          target: "chat_123",
          targetKind: "participant" as const,
        },
      ];
    });
    mocks.stopLinqChatTypingIndicator.mockImplementationOnce(async ({ chatId }) => {
      steps.push(`stop:${chatId}`);
    });
    mocks.exportHostedPendingAssistantUsage.mockImplementationOnce(async () => {
      steps.push("usage");
      return {
        exported: 1,
        failed: 0,
        pending: 0,
      };
    });

    await completeHostedRunDrainAfterCommit({
      run: HOSTED_RUN_CONTEXT,
      request: {
        bundle: "committed-bundle",
        run: HOSTED_RUN_CONTEXT,
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "runtime_timer",
          userId: "member_123",
          resumeFinalize: true,
        },
      },
      restored: createRestored(),
      runtime,
      wake: buildHostedExecutionLinqConversationMessageWake({
        eventId: "evt_delivery_finished_callback",
        linqMessage: {
          chatId: "chat_123",
          from: "+15551234567",
          isFromMe: false,
          messageId: "linq_message_123",
          parts: [{ type: "text", value: "hello" }],
        },
        occurredAt: "2026-04-08T00:00:00.000Z",
        phoneLookupKey: "15551234567",
        userId: "member_123",
      }),
    });

    expect(mocks.stopLinqChatTypingIndicator).toHaveBeenCalledWith(
      {
        chatId: "chat_123",
      },
      {
        env: expect.objectContaining({
          HOSTED_RUN_MESSAGING_ACTIVITY_OWNER: "executor",
          LINQ_API_TOKEN: "linq-token",
        }),
      },
    );
    expect(steps).toEqual([
      "drain",
      "stop:chat_123",
      "usage",
    ]);
  });

  it("returns a final result when best-effort post-commit exports fail", async () => {
    mocks.exportHostedPendingAssistantUsage.mockRejectedValueOnce(
      new Error("usage export unavailable"),
    );
    mocks.refreshAssistantStatusSnapshot.mockRejectedValueOnce(
      new Error("status refresh unavailable"),
    );
    mocks.exportGatewayProjectionSnapshotLocal.mockRejectedValueOnce(
      new Error("gateway export unavailable"),
    );
    mocks.exportHostedBrowserVaultReplica.mockRejectedValueOnce(
      new Error("browser vault export unavailable"),
    );

    const result = await completeHostedRunDrainAfterCommit({
      request: {
        bundle: "bundle-that-breaks-listing",
        run: HOSTED_RUN_CONTEXT,
        runDrain: {
          acquiredAt: "2026-04-08T00:00:00.000Z",
          events: [],
          inputCommittedSeq: "24",
          inputCursorVersion: "4",
          runId: "run_123",
          triggerKind: "runtime_timer",
          userId: "member_123",
          resumeFinalize: true,
        },
      },
      restored: createRestored(),
      runtime: createRuntime(),
      wake: buildHostedExecutionRuntimeTimerWake({
        eventId: "evt_best_effort_exports",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      }),
    });

    assert.equal(result.phase, "completed");
    assert.equal(result.finalGatewayProjectionSnapshot, null);
    assert.equal(result.browserVaultReplica, null);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not export pending assistant usage after draining side effects; leaving the pending usage records in the final bundle.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not refresh the assistant status snapshot after draining side effects; continuing with the final bundle snapshot.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not export the final gateway projection snapshot; returning the final bundle without it.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not export the browser vault replica; returning the final bundle without it.",
      }),
    );
  });
});
