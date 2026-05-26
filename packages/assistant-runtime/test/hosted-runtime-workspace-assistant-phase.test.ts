import type {
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import { readFile } from "node:fs/promises";
import type {
  HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildHostedLinqChannelEnv: vi.fn((input: {
    forwardedEnv: Readonly<Record<string, string>>;
    userEnv: Readonly<Record<string, string>>;
  }) => {
    const env: Record<string, string> = {};
    const token = input.userEnv.LINQ_API_TOKEN ?? input.forwardedEnv.LINQ_API_TOKEN;
    const baseUrl = input.userEnv.LINQ_API_BASE_URL ?? input.forwardedEnv.LINQ_API_BASE_URL;
    if (baseUrl) {
      env.LINQ_API_BASE_URL = baseUrl;
    }
    if (token) {
      env.LINQ_API_TOKEN = token;
    }
    return env;
  }),
  compareAssistantInputCursors: vi.fn(),
  collectHostedAssistantDeliverySideEffects: vi.fn(),
  collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes: vi.fn(),
  createHostedAssistantChannelTypingDependencies: vi.fn(),
  drainHostedProviderCleanupAfterCommit: vi.fn(),
  drainHostedPreparedAssistantDeliveries: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listPendingAssistantAutoReplyLinqCleanupEvidence: vi.fn(),
  markAssistantAutoReplyLinqCleanupQueued: vi.fn(),
  prepareHostedAssistantDeliveryEffectsForDispatch: vi.fn(),
  prepareHostedSystemMailboxItemForCheckpoint: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  readLatestAssistantInputCursor: vi.fn(),
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
  compareAssistantInputCursors: mocks.compareAssistantInputCursors,
  listPendingAssistantAutoReplyLinqCleanupEvidence:
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued: mocks.markAssistantAutoReplyLinqCleanupQueued,
  readLatestAssistantInputCursor: mocks.readLatestAssistantInputCursor,
}));

vi.mock("@murphai/assistant-engine/assistant-store", () => ({
  readAssistantAutomationState: mocks.readAssistantAutomationState,
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
  buildHostedLinqChannelEnv: mocks.buildHostedLinqChannelEnv,
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
  collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes:
    mocks.collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes,
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
import type {
  HostedAssistantDeliveryOutcome,
} from "../src/hosted-runtime/models.ts";
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
type RuntimeUsageRecordPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["usageRecordPort"]
>;
type RuntimeDeviceSyncConnectLinkRequest = Parameters<
  RuntimeDeviceSyncPort["createConnectLink"]
>[0];

function extractTopLevelFunctionBody(source: string, functionName: string): string {
  const declarationIndex = source.indexOf(`function ${functionName}`);
  if (declarationIndex < 0) {
    throw new Error(`Missing function ${functionName}.`);
  }
  const signatureEnd = source.indexOf("): Promise", declarationIndex);
  const bodyStart = source.indexOf("{", signatureEnd >= 0 ? signatureEnd : declarationIndex);
  if (bodyStart < 0) {
    throw new Error(`Missing function body for ${functionName}.`);
  }

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }

  throw new Error(`Unclosed function body for ${functionName}.`);
}

function createNoDirtyRuntimeDeviceSyncPortMethods(): Pick<
  RuntimeDeviceSyncPort,
  "ackDirtyStateProcessed" | "fetchDirtyStates"
> {
  return {
    async ackDirtyStateProcessed() {
      throw new Error("ackDirtyStateProcessed should not be called.");
    },
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: "member_synthetic_phase",
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildHostedLinqChannelEnv.mockImplementation((input) => {
    const env: Record<string, string> = {};
    const token = input.userEnv.LINQ_API_TOKEN ?? input.forwardedEnv.LINQ_API_TOKEN;
    const baseUrl = input.userEnv.LINQ_API_BASE_URL ?? input.forwardedEnv.LINQ_API_BASE_URL;
    if (baseUrl) {
      env.LINQ_API_BASE_URL = baseUrl;
    }
    if (token) {
      env.LINQ_API_TOKEN = token;
    }
    return env;
  });
  mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([]);
  mocks.createHostedAssistantChannelTypingDependencies.mockReturnValue({});
  mocks.collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes.mockImplementation(
    (outcomes: readonly HostedAssistantDeliveryOutcome[]) => [
      ...new Set(outcomes.flatMap((outcome) => {
        if (
          outcome.deliveryChannel !== "linq"
          || (outcome.deliveryStatus !== "sent" && outcome.deliveryStatus !== "failed_ambiguous")
        ) {
          return [];
        }

        const providerMessageIds = outcome.providerMessageIds ?? [];
        if (providerMessageIds.length > 0) {
          return providerMessageIds;
        }

        return outcome.providerMessageId ? [outcome.providerMessageId] : [];
      })),
    ],
  );
  mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValue({
    attemptedLinqMessageCount: 0,
    deletedLinqMessageCount: 0,
    failedLinqMessageCount: 0,
    nextWakeAt: null,
  });
  mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([]);
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValue({
    captureIds: [],
    linqMessageIds: [],
  });
  mocks.markAssistantAutoReplyLinqCleanupQueued.mockResolvedValue(undefined);
  mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue(undefined);
  mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);
  mocks.readAssistantAutomationState.mockResolvedValue({
    autoReply: [],
    cron: [],
    schemaVersion: 1,
  });
  mocks.readLatestAssistantInputCursor.mockResolvedValue(null);
  mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValue({
    nextWakeAt: null,
    recorded: true,
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
    assistantAutomationProgressed: false,
    assistantAutomationCurrentTurnDeliveryIntentIds: [],
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

describe("runHostedWorkspaceAssistantPhase runtime logs", () => {
  it("keeps foreground reply orchestration separate from background maintenance", async () => {
    const source = await readFile(
      new URL("../src/hosted-runtime/workspace-assistant-phase.ts", import.meta.url),
      "utf8",
    );
    const body = extractTopLevelFunctionBody(source, "runForegroundAssistantReplyPhase");

    expect(body).toContain("collectForegroundDeliveryEffects");
    expect(body).not.toContain("prepareHostedSystemMailboxItemForCheckpoint");
    expect(body).not.toContain("runHostedDeviceSyncWakeLane");
    expect(body).not.toContain("readHostedProviderCleanupCheckpoint");
    expect(body).not.toContain("includeBackgroundDueIntents: true");
  });

  it("hydrates the hosted default assistant target before running automation", async () => {
    const hostedDefaultTarget = {
      adapter: "codex-cli" as const,
      approvalPolicy: "never" as const,
      codexCommand: null,
      model: "gpt-5.5",
      modelProvider: "openai",
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

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          memberId: "member_synthetic_phase",
          userEnvKeys: [],
        }),
      },
      {
        runtimeEnv: {},
      },
    );
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

  it("installs a direct hosted usage recorder from the runtime platform", async () => {
    const recordedUsageIds: string[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage(record) {
        recordedUsageIds.push(record.usageId);
        return {
          recorded: true,
          usageId: record.usageId,
        };
      },
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ runtimeUsageRecordPort: usageRecordPort }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    expect(hydratedContext?.hosted?.usageRecorder).toEqual({
      recordUsage: expect.any(Function),
    });

    await hydratedContext?.hosted?.usageRecorder?.recordUsage(createAssistantUsageRecord());

    expect(recordedUsageIds).toEqual(["turn_direct_usage.attempt-1"]);
  });

  it("skips timer device-sync work when the mailbox import brought in active input", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      reason: "alarm",
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredInputIds: ["ain_00000000000000000000000000000001"],
        skipDeviceSync: true,
      }),
    );
  });

  it("skips timer device-sync work for webhook nudges even before import sees active input", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      reason: "nudge",
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: true,
      }),
    );
  });

  it("skips timer device-sync work for scheduled wakes so background sync cannot hold the hot reply path", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: true,
      }),
    );
    expect(result.progressed).toBe(false);
    expect("checkpointReason" in result).toBe(false);
    expect("nextWakeAt" in result).toBe(false);
  });

  it("runs a projected due device-sync wake inside a foreground nudge", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "nudge",
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
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: false,
      }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: true,
      }),
    }));
  });

  it("passes the foreground-input yield hook to due device-sync timer work", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "nudge",
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
      shouldYieldBackgroundMaintenance,
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldYieldDeviceSync: shouldYieldBackgroundMaintenance,
        skipDeviceSync: false,
      }),
    );
  });

  it("checkpoints a consumed alarm wake when foreground input was ingested", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
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
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: true,
      }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
    }));
  });

  it("runs a due legacy assistant-labeled device-sync alarm instead of re-arming a synthetic retry", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
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
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: true,
      }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("does not run deferred legacy device-sync recovery after foreground input arrives", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
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
      shouldYieldBackgroundMaintenance,
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result.progressed).toBe(true);
  });

  it("passes foreground-input yield hook to deferred legacy device-sync recovery", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
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
      shouldYieldBackgroundMaintenance,
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldYieldDeviceSync: shouldYieldBackgroundMaintenance,
      }),
    );
  });

  it("runs a due legacy null-labeled device-sync alarm instead of re-arming a synthetic retry", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
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
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: null,
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: true,
      }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("does not re-arm a stale assistant wake as a skipped device-sync retry during a foreground nudge", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "nudge",
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
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: true,
      }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual({
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: false,
      }),
    });
    expect("checkpointReason" in result).toBe(false);
    expect("nextWakeAt" in result).toBe(false);
    expect("nextWakeReason" in result).toBe(false);
  });

  it("preserves a real device-sync follow-up from a due legacy assistant-labeled alarm", async () => {
    const nextWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
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
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: true,
      }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("drops stale assistant automation wakes before reporting scheduled work", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-04-26T23:59:59.000Z",
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "nudge",
    }));

    expect(result).toEqual({
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: false,
      }),
    });
  });

  it("does not checkpoint no-op alarms only because automation returned a future wake", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
    const existingWakeAt = "2026-04-27T00:05:00.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: existingWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual({
      nextWakeAt,
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: false,
      }),
    });
    expect("checkpointReason" in result).toBe(false);
    expect(logRequests.at(-1)?.entries[0]).toEqual(expect.objectContaining({
      eventCode: "assistant.pass_finished",
      redactedJson: expect.objectContaining({
        assistantAutomationProgressed: false,
        nextWakeAtPresent: true,
        progressed: false,
      }),
    }));
  });

  it("checkpoints a new future automation wake from manual runtime maintenance", async () => {
    const nextWakeAt = "2026-04-27T00:05:00.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "nudge",
      workspace: null,
    }));

    expect(result).toEqual({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: true,
      }),
    });
    expect(logRequests.at(-1)?.entries[0]).toEqual(expect.objectContaining({
      eventCode: "assistant.pass_finished",
      redactedJson: expect.objectContaining({
        assistantAutomationProgressed: false,
        nextWakeAtPresent: true,
        progressed: true,
      }),
    }));
  });

  it("checkpoints a consumed alarm wake when automation advances it", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
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
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("preserves an existing workspace wake when active input skips device-sync work", async () => {
    const nextWakeAt = "2026-04-27T00:05:00.000Z";

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "nudge",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt,
      progressed: true,
    }));
  });

  it("schedules a near follow-up wake when active input consumes a due alarm and skips device sync", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      progressed: true,
    }));
  });

  it("schedules a near follow-up wake when a nudge skips a due device-sync wake", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "nudge",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      progressed: true,
    }));
  });

  it("runs device-sync work for a due device-sync alarm without active input", async () => {
    const nextWakeAt = new Date(Date.now() + 60_000).toISOString();
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: false,
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("checkpoints a consumed due device-sync alarm when no follow-up work remains", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: false,
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: true,
      }),
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("preserves a skipped due device-sync alarm reason when fresh input owns the hot path", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDeviceSync: true,
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("exposes hosted device connect providers and link helper from the platform port", async () => {
    const connectLinkRequests: RuntimeDeviceSyncConnectLinkRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
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
          authorizationUrl: `https://connect.example.test/${request.connectTarget}`,
          connectUrl: `https://connect.example.test/${request.connectTarget}`,
          expiresAt: "2026-04-29T00:05:00.000Z",
          provider: request.connectTarget,
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
      logRequests,
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["fitbit"],
            region: "us",
          },
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
          { label: "Fitbit", provider: "fitbit" },
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
      connectUrl: "https://connect.example.test/whoop",
      expiresAt: "2026-04-29T00:05:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    });
    expect(connectLinkRequests).toEqual([
      { connectTarget: "whoop", messagingReturnTarget: "telegram" },
    ]);
    const deviceConnectLogs = logRequests
      .flatMap((request) => request.entries)
      .filter((entry) => entry.eventCode === "assistant.device_connect");
    expect(deviceConnectLogs.map((entry) => entry.redactedJson)).toEqual([
      expect.objectContaining({
        deviceConnectIssueLinkAvailable: true,
        deviceConnectPortPresent: true,
        deviceConnectProviderCount: 2,
        deviceConnectProviders: ["whoop", "fitbit"],
        deviceConnectStage: "context",
        deviceConnectStatus: "available",
      }),
      expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "requested",
        deviceConnectReturnTarget: "telegram",
        provider: "whoop",
      }),
      expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "issued",
        deviceConnectReturnTarget: "telegram",
        expiresAtPresent: true,
        provider: "whoop",
      }),
    ]);
    expect(JSON.stringify(deviceConnectLogs)).not.toContain("connect.example.test");
    expect(JSON.stringify(deviceConnectLogs)).not.toContain("synthetic-whoop-secret");
  });

  it("logs hosted device connect helper failures without leaking response details", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deviceSyncPort = {
      ...createNoDirtyRuntimeDeviceSyncPortMethods(),
      async applyUpdates() {
        return {
          appliedAt: "2026-04-29T00:00:00.000Z",
          updates: [],
          userId: "member_synthetic_phase",
        };
      },
      async createConnectLink() {
        const error = new Error(
          "Connect link failed for https://connect.example.test/oauth?state=opaque-secret",
        );
        Object.defineProperty(error, "status", {
          enumerable: true,
          value: 401,
        });
        throw error;
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
      logRequests,
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
    await expect(
      hydratedContext?.hosted?.issueDeviceConnectLink?.({
        messagingReturnTarget: "telegram",
        provider: "whoop",
      }),
    ).rejects.toThrow("Connect link failed");
    const failedLog = logRequests
      .flatMap((request) => request.entries)
      .find((entry) =>
        entry.eventCode === "assistant.device_connect"
        && entry.redactedJson?.deviceConnectStatus === "failed"
      );
    expect(failedLog).toEqual(expect.objectContaining({
      errorCode: "authorization_error",
      level: "warn",
      redactedJson: expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "failed",
        deviceConnectReturnTarget: "telegram",
        errorCode: "authorization_error",
        errorStatus: 401,
        provider: "whoop",
      }),
    }));
    expect(JSON.stringify(logRequests)).not.toContain("connect.example.test");
    expect(JSON.stringify(logRequests)).not.toContain("opaque-secret");
    expect(JSON.stringify(logRequests)).not.toContain("synthetic-whoop-secret");
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      reason: "alarm",
    }));

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
        localPathPreview: "<REDACTED_PATH>",
        replyConsidered: 1,
      }),
      workspaceVersion: "8",
    }));
    expect(logRequests[0]?.entries[0]?.redactedJson).not.toEqual(expect.objectContaining({
      assistantProviderRequest: expect.anything(),
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

  it("persists redacted full Codex failure diagnostics in assistant detail logs", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      nextWakeAt: "2026-05-03T14:56:05.548Z",
      parserProcessed: 0,
      progressed: false,
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation event: input.reply-failed.",
        phase: "wake.running",
        redacted: {
          errorCode: "ASSISTANT_CODEX_FAILED",
          failureCodexDiagnosticsPresent: true,
          failureCodexExitCode: 1,
          failureCodexFailureDetailPresent: true,
          failureCodexFailureStage: "process_exit",
          failureCodexRetryable: false,
          failureCodexStderrPresent: true,
          failureProviderActionCount: 4,
          failureFieldsPresent: true,
          failureRetryable: false,
          requestId: "hosted-workspace-invocation:workspace-invocation-16:assistant",
          safeDetails: "provider usage limit reached (ASSISTANT_CODEX_FAILED)",
          safeErrorLength:
            "Codex app-server failed.\ndetails:\n- usage limit reached; try again later\n- workspace: <HOME_DIR>/project".length,
          safeErrorMessage:
            "Codex app-server failed.\ndetails:\n- usage limit reached; try again later\n- workspace: <HOME_DIR>/project",
          safeErrorPresent: true,
          type: "input.reply-failed",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        errorCode: "ASSISTANT_CODEX_FAILED",
        failureCodexExitCode: 1,
        failureCodexFailureDetailPresent: true,
        failureCodexFailureStage: "process_exit",
        failureCodexRetryable: false,
        failureCodexStderrPresent: true,
        failureProviderActionCount: 4,
        failureRetryable: false,
        safeDetails: "provider usage limit reached (ASSISTANT_CODEX_FAILED)",
        safeErrorMessage:
          "Codex app-server failed. details: - usage limit reached; try again later - workspace: <REDACTED_PATH>",
        type: "input.reply-failed",
      }),
    }));
  });

  it("redacts unsafe diagnostic error text before persistence", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      nextWakeAt: null,
      parserProcessed: 0,
      progressed: false,
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation event: input.reply-failed.",
        phase: "wake.running",
        redacted: {
          errorCode: "ASSISTANT_CODEX_FAILED",
          safeErrorMessage: "Bearer raw-token-value",
          safeErrorPresent: true,
          safeErrorLength: "Bearer raw-token-value".length,
          type: "input.reply-failed",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));

    expect(logRequests[0]?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      errorCode: "ASSISTANT_CODEX_FAILED",
      safeErrorLength: "Bearer raw-token-value".length,
      safeErrorMessage: "Bearer [redacted]",
      safeErrorPresent: true,
      type: "input.reply-failed",
    }));
    expect(JSON.stringify(logRequests)).not.toContain("raw-token-value");
  });

  it("persists diagnostics when Codex context is missing and error text needs path redaction", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      nextWakeAt: null,
      parserProcessed: 0,
      progressed: false,
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation event: input.reply-failed.",
        phase: "wake.running",
        redacted: {
          errorCode: "ASSISTANT_CODEX_FAILED",
          assistantExceptionDetail: "Unhandled provider exception at /tmp/provider",
          failureCodexDiagnosticsPresent: false,
          failureFieldsPresent: true,
          providerFailureReason: "authorization: Bearer raw-provider-token",
          providerFailureRawPayloadReason: "raw payload should not persist",
          safeDetails: "assistant provider failed (ASSISTANT_CODEX_FAILED)",
          safeErrorLength: "Codex app-server failed at /tmp/workspace".length,
          safeErrorMessage: "Codex app-server failed at /tmp/workspace",
          safeErrorPresent: true,
          type: "input.reply-failed",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));

    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      errorCode: "ASSISTANT_CODEX_FAILED",
      redactedJson: expect.objectContaining({
        errorCode: "ASSISTANT_CODEX_FAILED",
        assistantExceptionDetail: "Unhandled provider exception at <REDACTED_PATH>",
        failureCodexDiagnosticsPresent: false,
        failureFieldsPresent: true,
        providerFailureReason: "authorization [redacted]",
        safeDetails: "assistant provider failed (ASSISTANT_CODEX_FAILED)",
        safeErrorLength: "Codex app-server failed at /tmp/workspace".length,
        safeErrorMessage: "Codex app-server failed at <REDACTED_PATH>",
        safeErrorPresent: true,
        type: "input.reply-failed",
      }),
    }));
    expect(logRequests[0]?.entries[0]?.redactedJson).not.toEqual(expect.objectContaining({
      providerFailureRawPayloadReason: expect.anything(),
    }));
    expect(JSON.stringify(logRequests)).not.toContain("raw-provider-token");
    expect(JSON.stringify(logRequests)).not.toContain("raw payload should not persist");
  });

  it("writes an outbox delivery summary after committed delivery effects drain", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      reason: "alarm",
    }));
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

  it("preserves device-sync next-wake reason after post-checkpoint delivery drains", async () => {
    const nextWakeAt = new Date(Date.now() + 60_000).toISOString();
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      reason: "alarm",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
    }));
  });

  it("fast-dispatches idempotent active nudge delivery before the runner checkpoint", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
        providerMessageId: null,
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedOutboxDeliveryAttempted: 1,
      hostedOutboxDeliverySent: 1,
      hostedOutboxPendingDeliveryEffects: 1,
      nextWakeAt: null,
    }));
    expect(result.nextWakeAt).toBeNull();
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
  });

  it("preserves the assistant wake after clean fast dispatch", async () => {
    const assistantNextWakeAt = "2026-05-08T16:00:00.000Z";
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: assistantNextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
        providerMessageId: null,
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-05-08T02:28:12.000Z",
      workspace: {
        checkpointedAt: "2026-05-08T02:02:12.387Z",
        createdAt: "2026-05-08T02:02:12.387Z",
        nextWakeAt: "2026-05-08T02:02:00.725Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T02:02:12.387Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: assistantNextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliverySent: 1,
        nextWakeAt: assistantNextWakeAt,
      }),
    }));
  });

  it.each(["assistant", null] as const)(
    "does not keep a synthetic legacy device-sync retry through clean fast dispatch for %s wakes",
    async (nextWakeReason) => {
      mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
        assistantAutomationProgressed: false,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
          providerMessageId: null,
          providerMessageIds: [],
          providerThreadId: "thread_synthetic",
          retryable: false,
          target: null,
          targetKind: null,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 1,
        now: () => "2026-05-08T02:28:12.000Z",
        reason: "alarm",
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
        workspace: {
          checkpointedAt: "2026-05-08T02:02:12.387Z",
          createdAt: "2026-05-08T02:02:12.387Z",
          nextWakeAt: "2026-05-08T02:02:00.725Z",
          nextWakeReason,
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T02:02:12.387Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));

      expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDeviceSync: true,
        }),
      );
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        progressed: true,
      }));
      expect("nextWakeReason" in result).toBe(false);
    },
  );

  it("preserves a skipped non-assistant due wake after clean fast dispatch", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-05-08T16:00:00.000Z",
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
        providerMessageId: null,
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-05-08T02:28:12.000Z",
      workspace: {
        checkpointedAt: "2026-05-08T02:02:12.387Z",
        createdAt: "2026-05-08T02:02:12.387Z",
        nextWakeAt: "2026-05-08T02:02:00.725Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T02:02:12.387Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-05-08T02:28:42.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("fast-dispatches idempotent nudge delivery when input is admitted during the active turn", async () => {
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
      importedCount: 0,
      reason: "nudge",
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
  });

  it("fast-dispatches idempotent delivery for active-turn input admitted on an alarm wake", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
      importedCount: 0,
      reason: "alarm",
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
  });

  it("writes a warning outbox delivery summary when a committed delivery fails", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      reason: "alarm",
    }));
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
        deliveryErrorCodeSummary: "external_code:1",
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

    expect(result.checkpointReason).toBe("system_mailbox_receipt");
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

  it("preserves system mailbox retry wake after dirty post-checkpoint recording", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_retryable",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      status: "retryable_failed",
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: {
        connectionId: "dsc_dirty_system_mailbox",
        kind: "device-sync.dirty-processed",
        nextWakeAt: null,
        processedRevision: "44",
      },
    });
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValueOnce({
      nextWakeAt: null,
      recorded: true,
      stillDirty: false,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result.nextWakeAt).toBe("2026-04-27T00:10:00.000Z");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      nextWakeReason: "assistant",
      redactedStatus: expect.objectContaining({
        hostedDeviceSyncDirtyAckRecorded: true,
        hostedDeviceSyncDirtyStillPending: false,
        nextWakeAt: "2026-04-27T00:10:00.000Z",
      }),
    }));
  });

  it("preserves a device-sync mailbox follow-up wake after recording the mailbox item", async () => {
    const nextWakeAt = new Date(Date.now() + 60_000).toISOString();
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_wake",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_device_sync",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("preserves device-sync ownership returned by mailbox post-checkpoint recording", async () => {
    const nextWakeAt = "2026-04-27T00:10:00.000Z";
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_device_sync_recorded",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      recorded: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
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
        redactedLogEntries: [{
          component: "runtime",
          level: "warn",
          message:
            "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
          phase: "wake.running",
          redacted: {
            ...Object.fromEntries(
              Array.from({ length: 24 }, (_entry, index) => [
                `diagnosticFiller${index}`,
                index,
              ]),
            ),
            assistantNotificationCodexConnectionLost: false,
            assistantNotificationCodexExitCode: 1,
            assistantNotificationCodexFailureStage: "process_exit",
            assistantNotificationCodexStderrPresent: true,
            assistantNotificationErrorCode: "runtime_error",
            assistantNotificationProviderErrorCode: "ASSISTANT_CODEX_FAILED",
            deliveryDispatchMode: "queue-only",
            errorCode: "assistant_provider_failed",
            localPathPreview: "/tmp/not-allowed",
            notificationChannel: "linq",
          },
        }],
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
      "assistant.automation_detail",
      "mailbox.system_processed",
      "mailbox.system_processed",
    ]);
    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      level: "warn",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        assistantNotificationCodexConnectionLost: false,
        assistantNotificationCodexExitCode: 1,
        assistantNotificationCodexFailureStage: "process_exit",
        assistantNotificationCodexStderrPresent: true,
        assistantNotificationErrorCode: "runtime_error",
        assistantNotificationProviderErrorCode: "ASSISTANT_CODEX_FAILED",
        deliveryDispatchMode: "queue-only",
        detailComponent: "runtime",
        detailLabel:
          "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
        errorCode: "assistant_provider_failed",
        localPathPreview: "<REDACTED_PATH>",
        notificationChannel: "linq",
      }),
    }));
    expect(logRequests[2]?.entries[0]).toEqual(expect.objectContaining({
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

  it("runs the assistant lane before optional system work when fresh conversation input exists", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:12:00.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.readHostedProviderCleanupCheckpoint).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      includeBackgroundDueIntents: false,
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
	    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
	      expect.objectContaining({
	        preferredInputIds: ["ain_00000000000000000000000000000001"],
	        skipDeviceSync: true,
	      }),
	    );
    expect(result.nextWakeAt).toBe("2026-04-27T00:12:00.000Z");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedAssistantNextWakeAt: "2026-04-27T00:12:00.000Z",
      hostedSystemMailboxPrepared: 0,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toBeUndefined();
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
    ]);
    expect(logRequests[0]?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      nextWakeAtPresent: true,
      progressed: false,
      systemWakeAtPresent: true,
    }));
  });

  it("limits restored foreground replay to the latest prompt window", async () => {
    const assistantInputIds = [
      "ain_00000000000000000000000000000001",
      "ain_00000000000000000000000000000002",
      "ain_00000000000000000000000000000003",
      "ain_00000000000000000000000000000004",
      "ain_00000000000000000000000000000005",
      "ain_00000000000000000000000000000006",
    ];

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds,
      importedCount: assistantInputIds.length,
    }));

    const foregroundReplayInputIds = assistantInputIds.slice(-5);
	    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
	      expect.objectContaining({
	        foregroundReplayInputIds,
	        foregroundReplayPromptInputIds: foregroundReplayInputIds,
	        preferredInputIds: foregroundReplayInputIds,
	      }),
	    );
  });

  it("treats imported assistant input ids as fresh even when no new mailbox rows were imported", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce(null);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: ["ain_00000000000000000000000000000007"],
      importedCount: 0,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
	    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
	      expect.objectContaining({
	        foregroundReplayInputIds: ["ain_00000000000000000000000000000007"],
	        foregroundReplayPromptInputIds: ["ain_00000000000000000000000000000007"],
	        preferredInputIds: ["ain_00000000000000000000000000000007"],
	      }),
	    );
  });

  it("does not treat system-only mailbox imports as foreground conversation input", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      importedCount: 1,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
	    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledWith(
	      expect.objectContaining({
	        foregroundReplayInputIds: [],
	        foregroundReplayPromptInputIds: [],
	        preferredInputIds: [],
      }),
	    );
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      includeBackgroundDueIntents: true,
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
  });

  it("continues through a manual runtime-control receipt so automation can schedule a wake", async () => {
    const nextWakeAt = "2026-04-27T00:45:00.000Z";
    const manualRuntimeItem = {
      ...createSystemMailboxItem(),
      itemId: "system_mailbox_item_runtime_manual",
      mailboxDedupeKey: "dedupe_system_mailbox_item_runtime_manual",
      routeAction: "apply-runtime-control-request" as const,
      wake: {
        eventId: "evt_runtime_manual_requested",
        kind: "runtime.manual-requested" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: manualRuntimeItem,
      itemId: "system_mailbox_item_runtime_manual",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(mocks.runHostedAssistantRuntimeTimerLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: true,
        hostedSystemMailboxPrepared: 1,
      }),
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: manualRuntimeItem,
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("does not continue non-manual runtime-control receipts into assistant automation", async () => {
    const browserVaultRefreshItem = {
      ...createSystemMailboxItem(),
      itemId: "system_mailbox_item_browser_vault_refresh",
      mailboxDedupeKey: "dedupe_system_mailbox_item_browser_vault_refresh",
      routeAction: "apply-runtime-control-request" as const,
      wake: {
        eventId: "evt_runtime_browser_vault_refresh_requested",
        kind: "runtime.browser-vault-refresh-requested" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: browserVaultRefreshItem,
      itemId: "system_mailbox_item_browser_vault_refresh",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantRuntimeTimerLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: browserVaultRefreshItem,
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxPrepared: 1,
      }),
    }));
  });

  it("defers cleanup for assistant input ids even when imported count is zero", async () => {
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValueOnce({
      captureIds: ["cap_terminal_cleanup"],
      linqMessageIds: ["linq_msg_terminal_cleanup"],
    });
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: ["ain_00000000000000000000000000000007"],
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result.nextWakeAt).toBe("2026-04-27T00:09:00.000Z");
  });

  it("collects only current-turn delivery effects on foreground conversation input", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: ["intent_fresh"],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      includeBackgroundDueIntents: false,
      preferredIntentIds: ["intent_fresh"],
      vaultRoot: expect.any(String),
    });
  });

  it("schedules terminal Linq cleanup after fresh conversation input without draining it first", async () => {
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValueOnce({
      captureIds: ["cap_terminal_cleanup"],
      linqMessageIds: ["linq_msg_terminal_cleanup"],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result.nextWakeAt).toBe("2026-04-27T00:09:00.000Z");
    expect(result.progressed).toBe(false);
    expect(result.checkpointReason).toBeUndefined();
  });

  it("does not drain queued provider cleanup when fresh input also produces delivery effects", async () => {
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValueOnce({
      captureIds: ["cap_terminal_cleanup"],
      linqMessageIds: ["linq_msg_terminal_cleanup"],
    });
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
        providerMessageId: "provider_message_from_reply",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: null,
      },
      linqMessageIds: ["provider_message_from_reply"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:09:00.000Z",
      progressed: true,
    }));
  });

  it("defers cleanup when input is admitted during the active turn", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValueOnce({
      captureIds: ["cap_terminal_cleanup"],
      linqMessageIds: ["linq_msg_terminal_cleanup"],
    });
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
        providerMessageId: "provider_message_from_active_turn",
        providerMessageIds: [],
        providerThreadId: "thread_synthetic",
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
      reason: "nudge",
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      includeBackgroundDueIntents: false,
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: null,
      },
      linqMessageIds: ["provider_message_from_active_turn"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:09:00.000Z",
      progressed: true,
    }));
  });

  it("schedules an immediate assistant wake when staged input predates a system mailbox reset", async () => {
    const pendingCursor = {
      createdAt: "2026-04-27T00:09:00.000Z",
      inputId: "ain_00000000000000000000000000000002",
      occurredAt: "2026-04-27T00:09:00.000Z",
      sourceKind: "hosted-conversation",
      sourcePosition: "hosted-mailbox:conversation:00000000000000000002",
    };
    const eligibleAfter = {
      createdAt: "2026-04-27T00:08:00.000Z",
      inputId: "ain_00000000000000000000000000000001",
      occurredAt: "2026-04-27T00:08:00.000Z",
      sourceKind: "hosted-conversation",
      sourcePosition: "hosted-mailbox:conversation:00000000000000000001",
    };
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
    mocks.readAssistantAutomationState.mockResolvedValueOnce({
      autoReply: [{
        channel: "linq",
        eligibleAfter,
        enabledAt: "2026-04-27T00:00:00.000Z",
      }],
      cron: [],
      schemaVersion: 1,
    });
    mocks.readLatestAssistantInputCursor.mockResolvedValueOnce(pendingCursor);
    mocks.compareAssistantInputCursors.mockReturnValueOnce(1);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result.nextWakeAt).toBe("2026-04-27T00:10:00.000Z");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      nextWakeReason: "assistant",
    }));
    expect(mocks.runHostedAssistantRuntimeTimerLane).not.toHaveBeenCalled();
    expect(mocks.readLatestAssistantInputCursor).toHaveBeenCalledWith({
      vault: "/tmp/murph-vault",
    });
  });

  it("uses a full bootstrap checkpoint reason for member activation work", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: {
          assistantConfigStatus: "hosted-env",
          assistantConfigured: true,
          assistantProvider: "codex-cli",
          assistantSeeded: true,
          emailAutoReplyEnabled: false,
          linqAutoReplyEnabled: true,
          telegramAutoReplyEnabled: false,
          vaultCreated: true,
        },
        conversationMetrics: null,
        mailboxLane: "member-activated",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.checkpointReason).toBe("activation_bootstrap");
  });

  it("drains dirty device-sync work alongside non-device system mailbox items", async () => {
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
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 2,
      deviceSyncSkipped: false,
      nextWakeAt: "not-a-timestamp",
      parserProcessed: 0,
      postCheckpointRecord: {
        connectionId: "dsc_dirty",
        kind: "device-sync.dirty-processed",
        nextWakeAt: "2026-04-27T00:11:00.000Z",
        processedRevision: "42",
      },
    });
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:13:00.000Z",
      recorded: true,
      stillDirty: true,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.progressed).toBe(true);
    expect(result.nextWakeAt).toBe("2026-04-27T00:11:00.000Z");
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        wake: expect.objectContaining({
          kind: "runtime.timer",
          userId: "member_synthetic_phase",
        }),
      }),
    );

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).toHaveBeenCalledWith({
      record: {
        connectionId: "dsc_dirty",
        kind: "device-sync.dirty-processed",
        nextWakeAt: "2026-04-27T00:11:00.000Z",
        processedRevision: "42",
      },
      runtime: expect.any(Object),
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-04-27T00:13:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedDeviceSyncDirtyAckRecorded: true,
        hostedDeviceSyncDirtyStillPending: true,
        hostedSystemMailboxRecorded: 1,
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeForwardedEnv: {
        LINQ_API_BASE_URL: "https://linq.example",
        LINQ_API_TOKEN: "forwarded-linq-token",
        OPENAI_API_KEY: "sk-not-for-cleanup",
      },
      runtimeUserEnv: {
        LINQ_API_TOKEN: "user-linq-token",
      },
    }));

    expect(result.checkpointReason).toBe("system_mailbox_receipt");
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryOutcomes: [],
        checkpoint: {
          nextWakeAt: null,
        },
        env: {
          LINQ_API_BASE_URL: "https://linq.example",
          LINQ_API_TOKEN: "user-linq-token",
        },
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
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
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
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
    }));

    expect(result.checkpointReason).toBe("outbox_sending");
    expect(result.nextWakeAt).toBe("2026-04-27T00:20:00.000Z");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedOutboxPendingDeliveryEffects: 1,
      hostedSystemMailboxPrepared: 1,
    }));
    expect(mocks.prepareHostedAssistantDeliveryEffectsForDispatch)
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
    const deliveryDrainInput = mocks.drainHostedPreparedAssistantDeliveries
      .mock.calls[0]?.[0];
    const cleanupDrainInput = mocks.drainHostedProviderCleanupAfterCommit.mock.calls[0]?.[0];
    await expect(deliveryDrainInput.assertLiveness()).resolves.toBeUndefined();
    await expect(cleanupDrainInput.assertLiveness()).resolves.toBeUndefined();
  });

  it("uses a hot provider cleanup checkpoint for cleanup-only progress", async () => {
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
    expect(result.checkpointReason).toBe("provider_cleanup");
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
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
      checkpointReason: "provider_cleanup",
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
      }),
    }));
  });

  it("uses a hot assistant runtime checkpoint for dirty ack-only progress", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: {
        connectionId: "dsc_dirty_ack_only",
        kind: "device-sync.dirty-processed",
        nextWakeAt: null,
        processedRevision: "43",
      },
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValueOnce({
      nextWakeAt: null,
      recorded: true,
      stillDirty: false,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result.progressed).toBe(true);
    expect(result.checkpointReason).toBe("assistant_runtime_commit");
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).toHaveBeenCalledWith({
      record: {
        connectionId: "dsc_dirty_ack_only",
        kind: "device-sync.dirty-processed",
        nextWakeAt: null,
        processedRevision: "43",
      },
      runtime: expect.any(Object),
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      redactedStatus: expect.objectContaining({
        hostedDeviceSyncDirtyAckRecorded: true,
        hostedDeviceSyncDirtyStillPending: false,
      }),
    }));
  });

  it("preserves deferred cleanup wake after dirty ack-only foreground progress", async () => {
    mocks.runHostedAssistantRuntimeTimerLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: {
        connectionId: "dsc_dirty_ack_with_cleanup",
        kind: "device-sync.dirty-processed",
        nextWakeAt: null,
        processedRevision: "45",
      },
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValueOnce({
      captureIds: ["cap_terminal_cleanup"],
      linqMessageIds: ["linq_msg_terminal_cleanup"],
    });
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValueOnce({
      nextWakeAt: null,
      recorded: true,
      stillDirty: false,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result.nextWakeAt).toBe("2026-04-27T00:09:00.000Z");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:09:00.000Z",
      nextWakeReason: "assistant",
      redactedStatus: expect.objectContaining({
        hostedDeviceSyncDirtyAckRecorded: true,
        hostedDeviceSyncDirtyStillPending: false,
        nextWakeAt: "2026-04-27T00:09:00.000Z",
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
    expect(result.checkpointReason).toBe("provider_cleanup");
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
      checkpointReason: "provider_cleanup",
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
  assistantInputIds?: string[];
  conversationImportedCount?: number;
  importedCount?: number;
  logRequests?: HostedRuntimeLogRequest[];
  now?: () => string;
  reason?: HostedWorkspaceRuntimeAssistantPhaseInput["request"]["reason"];
  resolvedDeviceSync?: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["resolvedConfig"]["deviceSync"];
  runtimeDeviceSyncPort?: RuntimeDeviceSyncPort;
  runtimeForwardedEnv?: Record<string, string>;
  shouldYieldBackgroundMaintenance?: HostedWorkspaceRuntimeAssistantPhaseInput["shouldYieldBackgroundMaintenance"];
  runtimeUsageRecordPort?: RuntimeUsageRecordPort;
  runtimeUserEnv?: Record<string, string>;
  workspace?: HostedWorkspaceRuntimeAssistantPhaseInput["workspace"];
}): HostedWorkspaceRuntimeAssistantPhaseInput {
  const assistantInputIds = input.assistantInputIds
    ?? (input.importedCount ? ["ain_00000000000000000000000000000001"] : []);
  return {
    initialMailboxImport: {
      afterCheckpointEffects: [],
      checkpoint: null,
      checkpointDeferred: false,
      importResult: {
        assistantInputIds,
        blocked: [],
        conversationImportedCount: input.conversationImportedCount
          ?? (assistantInputIds.length > 0 ? input.importedCount ?? 0 : 0),
        fetchedCount: input.importedCount ?? 0,
        importedCount: input.importedCount ?? 0,
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
    now: input.now,
    platform: {
      artifactStore: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
      },
      effectsPort: {
        readRawEmailMessage: vi.fn(async () => null),
        sendEmail: vi.fn(async () => undefined),
      },
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
      reason: input.reason ?? "nudge",
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
        ...(input.runtimeDeviceSyncPort ? { deviceSyncPort: input.runtimeDeviceSyncPort } : {}),
        ...(input.runtimeUsageRecordPort ? { usageRecordPort: input.runtimeUsageRecordPort } : {}),
      },
      platformEnv: {},
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
          whatsappCloudApiConfigured: false,
        },
        deviceSync: input.resolvedDeviceSync ?? null,
      },
      userEnv: input.runtimeUserEnv ?? {},
    },
    runtimeEnv: {},
    shouldYieldBackgroundMaintenance: input.shouldYieldBackgroundMaintenance,
    workspace: input.workspace ?? null,
  };
}

function createAssistantUsageRecord(): AssistantUsageRecord {
  return {
    apiKeyEnv: null,
    attemptCount: 1,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    credentialSource: "platform",
    featureKey: null,
    gatewayTags: [],
    inputTokens: 10,
    memberId: "member_synthetic_phase",
    occurredAt: "2026-04-29T00:00:00.000Z",
    outputTokens: 5,
    provider: "codex-cli",
    providerName: "OpenAI",
    providerRequestId: null,
    providerRequestOutcome: "succeeded",
    providerRequestOrdinal: 0,
    rawUsageJson: null,
    rawUsageJsonHash: null,
    reasoningTokens: null,
    reportingUserId: null,
    requestedModel: "gpt-5.5",
    routeId: "primary",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: "gpt-5.5",
    sessionId: "asst_direct_usage",
    stripeMeterSource: "murph",
    surface: null,
    totalTokens: 15,
    triggerKind: null,
    turnId: "turn_direct_usage",
    usageId: "turn_direct_usage.attempt-1",
    usageExtractionSourcePath: null,
    usageExtractionVersion: "codex-usage-v1",
  };
}

function createDeliveryEffect(): HostedAssistantDeliverySideEffect {
  return {
    deliveryPhase: "foreground_current_turn",
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
