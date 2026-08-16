import type {
  HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectHostedAssistantDeliverySideEffects: vi.fn(),
  createHostedAssistantProgressDeliveryDependencies: vi.fn(),
  createHostedAssistantChannelTypingDependencies: vi.fn(),
  createStoreBackedAssistantInputSource: vi.fn(() => ({
    listInputCandidates: vi.fn(async () => ({
      inputs: [],
      nextCursor: null,
    })),
    listNewConversationInputs: vi.fn(async () => ({
      inputs: [],
      nextCursor: null,
    })),
    refresh: vi.fn(async () => ({
      progressed: false,
      reason: "no_new_input",
    })),
  })),
  drainHostedPreparedAssistantDeliveries: vi.fn(),
  drainHostedProviderCleanupAfterCommit: vi.fn(),
  hasCompleteAssistantAutoReplyTerminalEvidence: vi.fn(),
  hasPendingAssistantAutoReplyInput: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listAssistantInputEvents: vi.fn(),
  listPendingAssistantAutoReplyLinqCleanupEvidence: vi.fn(),
  maintainAssistantAutoReplyRouteState: vi.fn(async () => ({
    changed: false,
    trusted: true,
  })),
  markAssistantAutoReplyLinqCleanupQueued: vi.fn(),
  prepareHostedAssistantAutomationForWake: vi.fn(),
  prepareHostedAssistantDeliveryEffectsForDispatch: vi.fn(),
  prepareHostedProviderCleanupPlan: vi.fn(),
  prepareHostedSystemMailboxItemForCheckpoint: vi.fn(),
  recordHostedDeviceSyncDirtyPostCheckpointRecord: vi.fn(),
  recordHostedProviderCleanupBeforeCommit: vi.fn(),
  recordHostedSystemMailboxItemAfterCheckpoint: vi.fn(),
  readHostedProviderCleanupCheckpoint: vi.fn(),
  resolveHostedProviderCleanupCheckpointWakeAt: vi.fn(),
  resolveHostedProviderCleanupFirstDeferredWakeAt: vi.fn(),
  resolveHostedProviderCleanupScheduledWakeAt: vi.fn(),
  resolveHostedAssistantOutboxNextWakeAt: vi.fn(),
  resolveHostedSystemMailboxNextWakeCandidate: vi.fn(),
  resolveHostedSystemMailboxNextWakeAt: vi.fn(),
  runHostedAssistantAutomationLane: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
}));

vi.mock("@murphai/assistant-engine/assistant-automation", () => ({
  hasCompleteAssistantAutoReplyTerminalEvidence:
    mocks.hasCompleteAssistantAutoReplyTerminalEvidence,
  hasPendingAssistantAutoReplyInput: mocks.hasPendingAssistantAutoReplyInput,
  listPendingAssistantAutoReplyLinqCleanupEvidence:
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued: mocks.markAssistantAutoReplyLinqCleanupQueued,
}));

vi.mock("@murphai/assistant-engine/assistant-runtime-residue", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/assistant-engine/assistant-runtime-residue")
  >();
  return {
    ...actual,
    maintainAssistantAutoReplyRouteState:
      mocks.maintainAssistantAutoReplyRouteState,
  };
});

vi.mock("@murphai/assistant-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/assistant-engine")>();
  return {
    ...actual,
    createStoreBackedAssistantInputSource: mocks.createStoreBackedAssistantInputSource,
    listAssistantInputEvents: mocks.listAssistantInputEvents,
  };
});

vi.mock("../src/hosted-runtime/callbacks.ts", () => ({
  collectHostedAssistantDeliverySideEffects: mocks.collectHostedAssistantDeliverySideEffects,
  createHostedAssistantProgressDeliveryDependencies:
    mocks.createHostedAssistantProgressDeliveryDependencies,
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
  prepareHostedAssistantAutomationForWake:
    mocks.prepareHostedAssistantAutomationForWake,
}));

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedAssistantAutomationLane: mocks.runHostedAssistantAutomationLane,
}));

vi.mock("../src/hosted-runtime/device-sync-maintenance-import.ts", () => ({
  isHostedDeviceSyncMaintenanceModuleLoadError: vi.fn(() => false),
  loadHostedDeviceSyncMaintenanceModule: vi.fn(async () => ({
    runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
  })),
}));

vi.mock("../src/hosted-runtime/provider-cleanup.ts", () => ({
  drainHostedProviderCleanupAfterCommit: mocks.drainHostedProviderCleanupAfterCommit,
  prepareHostedProviderCleanupPlan: mocks.prepareHostedProviderCleanupPlan,
  recordHostedProviderCleanupBeforeCommit: mocks.recordHostedProviderCleanupBeforeCommit,
  readHostedProviderCleanupCheckpoint: mocks.readHostedProviderCleanupCheckpoint,
  resolveHostedProviderCleanupCheckpointWakeAt:
    mocks.resolveHostedProviderCleanupCheckpointWakeAt,
  resolveHostedProviderCleanupFirstDeferredWakeAt:
    mocks.resolveHostedProviderCleanupFirstDeferredWakeAt,
  resolveHostedProviderCleanupScheduledWakeAt:
    mocks.resolveHostedProviderCleanupScheduledWakeAt,
}));

vi.mock("../src/hosted-runtime/system-mailbox.ts", () => ({
  prepareHostedSystemMailboxItemForCheckpoint:
    mocks.prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedDeviceSyncDirtyPostCheckpointRecord:
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord,
  recordHostedSystemMailboxItemAfterCheckpoint:
    mocks.recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedSystemMailboxNextWakeCandidate:
    mocks.resolveHostedSystemMailboxNextWakeCandidate,
  resolveHostedSystemMailboxNextWakeAt: mocks.resolveHostedSystemMailboxNextWakeAt,
}));

import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";

function withoutAssistantTurnTimingLogs(
  logRequests: HostedRuntimeLogRequest[],
): HostedRuntimeLogRequest[] {
  return logRequests.filter(
    (request) =>
      request.entries[0]?.redactedJson?.schema
        !== "murph.assistant-turn-timing.v1",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([]);
  mocks.createHostedAssistantProgressDeliveryDependencies.mockReturnValue({});
  mocks.createHostedAssistantChannelTypingDependencies.mockReturnValue({});
  mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([]);
  mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValue({
    attemptedLinqMessageCount: 0,
    deletedLinqMessageCount: 0,
    failedLinqMessageCount: 0,
    nextWakeAt: null,
  });
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.hasCompleteAssistantAutoReplyTerminalEvidence.mockResolvedValue(false);
  mocks.listAssistantInputEvents.mockResolvedValue({
    events: [],
    nextCursor: null,
  });
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValue({
    captureIds: [],
    linqMessageIds: [],
  });
  mocks.hasPendingAssistantAutoReplyInput.mockResolvedValue(false);
  mocks.markAssistantAutoReplyLinqCleanupQueued.mockResolvedValue(undefined);
  mocks.prepareHostedProviderCleanupPlan.mockImplementation(async (input: {
    deferred: boolean;
  }) => ({
    checkpoint: null,
    deferred: input.deferred,
    due: false,
    requiresCheckpoint: false,
    stateQueued: false,
    wakeAt: null,
  }));
  mocks.prepareHostedAssistantAutomationForWake.mockResolvedValue(undefined);
  mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue(undefined);
  mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);
  mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValue({
    nextWakeAt: null,
    recorded: 1,
    stillDirty: false,
  });
  mocks.recordHostedProviderCleanupBeforeCommit.mockImplementation(async (input) =>
    input.checkpoint
  );
  mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValue({
    failed: 0,
    nextWakeAt: null,
    recorded: 1,
  });
  mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue(null);
  mocks.resolveHostedProviderCleanupFirstDeferredWakeAt.mockImplementation((input = {}) => {
    const record = input as { nowMs?: number | null };
    const nowMs = Number.isFinite(record.nowMs)
      ? Number(record.nowMs)
      : Date.parse("2026-04-27T00:00:00.000Z");
    return new Date(nowMs + 5 * 60_000).toISOString();
  });
  mocks.resolveHostedProviderCleanupCheckpointWakeAt.mockImplementation((input) => {
    const checkpoint = input.checkpoint as { nextWakeAt?: string | null } | null;
    if (!checkpoint) {
      return null;
    }
    const nextWakeAt = checkpoint.nextWakeAt ?? null;
    const nextWakeMs = Date.parse(nextWakeAt ?? "");
    if (!Number.isFinite(nextWakeMs) || nextWakeMs <= input.nowMs) {
      return input.deferDueOrInvalid
        ? mocks.resolveHostedProviderCleanupFirstDeferredWakeAt({
            idleCheckpointDelayMs: input.idleCheckpointDelayMs,
            nowMs: input.nowMs,
          })
        : null;
    }
    return nextWakeAt;
  });
  mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(null);
  mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(null);
  mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValue(null);
  mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async () => {
    const at = await mocks.resolveHostedSystemMailboxNextWakeAt();
    return {
      at,
      reason: at ? "assistant" : null,
    };
  });
  mocks.runHostedAssistantAutomationLane.mockResolvedValue({
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
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
          ...Object.fromEntries(
            Array.from({ length: 48 }, (_, index) => [
              `genericResumeOverflow${index}Count`,
              index,
            ]),
          ),
          codexResumeFailureCodexAbortRequested: false,
          codexResumeFailureCodexExitSignal: "SIGKILL",
          codexResumeFailureCodexFailureStage: "turn_failed",
          codexResumeFailureCodexTurnStatus: "failed",
          codexResumeFailureCodexJsonEventCount: 3,
          codexResumeFailureCodexLifecycleStage: "turn_running",
          codexResumeFailureCodexLiveTurnOpen: true,
          codexResumeFailureCodexPendingRpcCount: 1,
          codexResumeFailureCodexPendingRpcMethod: "turn/start",
          codexResumeFailureCodexProcessGroupPresent: true,
          codexResumeFailureCodexProcessLifetimeMs: 2041,
          codexResumeFailureCodexProviderRequestStarted: true,
          codexResumeFailureCodexShutdownRequested: false,
          codexResumeFailureCodexStderrBytes: 128,
          codexResumeFailureCodexTerminationSignalSent: null,
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
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        codexResumeFailureCodexAbortRequested: false,
        codexResumeFailureCodexExitSignal: "SIGKILL",
        codexResumeFailureCodexJsonEventCount: 3,
        codexResumeFailureCodexLifecycleStage: "turn_running",
        codexResumeFailureCodexLiveTurnOpen: true,
        codexResumeFailureCodexPendingRpcCount: 1,
        codexResumeFailureCodexPendingRpcMethod: "turn/start",
        codexResumeFailureCodexProcessGroupPresent: true,
        codexResumeFailureCodexProcessLifetimeMs: 2041,
        codexResumeFailureCodexProviderRequestStarted: true,
        codexResumeFailureCodexShutdownRequested: false,
        codexResumeFailureCodexStderrBytes: 128,
        codexResumeFailureCodexTerminationSignalSent: null,
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
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).not.toEqual(
      expect.objectContaining({
        codexResumeFailureErrorPreview: expect.anything(),
      }),
    );
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).not.toEqual(
      expect.objectContaining({
        genericResumeOverflow0Count: expect.anything(),
      }),
    );
    expect(JSON.stringify(logRequests)).not.toContain("private text should not persist");
    expect(JSON.stringify(logRequests)).not.toContain("test-token-value");
  });

  it("preserves neutral provider-plan diagnostics", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
          reasoningEffort: "high",
          routePlanningElapsedMs: 71_000,
          routePlanningFallbackInstructionsElapsedMs: 66_000,
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
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        reasoningEffort: "high",
        routePlanningElapsedMs: 71_000,
        routePlanningFallbackInstructionsElapsedMs: 66_000,
        routePlanningMeasuredElapsedMs: 70_990,
        routePlanningMemoryOverviewElapsedMs: 900,
        routePlanningPrimaryInstructionsElapsedMs: 70,
        routePlanningSlowestStage: "fallback_instructions",
        routePlanningSlowestStageElapsedMs: 66_000,
      }),
    }));
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).not.toEqual(
      expect.objectContaining({
        routePlanningPrimarySystemPromptElapsedMs: expect.anything(),
        routePlanningVaultOverviewElapsedMs: expect.anything(),
      }),
    );
  });

  it("preserves bounded Codex action tool diagnostics in durable detail logs", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [{
        component: "runtime.provider",
        level: "info",
        message: "Hosted assistant Codex action diagnostics captured.",
        phase: "wake.running",
        redacted: {
          codexActionCachedInputUnitMax: 1000,
          codexActionCommandCount: 1,
          codexActionCompletedCount: 2,
          codexActionDurationMsMax: 123,
          codexActionDurationMsTotal: 183,
          codexActionDynamicToolCallCount: 1,
          codexActionEventCount: 8,
          codexActionFailedCount: 0,
          codexActionFileChangeCount: 0,
          codexActionFinalCachedInputUnit: 900,
          codexActionFinalInputUnit: 81000,
          codexActionFinalOutputUnit: 1200,
          codexActionFinalReasoningOutputUnit: 300,
          codexActionFinalTotalUnit: 82500,
          codexActionInputUnitMax: 81000,
          codexActionKinds: ["dynamic.tool.call", "command.execution"],
          codexActionMcpToolCallCount: 0,
          codexActionOutputBytesMax: 64,
          codexActionOutputBytesTotal: 128,
          codexActionOutputItemCount: 3,
          codexActionOutputUnitMax: 1200,
          codexActionProviderActionCount: 2,
          codexActionReasoningOutputUnitMax: 300,
          codexActionSlowDurationMs: [123, 60],
          codexActionSlowKinds: ["dynamic.tool.call", "command.execution"],
          codexActionStartedCount: 2,
          codexActionThreadIdPresent: true,
          codexActionToolSummaries: [
            {
              callCount: 1,
              kind: "dynamic.tool.call",
              namespacePresent: true,
              outputBytesMax: 64,
              outputBytesTotal: 96,
              tool: "readSummary",
            },
            {
              callCount: 1,
              kind: "command.execution",
              outputBytesMax: 32,
              outputBytesTotal: 32,
            },
          ],
          codexActionTotalUnitMax: 82500,
          codexActionTraceType: "action-diagnostics",
          codexActionTurnIdPresent: true,
          codexActionUsageSampleCount: 1,
          codexActionWebSearchCount: 0,
          providerTraceKind: "codex.action_diagnostics",
          schema: "murph.assistant-codex-action-diagnostics.v1",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        codexActionCommandCount: 1,
        codexActionKinds: ["dynamic.tool.call", "command.execution"],
        codexActionOutputBytesTotal: 128,
        codexActionSlowKinds: ["dynamic.tool.call", "command.execution"],
        codexActionToolSummaries: [
          {
            callCount: 1,
            kind: "dynamic.tool.call",
            namespacePresent: true,
            outputBytesMax: 64,
            outputBytesTotal: 96,
            tool: "readSummary",
          },
          {
            callCount: 1,
            kind: "command.execution",
            outputBytesMax: 32,
            outputBytesTotal: 32,
          },
        ],
        providerTraceKind: "codex.action_diagnostics",
        schema: "murph.assistant-codex-action-diagnostics.v1",
      }),
    }));
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
        consumedSeqByLane: {
          conversation: null,
          system: null,
        },
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
        },
        deviceSync: null,
      },
      userEnv: {},
    },
    runtimeEnv: {},
    workspace: null,
  };
}
