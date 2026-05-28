import type {
  HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectHostedAssistantDeliverySideEffects: vi.fn(),
  createHostedAssistantChannelTypingDependencies: vi.fn(),
  drainHostedPreparedAssistantDeliveries: vi.fn(),
  drainHostedProviderCleanupAfterCommit: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listPendingAssistantAutoReplyLinqCleanupEvidence: vi.fn(),
  markAssistantAutoReplyLinqCleanupQueued: vi.fn(),
  prepareHostedAssistantDeliveryEffectsForDispatch: vi.fn(),
  prepareHostedSystemMailboxItemForCheckpoint: vi.fn(),
  recordHostedDeviceSyncDirtyPostCheckpointRecord: vi.fn(),
  recordHostedProviderCleanupBeforeCommit: vi.fn(),
  recordHostedSystemMailboxItemAfterCheckpoint: vi.fn(),
  readHostedProviderCleanupCheckpoint: vi.fn(),
  resolveHostedAssistantOutboxNextWakeAt: vi.fn(),
  resolveHostedSystemMailboxNextWakeAt: vi.fn(),
  runHostedAssistantRuntimeTimerLane: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
}));

vi.mock("@murphai/assistant-engine/assistant-automation", () => ({
  listPendingAssistantAutoReplyLinqCleanupEvidence:
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued: mocks.markAssistantAutoReplyLinqCleanupQueued,
}));

vi.mock("../src/hosted-runtime/callbacks.ts", () => ({
  collectHostedAssistantDeliverySideEffects: mocks.collectHostedAssistantDeliverySideEffects,
  drainHostedPreparedAssistantDeliveries:
    mocks.drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch:
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch,
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
  runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
}));

vi.mock("../src/hosted-runtime/provider-cleanup.ts", () => ({
  drainHostedProviderCleanupAfterCommit: mocks.drainHostedProviderCleanupAfterCommit,
  recordHostedProviderCleanupBeforeCommit: mocks.recordHostedProviderCleanupBeforeCommit,
  readHostedProviderCleanupCheckpoint: mocks.readHostedProviderCleanupCheckpoint,
}));

vi.mock("../src/hosted-runtime/system-mailbox.ts", () => ({
  prepareHostedSystemMailboxItemForCheckpoint:
    mocks.prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedDeviceSyncDirtyPostCheckpointRecord:
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord,
  recordHostedSystemMailboxItemAfterCheckpoint:
    mocks.recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedSystemMailboxNextWakeAt: mocks.resolveHostedSystemMailboxNextWakeAt,
}));

import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([]);
  mocks.createHostedAssistantChannelTypingDependencies.mockReturnValue({});
  mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([]);
  mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValue({
    attemptedLinqMessageCount: 0,
    deletedLinqMessageCount: 0,
    failedLinqMessageCount: 0,
    nextWakeAt: null,
  });
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValue({
    captureIds: [],
    linqMessageIds: [],
  });
  mocks.markAssistantAutoReplyLinqCleanupQueued.mockResolvedValue(undefined);
  mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue(undefined);
  mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);
  mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValue({
    nextWakeAt: null,
    recorded: 1,
    stillDirty: false,
  });
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
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
    postCheckpointRecord: null,
    progressed: false,
    redactedLogEntries: [],
  });
  mocks.runHostedDeviceSyncWakeLane.mockResolvedValue({
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
    postCheckpointRecord: null,
  });
});

describe("hosted workspace assistant diagnostics detail logs", () => {
  it("revalidates Codex resume-failure diagnostics before durable logging", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [{
        component: "runtime.provider",
        level: "info",
        message: "Hosted assistant Codex resume-failure diagnostics captured.",
        phase: "wake.running",
        redacted: {
          codexResumeFailureCodexFailureStage: "turn_failed",
          codexResumeFailureCodexTurnStatus: "failed",
          codexResumeFailureErrorCode: "ASSISTANT_CODEX_FAILED",
          codexResumeFailureErrorKind: "turn-failed",
          codexResumeFailureErrorMessage:
            "Codex app-server turn failed. status failed. Bearer test-token-value at /tmp/provider",
          codexResumeFailureErrorMessageLength: 251,
          codexResumeFailureErrorMessagePresent: true,
          codexResumeFailureErrorPhrases: [
            "codex-turn-failed",
            "status-failed",
          ],
          codexResumeFailureErrorPreview: "private text should not persist",
          codexResumeFailureEventCount: 2,
          codexResumeFailureEventKinds: ["message", "private"],
          codexResumeFailureEventMethods: ["turn/completed"],
          codexResumeFailureEventStatuses: ["failed", "turn_failed"],
          codexResumeFailureOutputArrayLengths: [3],
          codexResumeFailureOutputKinds: ["array", "object"],
          codexResumeFailureOutputObjectKeys: [
            "[key],text,type",
            "privateField,privateName",
          ],
          codexResumeFailureOutputPartTypes: ["input_text", "process_exit"],
          codexResumeFailureOutputStringLengths: [48, -1],
          codexResumeFailureParamKeys: ["output,[key]"],
          codexResumeFailurePhase: "resume-failed",
          codexResumeFailureProviderActionCount: 0,
          codexResumeFailureResumeMatchesFailureSession: true,
          codexResumeFailureResumeSessionPresent: true,
          codexResumeFailureRetryable: false,
          codexResumeFailureSessionPresent: true,
          codexResumeFailureTraceType: "failure",
          codexResumeFailureTurnPresent: true,
          providerTraceKind: "codex.resume_failure",
          schema: "murph.assistant-codex-resume-failure-diagnostics.v1",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));

    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        codexResumeFailureErrorCode: "ASSISTANT_CODEX_FAILED",
        codexResumeFailureErrorKind: "turn-failed",
        codexResumeFailureErrorMessage:
          "Codex app-server turn failed. status failed. Bearer [redacted] at <REDACTED_PATH>",
        codexResumeFailureErrorMessageLength: 251,
        codexResumeFailureErrorMessagePresent: true,
        codexResumeFailureErrorPhrases: [
          "codex-turn-failed",
          "status-failed",
        ],
        codexResumeFailureEventMethods: ["turn/completed"],
        codexResumeFailureEventKinds: ["message", "private"],
        codexResumeFailureEventStatuses: ["failed", "turn_failed"],
        codexResumeFailureOutputArrayLengths: [3],
        codexResumeFailureOutputKinds: ["array", "object"],
        codexResumeFailureOutputObjectKeys: [
          "[key],text,type",
          "privateField,privateName",
        ],
        codexResumeFailureOutputPartTypes: ["input_text", "process_exit"],
        codexResumeFailureOutputStringLengths: [48, -1],
        codexResumeFailureParamKeys: ["output,[key]"],
        codexResumeFailurePhase: "resume-failed",
        codexResumeFailureProviderActionCount: 0,
        codexResumeFailureTraceType: "failure",
        providerTraceKind: "codex.resume_failure",
        schema: "murph.assistant-codex-resume-failure-diagnostics.v1",
      }),
    }));
    expect(logRequests[0]?.entries[0]?.redactedJson).not.toEqual(
      expect.objectContaining({
        codexResumeFailureErrorPreview: expect.anything(),
      }),
    );
    expect(JSON.stringify(logRequests)).not.toContain("private text should not persist");
    expect(JSON.stringify(logRequests)).not.toContain("test-token-value");
  });

  it("preserves neutral route-planning timing diagnostics", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [{
        component: "runtime.provider",
        level: "info",
        message: "Hosted assistant provider plan captured.",
        phase: "wake.running",
        redacted: {
          providerTraceKind: "assistant.provider.plan",
          routePlanningElapsedMs: 71_000,
          routePlanningFallbackInstructionsElapsedMs: 66_000,
          routePlanningFreshThreadFallbackPromptElapsedMs: 66_000,
          routePlanningMeasuredElapsedMs: 70_990,
          routePlanningMemoryOverviewElapsedMs: 900,
          routePlanningPrimaryInstructionsElapsedMs: 70,
          routePlanningPrimarySystemPromptElapsedMs: 70,
          routePlanningSlowestStage: "fallback_instructions",
          routePlanningSlowestStageElapsedMs: 66_000,
          routePlanningVaultOverviewElapsedMs: 900,
          schema: "murph.assistant-provider-plan.v1",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));

    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        routePlanningElapsedMs: 71_000,
        routePlanningFallbackInstructionsElapsedMs: 66_000,
        routePlanningMeasuredElapsedMs: 70_990,
        routePlanningMemoryOverviewElapsedMs: 900,
        routePlanningPrimaryInstructionsElapsedMs: 70,
        routePlanningSlowestStage: "fallback_instructions",
        routePlanningSlowestStageElapsedMs: 66_000,
      }),
    }));
    expect(logRequests[0]?.entries[0]?.redactedJson).not.toEqual(
      expect.objectContaining({
        routePlanningFreshThreadFallbackPromptElapsedMs: expect.anything(),
        routePlanningPrimarySystemPromptElapsedMs: expect.anything(),
        routePlanningVaultOverviewElapsedMs: expect.anything(),
      }),
    );
  });
});

function createPhaseInput(input: {
  logRequests: HostedRuntimeLogRequest[];
}): HostedWorkspaceRuntimeAssistantPhaseInput {
  return {
    initialMailboxImport: {
      afterCheckpointEffects: [],
      checkpoint: null,
      checkpointDeferred: false,
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
      logPort: {
        async write(request: HostedRuntimeLogRequest) {
          input.logRequests.push(request);
          return {
            loggedCount: request.entries.length,
          };
        },
      },
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
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
          whatsappCloudApiConfigured: false,
        },
        deviceSync: null,
      },
      userEnv: {},
    },
    runtimeEnv: {},
    workspace: null,
  };
}
