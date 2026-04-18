import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";
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
  drainHostedCommittedAssistantDeliveriesAfterCommit: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  encodeHostedBundleBase64: vi.fn(),
  executeHostedDispatchEvent: vi.fn(),
  exportGatewayProjectionSnapshotLocal: vi.fn(),
  exportHostedPendingAssistantUsage: vi.fn(),
  getAssistantCronStatus: vi.fn(),
  getAssistantStatus: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listHostedBundleArtifacts: vi.fn(),
  readHostedAssistantExecutionDefaultTarget: vi.fn(),
  refreshAssistantStatusSnapshot: vi.fn(),
  runHostedMaintenanceLoop: vi.fn(),
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
  executeHostedDispatchEvent: mocks.executeHostedDispatchEvent,
}));

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedMaintenanceLoop: mocks.runHostedMaintenanceLoop,
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

import {
  completeHostedExecutionAfterCommit,
  executeHostedDispatchForCommit,
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
  mocks.executeHostedDispatchEvent.mockResolvedValue({
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
    maintenanceRequired: true,
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.runHostedMaintenanceLoop.mockResolvedValue({
    deviceSyncProcessed: 2,
    deviceSyncSkipped: false,
    nextWakeAt: "2026-04-08T00:30:00.000Z",
    parserProcessed: 3,
  });
  mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockResolvedValue([
    {
      deliveryChannel: "linq",
      deliveryErrorCode: null,
      deliveryStatus: "sent",
      effectFingerprint: "dedupe_123",
      effectId: "intent_123",
      journalMethod: null,
      journalStatus: null,
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

describe("executeHostedDispatchForCommit", () => {
  it("runs the dispatch and maintenance loops, snapshots the workspace, and summarizes the commit", async () => {
    mocks.listHostedBundleArtifacts.mockReturnValue([
      {
        path: "vault/raw/already-materialized.bin",
        ref: {
          sha256: "sha_existing",
        },
      },
    ]);

    const result = await executeHostedDispatchForCommit({
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
        dispatch: {
          event: {
            kind: "member.activated",
            memberChannels: {
              email: false,
              linq: false,
              telegram: false,
            },
            userId: "member_123",
          },
          eventId: "evt_123",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
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
            async writeAssistantDeliveryRecord(record) {
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

    expect(mocks.executeHostedDispatchEvent).toHaveBeenCalledWith({
      dispatch: {
        event: {
          kind: "member.activated",
          memberChannels: {
            email: false,
            linq: false,
            telegram: false,
          },
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
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
    expect(mocks.runHostedMaintenanceLoop).toHaveBeenCalledWith(
      expect.objectContaining({
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
        skipAssistantAutomation: true,
        timeoutMs: 45_000,
      }),
    );
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
    assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:30:00.000Z");
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

    await executeHostedDispatchForCommit({
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
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_123",
          },
          eventId: "evt_existing_default_target",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
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
            async writeAssistantDeliveryRecord(record) {
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

    expect(mocks.runHostedMaintenanceLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: {
          hosted: expect.objectContaining({
            defaultTarget: existingDefaultTarget,
          }),
        },
      }),
    );
  });

  it("skips the generic maintenance loop when dispatch handlers do not require it", async () => {
    mocks.executeHostedDispatchEvent.mockResolvedValue({
      bootstrapResult: null,
      maintenanceRequired: false,
      shareImportResult: null,
      shareImportTitle: null,
    });

    const result = await executeHostedDispatchForCommit({
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
        dispatch: {
          event: {
            kind: "linq.message.received",
            linqEvent: {
              event_type: "message.received",
            },
            phoneLookupKey: "15551234567",
            userId: "member_123",
          },
          eventId: "evt_linq_message",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
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
            async writeAssistantDeliveryRecord(record) {
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

    expect(mocks.runHostedMaintenanceLoop).not.toHaveBeenCalled();
    assert.equal(result.committedResult.result.nextWakeAt, null);
    assert.equal(
      result.committedResult.result.summary,
      "Persisted Linq capture on the hosted conversation lane.",
    );
  });

  it("preserves a pending assistant wake when dispatch handlers skip generic maintenance", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));
      mocks.executeHostedDispatchEvent.mockResolvedValue({
        bootstrapResult: null,
        maintenanceRequired: false,
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

      const result = await executeHostedDispatchForCommit({
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
          dispatch: {
            event: {
              kind: "telegram.message.received",
              telegramMessage: {
                messageId: "telegram_message_123",
                schema: "murph.hosted-telegram-message.v1",
                text: "hello",
                threadId: "telegram_thread_123",
              },
              userId: "member_123",
            },
            eventId: "evt_telegram_message",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
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
              async writeAssistantDeliveryRecord(record) {
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

      expect(mocks.runHostedMaintenanceLoop).not.toHaveBeenCalled();
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
      mocks.executeHostedDispatchEvent.mockResolvedValue({
        bootstrapResult: null,
        maintenanceRequired: false,
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

      const result = await executeHostedDispatchForCommit({
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
          dispatch: {
            event: {
              kind: "email.message.received",
              identityId: null,
              rawMessageKey: "raw/message.eml",
              userId: "member_123",
            },
            eventId: "evt_email_message",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
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
              async writeAssistantDeliveryRecord(record) {
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
      mocks.executeHostedDispatchEvent.mockResolvedValue({
        bootstrapResult: null,
        maintenanceRequired: false,
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

      const result = await executeHostedDispatchForCommit({
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
          dispatch: {
            event: {
              kind: "linq.message.received",
              linqEvent: {
                event_type: "message.received",
              },
              phoneLookupKey: "15551234567",
              userId: "member_123",
            },
            eventId: "evt_linq_message_device_sync",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
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
              async writeAssistantDeliveryRecord(record) {
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

      expect(mocks.runHostedMaintenanceLoop).not.toHaveBeenCalled();
      expect(mocks.createConfiguredDeviceSyncProvidersFromConfigs).toHaveBeenCalledWith({});
      expect(close).toHaveBeenCalledTimes(1);
      assert.equal(result.committedResult.result.nextWakeAt, "2026-04-08T00:25:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a null preserved wake when assistant and device-sync wake lookups fail", async () => {
    mocks.executeHostedDispatchEvent.mockResolvedValue({
      bootstrapResult: null,
      maintenanceRequired: false,
      shareImportResult: null,
      shareImportTitle: null,
    });
    mocks.getAssistantStatus.mockRejectedValue(new Error("status read failed"));
    mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockImplementation(() => {
      throw new Error("device sync init failed");
    });

    const result = await executeHostedDispatchForCommit({
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
        dispatch: {
          event: {
            kind: "linq.message.received",
            linqEvent: {
              event_type: "message.received",
            },
            phoneLookupKey: "15551234567",
            userId: "member_123",
          },
          eventId: "evt_linq_message_error",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
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
            async writeAssistantDeliveryRecord(record) {
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
          "Hosted runtime could not resolve the preserved assistant wake while skipping maintenance; continuing without it.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted runtime could not resolve the preserved device-sync wake while skipping maintenance; continuing without it.",
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
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
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
            async writeAssistantDeliveryRecord(record) {
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
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
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
          journalMethod: null,
          journalStatus: null,
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
});
