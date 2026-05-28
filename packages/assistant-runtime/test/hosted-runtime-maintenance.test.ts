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
  DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT: 50,
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

async function withHostedMaintenanceNow<T>(
  now: string,
  callback: () => Promise<T>,
): Promise<T> {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(now));
    return await callback();
  } finally {
    vi.useRealTimers();
  }
}

type InboxServices = import("@murphai/inbox-services").InboxServices;
type RunAssistantAutomationPassInput = Parameters<
  typeof import("@murphai/assistant-engine").runAssistantAutomationPass
>[0];
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
  platform?: Partial<HostedTimerRuntime["platform"]>;
} = {}): HostedTimerRuntime {
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
        whatsappCloudApiConfigured: false,
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
    pendingDirtyAcks: [],
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

  it("reports active-turn ingestion when automation reads staged conversation input", async () => {
    const listNewConversationInputs = vi.fn(async (query) => ({
      inputs: [
        {
          acceptedInput: {
            id: "request-1",
            source: "assistant-input",
          },
          event: {
            inputId: "request-1",
          },
        },
      ],
      nextCursor: query.afterCursor ?? null,
    }));
    mocks.createStoreBackedAssistantInputSource.mockReturnValueOnce({
      listInputCandidates: vi.fn(async (query) => ({
        inputs: [],
        nextCursor: query.afterCursor ?? null,
      })),
      listNewConversationInputs,
      refresh: vi.fn(async () => ({
        progressed: false,
        reason: "no_new_input",
      })),
    });
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      await input.inputSource?.listNewConversationInputs({
        conversation: {
          accountId: "acct_1",
          actorId: "actor_1",
          actorIsSelf: false,
          source: "linq",
          threadId: "thread_1",
          threadIsDirect: true,
        },
        knownInputIds: ["input_previous_should_not_log"],
        knownProjectionCaptureIds: ["cap_previous_should_not_log"],
        limit: 2,
      });
      return {
        nextWakeAt: null,
        progressed: true,
      };
    });

    const result = await runHostedAssistantAutomation(
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
    );

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: null,
      progressed: true,
      redactedLogEntries: expect.any(Array),
      timings: expect.objectContaining({
        activeTurnInputIngested: true,
      }),
    }));
    expect(result.redactedLogEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "Hosted assistant new conversation input query finished.",
        redacted: expect.objectContaining({
          candidateCount: 1,
          conversationActorIsSelf: false,
          conversationDirect: true,
          conversationSource: "linq",
          knownInputIdCount: 1,
          knownProjectionCaptureIdCount: 1,
          limit: 2,
          nextCursorPresent: false,
          type: "assistant.new_conversation_inputs.listed",
        }),
      }),
    ]));
    const conversationLog = result.redactedLogEntries.find((entry) =>
      entry.message === "Hosted assistant new conversation input query finished."
    );
    expect(conversationLog?.redacted).not.toHaveProperty("requestId");
    expect(JSON.stringify(conversationLog?.redacted)).not.toContain("request-1");
    expect(JSON.stringify(conversationLog?.redacted))
      .not.toContain("input_previous_should_not_log");
    expect(JSON.stringify(conversationLog?.redacted))
      .not.toContain("cap_previous_should_not_log");

    expect(listNewConversationInputs).toHaveBeenCalledTimes(1);
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSource: expect.any(Object),
      }),
    );
    expect(mocks.initInboxRuntime).not.toHaveBeenCalled();
  });

  it("records metadata-only candidate query diagnostics for scanner misses", async () => {
    const candidate = {
      acceptedInput: {
        id: "input_candidate",
        source: "assistant-input",
      },
      event: {
        attachmentCount: 0,
        attachmentDescriptors: [],
        attachmentEvidence: {
          attachments: [],
          optionalInboxCaptureId: null,
          reasonCode: null,
          source: null,
          status: "not_attempted",
          updatedAt: null,
        },
        conversation: {
          accountId: "acct_1",
          actorId: "actor_1",
          actorIsSelf: false,
          source: "linq",
          threadId: "thread_1",
          threadIsDirect: true,
        },
        cursor: {
          createdAt: "2026-05-18T15:10:38.000Z",
          inputId: "input_candidate",
          occurredAt: "2026-05-18T15:10:38.000Z",
          sourceKind: "hosted-mailbox",
          sourcePosition: "conversation:00000000000000000042:input_candidate",
        },
        inputId: "input_candidate",
        occurredAt: "2026-05-18T15:10:38.000Z",
        receivedAt: "2026-05-18T15:10:39.000Z",
        replyTarget: {
          channel: "linq",
          messageId: "msg_candidate",
          threadId: "thread_1",
        },
        source: "linq",
        sourceMetadata: null,
        sourceRef: {
          kind: "hosted-mailbox",
          lane: "conversation",
          laneSeq: "42",
          source: "hosted-mailbox",
        },
        text: "hello",
        transcriptText: "hello",
        userMessageContent: [
          {
            text: "hello",
            type: "text",
          },
        ],
      },
      projection: {
        captureId: null,
        reasonCode: null,
        status: "not_attempted",
      },
    };
    mocks.createStoreBackedAssistantInputSource.mockReturnValueOnce({
      listInputCandidates: vi.fn(async () => ({
        inputs: [candidate],
        nextCursor: candidate.event.cursor,
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
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      await input.inputSource?.listInputCandidates({
        limit: 1,
        sourceId: "linq",
      });
      return {
        nextWakeAt: null,
        progressed: false,
      };
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_candidate_query",
      {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_candidate_query",
        kind: "runtime.timer",
        occurredAt: "2026-05-18T15:10:38.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
    );

    expect(result.timings).toEqual(expect.objectContaining({
      inputCandidateListed: true,
      inputCandidateQueryCount: 1,
    }));
    expect(result.redactedLogEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "Hosted assistant input candidate query finished.",
        redacted: expect.objectContaining({
          candidateConversationCount: 1,
          candidateCount: 1,
          candidateProjectionStatusSummary: "not_attempted:1",
          candidateReplyTargetPresentCount: 1,
          candidateSelfAuthoredCount: 0,
          candidateSourceSummary: "linq:1",
          knownInputIdCount: 0,
          nextCursorPresent: true,
          sourceId: "linq",
          sourceIdPresent: true,
          type: "assistant.input_candidates.listed",
        }),
      }),
    ]));
    const candidateLog = result.redactedLogEntries.find((entry) =>
      entry.message === "Hosted assistant input candidate query finished."
    );
    expect(candidateLog?.redacted).not.toHaveProperty("requestId");
  });

  it("runs hosted assistant automation through the queue-only scanner path", async () => {
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      nextWakeAt: "2026-05-07T00:00:01.000Z",
      progressed: true,
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_queue_only_scanner",
      {
        hosted: {
          issueDeviceConnectLink: vi.fn(),
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_queue_only_scanner",
        kind: "runtime.timer",
        occurredAt: "2026-05-07T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      [],
    );

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-05-07T00:00:01.000Z",
    }));
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith(
      expect.objectContaining({
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
    ),
    ).resolves.toEqual(expect.objectContaining({
      nextWakeAt: null,
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
          autoReplyEligibleAfterSummary: "telegram:present",
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
    expect(
      JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls),
    ).not.toContain("ain_00000000000000000000000000000122");
    expect(
      JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls),
    ).not.toContain("ain_00000000000000000000000000000123");
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
    ),
    ).resolves.toEqual(expect.objectContaining({
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
    }));
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

  it("fails closed on control-plane sync failures when hosted device sync is configured", async () => {
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

    await expect(
      runHostedDeviceSyncPass(
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
      ),
    ).rejects.toThrow("sync failed");

    expect(runSchedulerOnce).not.toHaveBeenCalled();
    expect(drainWorker).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails closed on control-plane reconcile failures when hosted device sync is configured", async () => {
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

    await expect(
      runHostedDeviceSyncPass(
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
      ),
    ).rejects.toThrow("reconcile failed");

    expect(runSchedulerOnce).toHaveBeenCalledTimes(1);
    expect(drainWorker).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drains up to 100 device-sync jobs per pass when foreground yielding is unavailable", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 100);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      runSchedulerOnce,
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_device_sync_drain_cap",
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
      processedJobs: 100,
      skipped: false,
    });
    expect(runSchedulerOnce).toHaveBeenCalledTimes(1);
    expect(drainWorker).toHaveBeenCalledTimes(1);
    expect(drainWorker).toHaveBeenCalledWith(100);
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded batch dirty ack post-checkpoint record when multiple dirty states are handed off", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      runSchedulerOnce,
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValueOnce({
      hostedToLocalAccountIds: new Map(),
      localToHostedAccountIds: new Map(),
      observedTokenVersions: new Map(),
      pendingDirtyAcks: [
        {
          connectionId: "dsc_dirty_batch_1",
          localAccountId: "local_1",
          nextWakeAt: "2026-04-08T00:05:00.000Z",
          processedDirtyPayloadIds: ["dsp_1"],
          processedRevision: "11",
        },
        {
          connectionId: "dsc_dirty_batch_2",
          localAccountId: "local_2",
          nextWakeAt: "2026-04-08T00:03:00.000Z",
          processedDirtyPayloadIds: ["dsp_2", "dsp_3"],
          processedRevision: "12",
        },
      ],
      snapshot: {
        connections: [],
        schema: "murph.hosted-device-sync-runtime-snapshot.v1",
      },
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_device_sync_dirty_batch_ack",
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

    assert.deepEqual(result.postCheckpointRecord, {
      kind: "device-sync.dirty-processed-batch",
      nextWakeAt: "2026-04-08T00:03:00.000Z",
      records: [
        {
          connectionId: "dsc_dirty_batch_1",
          nextWakeAt: "2026-04-08T00:05:00.000Z",
          processedDirtyPayloadIds: ["dsp_1"],
          processedRevision: "11",
        },
        {
          connectionId: "dsc_dirty_batch_2",
          nextWakeAt: "2026-04-08T00:03:00.000Z",
          processedDirtyPayloadIds: ["dsp_2", "dsp_3"],
          processedRevision: "12",
        },
      ],
    });
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("yields before dirty control-plane fetch when foreground input is waiting", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);
    const shouldYield = vi.fn(() => true);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      runSchedulerOnce,
    });

    const result = await withHostedMaintenanceNow(
      "2026-04-08T00:00:00.000Z",
      () => runHostedDeviceSyncPass(
        {
          eventId: "evt_yield_before_dirty_fetch",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        createMaintenanceDeviceSyncPortStub(),
        45_000,
        { shouldYield },
      ),
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T00:00:30.000Z",
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.syncHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(runSchedulerOnce).not.toHaveBeenCalled();
    expect(drainWorker).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("suppresses dirty ack and schedules retry when foreground input arrives after dirty fetch", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);
    const shouldYield = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      runSchedulerOnce,
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValueOnce({
      hostedToLocalAccountIds: new Map(),
      localToHostedAccountIds: new Map(),
      observedTokenVersions: new Map(),
      pendingDirtyAcks: [{
        connectionId: "dsc_yield_after_fetch",
        nextWakeAt: null,
        processedRevision: "41",
      }],
      snapshot: {
        connections: [],
        schema: "murph.hosted-device-sync-runtime-snapshot.v1",
      },
    });

    const result = await withHostedMaintenanceNow(
      "2026-04-08T00:00:00.000Z",
      () => runHostedDeviceSyncPass(
        {
          eventId: "evt_yield_after_dirty_fetch",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        createMaintenanceDeviceSyncPortStub(),
        45_000,
        { shouldYield },
      ),
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T00:00:30.000Z",
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    });
    expect(mocks.syncHostedDeviceSyncControlPlaneState).toHaveBeenCalledTimes(1);
    expect(runSchedulerOnce).not.toHaveBeenCalled();
    expect(drainWorker).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("yields device-sync worker draining between jobs when requested", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValue(0);
    const shouldYield = vi.fn(() => drainWorker.mock.calls.length > 0);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      runSchedulerOnce,
    });

    const result = await withHostedMaintenanceNow(
      "2026-04-08T00:00:00.000Z",
      () => runHostedDeviceSyncPass(
        {
          eventId: "evt_yield_device_sync",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        createMaintenanceDeviceSyncPortStub(),
        45_000,
        {
          shouldYield,
        },
      ),
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T00:00:30.000Z",
      postCheckpointRecord: null,
      processedJobs: 1,
      skipped: true,
    });
    expect(runSchedulerOnce).toHaveBeenCalledTimes(1);
    expect(drainWorker).toHaveBeenCalledTimes(1);
    expect(drainWorker).toHaveBeenCalledWith(1);
    expect(shouldYield).toHaveBeenCalled();
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("caps the yield-aware device-sync drain path at 100 single-job checks", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 1);
    const shouldYield = vi.fn(() => false);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      runSchedulerOnce,
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_yield_device_sync_drain_cap",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      createMaintenanceDeviceSyncPortStub(),
      45_000,
      {
        shouldYield,
      },
    );

    assert.deepEqual(result, {
      nextWakeAt: null,
      postCheckpointRecord: null,
      processedJobs: 100,
      skipped: false,
    });
    expect(runSchedulerOnce).toHaveBeenCalledTimes(1);
    expect(drainWorker).toHaveBeenCalledTimes(100);
    expect(drainWorker).toHaveBeenCalledWith(1);
    expect(shouldYield).toHaveBeenCalled();
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps the yielded device-sync retry delay when released jobs are immediately due", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValue(0);
    const shouldYield = vi.fn(() => drainWorker.mock.calls.length > 0);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T00:00:00.000Z",
      runSchedulerOnce,
    });

    const result = await withHostedMaintenanceNow(
      "2026-04-08T00:01:00.000Z",
      () => runHostedDeviceSyncPass(
        {
          eventId: "evt_yield_device_sync_due_now",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        createMaintenanceDeviceSyncPortStub(),
        45_000,
        {
          shouldYield,
        },
      ),
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T00:01:30.000Z",
      postCheckpointRecord: null,
      processedJobs: 1,
      skipped: true,
    });
    expect(runSchedulerOnce).toHaveBeenCalledTimes(1);
    expect(drainWorker).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
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
      listJobFailureDiagnostics: vi.fn(() => [
        {
          accountId: "local_account_sensitive",
          accountStatus: null,
          code: "SYNC_JOB_FAILED",
          details: {
            failureCauseCode: "UND_ERR_CONNECT_TIMEOUT",
            failureErrorCause: "Connect Timeout Error",
            failureErrorName: "TypeError",
            providerHttpStatus: 503,
            providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
            providerOAuthRequestBodyBuilderKind: "url_search_params_record",
            providerOAuthRequestClientAuthPlacement: "body_parameters",
            providerOAuthRequestClientCredentialPresent: true,
            providerOAuthRequestClientIdPresent: true,
            providerOAuthRequestContentType: "application_x_www_form_urlencoded",
            providerOAuthRequestDuplicateParameterCount: 0,
            providerOAuthRequestEncodingKind: "form_urlencoded",
            providerOAuthRequestHasDuplicateParameters: false,
            providerOAuthRequestMethod: "POST",
            providerOAuthRequestOfflineScopePresent: true,
            providerOAuthRequestParameterCount: 5,
            providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
            providerOAuthRequestRefreshCredentialPresent: true,
            providerOAuthRequestScopeCount: 1,
            providerOAuthRequestScopePresent: true,
            providerOAuthRequestScopeValue: "offline",
            providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
            providerOAuthResponseErrorDescriptionFieldPresent: true,
            providerOAuthResponseErrorFieldPresent: true,
            providerOAuthResponseShapeKind: "json_object",
          },
          retryable: true,
        },
      ]),
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
      pendingDirtyAcks: [],
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
      failureCauseCode: "UND_ERR_CONNECT_TIMEOUT",
      failureErrorCause: "Connect Timeout Error",
      failureErrorName: "TypeError",
      failureRetryable: true,
      hadPriorFailure: false,
      hadPriorSuccess: false,
      hostedConnectionKnown: true,
      nextReconcileAt: "2026-04-08T02:00:00.000Z",
      processedJobs: 1,
      providerHttpStatus: 503,
      providerOAuthErrorDescription: "Refresh token expired. Reconnect WHOOP.",
      providerOAuthRequestBodyBuilderKind: "url_search_params_record",
      providerOAuthRequestClientAuthPlacement: "body_parameters",
      providerOAuthRequestClientCredentialPresent: true,
      providerOAuthRequestClientIdPresent: true,
      providerOAuthRequestContentType: "application_x_www_form_urlencoded",
      providerOAuthRequestDuplicateParameterCount: 0,
      providerOAuthRequestEncodingKind: "form_urlencoded",
      providerOAuthRequestHasDuplicateParameters: false,
      providerOAuthRequestMethod: "POST",
      providerOAuthRequestOfflineScopePresent: true,
      providerOAuthRequestParameterCount: 5,
      providerOAuthRequestParameterNames: "client_id.client_secret.grant_type.refresh_token.scope",
      providerOAuthRequestRefreshCredentialPresent: true,
      providerOAuthRequestScopeCount: 1,
      providerOAuthRequestScopePresent: true,
      providerOAuthRequestScopeValue: "offline",
      providerOAuthRequestTokenEndpointKind: "whoop_oauth_token",
      providerOAuthResponseErrorDescriptionFieldPresent: true,
      providerOAuthResponseErrorFieldPresent: true,
      providerOAuthResponseShapeKind: "json_object",
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
    const latencyTraceRecord = vi.fn(async () => ({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    }));
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
      runtime: createHostedAutomationRuntime({
        platform: {
          latencyTracePort: {
            record: latencyTraceRecord,
          },
        },
      }),
      runtimeAttemptId: "attempt_123",
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
      onProviderRequestStarted: expect.any(Function),
      onTraceEvent: expect.any(Function),
      requestId: "req_123",
      signal: undefined,
      vault: "/tmp/vault-root",
      vaultServices: expect.anything(),
    });
    const automationPassInput =
      mocks.runAssistantAutomationPass.mock.calls[0]?.[0] as RunAssistantAutomationPassInput;
    automationPassInput.onProviderRequestStarted?.({
      assistantInputIds: ["input_1"],
      providerRequestOrdinal: 0,
      source: "linq",
      startedAt: "2026-04-08T00:00:01.000Z",
    });
    await Promise.resolve();
    expect(latencyTraceRecord).toHaveBeenCalledWith({
      event: {
        assistantInputIds: ["input_1"],
        at: "2026-04-08T00:00:01.000Z",
        providerRequestOrdinal: 0,
        runtimeAttemptId: "attempt_123",
        source: "linq",
        type: "provider_started",
      },
    });
    automationPassInput.onProviderRequestStarted?.({
      assistantInputIds: ["input_2"],
      providerRequestOrdinal: 0,
      source: "telegram",
      startedAt: "2026-04-08T00:00:02.000Z",
    });
    await Promise.resolve();
    expect(latencyTraceRecord).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("retries provider-start latency traces when staged rows have not landed yet", async () => {
    const latencyTraceRecord = vi.fn()
      .mockResolvedValueOnce({
        matchedCount: 0,
        recorded: false,
        unmatchedCount: 1,
      })
      .mockResolvedValueOnce({
        matchedCount: 1,
        recorded: true,
        unmatchedCount: 0,
      });
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      nextWakeAt: null,
      progressed: false,
    });

    await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_assistant_latency_retry",
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
        platform: {
          latencyTracePort: {
            record: latencyTraceRecord,
          },
        },
      }),
      runtimeAttemptId: "attempt_123",
      vaultRoot: "/tmp/vault-root",
    });

    const automationPassInput =
      mocks.runAssistantAutomationPass.mock.calls[0]?.[0] as RunAssistantAutomationPassInput;

    vi.useFakeTimers();
    try {
      automationPassInput.onProviderRequestStarted?.({
        assistantInputIds: ["input_1"],
        providerRequestOrdinal: 0,
        source: "linq",
        startedAt: "2026-04-08T00:00:01.000Z",
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(latencyTraceRecord).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(250);

      expect(latencyTraceRecord).toHaveBeenCalledTimes(2);
      expect(latencyTraceRecord).toHaveBeenLastCalledWith({
        event: {
          assistantInputIds: ["input_1"],
          at: "2026-04-08T00:00:01.000Z",
          providerRequestOrdinal: 0,
          runtimeAttemptId: "attempt_123",
          source: "linq",
          type: "provider_started",
        },
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(latencyTraceRecord).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps device-sync ownership when assistant and device-sync wake times tie", async () => {
    const nextWakeAt = "2026-04-08T00:30:00.000Z";
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      nextWakeAt,
      progressed: false,
    });
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close: vi.fn(),
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => nextWakeAt,
      runSchedulerOnce: vi.fn(async () => undefined),
    });

    const result = await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_tied_device_sync_wake",
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
      requestId: "req_tied_device_sync_wake",
      runtime: createHostedAutomationRuntime({
        deviceSync: DEVICE_SYNC_CONFIG,
      }),
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toMatchObject({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
    });
  });

  it("bounds foreground replay scans to the replay window", async () => {
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      nextWakeAt: null,
      progressed: true,
    });

    await runHostedAssistantRuntimeTimerLane({
      wake: {
        eventId: "evt_foreground_replay_window",
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
      foregroundReplayInputIds: [
        "ain_00000000000000000000000000000001",
        "ain_00000000000000000000000000000002",
        "ain_00000000000000000000000000000003",
        "ain_00000000000000000000000000000004",
        "ain_00000000000000000000000000000005",
      ],
      requestId: "req_foreground_replay_window",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPerScan: 5,
      }),
    );
  });

  it("does not synthesize a wake when assistant work progressed without a due time", async () => {
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
        nextWakeAt: null,
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

  it("schedules an immediate wake when the normal assistant scan saturates its limit", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runAssistantAutomationPass.mockResolvedValueOnce({
        nextWakeAt: null,
        progressed: true,
        replies: {
          considered: 50,
          failed: 0,
          nextWakeAt: null,
          replied: 50,
          skipped: 0,
        },
        routing: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          noAction: 0,
          routed: 0,
          skipped: 0,
        },
      });

      const result = await runHostedAssistantRuntimeTimerLane({
        wake: {
          eventId: "evt_assistant_backlog",
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
        requestId: "req_assistant_backlog",
        runtime: createHostedAutomationRuntime(),
        vaultRoot: "/tmp/vault-root",
      });

      expect(result.nextWakeAt).toBe("2026-04-08T00:00:00.000Z");
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
    const drainWorker = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValue(0);
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close: vi.fn(),
      drainWorker,
      getNextWakeAt: () => "2026-04-08T00:30:00.000Z",
      runSchedulerOnce: vi.fn(async () => undefined),
    });
    const shouldYieldDeviceSync = vi.fn(() => false);

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
      shouldYieldDeviceSync,
      timeoutMs: 45_000,
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual(result, {
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-08T00:30:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    expect(drainWorker).toHaveBeenCalledWith(1);
    expect(shouldYieldDeviceSync).toHaveBeenCalled();
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
