import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import type { HostedAssistantDeliveryRecord } from "@murphai/hosted-execution/side-effects";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

const mocks = vi.hoisted(() => ({
  assistantGatewayLocalProjectionSourceReader: Symbol(
    "assistantGatewayLocalProjectionSourceReader",
  ),
  collectHostedAssistantDeliverySideEffects: vi.fn(),
  createHostedArtifactUploadSink: vi.fn(),
  createConfiguredDeviceSyncProvidersFromConfigs: vi.fn(),
  createDeviceSyncRegistry: vi.fn(),
  createDeviceSyncService: vi.fn(),
  decodeHostedBundleBase64: vi.fn(),
  drainHostedParserQueueUntilSettled: vi.fn(),
  drainHostedCommittedAssistantDeliveriesAfterCommit: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  encodeHostedBundleBase64: vi.fn(),
  executeHostedWakeEvent: vi.fn(),
  exportGatewayProjectionSnapshotLocal: vi.fn(),
  exportHostedBrowserVaultSnapshot: vi.fn(),
  exportHostedPendingAssistantUsage: vi.fn(),
  getAssistantCronStatus: vi.fn(),
  getAssistantStatus: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listHostedBundleArtifacts: vi.fn(),
  readHostedAssistantExecutionDefaultTarget: vi.fn(),
  refreshAssistantStatusSnapshot: vi.fn(),
  runHostedAssistantCronWakeLane: vi.fn(),
  runHostedConversationAssistantAutomation: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
  runHostedNoopSystemWakeLane: vi.fn(),
  snapshotHostedExecutionContext: vi.fn(),
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
  getAssistantCronStatus: mocks.getAssistantCronStatus,
  getAssistantStatus: mocks.getAssistantStatus,
  refreshAssistantStatusSnapshot: mocks.refreshAssistantStatusSnapshot,
}));

vi.mock("@murphai/device-syncd/config", () => ({
  createConfiguredDeviceSyncProvidersFromConfigs:
    mocks.createConfiguredDeviceSyncProvidersFromConfigs,
}));

vi.mock("@murphai/device-syncd/registry", () => ({
  createDeviceSyncRegistry: mocks.createDeviceSyncRegistry,
}));

vi.mock("@murphai/device-syncd/service", () => ({
  createDeviceSyncService: mocks.createDeviceSyncService,
}));

vi.mock("@murphai/assistant-engine/gateway-local-adapter", () => ({
  assistantGatewayLocalProjectionSourceReader:
    mocks.assistantGatewayLocalProjectionSourceReader,
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

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedWakeEvent: mocks.executeHostedWakeEvent,
}));

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedAssistantCronWakeLane: mocks.runHostedAssistantCronWakeLane,
  drainHostedParserQueueUntilSettled: mocks.drainHostedParserQueueUntilSettled,
  runHostedConversationAssistantAutomation:
    mocks.runHostedConversationAssistantAutomation,
  runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
  runHostedNoopSystemWakeLane: mocks.runHostedNoopSystemWakeLane,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget:
    mocks.hydrateHostedExecutionDefaultTarget,
  readHostedAssistantExecutionDefaultTarget:
    mocks.readHostedAssistantExecutionDefaultTarget,
}));

vi.mock("../src/hosted-runtime/usage.ts", () => ({
  exportHostedPendingAssistantUsage: mocks.exportHostedPendingAssistantUsage,
}));

vi.mock("../src/hosted-runtime/browser-vault.ts", () => ({
  exportHostedBrowserVaultSnapshot: mocks.exportHostedBrowserVaultSnapshot,
}));

import {
  completeHostedExecutionAfterCommit,
  executeHostedWakeForCommit,
} from "../src/hosted-runtime/execution.ts";
import { createHostedRuntimeResolvedConfig } from "./hosted-runtime-test-helpers.ts";

const incomingBundle = Uint8Array.from([1, 2, 3]);
const committedBundle = Uint8Array.from([4, 5, 6]);
const hostedDeliveryEffect = {
  effectId: "intent_123",
  fingerprint: "dedupe_123",
  kind: "assistant.delivery" as const,
  payload: {
    actorId: "actor_123",
    bindingDeliveryKind: "participant" as const,
    bindingDeliveryTarget: "chat_123",
    channel: "telegram",
    explicitTarget: null,
    idempotencyKey: "assistant-outbox:intent_123",
    identityId: "identity_123",
    message: "hello from hosted",
    subject: null,
    replyToMessageId: null,
    sessionId: "session_123",
    threadId: "thread_123",
    threadIsDirect: true,
    transportIdempotent: false,
    turnId: "turn_123",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decodeHostedBundleBase64.mockImplementation((bundle: string | null) => {
    if (bundle === "incoming-bundle") {
      return incomingBundle;
    }
    if (bundle === "committed-bundle") {
      return committedBundle;
    }
    return null;
  });
  mocks.encodeHostedBundleBase64.mockImplementation((bytes: Uint8Array) =>
    Buffer.from(bytes).toString("base64"),
  );
  mocks.createHostedArtifactUploadSink.mockReturnValue(Symbol("artifact-sink"));
  mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue([]);
  mocks.createDeviceSyncRegistry.mockReturnValue({
    list() {
      return [];
    },
  });
  mocks.createDeviceSyncService.mockReturnValue({
    close: vi.fn(),
    getNextWakeAt: vi.fn(() => null),
  });
  mocks.snapshotHostedExecutionContext.mockResolvedValue({
    bundle: Uint8Array.from([9, 9, 9]),
  });
  mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
    hostedDeliveryEffect,
  ]);
  mocks.exportGatewayProjectionSnapshotLocal.mockResolvedValue({
    schema: "murph.gateway-projection-snapshot.v1",
    generatedAt: "2026-04-08T00:10:00.000Z",
    conversations: [],
    messages: [],
    permissions: [],
  });
  mocks.executeHostedWakeEvent.mockResolvedValue({
    bootstrapResult: {
      assistantConfigStatus: "missing",
      assistantConfigured: false,
      assistantProvider: null,
      assistantSeeded: false,
      emailAutoReplyEnabled: false,
      linqAutoReplyEnabled: false,
      telegramAutoReplyEnabled: false,
      vaultCreated: true,
    },
    conversationMetrics: null,
    followupExecution: "assistant-cron",
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.runHostedAssistantCronWakeLane.mockResolvedValue({
    deviceSyncProcessed: 2,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:30:00.000Z",
    parserProcessed: 3,
    wakeMaterializationHints: null,
  });
  mocks.runHostedDeviceSyncWakeLane.mockResolvedValue({
    deviceSyncProcessed: 2,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:30:00.000Z",
    parserProcessed: 0,
    wakeMaterializationHints: null,
  });
  mocks.runHostedNoopSystemWakeLane.mockReturnValue({
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
    wakeMaterializationHints: null,
  });
  mocks.runHostedConversationAssistantAutomation.mockResolvedValue({
    nextWakeAt: null,
    progressed: false,
  });
  mocks.drainHostedParserQueueUntilSettled.mockResolvedValue({
    nextWakeAt: null,
    processedJobs: 0,
  });
  mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockResolvedValue([
    {
      deliveryChannel: "linq",
      deliveryErrorCode: null,
      deliveryStatus: "sent",
      effectFingerprint: "dedupe_123",
      effectId: "intent_123",
      providerMessageId: "linq_message_123",
      providerThreadId: "chat_123",
      retryable: false,
      target: "chat_123",
      targetKind: "thread",
    },
  ]);
  mocks.exportHostedPendingAssistantUsage.mockResolvedValue({
    exported: 1,
    failed: 0,
    pending: 0,
  });
  mocks.exportHostedBrowserVaultSnapshot.mockResolvedValue({
    entities: [],
    generatedAt: "2026-04-08T00:10:00.000Z",
    metadata: null,
    schema: "murph.browser-vault-snapshot.v1",
    sourceVersion: "a".repeat(64),
  });
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (executionContext) => {
    if (executionContext.hosted?.defaultTarget) {
      return executionContext;
    }

    const defaultTarget = await mocks.readHostedAssistantExecutionDefaultTarget();
    if (!defaultTarget || !executionContext.hosted) {
      return executionContext;
    }

    return {
      ...executionContext,
      hosted: {
        ...executionContext.hosted,
        defaultTarget,
      },
    };
  });
  mocks.readHostedAssistantExecutionDefaultTarget.mockResolvedValue({
    adapter: "openai-compatible",
    apiKeyEnv: "OPENAI_API_KEY",
    endpoint: "https://api.openai.com/v1",
    headers: null,
    model: "gpt-4.1-mini",
    presetId: null,
    providerName: "OpenAI",
    reasoningEffort: null,
    webSearch: null,
  });
  mocks.refreshAssistantStatusSnapshot.mockResolvedValue(undefined);
  mocks.getAssistantCronStatus.mockResolvedValue({
    nextRunAt: null,
  });
  mocks.getAssistantStatus.mockResolvedValue({
    outbox: {
      nextAttemptAt: null,
    },
    recentTurns: [],
  });
});

describe("executeHostedWakeForCommit", () => {
  it("runs wake handling and system maintenance, snapshots the workspace, and summarizes the commit", async () => {
    mocks.executeHostedWakeEvent.mockResolvedValueOnce({
      bootstrapResult: {
        assistantConfigStatus: "missing",
        assistantConfigured: false,
        assistantProvider: null,
        assistantSeeded: false,
        emailAutoReplyEnabled: false,
        linqAutoReplyEnabled: false,
        telegramAutoReplyEnabled: false,
        vaultCreated: true,
      },
      conversationMetrics: null,
      followupExecution: "member-activated",
      shareImportResult: null,
      shareImportTitle: null,
    });
    mocks.listHostedBundleArtifacts.mockReturnValue([
      {
        path: "vault/raw/already-materialized.bin",
        ref: {
          sha256: "sha_existing",
        },
      },
    ]);

    const result = await executeHostedWakeForCommit({
      artifactMaterializer: vi.fn(),
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      materializedArtifactPaths: new Set(["vault/raw/already-materialized.bin"]),
      request: {
        bundle: "incoming-bundle",
        wake: buildHostedExecutionMemberActivatedWake({
          eventId: "evt_123",
          memberChannels: {
            email: false,
            linq: false,
            telegram: false,
          },
          memberId: "member_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        }),
      },
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: null,
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
      runtimeEnv: {
        OPENAI_API_KEY: "secret",
      },
    });

    expect(mocks.executeHostedWakeEvent).toHaveBeenCalledWith({
      wake: buildHostedExecutionMemberActivatedWake({
        eventId: "evt_123",
        memberChannels: {
          email: false,
          linq: false,
          telegram: false,
        },
        memberId: "member_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
      }),
      executionContext: {
        hosted: {
          defaultTarget: {
            adapter: "openai-compatible",
            apiKeyEnv: "OPENAI_API_KEY",
            endpoint: "https://api.openai.com/v1",
            headers: null,
            model: "gpt-4.1-mini",
            presetId: null,
            providerName: "OpenAI",
            reasoningEffort: null,
            webSearch: null,
          },
          issueDeviceConnectLink: expect.any(Function),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      runtime: expect.objectContaining({
        commitTimeoutMs: 45_000,
      }),
      runtimeEnv: {
        OPENAI_API_KEY: "secret",
      },
      sharePack: null,
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.runHostedNoopSystemWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantCronWakeLane).not.toHaveBeenCalled();
    expect(mocks.createHostedArtifactUploadSink).toHaveBeenCalledWith({
      artifactStore: expect.any(Object),
      knownArtifactHashes: new Set(["sha_existing"]),
    });
    expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledWith({
      artifactSink: expect.any(Symbol),
      operatorHomeRoot: "/tmp/operator-home",
      preservedArtifacts: [],
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith("/tmp/vault-root");
    assert.deepEqual(result.committedAssistantDeliveryEffects, [
      hostedDeliveryEffect,
    ]);
    assert.equal(result.committedResult.result.eventsHandled, 1);
    assert.equal(result.committedResult.result.nextWakeAt, null);
    assert.match(result.committedResult.result.summary, /Processed member activation/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          committedAssistantDeliveryEffectCount: "1",
        }),
        message: "Hosted runtime collected committed assistant delivery effects.",
        phase: "commit.recorded",
      }),
    );
  });

  it("continues when the committed gateway projection export fails", async () => {
    mocks.exportGatewayProjectionSnapshotLocal.mockRejectedValueOnce(
      new Error("gateway export unavailable"),
    );

    const result = await executeHostedWakeForCommit({
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      request: {
        bundle: "incoming-bundle",
        wake: buildHostedExecutionAssistantCronTickWake({
          eventId: "evt_committed_gateway_fallback",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        }),
      },
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: null,
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
      runtimeEnv: {},
    });

    assert.equal(result.committedGatewayProjectionSnapshot, null);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not export the committed gateway projection snapshot; continuing without it.",
        phase: "commit.recorded",
      }),
    );
  });

  it("preserves an existing hosted execution default target during maintenance setup", async () => {
    const existingDefaultTarget = {
      adapter: "openai-compatible" as const,
      apiKeyEnv: "CUSTOM_OPENAI_API_KEY",
      endpoint: "https://example.test/v1",
      headers: null,
      model: "gpt-4.1-mini",
      presetId: null,
      providerName: "Custom OpenAI",
      reasoningEffort: null,
      webSearch: "murph" as const,
    };

    await executeHostedWakeForCommit({
      artifactMaterializer: vi.fn(),
      executionContext: {
        hosted: {
          defaultTarget: existingDefaultTarget,
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      request: {
        bundle: "incoming-bundle",
        wake: buildHostedExecutionAssistantCronTickWake({
          eventId: "evt_existing_default_target",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "manual",
          userId: "member_123",
        }),
      },
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: null,
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
      runtimeEnv: {
        OPENAI_API_KEY: "secret",
      },
    });

    expect(mocks.runHostedAssistantCronWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: {
          hosted: expect.objectContaining({
            defaultTarget: existingDefaultTarget,
          }),
        },
        requestId: "evt_existing_default_target",
      }),
    );
  });

  it("keeps member channel updates on the explicit no-op system lane", async () => {
    mocks.executeHostedWakeEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      followupExecution: "member-channels-updated",
      shareImportResult: null,
      shareImportTitle: null,
    });

    const result = await executeHostedWakeForCommit({
      artifactMaterializer: vi.fn(),
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      request: {
        bundle: "incoming-bundle",
        wake: buildHostedExecutionMemberChannelsUpdatedWake({
          eventId: "evt_member_channels_updated",
          memberChannels: {
            email: true,
            linq: true,
            telegram: false,
          },
          memberId: "member_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        }),
      },
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: null,
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
      runtimeEnv: {},
    });

    expect(mocks.runHostedNoopSystemWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantCronWakeLane).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result.committedResult.result.nextWakeAt).toBe(null);
    expect(result.committedResult.result.summary).toBe("Processed member channel sync.");
  });

  it("skips the generic maintenance loop when the conversation lane stays on wake follow-up", async () => {
    mocks.executeHostedWakeEvent.mockResolvedValue({
      bootstrapResult: null,
      conversationMetrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      followupExecution: "conversation-message",
      shareImportResult: null,
      shareImportTitle: null,
    });

    const result = await executeHostedWakeForCommit({
      artifactMaterializer: vi.fn(),
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      request: {
        bundle: "incoming-bundle",
        wake: buildHostedExecutionLinqConversationMessageWake({
          eventId: "evt_linq_message",
          linqMessage: {
            chatId: "chat_123",
            from: "+15551234567",
            isFromMe: false,
            messageId: "linq_message_123",
            parts: [
              {
                value: "hello",
                type: "text",
              },
            ],
          },
          occurredAt: "2026-04-08T00:00:00.000Z",
          phoneLookupKey: "15551234567",
          userId: "member_123",
        }),
      },
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: null,
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
      runtimeEnv: {},
    });

    expect(mocks.runHostedAssistantCronWakeLane).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.runHostedNoopSystemWakeLane).not.toHaveBeenCalled();
    expect(mocks.drainHostedParserQueueUntilSettled).not.toHaveBeenCalled();
    expect(mocks.runHostedConversationAssistantAutomation).not.toHaveBeenCalled();
    assert.equal(result.committedResult.result.nextWakeAt, null);
    assert.equal(
      result.committedResult.result.summary,
      "Persisted Linq capture on the hosted conversation lane.",
    );
  });

  it("propagates conversation-lane nextWakeAt returned by the wake handler", async () => {
    mocks.executeHostedWakeEvent.mockResolvedValue({
      bootstrapResult: null,
      conversationMetrics: {
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        parserProcessed: 2,
      },
      followupExecution: "conversation-message",
      shareImportResult: null,
      shareImportTitle: null,
    });

    const result = await executeHostedWakeForCommit({
      artifactMaterializer: vi.fn(),
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      request: {
        bundle: "incoming-bundle",
        wake: buildHostedExecutionTelegramConversationMessageWake({
          eventId: "evt_telegram_message",
          occurredAt: "2026-04-08T00:00:00.000Z",
          telegramMessage: {
            messageId: "tg_message_123",
            schema: "murph.hosted-telegram-message.v1",
            threadId: "thread_123",
          },
          userId: "member_123",
        }),
      },
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          deviceSyncPort: null,
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: null,
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
      runtimeEnv: {},
    });

    expect(mocks.drainHostedParserQueueUntilSettled).not.toHaveBeenCalled();
    expect(mocks.runHostedConversationAssistantAutomation).not.toHaveBeenCalled();
    expect(result.committedResult.result.nextWakeAt).toBe("2026-04-08T00:00:00.000Z");
    expect(result.committedResult.result.summary).toBe(
      "Persisted Telegram capture on the hosted conversation lane.",
    );
  });

  it("preserves a pending assistant wake when the conversation lane skips generic maintenance", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
      mocks.executeHostedWakeEvent.mockResolvedValue({
        bootstrapResult: null,
        conversationMetrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
        followupExecution: "conversation-message",
        shareImportResult: null,
        shareImportTitle: null,
      });
      mocks.getAssistantStatus.mockResolvedValue({
        outbox: {
          nextAttemptAt: "2026-04-08T00:20:00.000Z",
        },
        recentTurns: [],
      });
      mocks.getAssistantCronStatus.mockResolvedValue({
        nextRunAt: "2026-04-08T00:30:00.000Z",
      });

      const result = await executeHostedWakeForCommit({
        artifactMaterializer: vi.fn(),
        executionContext: {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        request: {
          bundle: "incoming-bundle",
          wake: buildHostedExecutionTelegramConversationMessageWake({
            eventId: "evt_telegram_message",
            occurredAt: "2026-04-08T00:00:00.000Z",
            telegramMessage: {
              messageId: "telegram_message_123",
              schema: "murph.hosted-telegram-message.v1",
              text: "hello",
              threadId: "telegram_thread_123",
            },
            userId: "member_123",
          }),
        },
        restored: {
          assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
          operatorHomeRoot: "/tmp/operator-home",
          vaultRoot: "/tmp/vault-root",
        },
        runtime: {
          commitTimeoutMs: 45_000,
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            effectsPort: {
              async deletePreparedAssistantDelivery() {},
              async readRawEmailMessage() {
                return null;
              },
              async readAssistantDeliveryRecord() {
                return null;
              },
              async sendEmail() {},
              async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
                return record;
              },
            },
            usageExportPort: null,
          },
          resolvedConfig: createHostedRuntimeResolvedConfig(),
          userEnv: {},
        },
        runtimeEnv: {},
      });

      expect(mocks.runHostedAssistantCronWakeLane).not.toHaveBeenCalled();
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(mocks.runHostedNoopSystemWakeLane).not.toHaveBeenCalled();
      expect(mocks.getAssistantStatus).toHaveBeenCalledWith({
        limit: 200,
        vault: "/tmp/vault-root",
      });
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:20:00.000Z");
      assert.equal(
        result.committedResult.result.summary,
        "Persisted Telegram capture on the hosted conversation lane.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("promotes due assistant recovery work to an immediate preserved wake when maintenance is skipped", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
      mocks.executeHostedWakeEvent.mockResolvedValue({
        bootstrapResult: null,
        conversationMetrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
        followupExecution: "conversation-message",
        shareImportResult: null,
        shareImportTitle: null,
      });
      mocks.getAssistantStatus.mockResolvedValue({
        outbox: {
          nextAttemptAt: null,
        },
        recentTurns: [
          {
            deliveryDisposition: "failed",
            deliveryIntentId: null,
            deliveryRequested: true,
            completedAt: null,
            lastError: null,
            promptPreview: null,
            provider: "openai-compatible",
            providerModel: "gpt-4.1-mini",
            responsePreview: null,
            schema: "murph.assistant-turn-receipt.v1",
            sessionId: "session_123",
            startedAt: "2026-04-08T00:00:00.000Z",
            status: "failed",
            timeline: [
              {
                at: "2026-04-08T00:00:00.000Z",
                detail: null,
                kind: "turn.started",
                metadata: {
                  autoReplyCaptureId: "capture_123",
                },
              },
              {
                at: "2026-04-08T00:05:00.000Z",
                detail: null,
                kind: "turn.deferred",
                metadata: {
                  autoReplyRetryAt: "2026-04-08T00:09:00.000Z",
                },
              },
            ],
            turnId: "turn_123",
            updatedAt: "2026-04-08T00:05:00.000Z",
          },
        ],
      });

      const result = await executeHostedWakeForCommit({
        artifactMaterializer: vi.fn(),
        executionContext: {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        request: {
          bundle: "incoming-bundle",
          wake: buildHostedExecutionEmailConversationMessageWake({
            eventId: "evt_email_message",
            identityId: null,
            occurredAt: "2026-04-08T00:00:00.000Z",
            rawMessageKey: "raw/message.eml",
            userId: "member_123",
          }),
        },
        restored: {
          assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
          operatorHomeRoot: "/tmp/operator-home",
          vaultRoot: "/tmp/vault-root",
        },
        runtime: {
          commitTimeoutMs: 45_000,
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            effectsPort: {
              async deletePreparedAssistantDelivery() {},
              async readRawEmailMessage() {
                return null;
              },
              async readAssistantDeliveryRecord() {
                return null;
              },
              async sendEmail() {},
              async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
                return record;
              },
            },
            usageExportPort: null,
          },
          resolvedConfig: createHostedRuntimeResolvedConfig(),
          userEnv: {},
        },
        runtimeEnv: {},
      });

      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:10:00.000Z");
      expect(result.committedResult.result.wakeMaterializationHints).toEqual({
        assistantWakeAt: "2026-04-08T00:10:00.000Z",
        deviceSyncWakeAt: null,
      });
      assert.equal(
        result.committedResult.result.summary,
        "Persisted hosted email capture on the hosted conversation lane.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a device-sync wake without running the generic maintenance loop", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
      mocks.executeHostedWakeEvent.mockResolvedValue({
        bootstrapResult: null,
        conversationMetrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
        followupExecution: "conversation-message",
        shareImportResult: null,
        shareImportTitle: null,
      });
      const close = vi.fn();
      mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue([
        {
          provider: "oura",
        },
      ]);
      mocks.createDeviceSyncRegistry.mockReturnValue({
        list() {
          return [{ provider: "oura" }];
        },
      });
      mocks.createDeviceSyncService.mockReturnValue({
        close,
        getNextWakeAt() {
          return "2026-04-08T00:25:00.000Z";
        },
      });

      const result = await executeHostedWakeForCommit({
        artifactMaterializer: vi.fn(),
        executionContext: {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        request: {
          bundle: "incoming-bundle",
          wake: buildHostedExecutionLinqConversationMessageWake({
            eventId: "evt_linq_message_device_sync",
            linqMessage: {
              chatId: "chat_123",
              from: "+15551234567",
              isFromMe: false,
              messageId: "linq_message_device_sync",
              parts: [
                {
                  value: "hello",
                  type: "text",
                },
              ],
            },
            occurredAt: "2026-04-08T00:00:00.000Z",
            phoneLookupKey: "15551234567",
            userId: "member_123",
          }),
        },
        restored: {
          assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
          operatorHomeRoot: "/tmp/operator-home",
          vaultRoot: "/tmp/vault-root",
        },
        runtime: {
          commitTimeoutMs: 45_000,
          platform: {
            artifactStore: {
              async get() {
                return null;
              },
              async put() {},
            },
            effectsPort: {
              async deletePreparedAssistantDelivery() {},
              async readRawEmailMessage() {
                return null;
              },
              async readAssistantDeliveryRecord() {
                return null;
              },
              async sendEmail() {},
              async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
                return record;
              },
            },
            usageExportPort: null,
          },
          resolvedConfig: createHostedRuntimeResolvedConfig({
            deviceSync: {
              providerConfigs: {},
              publicBaseUrl: "https://device-sync.example.test",
              secret: "device-sync-secret",
            },
          }),
          userEnv: {},
        },
        runtimeEnv: {},
      });

      expect(mocks.runHostedAssistantCronWakeLane).not.toHaveBeenCalled();
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(mocks.runHostedNoopSystemWakeLane).not.toHaveBeenCalled();
      expect(mocks.createConfiguredDeviceSyncProvidersFromConfigs).toHaveBeenCalledWith({});
      expect(close).toHaveBeenCalledTimes(1);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:25:00.000Z");
      expect(result.committedResult.result.wakeMaterializationHints).toEqual({
        assistantWakeAt: null,
        deviceSyncWakeAt: "2026-04-08T00:25:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a null preserved wake when assistant and device-sync wake lookups fail", async () => {
    mocks.executeHostedWakeEvent.mockResolvedValue({
      bootstrapResult: null,
      conversationMetrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      followupExecution: "conversation-message",
      shareImportResult: null,
      shareImportTitle: null,
    });
    mocks.getAssistantStatus.mockRejectedValue(new Error("status read failed"));
    mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockImplementation(() => {
      throw new Error("device sync init failed");
    });

    const result = await executeHostedWakeForCommit({
      artifactMaterializer: vi.fn(),
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      request: {
        bundle: "incoming-bundle",
        wake: buildHostedExecutionLinqConversationMessageWake({
          eventId: "evt_linq_message_error",
          linqMessage: {
            chatId: "chat_123",
            from: "+15551234567",
            isFromMe: false,
            messageId: "linq_message_error",
            parts: [
              {
                value: "hello",
                type: "text",
              },
            ],
          },
          occurredAt: "2026-04-08T00:00:00.000Z",
          phoneLookupKey: "15551234567",
          userId: "member_123",
        }),
      },
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: null,
        },
        resolvedConfig: createHostedRuntimeResolvedConfig({
          deviceSync: {
            providerConfigs: {},
            publicBaseUrl: "https://device-sync.example.test",
            secret: "device-sync-secret",
          },
        }),
        userEnv: {},
      },
      runtimeEnv: {},
    });

    assert.equal(result.committedResult.result.nextWakeAt, null);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not resolve the preserved assistant wake after conversation wake handling; continuing without it.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not resolve the preserved device-sync wake after conversation wake handling; continuing without it.",
      }),
    );
  });
});

describe("completeHostedExecutionAfterCommit", () => {
  it("drains committed side effects, exports usage, reconciles email state, and preserves only untouched artifacts", async () => {
    mocks.listHostedBundleArtifacts.mockReturnValue([
      {
        path: "vault/raw/already-materialized.bin",
        ref: {
          sha256: "sha_materialized",
        },
      },
      {
        path: "vault/raw/preserved.bin",
        ref: {
          sha256: "sha_preserved",
        },
      },
    ]);

    const result = await completeHostedExecutionAfterCommit({
      committedExecution: {
        committedGatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-08T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
        committedResult: {
          bundle: "committed-bundle",
          result: {
            eventsHandled: 1,
            nextWakeAt: "2026-04-08T00:30:00.000Z",
            summary: "completed summary",
          },
        },
        committedAssistantDeliveryEffects: [
          hostedDeliveryEffect,
        ],
      },
      wake: buildHostedExecutionAssistantCronTickWake({
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      materializedArtifactPaths: new Set(["vault/raw/already-materialized.bin"]),
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      run: {
        attempt: 1,
        runId: "run_123",
        startedAt: "2026-04-08T00:00:00.000Z",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: {
            async recordUsage() {
              return { recorded: 1, usageIds: ["usage_123"] };
            },
          },
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
    });

    expect(mocks.drainHostedCommittedAssistantDeliveriesAfterCommit).toHaveBeenCalledWith({
      wake: buildHostedExecutionAssistantCronTickWake({
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      effectsPort: expect.any(Object),
      assistantDeliveryEffects: [
        hostedDeliveryEffect,
      ],
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.exportHostedPendingAssistantUsage).toHaveBeenCalledWith({
      usageExportPort: expect.any(Object),
      vaultRoot: "/tmp/vault-root",
    });
    expect(mocks.refreshAssistantStatusSnapshot).toHaveBeenCalledWith("/tmp/vault-root");
    expect(mocks.createHostedArtifactUploadSink).toHaveBeenCalledWith({
      artifactStore: expect.any(Object),
      knownArtifactHashes: new Set(["sha_materialized", "sha_preserved"]),
    });
    expect(mocks.snapshotHostedExecutionContext).toHaveBeenCalledWith({
      artifactSink: expect.any(Symbol),
      operatorHomeRoot: "/tmp/operator-home",
      preservedArtifacts: [
        {
          path: "vault/raw/preserved.bin",
          ref: {
            sha256: "sha_preserved",
          },
        },
      ],
      vaultRoot: "/tmp/vault-root",
    });
    assert.ok(result.browserVaultSnapshot);
    assert.equal(result.browserVaultSnapshot.schema, "murph.browser-vault-snapshot.v1");
    assert.equal(Array.isArray(result.browserVaultSnapshot.entities), true);
    assert.equal(result.browserVaultSnapshot.metadata, null);
    assert.match(result.browserVaultSnapshot.generatedAt, /^\d{4}-\d{2}-\d{2}T/u);
    assert.match(result.browserVaultSnapshot.sourceVersion, /^[a-f0-9]{64}$/u);
    assert.deepEqual({ ...result, browserVaultSnapshot: undefined }, {
      assistantDeliveryOutcomes: [
        {
          deliveryChannel: "linq",
          deliveryErrorCode: null,
          deliveryStatus: "sent",
          effectFingerprint: "dedupe_123",
          effectId: "intent_123",
          providerMessageId: "linq_message_123",
          providerThreadId: "chat_123",
          retryable: false,
          target: "chat_123",
          targetKind: "thread",
        },
      ],
      browserVaultSnapshot: undefined,
      finalGatewayProjectionSnapshot: {
        schema: "murph.gateway-projection-snapshot.v1",
        generatedAt: "2026-04-08T00:10:00.000Z",
        conversations: [],
        messages: [],
        permissions: [],
      },
      phase: "completed",
      result: {
        bundle: Buffer.from(Uint8Array.from([9, 9, 9])).toString("base64"),
        result: {
          eventsHandled: 1,
          nextWakeAt: "2026-04-08T00:30:00.000Z",
          summary: "completed summary",
        },
      },
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          assistantDeliveryEffectCount: "1",
        }),
        message: "Hosted runtime draining committed side effects.",
        phase: "side-effects.draining",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          assistantDeliveryOutcomeSummary: "linq:sent=1",
        }),
        message: "Hosted runtime drained committed side effects.",
        phase: "side-effects.draining",
      }),
    );
  });

  it("preserves ambiguous and retryable delivery outcomes through final result shaping", async () => {
    const retryableEffect = {
      ...hostedDeliveryEffect,
      effectId: "intent_456",
      fingerprint: "dedupe_456",
      payload: {
        ...hostedDeliveryEffect.payload,
        bindingDeliveryKind: "thread" as const,
        bindingDeliveryTarget: "thread_456",
        channel: "linq",
        explicitTarget: "thread_456",
        transportIdempotent: true,
      },
    };
    mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockResolvedValueOnce([
      {
        deliveryChannel: "telegram",
        deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
        deliveryErrorMessage: "mirror abandoned the delivery",
        deliveryStatus: "failed_ambiguous",
        effectFingerprint: hostedDeliveryEffect.fingerprint,
        effectId: hostedDeliveryEffect.effectId,
        providerMessageId: null,
        providerThreadId: null,
        retryable: false,
        target: "chat_123",
        targetKind: "participant",
      },
      {
        deliveryChannel: "linq",
        deliveryErrorCode: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
        deliveryErrorMessage: "linq confirmation pending",
        deliveryStatus: "retryable",
        effectFingerprint: retryableEffect.fingerprint,
        effectId: retryableEffect.effectId,
        providerMessageId: null,
        providerThreadId: "thread_456",
        retryable: true,
        target: "thread_456",
        targetKind: "thread",
      },
    ]);

    const result = await completeHostedExecutionAfterCommit({
      committedExecution: {
        committedGatewayProjectionSnapshot: {
          schema: "murph.gateway-projection-snapshot.v1",
          generatedAt: "2026-04-08T00:00:00.000Z",
          conversations: [],
          messages: [],
          permissions: [],
        },
        committedResult: {
          bundle: "committed-bundle",
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "completed summary",
          },
        },
        committedAssistantDeliveryEffects: [
          hostedDeliveryEffect,
          retryableEffect,
        ],
      },
      wake: buildHostedExecutionAssistantCronTickWake({
        eventId: "evt_delivery_outcomes",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      run: {
        attempt: 1,
        runId: "run_delivery_outcomes",
        startedAt: "2026-04-08T00:00:00.000Z",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: {
            async recordUsage() {
              return { recorded: 1, usageIds: ["usage_123"] };
            },
          },
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
    });

    expect(result.assistantDeliveryOutcomes).toEqual([
      {
        deliveryChannel: "telegram",
        deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
        deliveryErrorMessage: "mirror abandoned the delivery",
        deliveryStatus: "failed_ambiguous",
        effectFingerprint: hostedDeliveryEffect.fingerprint,
        effectId: hostedDeliveryEffect.effectId,
        providerMessageId: null,
        providerThreadId: null,
        retryable: false,
        target: "chat_123",
        targetKind: "participant",
      },
      {
        deliveryChannel: "linq",
        deliveryErrorCode: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
        deliveryErrorMessage: "linq confirmation pending",
        deliveryStatus: "retryable",
        effectFingerprint: retryableEffect.fingerprint,
        effectId: retryableEffect.effectId,
        providerMessageId: null,
        providerThreadId: "thread_456",
        retryable: true,
        target: "thread_456",
        targetKind: "thread",
      },
    ]);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: expect.objectContaining({
          assistantDeliveryOutcomeSummary: "linq:retryable=1,telegram:failed_ambiguous=1",
        }),
        message: "Hosted runtime drained committed side effects.",
        phase: "side-effects.draining",
      }),
    );
  });

  it("returns a final result when non-critical post-commit exports fail", async () => {
    mocks.exportHostedPendingAssistantUsage.mockRejectedValueOnce(
      new Error("usage export unavailable"),
    );
    mocks.refreshAssistantStatusSnapshot.mockRejectedValueOnce(
      new Error("status refresh unavailable"),
    );
    mocks.exportGatewayProjectionSnapshotLocal.mockRejectedValueOnce(
      new Error("gateway export unavailable"),
    );
    mocks.exportHostedBrowserVaultSnapshot.mockRejectedValueOnce(
      new Error("browser vault export unavailable"),
    );

    const result = await completeHostedExecutionAfterCommit({
      committedExecution: {
        committedGatewayProjectionSnapshot: null,
        committedResult: {
          bundle: "committed-bundle",
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "completed summary",
          },
        },
        committedAssistantDeliveryEffects: [],
      },
      wake: buildHostedExecutionAssistantCronTickWake({
        eventId: "evt_best_effort_exports",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "manual",
        userId: "member_123",
      }),
      restored: {
        assistantStateRoot: resolveAssistantStatePaths("/tmp/vault-root").assistantStateRoot,
        operatorHomeRoot: "/tmp/operator-home",
        vaultRoot: "/tmp/vault-root",
      },
      run: {
        attempt: 1,
        runId: "run_best_effort_exports",
        startedAt: "2026-04-08T00:00:00.000Z",
      },
      runtime: {
        commitTimeoutMs: 45_000,
        platform: {
          artifactStore: {
            async get() {
              return null;
            },
            async put() {},
          },
          effectsPort: {
            async deletePreparedAssistantDelivery() {},
            async readRawEmailMessage() {
              return null;
            },
            async readAssistantDeliveryRecord() {
              return null;
            },
            async sendEmail() {},
            async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
              return record;
            },
          },
          usageExportPort: {
            async recordUsage() {
              return { recorded: 1, usageIds: ["usage_123"] };
            },
          },
        },
        resolvedConfig: createHostedRuntimeResolvedConfig(),
        userEnv: {},
      },
    });

    assert.equal(result.phase, "completed");
    assert.equal(result.finalGatewayProjectionSnapshot, null);
    assert.equal(result.browserVaultSnapshot, null);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not export pending assistant usage after draining side effects; leaving the pending usage records in the final bundle.",
        phase: "side-effects.draining",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not refresh the assistant status snapshot after draining side effects; continuing with the final bundle snapshot.",
        phase: "side-effects.draining",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not export the final gateway projection snapshot; returning the final bundle without it.",
        phase: "completed",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not export the browser vault snapshot; returning the final bundle without it.",
        phase: "completed",
      }),
    );
  });
});
