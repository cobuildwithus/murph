import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";

const mocks = vi.hoisted(() => ({
  closeHostedRuntimeDeviceSyncService: vi.fn(),
  createStoreBackedAssistantInputSource: vi.fn(),
  createConfiguredDeviceSyncProvidersFromConfigs: vi.fn(),
  createDeviceSyncRegistry: vi.fn(),
  createHostedRuntimeDeviceSyncService: vi.fn(),
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  initInboxRuntime: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  readConfiguredJunctionDeviceSyncProviderConfig: vi.fn(),
  readHostedAssistantRuntimeState: vi.fn(),
  reconcileHostedDeviceSyncControlPlaneState: vi.fn(),
  runAssistantAutomationPass: vi.fn(),
  syncHostedDeviceSyncControlPlaneState: vi.fn(),
}));

vi.mock("@murphai/device-syncd/config", () => ({
  createConfiguredDeviceSyncProvidersFromConfigs:
    mocks.createConfiguredDeviceSyncProvidersFromConfigs,
  readConfiguredJunctionDeviceSyncProviderConfig:
    mocks.readConfiguredJunctionDeviceSyncProviderConfig,
}));

vi.mock("@murphai/device-syncd/registry", () => ({
  createDeviceSyncRegistry: mocks.createDeviceSyncRegistry,
}));

vi.mock("../src/device-sync-service.ts", () => ({
  closeHostedRuntimeDeviceSyncService: mocks.closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService: mocks.createHostedRuntimeDeviceSyncService,
}));

vi.mock("@murphai/assistant-engine", () => ({
  HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_SCHEMA:
    "murph.assistant-context-diagnostics.v1",
  HOSTED_ASSISTANT_CONTEXT_DIAGNOSTICS_TYPE: "assistant.context.diagnostics",
  createStoreBackedAssistantInputSource: mocks.createStoreBackedAssistantInputSource,
  readAssistantAutomationState: mocks.readAssistantAutomationState,
  runAssistantAutomationPass: mocks.runAssistantAutomationPass,
}));

vi.mock("@murphai/inbox-services", () => ({
  createIntegratedInboxServices: mocks.createIntegratedInboxServices,
}));

vi.mock("@murphai/vault-usecases/vault-services", () => ({
  createIntegratedVaultServices: mocks.createIntegratedVaultServices,
}));

vi.mock("../src/hosted-device-sync-runtime.ts", () => ({
  reconcileHostedDeviceSyncControlPlaneState:
    mocks.reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState: mocks.syncHostedDeviceSyncControlPlaneState,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  readHostedAssistantRuntimeState: mocks.readHostedAssistantRuntimeState,
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  runHostedAssistantAutomation,
  runHostedAssistantRuntimeTimerLane,
  runHostedDeviceSyncPass,
  runHostedDeviceSyncWakeLane,
  runHostedNoopSystemWakeLane,
} from "../src/hosted-runtime/maintenance.ts";

function createMaintenanceDeviceSyncPortStub() {
  return {
    ackDirtyStateProcessed: vi.fn(),
    applyUpdates: vi.fn(),
    createConnectLink: vi.fn(),
    fetchDirtyStates: vi.fn(async () => ({
      hasMore: false,
      items: [],
      nextWakeAt: null,
      userId: "member_123",
    })),
    fetchSnapshot: vi.fn(),
  };
}

type InboxServices = import("@murphai/inbox-services").InboxServices;
type RunAssistantAutomationPassInput = Parameters<
  typeof import("@murphai/assistant-engine").runAssistantAutomationPass
>[0];
type HostedAutomationRuntime = Parameters<typeof runHostedAssistantAutomation>[4];
type HostedTimerRuntime = Parameters<typeof runHostedAssistantRuntimeTimerLane>[0]["runtime"];

const DEVICE_SYNC_CONFIG = {
  providerConfigs: {
    oura: {
      clientId: "oura-client",
      clientSecret: "oura-secret",
    },
  },
  publicBaseUrl: "https://device-sync.example.test",
  secret: "secret_123",
} as const;

function createHostedAutomationRuntime(input: {
  deviceSync?: HostedTimerRuntime["resolvedConfig"]["deviceSync"];
  platform?: Partial<HostedAutomationRuntime["platform"]>;
} = {}): HostedAutomationRuntime & HostedTimerRuntime {
  return {
    commitTimeoutMs: 45_000,
    forwardedEnv: {},
    platform: {
      artifactStore: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
      },
      effectsPort: {
        readRawEmailMessage: vi.fn(async () => null),
        sendEmail: vi.fn(async () => undefined),
      },
      ...input.platform,
    },
    platformEnv: {},
    resolvedConfig: {
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: input.deviceSync ?? null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.closeHostedRuntimeDeviceSyncService.mockImplementation((service: { close?: () => void }) => {
    service.close?.();
  });
  mocks.initInboxRuntime.mockResolvedValue({
    configPath: ".runtime/operations/inbox/config.json",
    createdPaths: [],
    databasePath: ".runtime/projections/inboxd.sqlite",
    rebuiltCaptures: 0,
    runtimeDirectory: ".runtime/operations/inbox",
    vault: "/tmp/vault-root",
  });
  mocks.createIntegratedInboxServices.mockReturnValue({
    init: mocks.initInboxRuntime,
  });
  mocks.createStoreBackedAssistantInputSource.mockReturnValue({
    listInputCandidates: vi.fn(async (query) => ({
      inputs: [],
      nextCursor: query.afterCursor ?? null,
    })),
    listNewConversationInputs: vi.fn(async (query) => ({
      inputs: [],
      nextCursor: query.afterCursor ?? null,
    })),
    refresh: vi.fn(async () => ({
      progressed: false,
      reason: "no_new_input",
    })),
  });
  mocks.createIntegratedVaultServices.mockReturnValue(Symbol("vault-services"));
  mocks.readHostedAssistantRuntimeState.mockResolvedValue({
    assistantActiveProfileId: null,
    assistantActiveProfileManagedBy: null,
    assistantActiveProfileReady: false,
    assistantConfigInvalid: false,
    assistantConfigPresent: true,
    assistantConfigStatus: "saved",
    assistantConfigured: true,
    assistantProvider: "codex-cli",
  });
  mocks.readAssistantAutomationState.mockResolvedValue({
    autoReply: [],
    updatedAt: "2026-04-08T00:00:00.000Z",
    version: 1,
  });
  mocks.runAssistantAutomationPass.mockResolvedValue({
    nextWakeAt: "2026-04-08T01:00:00.000Z",
    progressed: false,
  });
  mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue(["oura"]);
  mocks.readConfiguredJunctionDeviceSyncProviderConfig.mockReturnValue(null);
  mocks.createDeviceSyncRegistry.mockReturnValue({
    list: () => ["oura"],
  });
  mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValue({
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    snapshot: {
      connections: [],
      schema: "murph.hosted-device-sync-runtime-snapshot.v1",
    },
  });
  mocks.reconcileHostedDeviceSyncControlPlaneState.mockResolvedValue(undefined);
});

describe("runHostedAssistantAutomation", () => {
  it("persists safe raw reply failure messages and structured failure context", async () => {
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onEvent?.({
        errorCode: "ASSISTANT_CODEX_FAILED",
        failureContext: {
          codexDiagnosticsPresent: true,
          codexExitCode: 1,
          retryable: false,
        },
        safeDetails: "assistant provider failed (ASSISTANT_CODEX_FAILED)",
        safeErrorMessage:
          "Codex app-server failed. connection refused by local bridge.",
        type: "input.reply-failed",
      });
      return {
        nextWakeAt: null,
        progressed: true,
      };
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_failure_log",
      {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_failure_log",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      createHostedAutomationRuntime(),
    );

    expect(result.redactedLogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Hosted assistant automation event: input.reply-failed.",
          redacted: expect.objectContaining({
            errorCode: "ASSISTANT_CODEX_FAILED",
            failureCodexDiagnosticsPresent: true,
            failureCodexExitCode: 1,
            failureFieldsPresent: true,
            failureRetryable: false,
            safeErrorLength:
              "Codex app-server failed. connection refused by local bridge.".length,
            safeErrorMessage:
              "Codex app-server failed. connection refused by local bridge.",
            safeErrorPresent: true,
            type: "input.reply-failed",
          }),
        }),
      ]),
    );
  });

  it("wraps hosted mailbox refreshes through the assistant input source", async () => {
    const checkpointActiveTurnInput = vi.fn(async () => undefined);
    const refreshMailboxForActiveTurnInput = vi.fn(async () => ({
      progressed: true,
      reason: "ingested_input" as const,
    }));
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      await input.inputSource?.refresh({
        phase: "request_boundary",
      });
      await input.inputSource?.checkpointAcceptedInput?.({
        acceptedInputIds: ["request-1"],
        providerRequestOrdinal: 0,
        sessionId: "session_123",
        turnId: "turn_123",
        vault: "/tmp/vault-root",
      });
      return {
        nextWakeAt: null,
        progressed: true,
      };
    });

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_turn_input",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_turn_input",
          kind: "runtime.timer",
          occurredAt: "2026-04-23T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        {
          forwardedEnv: {},
          platform: {
            artifactStore: {
              get: vi.fn(async () => null),
              put: vi.fn(async () => undefined),
            },
            effectsPort: {
              readRawEmailMessage: vi.fn(async () => null),
              sendEmail: vi.fn(async () => undefined),
            },
            checkpointActiveTurnInput,
            refreshMailboxForActiveTurnInput,
          },
          platformEnv: {},
        },
      ),
    ).resolves.toEqual(expect.objectContaining({
      nextWakeAt: null,
      progressed: true,
      redactedLogEntries: expect.any(Array),
    }));

    expect(refreshMailboxForActiveTurnInput).toHaveBeenCalledWith({
      requestId: "req_turn_input",
    });
    expect(checkpointActiveTurnInput).toHaveBeenCalledWith({
      acceptedInputIds: ["request-1"],
      providerRequestOrdinal: 0,
      requestId: "req_turn_input",
      sessionId: "session_123",
      turnId: "turn_123",
      vault: "/tmp/vault-root",
    });
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSource: expect.any(Object),
      }),
    );
    expect(mocks.initInboxRuntime).not.toHaveBeenCalled();
  });

  it("passes deferred receipt recovery to hosted assistant automation passes", async () => {
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      nextWakeAt: "2026-05-07T00:00:00.000Z",
      progressed: true,
    });

    await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_defer_recovery",
      {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_defer_recovery",
        kind: "runtime.timer",
        occurredAt: "2026-05-07T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      createHostedAutomationRuntime(),
      [],
      false,
      true,
    );

    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith(
      expect.objectContaining({
        deferReceiptRecovery: true,
        deliveryDispatchMode: "queue-only",
      }),
    );
  });

  it("runs hosted automation even when inbox init would fail", async () => {
    mocks.initInboxRuntime.mockRejectedValueOnce(new Error("inbox init failed"));

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_bootstrap",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_bootstrap",
          kind: "runtime.timer",
          occurredAt: "2026-04-29T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        createHostedAutomationRuntime(),
      ),
    ).resolves.toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-08T01:00:00.000Z",
      progressed: false,
      redactedLogEntries: expect.any(Array),
    }));

    expect(mocks.initInboxRuntime).not.toHaveBeenCalled();
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledTimes(1);
  });

  it("passes normal hosted inbox projection services to automation", async () => {
    const list = vi.fn<InboxServices["list"]>(async (input) => ({
      vault: input.vault,
      filters: {
        sourceId: null,
        limit: input.limit ?? 50,
        afterCreatedAt: input.afterCreatedAt ?? null,
        afterOccurredAt: input.afterOccurredAt ?? null,
        afterCaptureId: input.afterCaptureId ?? null,
        oldestFirst: input.oldestFirst ?? false,
      },
      items: [],
    }));
    const show = vi.fn<InboxServices["show"]>(async (input) => ({
      vault: input.vault,
      capture: {
        accountId: "acct_1",
        actorId: "actor_1",
        actorIsSelf: false,
        actorName: null,
        attachmentCount: 0,
        attachments: [],
        captureId: input.captureId,
        createdAt: "2026-04-29T00:00:03.000Z",
        envelopePath: "raw/inbox/linq/acct_1/2026/04/cap_projection/envelope.json",
        eventId: "evt_projection",
        externalId: "linq:msg_projection",
        occurredAt: "2026-04-29T00:00:02.000Z",
        promotions: [],
        receivedAt: "2026-04-29T00:00:02.500Z",
        source: "linq",
        text: "projected hosted input",
        threadId: "thread_1",
        threadIsDirect: true,
        threadTitle: null,
      },
    }));
    const inboxServices = {
      init: mocks.initInboxRuntime,
      list,
      show,
    } satisfies Pick<InboxServices, "init" | "list" | "show">;
    mocks.createIntegratedInboxServices.mockReturnValueOnce(inboxServices);
    mocks.runAssistantAutomationPass.mockImplementationOnce(
      async (input: RunAssistantAutomationPassInput) => {
        const passInboxServices = input.inboxServices;
        if (!passInboxServices) {
          throw new Error("Expected hosted automation inbox services.");
        }

        await passInboxServices.list({
          limit: 1,
          requestId: "req_projection_show",
          sourceId: null,
          vault: "/tmp/vault-root",
        });
        await passInboxServices.show({
          captureId: "cap_projection",
          requestId: "req_projection_show",
          vault: "/tmp/vault-root",
        });

        return {
          nextWakeAt: null,
          progressed: true,
        };
      },
    );

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_projection_show",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_projection_show",
          kind: "runtime.timer",
          occurredAt: "2026-04-29T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        {
          forwardedEnv: {},
          platform: {
            artifactStore: {
              get: vi.fn(async () => null),
              put: vi.fn(async () => undefined),
            },
            effectsPort: {
              readRawEmailMessage: vi.fn(async () => null),
              sendEmail: vi.fn(async () => undefined),
            },
          },
          platformEnv: {},
        },
      ),
    ).resolves.toEqual(expect.objectContaining({
      nextWakeAt: null,
      progressed: true,
      redactedLogEntries: expect.any(Array),
    }));

    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        captureId: "cap_projection",
      }),
    );
  });

  it("logs automation events emitted during the hosted pass", async () => {
    mocks.readAssistantAutomationState
      .mockResolvedValueOnce({
        autoReply: [
          {
            channel: "telegram",
            enabledAt: "2026-04-08T00:00:00.000Z",
            eligibleAfter: {
              createdAt: null,
              inputId: "ain_00000000000000000000000000000122",
              occurredAt: "2026-04-08T00:05:00.000Z",
              sourceKind: "inbox-capture",
              sourcePosition: null,
            },
          },
        ],
        updatedAt: "2026-04-08T00:00:00.000Z",
        version: 1,
      })
      .mockResolvedValueOnce({
        autoReply: [
          {
            channel: "telegram",
            enabledAt: "2026-04-08T00:00:00.000Z",
            eligibleAfter: {
              createdAt: null,
              inputId: "ain_00000000000000000000000000000123",
              occurredAt: "2026-04-08T00:10:00.000Z",
              sourceKind: "inbox-capture",
              sourcePosition: null,
            },
          },
        ],
        updatedAt: "2026-04-08T00:10:00.000Z",
        version: 2,
      });
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onEvent?.({
        inputId: "ain_123",
        details: "telegram -> real_thread_id",
        safeDetails: "reply_sent",
        type: "input.replied",
      });
      return {
        nextWakeAt: "2026-04-08T01:15:00.000Z",
        progressed: true,
      };
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_123",
      {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_automation_event",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      createHostedAutomationRuntime(),
    );

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-08T01:15:00.000Z",
      progressed: true,
      redactedLogEntries: [
        expect.objectContaining({
          message: "Hosted assistant automation pass starting.",
        }),
        expect.objectContaining({
          message: "Hosted assistant automation event: input.replied.",
          redacted: expect.objectContaining({
            inputIdPresent: true,
            safeDetails: "reply_sent",
            type: "input.replied",
          }),
        }),
        expect.objectContaining({
          message: "Hosted assistant automation pass finished.",
          redacted: expect.objectContaining({
            automationEventCount0: 1,
            automationEventType0: "input.replied",
            automationEventTypeCount: 1,
            progressed: true,
            requestId: "req_123",
          }),
        }),
      ],
    }));
    expect(JSON.stringify(result.redactedLogEntries)).not.toContain(
      "real_thread_id",
    );

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          autoReplyChannels: "telegram",
          autoReplyEligibleAfterSummary: "telegram:ain_00000000000000000000000000000122",
        }),
        message: "Hosted assistant automation pass starting.",
      }),
    );
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          inputIdPresent: true,
          safeDetails: "reply_sent",
          type: "input.replied",
        }),
        message: "Hosted assistant automation event: input.replied.",
      }),
    );
    expect(
      JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls),
    ).not.toContain("real_thread_id");
  });

  it("treats missing inbox runtime state as a non-fatal bootstrap gap", async () => {
    mocks.runAssistantAutomationPass.mockRejectedValueOnce({
      code: "INBOX_NOT_INITIALIZED",
    });

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_123",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_gap",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        createHostedAutomationRuntime(),
      ),
    ).resolves.toEqual({
      nextWakeAt: expect.any(String),
      progressed: true,
      redactedLogEntries: [
        expect.objectContaining({
          message: "Hosted assistant automation pass starting.",
        }),
        expect.objectContaining({
          message: "Hosted assistant automation could not run because the inbox runtime is not initialized yet; scheduling a retry.",
        }),
      ],
    });
  });

  it("rethrows unexpected automation failures", async () => {
    mocks.runAssistantAutomationPass.mockRejectedValueOnce(new Error("automation failed"));

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_123",
        {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_automation_failure",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        createHostedAutomationRuntime(),
      ),
    ).rejects.toThrow("automation failed");
  });
});

describe("runHostedDeviceSyncPass", () => {
  it("skips device sync entirely when no providers are configured", async () => {
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_skip",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      null,
      null,
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("skips device sync when the resolved registry has no providers", async () => {
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_empty_registry",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      null,
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("does not instantiate Junction from serializable hosted runtime hints", async () => {
    mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue([]);
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => [],
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_junction_serializable_hints",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["fitbit"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
      null,
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.createConfiguredDeviceSyncProvidersFromConfigs).toHaveBeenCalledWith({});
    expect(mocks.readConfiguredJunctionDeviceSyncProviderConfig).not.toHaveBeenCalled();
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("hydrates Junction provider config from hosted runtime platform env", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);
    const platformEnv = {
      JUNCTION_API_KEY: "junction-api-key",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
    };
    const junctionConfig = {
      apiKey: "junction-api-key",
      clientUserIdSecret: "junction-client-user-id-secret",
      environment: "sandbox",
      region: "us",
    };

    mocks.readConfiguredJunctionDeviceSyncProviderConfig.mockReturnValue(junctionConfig);
    mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue(["junction"]);
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => ["junction"],
    });
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      runSchedulerOnce,
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_junction_platform_env",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["garmin"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
      createMaintenanceDeviceSyncPortStub(),
      45_000,
      {
        platformEnv,
      },
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: false,
    });
    expect(mocks.readConfiguredJunctionDeviceSyncProviderConfig).toHaveBeenCalledWith(platformEnv);
    expect(mocks.createConfiguredDeviceSyncProvidersFromConfigs).toHaveBeenCalledWith({
      junction: junctionConfig,
    });
    expect(mocks.createHostedRuntimeDeviceSyncService).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: expect.anything(),
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("logs redacted legacy Junction platform env usage when consumed", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);
    const platformEnv = {
      JUNCTION_API_KEY: "junction-api-key",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_ENV: "sandbox",
      JUNCTION_REGION: "us",
    };
    const junctionConfig = {
      apiKey: "junction-api-key",
      clientUserIdSecret: "junction-client-user-id-secret",
      environment: "sandbox",
      region: "us",
    };

    mocks.readConfiguredJunctionDeviceSyncProviderConfig.mockReturnValue(junctionConfig);
    mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue(["junction"]);
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => ["junction"],
    });
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      runSchedulerOnce,
    });

    await runHostedDeviceSyncPass(
      {
        eventId: "evt_junction_platform_env_log",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
      createMaintenanceDeviceSyncPortStub(),
      45_000,
      {
        platformEnv,
        runtimeLogPlatform: {
          logPort: {
            async write(request) {
              logRequests.push(request);
              return {
                loggedCount: request.entries.length,
              };
            },
          },
        },
      },
    );

    assert.equal(logRequests.length, 1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    assert.equal(entry.component, "device-sync");
    assert.equal(entry.eventCode, "device-sync.legacy_platform_env_present");
    assert.equal(entry.level, "info");
    assert.equal(entry.phase, "invoke");
    assert.deepEqual(entry.redactedJson, {
      junctionPlatformEnvPresent: true,
      legacyPlatformEnvKeyCount: 4,
    });
    assert.equal(JSON.stringify(entry).includes("junction-api-key"), false);
    assert.equal(JSON.stringify(entry).includes("junction-client-user-id-secret"), false);
  });

  it("skips device sync when the hosted runtime resolved config disables device sync", async () => {
    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_missing_env",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      null,
      null,
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("logs non-fatal control-plane sync failures for non-device-sync wake events and keeps processing jobs", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 3);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      runSchedulerOnce,
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockRejectedValue(
      new Error("sync failed"),
    );

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_continue",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      createMaintenanceDeviceSyncPortStub(),
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T02:00:00.000Z",
      postCheckpointRecord: null,
      processedJobs: 3,
      skipped: false,
    });
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted device-sync control-plane sync failed; continuing hosted job.",
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("logs non-fatal control-plane reconcile failures for non-device-sync wake events and keeps processing jobs", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 3);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      runSchedulerOnce,
    });
    mocks.reconcileHostedDeviceSyncControlPlaneState.mockRejectedValue(
      new Error("reconcile failed"),
    );

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_reconcile_continue",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      createMaintenanceDeviceSyncPortStub(),
      45_000,
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T02:00:00.000Z",
      postCheckpointRecord: null,
      processedJobs: 3,
      skipped: false,
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Hosted device-sync control-plane reconcile failed; continuing hosted job.",
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("writes sanitized durable logs for newly failed device-sync jobs", async () => {
    const close = vi.fn();
    const drainWorker = vi.fn(async () => 1);
    const runSchedulerOnce = vi.fn(async () => undefined);
    const logRequests: HostedRuntimeLogRequest[] = [];

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      listAccounts: vi.fn(() => [
        {
          id: "local_account_sensitive",
          lastErrorCode: "SYNC_JOB_FAILED",
          lastErrorMessage:
            "Importer failed reading file://<fixture-path> for owner@example.test with access_token=<fixture-secret>.",
          lastSyncCompletedAt: null,
          lastSyncErrorAt: "2026-04-08T00:00:03.000Z",
          lastSyncStartedAt: "2026-04-08T00:00:01.000Z",
          nextReconcileAt: "2026-04-08T02:00:00.000Z",
          provider: "whoop",
          setupPhase: null,
          status: "active",
        },
      ]),
      runSchedulerOnce,
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValue({
      hostedToLocalAccountIds: new Map([
        ["hosted_connection_sensitive", "local_account_sensitive"],
      ]),
      localToHostedAccountIds: new Map([
        ["local_account_sensitive", "hosted_connection_sensitive"],
      ]),
      observedTokenVersions: new Map(),
      snapshot: {
        connections: [
          {
            connection: {
              id: "hosted_connection_sensitive",
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
            },
          },
        ],
      },
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_device_sync_failure_log",
        hint: null,
        kind: "device-sync.wake",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "webhook_hint",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      createMaintenanceDeviceSyncPortStub(),
      45_000,
      {
        runtimeLogPlatform: {
          logPort: {
            async write(request) {
              logRequests.push(request);
              return {
                loggedCount: request.entries.length,
              };
            },
          },
        },
      },
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T02:00:00.000Z",
      postCheckpointRecord: null,
      processedJobs: 1,
      skipped: false,
    });
    assert.equal(logRequests.length, 1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    assert.equal(entry.component, "device-sync");
    assert.equal(entry.errorCode, "SYNC_JOB_FAILED");
    assert.equal(entry.eventCode, "device-sync.job_failed");
    assert.equal(entry.level, "warn");
    assert.equal(entry.phase, "invoke");
    assert.deepEqual(entry.redactedJson, {
      failureCode: "SYNC_JOB_FAILED",
      failureSummary:
        "Importer failed reading <redacted-path> for <redacted-email> with <redacted-secret>",
      hadPriorFailure: false,
      hadPriorSuccess: false,
      hostedConnectionKnown: true,
      nextReconcileAt: "2026-04-08T02:00:00.000Z",
      processedJobs: 1,
      provider: "whoop",
      setupPhase: null,
      status: "active",
      syncCompletedAt: null,
      syncFailedAt: "2026-04-08T00:00:03.000Z",
      syncStartedAt: "2026-04-08T00:00:01.000Z",
      wakeKind: "device-sync.wake",
      wakeReason: "webhook_hint",
    });
    const serialized = JSON.stringify(logRequests);
    expect(serialized).not.toContain("local_account_sensitive");
    expect(serialized).not.toContain("hosted_connection_sensitive");
    expect(serialized).not.toContain("file://");
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain("<fixture-secret>");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed on control-plane sync errors during device-sync wake handling", async () => {
    const close = vi.fn();

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker: vi.fn(),
      getNextWakeAt: () => null,
      runSchedulerOnce: vi.fn(),
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockRejectedValue(
      new Error("sync failed"),
    );

    await expect(
      runHostedDeviceSyncPass(
        {
          eventId: "evt_wake",
          hint: null,
          kind: "device-sync.wake",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "webhook_hint",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        createMaintenanceDeviceSyncPortStub(),
        45_000,
      ),
    ).rejects.toThrow("sync failed");

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed on control-plane reconcile errors during device-sync wake handling", async () => {
    const close = vi.fn();

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => null,
      runSchedulerOnce: vi.fn(async () => undefined),
    });
    mocks.reconcileHostedDeviceSyncControlPlaneState.mockRejectedValue(
      new Error("reconcile failed"),
    );

    await expect(
      runHostedDeviceSyncPass(
        {
          eventId: "evt_wake_reconcile",
          hint: null,
          kind: "device-sync.wake",
          occurredAt: "2026-04-08T00:00:00.000Z",
          reason: "webhook_hint",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        createMaintenanceDeviceSyncPortStub(),
        45_000,
      ),
    ).rejects.toThrow("reconcile failed");

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("runHostedAssistantRuntimeTimerLane", () => {
  it("runs assistant automation without sweeping parser or device-sync work", async () => {
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onTraceEvent?.({
        providerSessionId: null,
        rawEvent: {
          schema: "murph.assistant-context-diagnostics.v1",
          type: "assistant.context.diagnostics",
          stage: "assistant-session-resolved",
          source: "assistant-message",
          fingerprintReady: true,
          channel: "linq",
          actorFingerprint: "h1_111111111111111111111111",
          sessionFingerprint: "h1_222222222222222222222222",
          primaryConversationScope: "thread",
          sessionResolutionCreated: false,
          sessionTurnCount: 1,
        },
        updates: [],
      });
      return {
        nextWakeAt: "2026-04-08T01:00:00.000Z",
        progressed: false,
      };
    });

    const result = await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_assistant_lane",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toMatchObject({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-04-08T01:00:00.000Z",
      parserProcessed: 0,
      redactedLogEntries: [
        expect.objectContaining({
          message: "Hosted assistant automation pass starting.",
        }),
        expect.objectContaining({
          component: "runtime.context",
          message: "Hosted assistant context fingerprints captured.",
          redacted: expect.objectContaining({
            actorFingerprint: "h1_111111111111111111111111",
            channel: "linq",
            sessionFingerprint: "h1_222222222222222222222222",
            source: "assistant-message",
            stage: "assistant-session-resolved",
          }),
        }),
        expect.objectContaining({
          message: "Hosted assistant automation pass finished.",
        }),
      ],
    });
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith({
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
      executionContext: {
        hosted: {
          issueDeviceConnectLink: expect.any(Function),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      inboxServices: expect.anything(),
      inputSource: expect.any(Object),
      onEvent: expect.any(Function),
      onTraceEvent: expect.any(Function),
      requestId: "req_123",
      vault: "/tmp/vault-root",
      vaultServices: expect.anything(),
    });
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("returns an immediate follow-up wake when assistant work is still runnable now", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runAssistantAutomationPass.mockResolvedValueOnce({
        nextWakeAt: null,
        progressed: true,
      });

      const result = await runHostedAssistantRuntimeTimerLane({
        wake: {
          eventId: "evt_assistant_progress",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        executionContext: {
          hosted: {
            issueDeviceConnectLink: vi.fn(),
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        requestId: "req_123",
        runtime: createHostedAutomationRuntime(),
        vaultRoot: "/tmp/vault-root",
      });

      expect(result).toMatchObject({
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        parserProcessed: 0,
        redactedLogEntries: [
          expect.objectContaining({
            message: "Hosted assistant automation pass starting.",
          }),
          expect.objectContaining({
            message: "Hosted assistant automation pass finished.",
          }),
        ],
      });
      expect(mocks.runAssistantAutomationPass).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips assistant automation without warning when the caller explicitly disables it", async () => {
    const result = await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_skip_requested",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime(),
      skipAssistantAutomation: true,
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual({
      deviceSyncProcessed: result.deviceSyncProcessed,
      deviceSyncSkipped: result.deviceSyncSkipped,
      nextWakeAt: result.nextWakeAt,
      parserProcessed: result.parserProcessed,
      postCheckpointRecord: result.postCheckpointRecord,
    }, {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    assert.equal(typeof result.totalElapsedMs, "number");
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
  });

  it("skips device-sync when the caller is handling active input latency", async () => {
    const service = {
      close: vi.fn(),
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => "2026-04-08T00:30:00.000Z",
      runSchedulerOnce: vi.fn(async () => undefined),
    };
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue(service);

    const result = await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_skip_device_sync",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime({
        deviceSync: DEVICE_SYNC_CONFIG,
      }),
      skipDeviceSync: true,
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toMatchObject({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
    });
    expect(service.runSchedulerOnce).not.toHaveBeenCalled();
    expect(service.drainWorker).not.toHaveBeenCalled();
  });

  it("logs skipped automation when the hosted assistant is not configured", async () => {
    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantConfigStatus: "missing",
      assistantConfigured: false,
      assistantProvider: null,
    });

    const result = await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_skip_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toMatchObject({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      redactedLogEntries: [
        expect.objectContaining({
          message:
            "Hosted assistant automation skipped because no explicit hosted assistant profile is configured.",
        }),
      ],
    });
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted assistant automation skipped because no explicit hosted assistant profile is configured.",
      }),
    );
  });

  it("reports invalid hosted assistant configs when automation is skipped", async () => {
    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantActiveProfileId: null,
      assistantActiveProfileManagedBy: null,
      assistantActiveProfileReady: false,
      assistantConfigInvalid: true,
      assistantConfigPresent: false,
      assistantConfigStatus: "invalid",
      assistantConfigured: false,
      assistantProvider: null,
    });

    await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_invalid_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted assistant automation skipped because the saved hosted assistant config is invalid.",
      }),
    );
  });

  it("reports unready hosted assistant profiles with the active provider label", async () => {
    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantActiveProfileId: "platform-default",
      assistantActiveProfileManagedBy: "platform",
      assistantActiveProfileReady: false,
      assistantConfigInvalid: false,
      assistantConfigPresent: true,
      assistantConfigStatus: "hosted-env",
      assistantConfigured: false,
      assistantProvider: "codex-cli",
    });

    await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_unready_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message:
          "Hosted assistant automation skipped because the active hosted assistant profile (codex-cli) is not ready.",
      }),
    );
  });
});

describe("runHostedDeviceSyncWakeLane", () => {
  it("runs only the hosted device-sync lane", async () => {
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close: vi.fn(),
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => "2026-04-08T00:30:00.000Z",
      runSchedulerOnce: vi.fn(async () => undefined),
    });

    const result = await runHostedDeviceSyncWakeLane({
      deviceSyncPort: {
        ackDirtyStateProcessed: vi.fn(),
        applyUpdates: vi.fn(),
        createConnectLink: vi.fn(),
        fetchDirtyStates: vi.fn(async () => ({
          hasMore: false,
          items: [],
          nextWakeAt: null,
          userId: "member_123",
        })),
        fetchSnapshot: vi.fn(),
      },
      wake: {
        eventId: "evt_device_sync_lane",
        kind: "device-sync.wake",
        occurredAt: "2026-04-08T00:00:00.000Z",
        reason: "connected",
        userId: "member_123",
      },
      resolvedConfig: {
        deviceSync: DEVICE_SYNC_CONFIG,
      },
      timeoutMs: 45_000,
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual(result, {
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:30:00.000Z",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
  });
});

describe("runHostedNoopSystemWakeLane", () => {
  it("returns an empty follow-up result for explicit no-op system wakes", () => {
    assert.deepEqual(runHostedNoopSystemWakeLane(), {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
  });
});
