import type {
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import type {
  HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectHostedAssistantDeliverySideEffects: vi.fn(),
  createHostedAssistantChannelTypingDependencies: vi.fn(),
  drainHostedProviderCleanupAfterCommit: vi.fn(),
  drainHostedCommittedAssistantDeliveriesAfterCommit: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listPendingAssistantAutoReplyLinqCleanupEvidence: vi.fn(),
  markAssistantAutoReplyLinqCleanupQueued: vi.fn(),
  prepareHostedAssistantDeliverySideEffectsForCheckpoint: vi.fn(),
  prepareHostedSystemMailboxItemForCheckpoint: vi.fn(),
  recordHostedProviderCleanupBeforeCommit: vi.fn(),
  recordHostedSystemMailboxItemAfterCheckpoint: vi.fn(),
  readHostedProviderCleanupCheckpoint: vi.fn(),
  resolveHostedAssistantOutboxNextWakeAt: vi.fn(),
  resolveHostedSystemMailboxNextWakeAt: vi.fn(),
  runHostedAssistantRuntimeTimerLane: vi.fn(),
}));

vi.mock("@murphai/assistant-engine/assistant-automation", () => ({
  listPendingAssistantAutoReplyLinqCleanupEvidence:
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued: mocks.markAssistantAutoReplyLinqCleanupQueued,
}));

vi.mock("../src/hosted-runtime/callbacks.ts", () => ({
  collectHostedAssistantDeliverySideEffects: mocks.collectHostedAssistantDeliverySideEffects,
  drainHostedCommittedAssistantDeliveriesAfterCommit:
    mocks.drainHostedCommittedAssistantDeliveriesAfterCommit,
  prepareHostedAssistantDeliverySideEffectsForCheckpoint:
    mocks.prepareHostedAssistantDeliverySideEffectsForCheckpoint,
  resolveHostedAssistantOutboxNextWakeAt: mocks.resolveHostedAssistantOutboxNextWakeAt,
}));

vi.mock("../src/hosted-runtime/channel-activity.ts", () => ({
  createHostedAssistantChannelTypingDependencies:
    mocks.createHostedAssistantChannelTypingDependencies,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget: mocks.hydrateHostedExecutionDefaultTarget,
}));

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedAssistantRuntimeTimerLane: mocks.runHostedAssistantRuntimeTimerLane,
}));

vi.mock("../src/hosted-runtime/provider-cleanup.ts", () => ({
  drainHostedProviderCleanupAfterCommit: mocks.drainHostedProviderCleanupAfterCommit,
  recordHostedProviderCleanupBeforeCommit: mocks.recordHostedProviderCleanupBeforeCommit,
  readHostedProviderCleanupCheckpoint: mocks.readHostedProviderCleanupCheckpoint,
}));

vi.mock("../src/hosted-runtime/system-mailbox.ts", () => ({
  prepareHostedSystemMailboxItemForCheckpoint:
    mocks.prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedSystemMailboxItemAfterCheckpoint:
    mocks.recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedSystemMailboxNextWakeAt: mocks.resolveHostedSystemMailboxNextWakeAt,
}));

import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import {
  buildHostedRuntimeLogContextFields,
  compactHostedRuntimeLogCodes,
  summarizeHostedRuntimeStatusCounts,
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "../src/hosted-runtime/runtime-logs.ts";

type RuntimeDeviceSyncPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["deviceSyncPort"]
>;
type RuntimeDeviceSyncConnectLinkRequest = Parameters<
  RuntimeDeviceSyncPort["createConnectLink"]
>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([]);
  mocks.createHostedAssistantChannelTypingDependencies.mockReturnValue({});
  mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValue({
    attemptedLinqMessageCount: 0,
    deletedLinqMessageCount: 0,
    failedLinqMessageCount: 0,
    nextWakeAt: null,
  });
  mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockResolvedValue([]);
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValue({
    captureIds: [],
    linqMessageIds: [],
  });
  mocks.markAssistantAutoReplyLinqCleanupQueued.mockResolvedValue(undefined);
  mocks.prepareHostedAssistantDeliverySideEffectsForCheckpoint.mockResolvedValue(undefined);
  mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);
  mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValue(undefined);
  mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValue({
    failed: 0,
    nextWakeAt: null,
    recorded: 1,
  });
  mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue(null);
  mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(null);
  mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValue(null);
  mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValue({
    nextWakeAt: null,
    parserProcessed: 0,
    progressed: false,
    redactedLogEntries: [],
  });
});

describe("runHostedWorkspaceAssistantPhase runtime logs", () => {
  it("hydrates the hosted default assistant target before running automation", async () => {
    const hostedDefaultTarget = {
      adapter: "codex-cli" as const,
      approvalPolicy: "never" as const,
      codexCommand: null,
      model: "gpt-5.5",
      modelProvider: "vercel-ai-gateway",
      oss: false,
      profile: null,
      reasoningEffort: "medium" as const,
      sandbox: "danger-full-access" as const,
    };
    mocks.hydrateHostedExecutionDefaultTarget.mockImplementationOnce(async (value) => ({
      ...value,
      hosted: {
        ...value.hosted,
        defaultTarget: hostedDefaultTarget,
      },
    }));

    await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith({
      hosted: expect.objectContaining({
        memberId: "member_synthetic_phase",
        userEnvKeys: [],
      }),
    });
    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          hosted: expect.objectContaining({
            defaultTarget: hostedDefaultTarget,
          }),
        }),
      }),
    );
  });

  it("adds delegated Vercel Gateway Stripe customer id to the hosted execution context", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      billingStripeCustomerId: "cus_platform_gateway",
      runtimeForwardedEnv: {
        HOSTED_AI_USAGE_BILLING_MODE: "stripe_meter",
        HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "rk_test_gateway",
        HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
        HOSTED_ASSISTANT_PROVIDER: "vercel-ai-gateway",
        VERCEL_AI_API_KEY: "platform-vercel-key",
      },
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith({
      hosted: expect.objectContaining({
        memberId: "member_synthetic_phase",
        stripeCustomerId: "cus_platform_gateway",
        userEnvKeys: [],
      }),
    });
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          hosted: expect.objectContaining({
            stripeCustomerId: "cus_platform_gateway",
          }),
        }),
      }),
    );
  });

  it("exposes hosted device connect providers and link helper from the platform port", async () => {
    const connectLinkRequests: RuntimeDeviceSyncConnectLinkRequest[] = [];
    const deviceSyncPort = {
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink(request) {
        connectLinkRequests.push(request);
        return {
          authorizationUrl: `https://connect.example.test/${request.provider}`,
          expiresAt: "2026-04-29T00:05:00.000Z",
          provider: request.provider,
          providerLabel: "WHOOP",
        };
      },
      async fetchSnapshot() {
        return {
          connections: [],
          generatedAt: "2026-04-29T00:00:00.000Z",
          userId: "member_synthetic_phase",
        };
      },
    } satisfies RuntimeDeviceSyncPort;

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    expect(hydratedContext).toEqual({
      hosted: expect.objectContaining({
        deviceConnectProviders: [
          { label: "WHOOP", provider: "whoop" },
        ],
        issueDeviceConnectLink: expect.any(Function),
        memberId: "member_synthetic_phase",
      }),
    });
    await expect(
      hydratedContext?.hosted?.issueDeviceConnectLink?.({
        messagingReturnTarget: "telegram",
        provider: "whoop",
      }),
    ).resolves.toEqual({
      authorizationUrl: "https://connect.example.test/whoop",
      expiresAt: "2026-04-29T00:05:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    });
    expect(connectLinkRequests).toEqual([
      { messagingReturnTarget: "telegram", provider: "whoop" },
    ]);
  });

  it("writes a durable assistant pass summary without requiring local log storage", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:05:00.000Z",
      parserProcessed: 2,
      progressed: true,
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation pass finished.",
        phase: "wake.running",
        redacted: {
          assistantProviderRequest: {
            model: "not-allowed-nested",
          },
          autoReplyChannels: "linq",
          localPathPreview: "/tmp/not-allowed",
          replyConsidered: 1,
        },
      }],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));

    expect(result.progressed).toBe(true);
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.automation_detail",
      "assistant.pass_finished",
    ]);
    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      attemptId: "attempt_synthetic_phase",
      component: "assistant",
      eventCode: "assistant.automation_detail",
      leaseGeneration: "3",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        autoReplyChannels: "linq",
        detailComponent: "runtime",
        detailLabel: "Hosted assistant automation pass finished.",
        replyConsidered: 1,
      }),
      workspaceVersion: "8",
    }));
    expect(logRequests[0]?.entries[0]?.redactedJson).not.toEqual(expect.objectContaining({
      assistantProviderRequest: expect.anything(),
      localPathPreview: expect.anything(),
    }));
    expect(logRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      attemptId: "attempt_synthetic_phase",
      component: "assistant",
      eventCode: "assistant.pass_finished",
      leaseGeneration: "3",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        automationLogCount: 1,
        deliveryEffectCount: 0,
        nextWakeAtPresent: true,
        parserProcessed: 2,
        progressed: true,
      }),
      workspaceVersion: "8",
    }));
  });

  it("writes an outbox delivery summary after committed delivery effects drain", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_synthetic",
        providerMessageIds: [],
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    await result.afterCheckpoint?.();

    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
      "outbox.delivery_finished",
    ]);
    expect(logRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "info",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 1,
        failed: 0,
        retryable: 0,
        sent: 1,
        statusSummary: "sent:1",
      }),
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryOutcomes: [expect.objectContaining({
          deliveryChannel: "telegram",
          providerMessageId: "provider_synthetic",
        })],
        env: {},
        vaultRoot: "/tmp/murph-vault",
      }),
    );
  });

  it("writes a warning outbox delivery summary when a committed delivery fails", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: "outbox.synthetic_failed",
        deliveryErrorMessage: "redacted",
        deliveryStatus: "failed_ambiguous",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "500",
        providerMessageId: null,
        providerMessageIds: [],
        providerThreadId: null,
        retryable: true,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    await result.afterCheckpoint?.();

    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
      "outbox.delivery_finished",
    ]);
    expect(logRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "warn",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 1,
        failed: 1,
        retryable: 1,
        sent: 0,
        statusSummary: "failed_ambiguous:1",
      }),
    }));
  });

  it("writes a system mailbox processing summary", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_123456789",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      status: "retryable_failed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));

    expect(result.checkpointReason).toBe("maintenance");
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "mailbox.system_processed",
    ]);
    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "mailbox",
      errorCode: "system_mailbox.retryable",
      eventCode: "mailbox.system_processed",
      level: "warn",
      phase: "checkpoint",
      redactedJson: expect.objectContaining({
        errorCode: "system_mailbox.retryable",
        nextWakeAtPresent: true,
        status: "retryable_failed",
      }),
    }));
  });

  it("writes a system mailbox record summary after checkpoint", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValueOnce(null);
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 1,
      nextWakeAt: "2026-04-27T00:15:00.000Z",
      recorded: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    await result.afterCheckpoint?.();

    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "mailbox.system_processed",
      "mailbox.system_processed",
    ]);
    expect(logRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "mailbox",
      eventCode: "mailbox.system_processed",
      level: "warn",
      redactedJson: expect.objectContaining({
        attemptCount: 2,
        nextWakeAtPresent: true,
        recordFailed: 1,
        recorded: 0,
        routeAction: "dispatch-assistant-notification",
        status: "recorded",
        wakeKind: "assistant.notification.requested",
      }),
    }));
  });

  it("runs pending provider cleanup after a system mailbox receipt without delivery effects", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.checkpointReason).toBe("system_mailbox_receipt");
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedCommittedAssistantDeliveriesAfterCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryOutcomes: [],
        checkpoint: {
          nextWakeAt: null,
        },
        env: {},
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
        hostedSystemMailboxRecordFailed: 0,
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("drains delivery effects created by system mailbox notifications after checkpoint", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const livenessTouches: string[] = [];
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_notification",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.resolveHostedAssistantOutboxNextWakeAt
      .mockResolvedValueOnce("2026-04-27T00:20:00.000Z")
      .mockResolvedValueOnce(null);
    mocks.drainHostedCommittedAssistantDeliveriesAfterCommit.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: "fingerprint_synthetic",
        effectId: "effect_synthetic",
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_synthetic",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      runtimeLivenessPort: {
        async touch(input) {
          livenessTouches.push(input.requestId);
          return { ok: true };
        },
      },
    }));

    expect(result.checkpointReason).toBe("outbox_sending");
    expect(result.nextWakeAt).toBe("2026-04-27T00:20:00.000Z");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedOutboxPendingDeliveryEffects: 1,
      hostedSystemMailboxPrepared: 1,
    }));
    expect(mocks.prepareHostedAssistantDeliverySideEffectsForCheckpoint)
      .toHaveBeenCalledWith(expect.objectContaining({
        assistantDeliveryEffects: [expect.objectContaining({
          effectId: "effect_synthetic",
        })],
      }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliveryAttempted: 1,
        hostedOutboxDeliverySent: 1,
        hostedSystemMailboxRecordFailed: 0,
        hostedSystemMailboxRecorded: 1,
      }),
    }));
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "mailbox.system_processed",
      "mailbox.system_processed",
      "outbox.delivery_finished",
    ]);
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryOutcomes: [expect.objectContaining({
          deliveryChannel: "linq",
          providerMessageId: "provider_synthetic",
        })],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    const deliveryDrainInput = mocks.drainHostedCommittedAssistantDeliveriesAfterCommit
      .mock.calls[0]?.[0];
    const cleanupDrainInput = mocks.drainHostedProviderCleanupAfterCommit.mock.calls[0]?.[0];
    await deliveryDrainInput.assertLiveness();
    await cleanupDrainInput.assertLiveness();
    expect(livenessTouches).toEqual([
      "hosted-workspace-invocation:attempt_synthetic_phase:post-checkpoint",
      "hosted-workspace-invocation:attempt_synthetic_phase:post-checkpoint",
    ]);
  });

  it("runs pending provider cleanup after a maintenance checkpoint even without delivery effects", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.progressed).toBe(true);
    expect(result.checkpointReason).toBe("maintenance");
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedCommittedAssistantDeliveriesAfterCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryOutcomes: [],
        checkpoint: {
          nextWakeAt: null,
        },
        env: {},
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "maintenance",
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
      }),
    }));
  });

  it("treats pending terminal Linq cleanup evidence as checkpoint progress", async () => {
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValueOnce({
      captureIds: ["cap_terminal_cleanup"],
      linqMessageIds: ["linq_msg_terminal_cleanup"],
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.progressed).toBe(true);
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: null,
      },
      linqMessageIds: ["linq_msg_terminal_cleanup"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).toHaveBeenCalledWith({
      captureIds: ["cap_terminal_cleanup"],
      vault: "/tmp/murph-vault",
    });

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryOutcomes: [],
        checkpoint: {
          nextWakeAt: null,
        },
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "maintenance",
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
      }),
    }));
  });
});

describe("hosted runtime log helpers", () => {
  it("keeps helper logging best-effort and redacted", async () => {
    await expect(writeHostedRuntimeLogBestEffort({
      entry: {
        component: "assistant",
        eventCode: "assistant.pass_finished",
        level: "info",
        phase: "invoke",
      },
      platform: {},
    })).resolves.toBeUndefined();

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(writeHostedRuntimeLogBestEffort({
        entry: {
          component: "assistant",
          eventCode: "assistant.pass_finished",
          level: "info",
          phase: "invoke",
        },
        now: () => "2026-04-27T00:00:00.000Z",
        platform: {
          logPort: {
            async write() {
              throw new TypeError("Synthetic log write failure.");
            },
          },
        },
      })).resolves.toBeUndefined();
      expect(consoleWarn).toHaveBeenCalledWith(
        "Hosted runtime durable log write failed.",
        {
          component: "assistant",
          errorName: "TypeError",
          eventCode: "assistant.pass_finished",
        },
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("normalizes log context, status summaries, and bounded codes", () => {
    expect(buildHostedRuntimeLogContextFields(null)).toEqual({});
    expect(buildHostedRuntimeLogContextFields({
      attemptId: "attempt_1",
      leaseGeneration: null,
      workspaceVersion: "3",
    })).toEqual({
      attemptId: "attempt_1",
      workspaceVersion: "3",
    });
    expect(toHostedRuntimeLogCode(null)).toBe("unclassified");
    expect(toHostedRuntimeLogCode("  ")).toBe("unclassified");
    expect(toHostedRuntimeLogCode("x".repeat(97))).toBe("unclassified");
    expect(toHostedRuntimeLogCode("not ok")).toBe("unclassified");
    expect(toHostedRuntimeLogCode("mailbox.ok_1")).toBe("mailbox.ok_1");
    expect(compactHostedRuntimeLogCodes(["b", "a", "b"])).toEqual(["a", "b"]);
    expect(summarizeHostedRuntimeStatusCounts(["sent", "retryable", "sent"])).toEqual({
      statusSummary: "retryable:1,sent:2",
    });
  });
});

function createPhaseInput(input: {
  billingStripeCustomerId?: string | null;
  logRequests?: HostedRuntimeLogRequest[];
  resolvedDeviceSync?: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["resolvedConfig"]["deviceSync"];
  runtimeDeviceSyncPort?: RuntimeDeviceSyncPort;
  runtimeForwardedEnv?: Record<string, string>;
  runtimeLivenessPort?: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["runtimeLivenessPort"];
  runtimeUserEnv?: Record<string, string>;
}): HostedWorkspaceRuntimeAssistantPhaseInput {
  const billingPort =
    input.billingStripeCustomerId === undefined
      ? null
      : {
          async resolveVercelAiGatewayStripeCustomerId() {
            return { stripeCustomerId: input.billingStripeCustomerId ?? null };
          },
        };

  return {
    initialMailboxImport: {
      afterCheckpointEffects: [],
      checkpoint: null,
      importResult: {
        blocked: [],
        fetchedCount: 0,
        importedCount: 0,
        state: {
          recentStatuses: [],
          watermarks: {
            conversation: "0",
            system: "0",
          },
        },
      },
      previousState: {
        recentStatuses: [],
        watermarks: {
          conversation: "0",
          system: "0",
        },
      },
      state: {
        recentStatuses: [],
        watermarks: {
          conversation: "0",
          system: "0",
        },
      },
      stateChanged: false,
    },
    platform: {
      artifactStore: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
      },
      effectsPort: {
        readRawEmailMessage: vi.fn(async () => null),
        sendEmail: vi.fn(async () => undefined),
      },
      ...(billingPort ? { billingPort } : {}),
      ...(input.logRequests
        ? {
            logPort: {
              async write(request: HostedRuntimeLogRequest) {
                input.logRequests?.push(request);
                return {
                  loggedCount: request.entries.length,
                };
              },
            },
          }
        : {}),
    },
    request: {
      attemptId: "attempt_synthetic_phase",
      leaseGeneration: "3",
      reason: "nudge",
      userId: "member_synthetic_phase",
      workspaceVersion: "8",
    },
    restored: {
      assistantStateRoot: "/tmp/murph-assistant-state",
      operatorHomeRoot: "/tmp/murph-operator-home",
      vaultRoot: "/tmp/murph-vault",
    },
    runtime: {
      commitTimeoutMs: null,
      forwardedEnv: input.runtimeForwardedEnv ?? {},
      platform: {
        artifactStore: {
          get: vi.fn(async () => null),
          put: vi.fn(async () => undefined),
        },
        effectsPort: {
          readRawEmailMessage: vi.fn(async () => null),
          sendEmail: vi.fn(async () => undefined),
        },
        ...(billingPort ? { billingPort } : {}),
        ...(input.runtimeDeviceSyncPort ? { deviceSyncPort: input.runtimeDeviceSyncPort } : {}),
        ...(input.runtimeLivenessPort ? { runtimeLivenessPort: input.runtimeLivenessPort } : {}),
      },
      platformEnv: {},
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: input.resolvedDeviceSync ?? null,
      },
      userEnv: input.runtimeUserEnv ?? {},
    },
    runtimeEnv: {},
    workspace: null,
  };
}

function createDeliveryEffect(): HostedAssistantDeliverySideEffect {
  return {
    effectId: "effect_synthetic",
    fingerprint: "fingerprint_synthetic",
    kind: "assistant.delivery",
    payload: {
      actorId: null,
      bindingDeliveryKind: null,
      bindingDeliveryTarget: null,
      channel: "telegram",
      explicitTarget: null,
      identityId: null,
      idempotencyKey: "assistant-outbox:intent_synthetic",
      message: "Synthetic delivery",
      replyToMessageId: null,
      sessionId: "session_synthetic",
      subject: null,
      threadId: null,
      threadIsDirect: true,
      transportIdempotent: true,
      turnId: "turn_synthetic",
    },
  };
}

function createSystemMailboxItem() {
  return {
    attemptCount: 2,
    itemId: "system_mailbox_item_processed",
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: "dedupe_system_mailbox_item_processed",
    nextAttemptAt: null,
    occurredAt: "2026-04-27T00:00:00.000Z",
    postCheckpointRecord: null,
    requestId: "request_system_mailbox_item_processed",
    routeAction: "dispatch-assistant-notification" as const,
    status: "pending" as const,
    wake: {
      kind: "assistant.notification.requested" as const,
      notification: {
        delivery: null,
      },
    },
  };
}
