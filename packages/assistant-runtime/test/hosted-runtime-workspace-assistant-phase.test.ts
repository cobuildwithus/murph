import type {
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type HostedMailboxItem,
  type HostedRuntimeGroupSummary,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
  buildHostedExecutionRuntimeControlWake,
} from "@murphai/hosted-execution";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/env";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyMurphManagedAutomations: vi.fn(),
  refreshReminderAvailability: vi.fn(),
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
  collectHostedAssistantDeliverySideEffects: vi.fn(),
  collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes: vi.fn(),
  createHostedAssistantProgressDeliveryDependencies: vi.fn(),
  createHostedAssistantChannelTypingDependencies: vi.fn(),
  drainHostedProviderCleanupAfterCommit: vi.fn(),
  drainHostedPreparedAssistantDeliveries: vi.fn(),
  findAssistantAutoReplyDeliveryIntentIds: vi.fn(),
  getAssistantCronStatus: vi.fn(),
  hasCompleteAssistantAutoReplyTerminalEvidence: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listPendingAssistantAutoReplyLinqCleanupEvidence: vi.fn(),
  markAssistantAutoReplyLinqCleanupQueued: vi.fn(),
  maintainAssistantAutoReplyRouteState: vi.fn(),
  prepareHostedAssistantAutomationForWake: vi.fn(),
  prepareHostedAssistantDeliveryEffectsForDispatch: vi.fn(),
  prepareHostedProviderCleanupPlan: vi.fn(),
  prepareHostedSystemMailboxItemForCheckpoint: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  readAssistantInputEvent: vi.fn(),
  readAssistantOutboxIntent: vi.fn(),
  queueHostedAssistantPendingMessageVolumeReceiptsForVault: vi.fn(),
  recordHostedDeviceSyncDirtyPostCheckpointRecord: vi.fn(),
  recordHostedProviderCleanupAfterDelivery: vi.fn(),
  recordHostedProviderCleanupBeforeCommit: vi.fn(),
  recordHostedSystemMailboxItemAfterCheckpoint: vi.fn(),
  readHostedProviderCleanupCheckpoint: vi.fn(),
  resolveHostedProviderCleanupCheckpointWakeAt: vi.fn(),
  resolveHostedProviderCleanupFirstDeferredWakeAt: vi.fn(),
  resolveHostedProviderCleanupScheduledWakeAt: vi.fn(),
  resolveHostedOldestAssistantInputOccurredAt: vi.fn(),
  resolveHostedOldestPendingAssistantInputAt: vi.fn(),
  resolveHostedPendingAssistantInputWakeAt: vi.fn(),
  resolveAssistantCronDefaultTimeZoneProjection: vi.fn(),
  resolveHostedAssistantOutboxNextWakeAt: vi.fn(),
  resolveHostedDeviceSyncNextWakeAt: vi.fn(),
  resolveHostedSystemMailboxNextWakeCandidate: vi.fn(),
  resolveHostedSystemMailboxNextWakeAt: vi.fn(),
  resetHostedPreparedAssistantDeliveryEffects: vi.fn(),
  runHostedAssistantAutomationLane: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
  scheduleDeviceActivityTriggeredAutomations: vi.fn(),
}));

vi.mock("@murphai/assistant-engine/assistant-automation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@murphai/assistant-engine/assistant-automation")>();
  return {
    ...actual,
    findAssistantAutoReplyDeliveryIntentIds:
      mocks.findAssistantAutoReplyDeliveryIntentIds,
    hasCompleteAssistantAutoReplyTerminalEvidence:
      mocks.hasCompleteAssistantAutoReplyTerminalEvidence,
    listPendingAssistantAutoReplyLinqCleanupEvidence:
      mocks.listPendingAssistantAutoReplyLinqCleanupEvidence,
    markAssistantAutoReplyLinqCleanupQueued: mocks.markAssistantAutoReplyLinqCleanupQueued,
  };
});

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

vi.mock("@murphai/assistant-engine/assistant-store", () => ({
  readAssistantAutomationState: mocks.readAssistantAutomationState,
}));

vi.mock("@murphai/assistant-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/assistant-engine")>();
  const automation =
    await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
      "@murphai/assistant-engine/assistant-automation",
    );
  return {
    ...actual,
    applyMurphManagedAutomations: mocks.applyMurphManagedAutomations,
    compareAssistantInputCursors: automation.compareAssistantInputCursors,
    createStoreBackedAssistantInputSource:
      automation.createStoreBackedAssistantInputSource,
    DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT:
      automation.DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
    getAssistantCronStatus: mocks.getAssistantCronStatus,
    resolveAssistantCronDefaultTimeZoneProjection:
      mocks.resolveAssistantCronDefaultTimeZoneProjection,
    readAssistantInputEvent: mocks.readAssistantInputEvent,
    readAssistantOutboxIntent: mocks.readAssistantOutboxIntent,
    refreshReminderAvailability: mocks.refreshReminderAvailability,
    recordHostedMailboxAssistantInputItem:
      automation.recordHostedMailboxAssistantInputItem,
    scheduleDeviceActivityTriggeredAutomations:
      mocks.scheduleDeviceActivityTriggeredAutomations,
    upsertAssistantInputEvent: automation.upsertAssistantInputEvent,
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
  queueHostedAssistantPendingMessageVolumeReceiptsForVault:
    mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault,
  resetHostedPreparedAssistantDeliveryEffects:
    mocks.resetHostedPreparedAssistantDeliveryEffects,
  resolveHostedAssistantOutboxNextWakeAt: mocks.resolveHostedAssistantOutboxNextWakeAt,
}));

vi.mock("../src/hosted-runtime/channel-activity.ts", () => ({
  buildHostedLinqChannelEnv: mocks.buildHostedLinqChannelEnv,
  createHostedAssistantChannelTypingDependencies:
    mocks.createHostedAssistantChannelTypingDependencies,
}));

vi.mock("../src/hosted-runtime/context.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/hosted-runtime/context.ts")
  >();
  return {
    ...actual,
    hydrateHostedExecutionDefaultTarget: mocks.hydrateHostedExecutionDefaultTarget,
    prepareHostedAssistantAutomationForWake:
      mocks.prepareHostedAssistantAutomationForWake,
  };
});

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  runHostedAssistantAutomationLane: mocks.runHostedAssistantAutomationLane,
}));

vi.mock("../src/hosted-runtime/device-sync-maintenance-import.ts", () => ({
  isHostedDeviceSyncMaintenanceModuleLoadError: vi.fn(() => false),
  loadHostedDeviceSyncMaintenanceModule: vi.fn(async () => ({
    resolveHostedDeviceSyncNextWakeAt: mocks.resolveHostedDeviceSyncNextWakeAt,
    runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
  })),
}));

vi.mock("../src/hosted-runtime/pending-assistant-input.ts", () => ({
  resolveHostedOldestAssistantInputOccurredAt:
    mocks.resolveHostedOldestAssistantInputOccurredAt,
  resolveHostedOldestPendingAssistantInputAt:
    mocks.resolveHostedOldestPendingAssistantInputAt,
  resolveHostedPendingAssistantInputWakeAt:
    mocks.resolveHostedPendingAssistantInputWakeAt,
}));

vi.mock("../src/hosted-runtime/provider-cleanup.ts", () => ({
  collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes:
    mocks.collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes,
  drainHostedProviderCleanupAfterCommit: mocks.drainHostedProviderCleanupAfterCommit,
  prepareHostedProviderCleanupPlan: mocks.prepareHostedProviderCleanupPlan,
  recordHostedProviderCleanupAfterDelivery: mocks.recordHostedProviderCleanupAfterDelivery,
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
  initializeVault,
  patchAutomation,
  showAutomation,
  splitAutomationAvailabilityConflictBlock,
  upsertAutomation,
} from "@murphai/core";
import {
  buildOnboardingFirstPersonalReadAutomationSaveRequest,
  completeAssistantOnboarding,
  getAssistantCronJob,
  markAssistantContextSnapshotDirty,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
  readAssistantContextSnapshotState,
  saveAssistantAutomationState,
  saveAssistantSession,
  upsertAssistantInputEvent,
  type AssistantAutomationOperationScope,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  parseAssistantSessionRecord,
  type AssistantOutboxIntent,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhaseInput,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import {
  enqueueHostedPendingAssistantInputId,
  inspectHostedPendingAssistantInputWakeCandidate,
  readExistingHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
} from "../src/hosted-runtime/pending-input-index.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  isHostedDeviceSyncMaintenanceModuleLoadError,
  loadHostedDeviceSyncMaintenanceModule,
} from "../src/hosted-runtime/device-sync-maintenance-import.ts";
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
import type {
  HostedWorkspaceDurableCheckpointEffects,
} from "../src/hosted-runtime/workspace-runner.ts";

type RuntimeDeviceSyncPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["deviceSyncPort"]
>;
type RuntimeClinicalRecordsPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["clinicalRecordsPort"]
>;
type RuntimeUsageRecordPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["usageRecordPort"]
>;
type RuntimeAssistantConfigurationToolPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["assistantConfigurationToolPort"]
>;
type RuntimeLabsToolPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["labsToolPort"]
>;
type RuntimeSubscriptionToolPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["subscriptionToolPort"]
>;
type RuntimeDeviceSyncConnectLinkRequest = Parameters<
  RuntimeDeviceSyncPort["createConnectLink"]
>[0];
type HostedPendingAssistantInputModule =
  typeof import("../src/hosted-runtime/pending-assistant-input.ts");
type HostedSystemMailboxModule =
  typeof import("../src/hosted-runtime/system-mailbox.ts");

function withoutAssistantTurnTimingLogs(
  logRequests: HostedRuntimeLogRequest[],
): HostedRuntimeLogRequest[] {
  return logRequests.filter(
    (request) =>
      request.entries[0]?.redactedJson?.schema
        !== "murph.assistant-turn-timing.v1",
  );
}

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

async function resolveHostedPendingAssistantInputWakeAtWithRealImplementation(
  input: Parameters<
    HostedPendingAssistantInputModule["resolveHostedPendingAssistantInputWakeAt"]
  >[0],
): Promise<string | null> {
  const actual = await vi.importActual<HostedPendingAssistantInputModule>(
    "../src/hosted-runtime/pending-assistant-input.ts",
  );
  return actual.resolveHostedPendingAssistantInputWakeAt(input);
}

async function loadHostedSystemMailboxRealImplementation(): Promise<
  HostedSystemMailboxModule
> {
  return await vi.importActual<HostedSystemMailboxModule>(
    "../src/hosted-runtime/system-mailbox.ts",
  );
}

async function runHostedWorkspaceDurableCheckpointEffects(
  effects: HostedWorkspaceDurableCheckpointEffects | null | undefined,
): Promise<void> {
  if (!effects) {
    return;
  }
  const list = typeof effects === "function" ? [effects] : [...effects];
  for (const effect of list) {
    await effect();
  }
}

const PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE = {
  assistantActiveProfileId: null,
  assistantActiveProfileManagedBy: null,
  assistantActiveProfileReady: true,
  assistantConfigInvalid: false,
  assistantConfigPresent: true,
  assistantConfigStatus: "hosted-env",
  assistantConfigured: true,
  assistantProvider: "codex-cli",
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveAssistantCronDefaultTimeZoneProjection.mockImplementation(
    async (vaultRoot: string) => {
      const actual = await vi.importActual<
        typeof import("@murphai/assistant-engine")
      >("@murphai/assistant-engine");
      return await actual.resolveAssistantCronDefaultTimeZoneProjection(vaultRoot);
    },
  );
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
  mocks.createHostedAssistantProgressDeliveryDependencies.mockReturnValue({});
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
  mocks.getAssistantCronStatus.mockResolvedValue({
    dueJobs: 0,
    enabledJobs: 0,
    nextRunAt: null,
    runningJobs: 0,
    totalJobs: 0,
  });
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.hasCompleteAssistantAutoReplyTerminalEvidence.mockResolvedValue(false);
  mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(new Set());
  mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(null);
  mocks.readAssistantOutboxIntent.mockResolvedValue(null);
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValue({
    captureIds: [],
    linqMessageIds: [],
  });
  mocks.markAssistantAutoReplyLinqCleanupQueued.mockResolvedValue(undefined);
  mocks.maintainAssistantAutoReplyRouteState.mockResolvedValue({
    changed: false,
    trusted: true,
  });
  mocks.prepareHostedProviderCleanupPlan.mockImplementation(async (input: {
    deferred: boolean;
    idleCheckpointDelayMs?: number | null;
    initialCheckpoint?: { nextWakeAt?: string | null } | null;
    nowMs: number;
    terminalCleanupMessageIds?: readonly string[] | null;
    vaultRoot: string;
  }) => {
    const pendingLinqMessageIds = [...new Set(input.terminalCleanupMessageIds ?? [])];
    if (input.deferred) {
      if (pendingLinqMessageIds.length > 0) {
        const queuedCheckpoint = await mocks.recordHostedProviderCleanupBeforeCommit({
          checkpoint: {
            nextWakeAt: mocks.resolveHostedProviderCleanupFirstDeferredWakeAt({
              idleCheckpointDelayMs: input.idleCheckpointDelayMs,
              nowMs: input.nowMs,
            }),
          },
          linqMessageIds: pendingLinqMessageIds,
          vaultRoot: input.vaultRoot,
        });
        return {
          checkpoint: queuedCheckpoint,
          deferred: true,
          due: false,
          requiresCheckpoint: true,
          stateQueued: true,
        };
      }
      const storedCheckpoint =
        await mocks.readHostedProviderCleanupCheckpoint(input.vaultRoot);
      const storedWakeMs = Date.parse(storedCheckpoint?.nextWakeAt ?? "");
      if (
        storedCheckpoint
        && (!Number.isFinite(storedWakeMs) || storedWakeMs <= input.nowMs)
      ) {
        // Mirrors the real plan: a due/invalid stored checkpoint re-arms
        // durably into hosted-provider-cleanup.json.
        const rearmedCheckpoint = await mocks.recordHostedProviderCleanupBeforeCommit({
          checkpoint: {
            nextWakeAt: mocks.resolveHostedProviderCleanupFirstDeferredWakeAt({
              idleCheckpointDelayMs: input.idleCheckpointDelayMs,
              nowMs: input.nowMs,
            }),
          },
          linqMessageIds: [],
          vaultRoot: input.vaultRoot,
        });
        return {
          checkpoint: rearmedCheckpoint,
          deferred: true,
          due: false,
          requiresCheckpoint: true,
          stateQueued: true,
        };
      }
      return {
        checkpoint: input.initialCheckpoint ?? null,
        deferred: true,
        due: false,
        requiresCheckpoint: false,
        stateQueued: false,
      };
    }
    const stateQueued = pendingLinqMessageIds.length > 0;
    let checkpoint = input.initialCheckpoint ?? null;
    if (stateQueued) {
      // Mirrors the real plan: current-pass ids are scheduled past the idle
      // horizon and are never due in the same invocation.
      checkpoint = await mocks.recordHostedProviderCleanupBeforeCommit({
        checkpoint: {
          nextWakeAt: mocks.resolveHostedProviderCleanupFirstDeferredWakeAt({
            idleCheckpointDelayMs: input.idleCheckpointDelayMs,
            nowMs: input.nowMs,
          }),
        },
        linqMessageIds: pendingLinqMessageIds,
        vaultRoot: input.vaultRoot,
      });
    } else {
      checkpoint ??= await mocks.readHostedProviderCleanupCheckpoint(input.vaultRoot);
    }
    const wakeMs = Date.parse(checkpoint?.nextWakeAt ?? "");
    const due = checkpoint !== null
      && (!Number.isFinite(wakeMs) || wakeMs <= input.nowMs);
    return {
      checkpoint,
      deferred: false,
      due,
      requiresCheckpoint: due || stateQueued,
      stateQueued,
    };
  });
  mocks.applyMurphManagedAutomations.mockResolvedValue({
    created: 0,
    skipped: 1,
    updated: 0,
  });
  mocks.refreshReminderAvailability.mockResolvedValue({
    attempted: 0,
    failed: 0,
    nextRefreshAt: null,
    refreshed: 0,
  });
  mocks.prepareHostedAssistantAutomationForWake.mockResolvedValue(
    PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE,
  );
  mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue(undefined);
  mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault.mockResolvedValue(0);
  mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);
  mocks.readAssistantAutomationState.mockResolvedValue({
    autoReply: [],
    cron: [],
    schemaVersion: 1,
  });
  mocks.readAssistantInputEvent.mockResolvedValue(null);
  mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockResolvedValue({
    nextWakeAt: null,
    recorded: 1,
    stillDirty: false,
  });
  mocks.recordHostedProviderCleanupAfterDelivery.mockImplementation(async (input: {
    idleCheckpointDelayMs?: number | null;
    nowMs: number;
    outcomes: readonly HostedAssistantDeliveryOutcome[];
    vaultRoot: string;
  }) => {
    const linqMessageIds =
      mocks.collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes(input.outcomes);
    if (linqMessageIds.length === 0) {
      return {
        nextWakeAt: null,
      };
    }

    const checkpoint = await mocks.recordHostedProviderCleanupBeforeCommit({
      checkpoint: {
        nextWakeAt: mocks.resolveHostedProviderCleanupFirstDeferredWakeAt({
          idleCheckpointDelayMs: input.idleCheckpointDelayMs,
          nowMs: input.nowMs,
        }),
      },
      linqMessageIds,
      vaultRoot: input.vaultRoot,
    });
    const nextWakeAt = typeof checkpoint?.nextWakeAt === "string"
      ? checkpoint.nextWakeAt
      : null;
    return {
      nextWakeAt,
    };
  });
  // The mocked owner state: checkpoints recorded this test are what the
  // scheduled-wake read resolves, mirroring hosted-provider-cleanup.json as
  // the single owner of the next cleanup wake.
  const recordedProviderCleanupCheckpoints = new Map<
    string,
    { nextWakeAt?: string | null } | null
  >();
  mocks.recordHostedProviderCleanupBeforeCommit.mockImplementation(async (input) => {
    recordedProviderCleanupCheckpoints.set(input.vaultRoot, input.checkpoint ?? null);
    return input.checkpoint;
  });
  mocks.resolveHostedProviderCleanupScheduledWakeAt.mockImplementation(async (input: {
    nowMs: number;
    vaultRoot: string;
  }) => {
    const recorded = recordedProviderCleanupCheckpoints.get(input.vaultRoot) ?? null;
    const nextWakeAt = recorded?.nextWakeAt ?? null;
    const nextWakeMs = Date.parse(nextWakeAt ?? "");
    return Number.isFinite(nextWakeMs) && nextWakeMs > input.nowMs ? nextWakeAt : null;
  });
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
  mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValue({
    failed: 0,
    nextWakeAt: null,
    recorded: 1,
  });
  mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue(null);
  mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(null);
  mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValue(null);
  mocks.resolveHostedOldestAssistantInputOccurredAt.mockResolvedValue(null);
  mocks.resolveHostedOldestPendingAssistantInputAt.mockResolvedValue(null);
  mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValue(null);
  mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
    if (
      input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")
    ) {
      return {
        at: null,
        reason: null,
      };
    }
    if (
      input?.allowedRouteActions?.length === 1
      && (
        input.allowedRouteActions[0] === "apply-member-preferences"
        || input.allowedRouteActions[0] === "initialize-group-room-model"
      )
    ) {
      return {
        at: null,
        reason: null,
      };
    }
    const at = await mocks.resolveHostedSystemMailboxNextWakeAt();
    return {
      at,
      reason: at ? "assistant" : null,
    };
  });
  mocks.resetHostedPreparedAssistantDeliveryEffects.mockResolvedValue(undefined);
  mocks.runHostedAssistantAutomationLane.mockResolvedValue({
    assistantAutomationProgressed: false,
    assistantAutomationCurrentTurnDeliveryIntentIds: [],
    nextWakeAt: null,
    redactedLogEntries: [],
  });
  mocks.runHostedDeviceSyncWakeLane.mockResolvedValue({
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
    postCheckpointRecord: null,
  });
  mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValue({
    matched: 0,
    nextWakeAt: null,
    scheduled: 0,
  });
});

function expectAssistantLaneCallWithoutDeviceSyncOptions(
  expected?: Record<string, unknown>,
): void {
  expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
    expect.objectContaining(expected ?? {}),
  );
  const call = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
  expect(call).not.toHaveProperty("skipDeviceSync");
  expect(call).not.toHaveProperty("shouldYieldDeviceSync");
  expect(call).not.toHaveProperty("skipDirtyPendingFetch");
  expect(call).not.toHaveProperty("stagedDirtyAcks");
}

async function writeHostedPhaseExperimentSource(vaultRoot: string): Promise<void> {
  await mkdir(path.join(vaultRoot, "bank/experiments"), {
    recursive: true,
  });
  await writeFile(
    path.join(vaultRoot, "bank/experiments/hosted-phase-sleep.md"),
    [
      "---",
      "schemaVersion: murph.frontmatter.experiment.v1",
      "docType: experiment",
      "experimentId: exp_01JNV4458HYPP53JDQCBP1QJFM",
      "slug: hosted-phase-sleep",
      "status: active",
      "title: Hosted phase sleep consistency",
      "startedOn: 2026-04-20",
      "runPlan:",
      "  baselineStart: 2026-04-20",
      "  baselineEnd: 2026-04-26",
      "  interventionStart: 2026-04-27",
      "  interventionEnd: 2026-05-10",
      "  modality: sleep",
      "---",
      "# Hosted phase sleep consistency",
      "",
    ].join("\n"),
    "utf8",
  );
}

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

  it("uses post-delivery wake normalization for member-channel barriers", async () => {
    const source = await readFile(
      new URL("../src/hosted-runtime/workspace-assistant-phase.ts", import.meta.url),
      "utf8",
    );
    const body = extractTopLevelFunctionBody(
      source,
      "buildHostedMemberChannelDeliveryBarrierResult",
    );

    expect(body).toContain("dropConsumedPostDeliveryWorkspaceAssistantWake");
    expect(body).toContain("resolveHostedPostDeliveryBaseNextWake(input.input)");
    expect(body).not.toContain("input.input.baseNextWake,");
  });

  it("hydrates the hosted default assistant target before running automation", async () => {
    const hostedDefaultTarget = {
      adapter: "codex-cli" as const,
      approvalPolicy: "never" as const,
      codexCommand: null,
      model: "gpt-5.6-terra",
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
        homeDirectory: "/tmp/murph-operator-home",
        runtimeEnv: {},
      },
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          hosted: expect.objectContaining({
            defaultTarget: hostedDefaultTarget,
          }),
        }),
      }),
    );
  });

  it("starts the assistant lane before a scheduled group operation lazily reads the Web-owned shared snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "hosted-share-authority-"));
    const sequence: string[] = [];
    const request: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    >["request"] = vi.fn(async (request) => {
      sequence.push("read_shared");
      expect(request).toEqual({
        action: "read_shared",
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      return {
        action: "read_shared" as const,
        result: {
          members: [{
            currentTurnHandles: [],
            displayName: "Ada",
            memberId: "member_shared_current",
            participantId: "participant_shared_current",
            projections: [{
              dataStatus: "missing" as const,
              grantStatus: "not_granted" as const,
              projectionScope: { projectionKind: "steps-days.v0" as const },
              projectionScopeKey: "steps-days.v0",
              records: [],
            }],
          }],
          requestedProjectionScopeKeys: ["steps-days.v0"],
          status: "ok" as const,
        },
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      sequence.push("assistant_lane");
      expect(request).not.toHaveBeenCalled();
      expect(laneInput.executionContext.hosted?.groupSharedReader).toBeUndefined();
      const createScheduledGroupTools =
        laneInput.executionContext.hosted?.createScheduledGroupTools;
      expect(createScheduledGroupTools).toEqual(expect.any(Function));
      if (!createScheduledGroupTools) {
        throw new Error("Expected the scheduled group capability factory.");
      }
      expect(createScheduledGroupTools({
        channel: "linq",
        target: "chat_direct",
        threadIsDirect: true,
      })).toBeNull();
      const scheduledGroupTools = createScheduledGroupTools({
        channel: "linq",
        target: "chat_current_group",
        threadIsDirect: false,
      });
      expect(scheduledGroupTools).not.toBeNull();
      if (!scheduledGroupTools) {
        throw new Error("Expected scheduled group capabilities.");
      }
      expect(scheduledGroupTools.groupTool).toEqual({ request });
      expect(request).not.toHaveBeenCalled();
      await expect(scheduledGroupTools.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      })).resolves.toMatchObject({ status: "ok" });
      const telegramGroupTools = createScheduledGroupTools({
        channel: "telegram",
        target: "telegram_current_group",
        threadIsDirect: false,
      });
      expect(telegramGroupTools).not.toBeNull();
      if (!telegramGroupTools) {
        throw new Error("Expected scheduled Telegram group capabilities.");
      }
      expect(telegramGroupTools.groupPermissionOfferTool).toEqual({
        request: expect.any(Function),
      });
      await expect(telegramGroupTools.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      })).resolves.toMatchObject({ status: "ok" });
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    try {
      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        runtimeGroupToolPort: { request },
        vaultRoot,
      }));
      expect(sequence).toEqual(["assistant_lane", "read_shared", "read_shared"]);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("allows one scheduled access link only for exact not-granted evidence from the same model operation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "hosted-scheduled-group-offer-"));
    const groupToolRequests: HostedRuntimeGroupToolRequest[] = [];
    let readGrantStatus: "granted" | "not_granted" = "not_granted";
    const request: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    >["request"] = vi.fn(async (groupToolRequest) => {
      groupToolRequests.push(groupToolRequest);
      if (groupToolRequest.action === "read_shared") {
        return {
          action: "read_shared" as const,
          result: {
            members: [{
              currentTurnHandles: [],
              displayName: "Ada",
              memberId: "member_shared_current",
              participantId: "participant_shared_current",
              projections: [{
                dataStatus: "missing" as const,
                grantStatus: readGrantStatus,
                projectionScope: { projectionKind: "steps-days.v0" as const },
                projectionScopeKey: "steps-days.v0",
                records: [],
              }],
            }],
            requestedProjectionScopeKeys: ["steps-days.v0"],
            status: "ok" as const,
          },
        };
      }
      if (groupToolRequest.action === "create_join_link") {
        return {
          action: "create_join_link" as const,
          result: {
            group: null,
            status: "unavailable" as const,
            unavailableReason: "synthetic_web_unavailable",
          },
        };
      }
      throw new Error(`Unexpected group action: ${groupToolRequest.action}`);
    });

    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      const factory = laneInput.executionContext.hosted?.createScheduledGroupTools;
      if (!factory) {
        throw new Error("Expected the scheduled group capability factory.");
      }
      expect(factory({
        channel: "email",
        target: "chat_current_group",
        threadIsDirect: false,
      })).toBeNull();

      const createTools = (channel: "linq" | "telegram" = "linq") => {
        const tools = factory({
          channel,
          target: "chat_current_group",
          threadIsDirect: false,
        });
        if (!tools) {
          throw new Error("Expected scheduled group capabilities.");
        }
        return tools;
      };
      const requirePermissionOffer = (tools: ReturnType<typeof createTools>) => {
        const permissionOffer = tools.groupPermissionOfferTool;
        if (!permissionOffer) {
          throw new Error("Expected scheduled Linq permission offer capability.");
        }
        return permissionOffer;
      };
      const stepsOffer = {
        projectionScopes: [{ projectionKind: "steps-days.v0" as const }],
      };

      const beforeRead = createTools();
      await expect(requirePermissionOffer(beforeRead).request(stepsOffer))
        .resolves.toMatchObject({
          result: {
            unavailableReason: "scheduled_group_permission_offer_unavailable",
          },
        });

      const unobserved = createTools();
      await unobserved.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      await expect(requirePermissionOffer(unobserved).request({
        projectionScopes: [{ projectionKind: "device-sync-status.v0" }],
      })).resolves.toMatchObject({
        result: {
          unavailableReason: "scheduled_group_permission_offer_unavailable",
        },
      });

      const grantedMissing = createTools();
      await grantedMissing.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      readGrantStatus = "granted";
      await grantedMissing.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      await expect(requirePermissionOffer(grantedMissing).request(stepsOffer))
        .resolves.toMatchObject({
          result: {
            unavailableReason: "scheduled_group_permission_offer_unavailable",
          },
        });

      readGrantStatus = "not_granted";
      const allowed = createTools();
      await allowed.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      await expect(requirePermissionOffer(allowed).request(stepsOffer))
        .resolves.toMatchObject({
          result: { unavailableReason: "synthetic_web_unavailable" },
        });
      await expect(requirePermissionOffer(allowed).request(stepsOffer))
        .resolves.toMatchObject({
          result: {
            unavailableReason: "scheduled_group_permission_offer_unavailable",
          },
        });

      const telegramAllowed = createTools("telegram");
      await telegramAllowed.groupSharedReader.request({
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      await expect(requirePermissionOffer(telegramAllowed).request(stepsOffer))
        .resolves.toMatchObject({
          result: { unavailableReason: "synthetic_web_unavailable" },
        });

      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    try {
      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        runtimeGroupToolPort: { request },
        vaultRoot,
      }));
      expect(groupToolRequests.filter((item) => item.action === "read_shared"))
        .toHaveLength(5);
      expect(groupToolRequests.filter((item) => item.action === "create_join_link"))
        .toEqual([
          {
            action: "create_join_link",
            joinLink: {
              requestedVaultShareProjectionScopes: [
                { projectionKind: "steps-days.v0" },
              ],
            },
          },
          {
            action: "create_join_link",
            joinLink: {
              requestedVaultShareProjectionScopes: [
                { projectionKind: "steps-days.v0" },
              ],
            },
          },
        ]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("exposes current-input authority with hosted personalization", async () => {
    const assistantPersonalizationToolPort = {
      request: vi.fn(),
    };
    const currentAssistantInputId = () =>
      "ain_33333333333333333333333333333333";

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      currentAssistantInputId,
      runtimeAssistantPersonalizationToolPort: assistantPersonalizationToolPort,
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          currentAssistantInputId,
          personalizationTool: assistantPersonalizationToolPort,
        }),
      },
      expect.any(Object),
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          hosted: expect.objectContaining({
            currentAssistantInputId,
            personalizationTool: assistantPersonalizationToolPort,
          }),
        }),
      }),
    );
  });

  it("resolves scheduled Linq routes through egress authority and fails closed", async () => {
    const signal = new AbortController().signal;
    const assertLinqRecentInboundEngagement = vi.fn()
      .mockResolvedValueOnce({
        resolvedRoute: {
          conversationThreadId: null,
          directRecipientPhoneNumber: null,
          fromPhoneNumber: "+15550002",
          target: "chat_current_group",
          targetKind: "thread" as const,
          threadIsDirect: false,
        },
      })
      .mockResolvedValueOnce({
        resolvedRoute: {
          conversationThreadId: "hid_current_direct",
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          target: "chat_current_direct",
          targetKind: "thread" as const,
          threadIsDirect: true,
        },
      })
      .mockResolvedValueOnce({
        resolvedRoute: {
          conversationThreadId: null,
          directRecipientPhoneNumber: "+15550001",
          fromPhoneNumber: "+15550002",
          target: "chat_current_direct",
          targetKind: "thread" as const,
          threadIsDirect: null,
        },
      });
    const phaseInput = createPhaseInput({});
    phaseInput.runtime.platform.effectsPort.assertLinqRecentInboundEngagement =
      assertLinqRecentInboundEngagement;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async ({ executionContext }) => {
        const resolveScheduledLinqRoute =
          executionContext.hosted?.resolveScheduledLinqRoute;
        if (!resolveScheduledLinqRoute) {
          throw new Error("Expected scheduled Linq route authority.");
        }

        await expect(resolveScheduledLinqRoute({
          homeRouteFallbackAllowed: false,
          signal,
          target: "chat_saved_group",
          targetKind: "thread",
        })).resolves.toEqual({
          target: "chat_current_group",
          threadIsDirect: false,
        });
        await expect(resolveScheduledLinqRoute({
          homeRouteFallbackAllowed: true,
          target: "chat_saved_direct",
          targetKind: "explicit",
        })).resolves.toEqual({
          conversationThreadId: "hid_current_direct",
          target: "chat_current_direct",
          threadIsDirect: true,
        });
        await expect(resolveScheduledLinqRoute({
          homeRouteFallbackAllowed: true,
          target: "chat_saved_direct",
          targetKind: "explicit",
        })).rejects.toMatchObject({
          code: "ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE",
        });

        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: false,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );

    await runHostedWorkspaceAssistantPhase(phaseInput);

    expect(assertLinqRecentInboundEngagement).toHaveBeenCalledWith({
      authorityCheckOnly: true,
      homeRouteFallbackAllowed: false,
      target: "chat_saved_group",
      targetKind: "thread",
    }, { signal });
  });

  it("resolves scheduled Telegram group authority through the live Web route owner", async () => {
    const signal = new AbortController().signal;
    const assertExternalThreadRouteAuthority = vi.fn(async () => undefined);
    const phaseInput = createPhaseInput({});
    phaseInput.runtime.platform.effectsPort.assertExternalThreadRouteAuthority =
      assertExternalThreadRouteAuthority;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async ({ executionContext }) => {
        const resolveScheduledExternalThreadRoute =
          executionContext.hosted?.resolveScheduledExternalThreadRoute;
        if (!resolveScheduledExternalThreadRoute) {
          throw new Error("Expected scheduled external thread route authority.");
        }

        await expect(resolveScheduledExternalThreadRoute({
          channel: "telegram",
          signal,
          target: "telegram_group_123",
        })).resolves.toEqual({
          channel: "telegram",
          containerMemberId: "member_synthetic_phase",
          threadId: "telegram_group_123",
        });

        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: false,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );

    await runHostedWorkspaceAssistantPhase(phaseInput);

    expect(assertExternalThreadRouteAuthority).toHaveBeenCalledWith({
      channel: "telegram",
      containerMemberId: "member_synthetic_phase",
      threadId: "telegram_group_123",
    }, { signal });
  });

  it("passes the hosted assistant configuration port into assistant execution", async () => {
    const assistantConfigurationToolPort: RuntimeAssistantConfigurationToolPort = {
      request: vi.fn(),
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeAssistantConfigurationToolPort: assistantConfigurationToolPort,
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          assistantConfigurationTool: assistantConfigurationToolPort,
        }),
      },
      expect.any(Object),
    );
  });

  it("passes the hosted subscription port into assistant execution", async () => {
    const subscriptionToolPort: RuntimeSubscriptionToolPort = {
      request: vi.fn(),
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeSubscriptionToolPort: subscriptionToolPort,
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          subscriptionTool: subscriptionToolPort,
        }),
      },
      expect.any(Object),
    );
  });

  it("passes the hosted labs port into assistant execution when available", async () => {
    const labsToolPort: RuntimeLabsToolPort = {
      request: vi.fn(),
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeLabsToolPort: labsToolPort,
    }));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.objectContaining({
          labsTool: labsToolPort,
        }),
      },
      expect.any(Object),
    );
  });

  it("omits the hosted labs port from assistant execution when unavailable", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      {
        hosted: expect.not.objectContaining({
          labsTool: expect.anything(),
        }),
      },
      expect.any(Object),
    );
  });

  it("prepares hosted assistant automation state before running scheduled automation", async () => {
    const runtimeEnv = {};
    const runtimeForwardedEnv = {
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      LINQ_API_BASE_URL: "https://linq.example.test",
    };
    const operatorHomeRoot = "/tmp/murph-operator-home-runtime";
    const vaultRoot = "/tmp/murph-vault-runtime";
    const callOrder: string[] = [];

    mocks.prepareHostedAssistantAutomationForWake.mockImplementationOnce(
      async () => {
        callOrder.push("prepare");
        return PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE;
      },
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("run");
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      operatorHomeRoot,
      runtimeEnv,
      runtimeForwardedEnv,
      vaultRoot,
    }));

    expect(mocks.prepareHostedAssistantAutomationForWake).toHaveBeenCalledWith(
      vaultRoot,
      expect.objectContaining({
        kind: "runtime.timer",
        triggerKind: "runtime_timer",
        userId: "member_synthetic_phase",
      }),
      runtimeForwardedEnv,
      expect.objectContaining({
        channelCapabilities: expect.objectContaining({
          emailSendReady: false,
        }),
      }),
      {
        operatorHomeRoot,
      },
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantRuntimeState: PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE,
      }),
    );
    expect(callOrder).toEqual(["prepare", "run"]);
  });

  it("passes hosted runtime environment explicitly without mutating process globals", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "hosted-phase-vault-"));
    const operatorHomeRoot = await mkdtemp(path.join(tmpdir(), "hosted-phase-home-"));
    const codexHome = path.join(operatorHomeRoot, ".codex-hosted");
    const codexShimPath = path.join(codexHome, "bin/codex");
    const previousCommand = process.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV];
    const previousCodexHome = process.env.CODEX_HOME;
    const previousHome = process.env.HOME;
    const previousHostedMarker = process.env[HOSTED_RUNTIME_PROCESS_ENV];
    const previousVault = process.env.VAULT;
    const restoreEnv = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    process.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV] = "ambient-command";
    process.env.CODEX_HOME = "ambient-codex-home";
    process.env.HOME = "ambient-home";
    process.env[HOSTED_RUNTIME_PROCESS_ENV] = "0";
    process.env.VAULT = "ambient-vault";
    const runtimeEnv = {
      CODEX_HOME: codexHome,
      [HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]: codexShimPath,
      [HOSTED_RUNTIME_PROCESS_ENV]: "1",
      NODE_ENV: "test",
      PATH: "/usr/bin",
    };
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      expect(process.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]).toBe("ambient-command");
      expect(process.env.CODEX_HOME).toBe("ambient-codex-home");
      expect(process.env.HOME).toBe("ambient-home");
      expect(process.env[HOSTED_RUNTIME_PROCESS_ENV]).toBe("0");
      expect(process.env.VAULT).toBe("ambient-vault");
      expect(laneInput.operatorHomeRoot).toBe(operatorHomeRoot);
      expect(laneInput.runtimeEnv).toEqual(runtimeEnv);
      expect(laneInput.vaultRoot).toBe(vaultRoot);
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    try {
      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        operatorHomeRoot,
        runtimeEnv,
        vaultRoot,
      }));

      expect(process.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV])
        .toBe("ambient-command");
      expect(process.env.CODEX_HOME).toBe("ambient-codex-home");
      expect(process.env.HOME).toBe("ambient-home");
      expect(process.env[HOSTED_RUNTIME_PROCESS_ENV]).toBe("0");
      expect(process.env.VAULT).toBe("ambient-vault");
    } finally {
      restoreEnv(HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV, previousCommand);
      restoreEnv("CODEX_HOME", previousCodexHome);
      restoreEnv("HOME", previousHome);
      restoreEnv(HOSTED_RUNTIME_PROCESS_ENV, previousHostedMarker);
      restoreEnv("VAULT", previousVault);
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(operatorHomeRoot, { force: true, recursive: true });
    }
  });

  it("defers hosted usage records until after a progressed assistant checkpoint", async () => {
    const events: string[] = [];
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage(record) {
        events.push(`record:${record.usageId}`);
        return {
          recorded: true,
          usageId: record.usageId,
        };
      },
    };
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      events.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
      },
      runtimeUsageRecordPort: usageRecordPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    expect(hydratedContext?.hosted?.usageRecorder).toEqual({
      recordUsage: expect.any(Function),
    });
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(events).toEqual(["assistant"]);

    events.push("checkpoint");
    for (const record of deferredUsageRecords) {
      await usageRecordPort.recordUsage(record);
    }

    expect(events).toEqual([
      "assistant",
      "checkpoint",
      "record:turn_direct_usage.attempt-1",
    ]);
  });

  it("forwards exact accepted input IDs for deferred route resolution", async () => {
    const deferredAcceptedInputIds: unknown[] = [];
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_a"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_a", "assistant_input_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_telegram_a", "assistant_input_telegram_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_personal_linq_a", "assistant_input_personal_linq_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_external_linq_a", "assistant_input_external_linq_b"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_late"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
        ["assistant_input_unknown"],
      );
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      initialAssistantInputBatch: {
        assistantInputIds: [
          "assistant_input_a",
          "assistant_input_b",
          "assistant_input_telegram_a",
          "assistant_input_telegram_b",
          "assistant_input_personal_linq_a",
          "assistant_input_personal_linq_b",
          "assistant_input_external_linq_a",
          "assistant_input_external_linq_b",
        ],
        emailDeliveryContexts: [],
        linqDeliveryContexts: [],
      },
      recordDeferredUsage: (_record, providerRequestAcceptedInputIds) => {
        deferredAcceptedInputIds.push(providerRequestAcceptedInputIds);
      },
      runtimeUsageRecordPort: {
        async recordUsage(record) {
          return {
            recorded: true,
            usageId: record.usageId,
          };
        },
      },
    }));

    expect(deferredAcceptedInputIds).toEqual([
      ["assistant_input_a"],
      ["assistant_input_b"],
      ["assistant_input_a", "assistant_input_b"],
      ["assistant_input_telegram_a", "assistant_input_telegram_b"],
      ["assistant_input_personal_linq_a", "assistant_input_personal_linq_b"],
      ["assistant_input_external_linq_a", "assistant_input_external_linq_b"],
      ["assistant_input_late"],
      ["assistant_input_unknown"],
      undefined,
    ]);
  });

  it("flushes deferred usage after existing post-checkpoint work", async () => {
    const events: string[] = [];
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage(record) {
        events.push(`record:${record.usageId}`);
        return {
          recorded: true,
          usageId: record.usageId,
        };
      },
    };
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadIsDirect: true,
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockImplementationOnce(async () => {
      events.push("managed-automation");
      return {
        created: 1,
        skipped: 0,
        updated: 0,
      };
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: "2026-04-30T17:00:00.000Z",
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      events.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
      },
      runtimeUsageRecordPort: usageRecordPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    expect(hydratedContext?.hosted?.usageRecorder).toEqual({
      recordUsage: expect.any(Function),
    });
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(mocks.maintainAssistantAutoReplyRouteState).not.toHaveBeenCalled();
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(events).toEqual(["assistant"]);

    events.push("checkpoint");
    await result.afterCheckpoint?.();

    expect(mocks.maintainAssistantAutoReplyRouteState).toHaveBeenCalledOnce();
    expect(mocks.maintainAssistantAutoReplyRouteState).toHaveBeenCalledWith({
      shouldYield: null,
      signal: null,
      vault: "/tmp/murph-vault",
    });

    expect(events).toEqual([
      "assistant",
      "checkpoint",
      "managed-automation",
    ]);

    for (const record of deferredUsageRecords) {
      await usageRecordPort.recordUsage(record);
    }

    expect(events).toEqual([
      "assistant",
      "checkpoint",
      "managed-automation",
      "record:turn_direct_usage.attempt-1",
    ]);
  });

  it("defers hosted usage records until after a system mailbox checkpoint", async () => {
    const events: string[] = [];
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage(record) {
        events.push(`record:${record.usageId}`);
        return {
          recorded: true,
          usageId: record.usageId,
        };
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(
      async ({ executionContext }) => {
        await executionContext.hosted?.usageRecorder?.recordUsage(
          createAssistantUsageRecord(),
        );
        events.push("system-mailbox");
        return {
          item: createSystemMailboxItem(),
          itemId: "system_mailbox_item_processed",
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            mailboxLane: "assistant-notification",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      },
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
      },
      runtimeUsageRecordPort: usageRecordPort,
    }));

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result.checkpointReason).toBe("system_mailbox_receipt");
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(events).toEqual(["system-mailbox"]);

    events.push("checkpoint");
    await result.afterCheckpoint?.();

    expect(events).toEqual([
      "system-mailbox",
      "checkpoint",
    ]);

    for (const record of deferredUsageRecords) {
      await usageRecordPort.recordUsage(record);
    }

    expect(events).toEqual([
      "system-mailbox",
      "checkpoint",
      "record:turn_direct_usage.attempt-1",
    ]);
  });

  it("collects no-progress deferred usage records for runner-owned flushing", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    let usagePortCalled = false;
    const usageRecordPort: RuntimeUsageRecordPort = {
      async recordUsage() {
        usagePortCalled = true;
        throw new Error("Phase should not flush deferred usage directly.");
      },
    };
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      await laneInput.executionContext.hosted?.usageRecorder?.recordUsage(
        createAssistantUsageRecord(),
      );
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
      },
      runtimeUsageRecordPort: usageRecordPort,
    }));

    expect(result.progressed).toBe(false);
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(usagePortCalled).toBe(false);
    const usageFailureLog = logRequests.flatMap((request) => request.entries)
      .find((entry) => entry.errorCode === "assistant_usage_record_failed");
    expect(usageFailureLog).toBeUndefined();
  });

  it("checkpoints background route migration when the assistant pass otherwise makes no progress", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.maintainAssistantAutoReplyRouteState.mockResolvedValueOnce({
      changed: true,
      trusted: true,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
    }));
    expect(mocks.maintainAssistantAutoReplyRouteState).toHaveBeenCalledOnce();
  });

  it("does not turn migration-only foreground progress into managed automation work", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.maintainAssistantAutoReplyRouteState.mockResolvedValueOnce({
      changed: true,
      trusted: true,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
    }));
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
  });

  it("keeps device-sync options out of the assistant lane when active input is fresh", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      executionContext: expect.objectContaining({
        hosted: expect.objectContaining({
          progressDeliveryDependencies: {},
          providerFetch: null,
        }),
      }),
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("keeps plain webhook nudges out of idle device-sync maintenance", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("checkpoints due message-volume receipt recovery without a system mailbox item", async () => {
    mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault.mockResolvedValueOnce(1);
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:01:00.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(
      mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault,
    ).toHaveBeenCalledWith({
      effectsPort: expect.objectContaining({
        recordOutboundMessageVolumeReceipt: expect.any(Function),
      }),
      now: new Date("2026-04-27T00:00:00.000Z"),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      progressed: true,
    }));
  });

  it("keeps browser-vault refresh control work behind fresh conversation input", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createBrowserVaultRefreshSystemMailboxItem(),
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
      importedCount: 1,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRefreshRequested");
    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
  });

  it("keeps non-device system mailbox nudges out of idle device-sync maintenance", async () => {
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
      nextWakeAt: "2026-04-27T00:30:00.000Z",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
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
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
  });

  it("runs the assistant lane before system mailbox work when cron is already due", async () => {
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: "2026-04-27T00:00:00.000Z",
      runningJobs: 0,
      totalJobs: 1,
    });
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.getAssistantCronStatus).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        turnEnvironment: expect.objectContaining({
          env: expect.objectContaining({
            [HOSTED_RUNTIME_PROCESS_ENV]: "1",
          }),
        }),
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
  });

  it("does not treat a running cron job's past nextRunAt as runnable due work", async () => {
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: "2026-04-27T00:00:00.000Z",
      runningJobs: 1,
      totalJobs: 1,
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createBrowserVaultRefreshSystemMailboxItem(),
      itemId: "system_mailbox_item_browser_vault_refresh",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "browser-vault",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:00:00.000Z",
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
  });

  it("re-arms an immediate assistant wake when cron remains due after the background pass", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 2,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 2,
      })
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 2,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 2,
      });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
      workspace: {
        checkpointedAt: dueAt,
        createdAt: dueAt,
        nextWakeAt: dueAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: dueAt,
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: dueAt,
      progressed: true,
    }));
  });

  it("runs idle device-sync work for a due scheduled device-sync wake", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
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

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeLogContext: {
          attemptId: "attempt_synthetic_phase",
          leaseGeneration: "3",
          workspaceVersion: "8",
        },
        skipDirtyPendingFetch: false,
      }),
    );
    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("keeps activity-scheduling failures out of job-attempt telemetry", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockRejectedValueOnce(
      new Error("synthetic activity scheduling secret"),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    const entries = logRequests.flatMap((request) => request.entries);
    expect(entries.filter((entry) => entry.eventCode === "device-sync.job_failed"))
      .toHaveLength(0);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        component: "runtime",
        errorCode: "runtime_error",
        eventCode: "assistant.device_activity_automation_failed",
        level: "warn",
        phase: "idle",
        redactedJson: expect.objectContaining({
          deviceActivityAutomationScheduleFailed: true,
          errorCode: "runtime_error",
          failureEventOrigin: "device_activity_automation",
          safeErrorMessage: "Hosted execution runtime failed.",
          wakeKind: "runtime.timer",
        }),
      }),
    ]));
    expect(JSON.stringify(entries)).not.toContain("synthetic activity scheduling secret");
    expect(JSON.stringify(entries)).not.toContain("synthetic-device-sync-secret");
  });

  it("schedules an assistant wake when idle device sync matches device activity automation", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValueOnce({
      matched: 1,
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      scheduled: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: "assistant",
      progressed: true,
    }));
  });

  it("schedules an assistant wake when idle device sync finds an already due activity handoff", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    mocks.scheduleDeviceActivityTriggeredAutomations.mockResolvedValueOnce({
      matched: 0,
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      scheduled: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(mocks.scheduleDeviceActivityTriggeredAutomations).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: "assistant",
      progressed: true,
    }));
  });

  it("refreshes assistant cron state after system-mailbox device sync queues due activity work", async () => {
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 0,
        enabledJobs: 0,
        nextRunAt: null,
        runningJobs: 0,
        totalJobs: 0,
      })
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: "2026-04-27T00:00:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_due_activity_handoff",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "webhook" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_due_activity_handoff",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T00:05:00.000Z",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: {
        checkpointedAt: "2026-04-27T00:00:00.000Z",
        createdAt: "2026-04-27T00:00:00.000Z",
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
    }));
  });

  it("logs and reschedules idle device-sync failures without throwing", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedDeviceSyncWakeLane.mockRejectedValueOnce(
      new Error("synthetic idle device sync failure"),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect("afterCheckpoint" in result).toBe(false);
    await Promise.resolve();
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.device_connect",
      "device-sync.maintenance_failed",
    ]);
    const failureEntries = logRequests.flatMap((request) => request.entries);
    const failureLog = failureEntries
      .find((entry) => entry.eventCode === "device-sync.maintenance_failed");
    expect(failureEntries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ eventCode: "device-sync.job_failed" }),
    ]));
    expect(failureLog).toEqual(expect.objectContaining({
      component: "device-sync",
      errorCode: "runtime_error",
      eventCode: "device-sync.maintenance_failed",
      level: "warn",
      phase: "idle",
      redactedJson: expect.objectContaining({
        errorCode: "runtime_error",
        errorMessagePresent: true,
        failureEventOrigin: "idle_maintenance",
        idleMaintenanceFailed: true,
        retryAt: "2026-04-27T00:00:30.000Z",
        safeErrorMessage: "Hosted execution runtime failed.",
      }),
    }));
    expect(JSON.stringify(logRequests)).not.toContain("synthetic idle device sync failure");
    expect(JSON.stringify(logRequests)).not.toContain("synthetic-whoop-secret");
  });

  it("refreshes dirty assistant context snapshots during idle hosted work", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-context-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        timezone: "America/New_York",
        vaultRoot,
      });
      await writeHostedPhaseExperimentSource(vaultRoot);
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });
      mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValueOnce({
        captureIds: ["cap_terminal_cleanup"],
        linqMessageIds: ["linq_msg_terminal_cleanup"],
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      }));

      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        progressed: true,
        redactedStatus: expect.objectContaining({
          assistantContextSnapshotPendingDirtyDomainCount: 0,
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: true,
        }),
      }));
      expect("nextWakeAt" in result).toBe(false);
      await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
        lastCompleted: {
          promptBlock: expect.stringContaining("Hosted phase sleep consistency"),
        },
        pendingDirtyDomains: [],
      });
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("preserves durable outbox wakes after context snapshot refresh", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-context-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const outboxWakeAt = "2026-04-27T00:05:00.000Z";

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await writeHostedPhaseExperimentSource(vaultRoot);
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });
      mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(outboxWakeAt);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      }));

      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: outboxWakeAt,
        progressed: true,
        redactedStatus: expect.objectContaining({
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: true,
        }),
      }));
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("reselects a durable device-sync continuation after an earlier outbox wake is serviced", async () => {
    const outboxWakeAt = "2026-04-27T00:00:05.000Z";
    const deviceSyncContinuationAt = "2026-04-27T00:00:30.000Z";
    const resolvedDeviceSync = {
      providerConfigs: {
        whoop: {
          clientId: "synthetic-whoop-client",
          clientSecret: "synthetic-whoop-secret",
        },
      },
      publicBaseUrl: "https://device-sync.example.test",
      secret: "synthetic-device-sync-secret",
    } as const;

    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(outboxWakeAt);
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce(deviceSyncContinuationAt);

    const firstPass = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync,
    }));

    expect(firstPass).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: outboxWakeAt,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      progressed: true,
    }));
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();

    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(null);
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce(deviceSyncContinuationAt);

    const restartedAtOutboxWake = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => outboxWakeAt,
      resolvedDeviceSync,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: outboxWakeAt,
        nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      }),
    }));

    expect(restartedAtOutboxWake).toEqual(expect.objectContaining({
      nextWakeAt: deviceSyncContinuationAt,
      nextWakeReason: "device-sync.reconcile",
    }));
    expect(mocks.resolveHostedDeviceSyncNextWakeAt).toHaveBeenCalledTimes(2);
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("preserves dirty assistant context snapshots and requests an immediate wake after preemption", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-context-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");
    let yieldChecks = 0;

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => "2026-04-27T00:00:00.000Z",
        shouldYieldBackgroundMaintenance: () => {
          yieldChecks += 1;
          return yieldChecks > 3;
        },
        vaultRoot,
      }));

      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        progressed: true,
        redactedStatus: expect.objectContaining({
          assistantContextSnapshotPendingDirtyDomainCount: 1,
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: false,
        }),
      }));
      await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
        lastCompleted: null,
        pendingDirtyDomains: ["experiments"],
      });
      expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
      expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
      expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("preserves dirty assistant context snapshots and requests an immediate wake after refresh failure", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-context-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await rm(path.join(vaultRoot, "bank/experiments"), {
        force: true,
        recursive: true,
      });
      await mkdir(path.join(vaultRoot, "bank"), {
        recursive: true,
      });
      await writeFile(
        path.join(vaultRoot, "bank/experiments"),
        "not a directory\n",
        "utf8",
      );
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      }));

      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        nextWakeReason: "assistant",
        progressed: true,
        redactedStatus: expect.objectContaining({
          assistantContextSnapshotPendingDirtyDomainCount: 1,
          assistantContextSnapshotRefreshAttempted: true,
          assistantContextSnapshotRefreshed: false,
        }),
      }));
      await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
        lastRefreshAttempt: {
          errorCode: expect.any(String),
          status: "failed",
        },
        pendingDirtyDomains: ["experiments"],
      });
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps scheduled device-sync work deferred when foreground input is fresh", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("keeps assistant-labeled scheduled wakes on the assistant lane when device sync is absent", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result.progressed).toBe(false);
    expect("checkpointReason" in result).toBe(false);
    expect("nextWakeAt" in result).toBe(false);
  });

  it("keeps projected due device-sync wakes out when foreground input is fresh", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("keeps the foreground reply running when follow-up device-sync wake projection cannot load", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const moduleLoadError = new Error("synthetic device-sync module load failure");
    vi.mocked(loadHostedDeviceSyncMaintenanceModule).mockRejectedValueOnce(
      moduleLoadError,
    );
    vi.mocked(isHostedDeviceSyncMaintenanceModuleLoadError).mockReturnValue(true);
    const deliveryEffect = createDeliveryEffect();
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
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
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: false,
        preferredIntentIds: [deliveryEffect.effectId],
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      }),
    );
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    const moduleLoadFailureLog = logRequests
      .flatMap((request) => request.entries)
      .find((entry) => entry.eventCode === "device-sync.module_load_failed");
    expect(moduleLoadFailureLog).toEqual(expect.objectContaining({
      component: "device-sync",
      eventCode: "device-sync.module_load_failed",
      level: "warn",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        followUpWakeProjection: true,
        projectionPath: "follow-up-wake",
      }),
    }));
    expect("nextWakeReason" in result ? result.nextWakeReason : null)
      .not.toBe("device-sync.reconcile");
    expect(postCheckpoint?.nextWakeReason ?? null).not.toBe("device-sync.reconcile");
    expect(JSON.stringify(logRequests)).not.toContain("synthetic-whoop-secret");
  });

  it("keeps due device-sync wakes out when non-conversation mailbox input is fresh", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("does not consume due assistant wakes when non-conversation mailbox input is fresh", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
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
    expect(result.progressed).toBe(false);
    expect("checkpointReason" in result).toBe(false);
    expect("nextWakeAt" in result).toBe(false);
  });

  it("passes the foreground-input yield hook to due idle device-sync work", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldYieldDeviceSync: shouldYieldBackgroundMaintenance,
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
  });

  it("passes the foreground-input yield hook to system mailbox maintenance", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldYieldBackgroundMaintenance,
      }),
    );
  });

  it("checkpoints hosted managed automation changes before continuing assistant work", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const events: string[] = [];
    mocks.applyMurphManagedAutomations.mockImplementationOnce(async (input) => {
      events.push("managed-automation");
      input.onOnboardingFollowupDiagnostic?.({
        action: "migrated_three_day_window",
        activeUntil: "2026-04-30T15:00:00.000Z",
        firstOccurrenceAt: "2026-04-28T13:30:00.000Z",
        onboardingStateCreatedAt: null,
        onboardingStateSource: "default_missing",
        onboardingStateStatus: "open",
        onboardingStateUpdatedAt: null,
        opportunityDays: 3,
        previousScheduleKind: "at",
        scheduleKind: "dailyLocal",
      });
      return {
        created: 1,
        skipped: 0,
        updated: 0,
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      events.push("automation-lane");
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      operatorHomeRoot: "/tmp/murph-hosted-operator-home",
      vaultRoot: "/tmp/murph-hosted-vault",
    }));

    expect(mocks.applyMurphManagedAutomations).toHaveBeenCalledWith({
      now: new Date("2026-04-27T00:00:00.000Z"),
      onDiagnosticStage: expect.any(Function),
      onOnboardingFollowupDiagnostic: expect.any(Function),
      operatorHomeRoot: "/tmp/murph-hosted-operator-home",
      routeValidationProfile: "hosted",
      runtimeEnv: {},
      shouldYield: null,
      vaultRoot: "/tmp/murph-hosted-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["managed-automation", "automation-lane"]);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationSkipped: 0,
        murphManagedAutomationUpdated: 0,
      }),
    }));
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "assistant.onboarding_followup_reconciled",
        level: "info",
        redactedJson: {
          onboardingFollowupAction: "migrated_three_day_window",
          onboardingFollowupActiveUntil: "2026-04-30T15:00:00.000Z",
          onboardingFollowupFirstOccurrenceAt: "2026-04-28T13:30:00.000Z",
          onboardingFollowupOpportunityDays: 3,
          onboardingFollowupPreviousScheduleKind: "at",
          onboardingFollowupScheduleKind: "dailyLocal",
          onboardingStateCreatedAt: null,
          onboardingStateSource: "default_missing",
          onboardingStateStatus: "open",
          onboardingStateUpdatedAt: null,
        },
      }),
    );
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "assistant.pass_finished",
        level: "info",
        redactedJson: expect.objectContaining({
          murphManagedAutomationCreated: 1,
          murphManagedAutomationSkipped: 0,
          murphManagedAutomationUpdated: 0,
        }),
      }),
    );
  });

  it("runs deterministic reminder availability in the hosted background pass", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-reminder-availability-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const actualAssistantEngine = await vi.importActual<
      typeof import("@murphai/assistant-engine")
    >("@murphai/assistant-engine");
    const connectedApps = {
      request: vi.fn(async () => ({
        result: {
          data: {
            items: [{
              description: "Private provider content",
              end: { dateTime: "2026-07-30T15:00:00.000Z" },
              start: { dateTime: "2026-07-30T14:00:00.000Z" },
              summary: "Private event title",
            }],
          },
        },
      })),
    };
    try {
      await initializeVault({
        createdAt: "2026-07-29T00:00:00.000Z",
        vaultRoot,
      });
      await upsertAutomation({
        continuityPolicy: "fresh",
        instructions: [
          "Send one flexible reminder.",
          "Availability conflict policy: skip-when-busy",
          "Availability source policy: calendar-only",
          "Availability calendar account: googlecalendar / calendar-account",
        ].join("\n"),
        now: new Date("2026-07-29T00:00:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "direct-thread",
          identityId: null,
          participantId: null,
          threadId: null,
          threadIsDirect: true,
        },
        schedule: { kind: "dailyLocal", localTime: "16:00" },
        slug: "hosted-reminder-availability",
        status: "active",
        title: "Hosted reminder availability",
        vaultRoot,
      });
      mocks.refreshReminderAvailability.mockImplementationOnce(
        actualAssistantEngine.refreshReminderAvailability,
      );

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => "2026-07-30T00:00:00.000Z",
        runtimeConnectedApps: connectedApps,
        vaultRoot,
      }));

      expect(mocks.refreshReminderAvailability).toHaveBeenCalledWith({
        connectedApps,
        now: new Date("2026-07-30T00:00:00.000Z"),
        shouldYield: null,
        signal: null,
        vaultRoot,
      });
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-07-30T23:00:00.000Z",
        progressed: true,
        redactedStatus: expect.objectContaining({
          reminderAvailabilityMaintenanceAttempted: 1,
          reminderAvailabilityMaintenanceFailed: 0,
          reminderAvailabilityMaintenanceRefreshed: 1,
        }),
      }));
      const reminder = await showAutomation({
        slug: "hosted-reminder-availability",
        vaultRoot,
      });
      expect(reminder).not.toBeNull();
      expect(reminder?.instructions).not.toContain("Private event title");
      expect(splitAutomationAvailabilityConflictBlock(
        reminder?.instructions ?? "",
      ).block).toContain(
        "- 2026-07-30T14:00:00.000Z / 2026-07-30T15:00:00.000Z",
      );
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("preempts an in-flight reminder availability read without logging a provider failure", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-reminder-availability-abort-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const backgroundController = new AbortController();
    const logRequests: HostedRuntimeLogRequest[] = [];
    let foregroundWaiting = false;
    let markRequestStarted: () => void = () => undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const connectedApps: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["connectedApps"]
    > = {
      request: vi.fn(async (_request, context) => {
        const signal = context?.signal ?? null;
        expect(signal).toBe(backgroundController.signal);
        markRequestStarted();
        return await new Promise<never>((_resolve, reject) => {
          const rejectFromAbort = () => reject(signal?.reason);
          if (!signal) {
            reject(new Error("Expected a background maintenance signal."));
          } else if (signal.aborted) {
            rejectFromAbort();
          } else {
            signal.addEventListener("abort", rejectFromAbort, { once: true });
          }
        });
      }),
    };
    const actualAssistantEngine = await vi.importActual<
      typeof import("@murphai/assistant-engine")
    >("@murphai/assistant-engine");
    try {
      await initializeVault({
        createdAt: "2026-07-29T00:00:00.000Z",
        vaultRoot,
      });
      await upsertAutomation({
        continuityPolicy: "fresh",
        instructions: [
          "Send one flexible reminder.",
          "Availability conflict policy: skip-when-busy",
          "Availability source policy: calendar-only",
          "Availability calendar account: googlecalendar / calendar-account",
        ].join("\n"),
        now: new Date("2026-07-29T00:00:00.000Z"),
        route: {
          channel: "linq",
          deliveryTarget: "direct-thread",
          identityId: null,
          participantId: null,
          threadId: null,
          threadIsDirect: true,
        },
        schedule: { kind: "dailyLocal", localTime: "16:00" },
        slug: "hosted-reminder-availability-abort",
        status: "active",
        title: "Hosted reminder availability abort",
        vaultRoot,
      });
      mocks.refreshReminderAvailability.mockImplementationOnce(
        actualAssistantEngine.refreshReminderAvailability,
      );

      const phasePromise = runHostedWorkspaceAssistantPhase(createPhaseInput({
        backgroundMaintenanceSignal: backgroundController.signal,
        logRequests,
        now: () => "2026-07-30T00:00:00.000Z",
        runtimeConnectedApps: connectedApps,
        shouldYieldBackgroundMaintenance: () => foregroundWaiting,
        vaultRoot,
      }));
      await requestStarted;
      foregroundWaiting = true;
      backgroundController.abort(
        new DOMException(
          "Foreground conversation input preempted background maintenance.",
          "AbortError",
        ),
      );

      await expect(phasePromise).resolves.toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-07-30T00:00:00.000Z",
        progressed: true,
        redactedStatus: expect.objectContaining({
          reminderAvailabilityMaintenanceYielded: true,
        }),
      }));
      expect(
        logRequests.flatMap((request) => request.entries).some((entry) =>
          entry.redactedJson?.reminderAvailabilityMaintenanceFailed === true
        ),
      ).toBe(false);
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("falls back to the runtime shutdown signal for reminder availability", async () => {
    const shutdownController = new AbortController();
    const shutdownReason = new DOMException(
      "Synthetic hosted runtime shutdown.",
      "AbortError",
    );
    let markRefreshStarted: () => void = () => undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    mocks.refreshReminderAvailability.mockImplementationOnce(async (input) => {
      expect(input.signal).toBe(shutdownController.signal);
      markRefreshStarted();
      return await new Promise<never>((_resolve, reject) => {
        const rejectFromAbort = () => reject(input.signal?.reason);
        if (!input.signal) {
          reject(new Error("Expected the runtime shutdown signal."));
        } else if (input.signal.aborted) {
          rejectFromAbort();
        } else {
          input.signal.addEventListener("abort", rejectFromAbort, { once: true });
        }
      });
    });

    const phasePromise = runHostedWorkspaceAssistantPhase(createPhaseInput({
      signal: shutdownController.signal,
    }));
    await refreshStarted;
    shutdownController.abort(shutdownReason);

    await expect(phasePromise).rejects.toBe(shutdownReason);
  });

  it("checkpoints a retry wake after logging partial managed setup failures", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const stableKeyFailure = new VaultCliError(
      "MURPH_MANAGED_AUTOMATION_SETUP_TRANSIENT",
      "metadata unavailable",
      { retryable: true },
    );
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 1,
      stableKeyFailure,
      stableKeyRetryNeeded: true,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationFailed: true,
        murphManagedAutomationSkipped: 1,
        murphManagedAutomationUpdated: 0,
      }),
    }));

    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
          murphManagedAutomationCreated: 1,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSkipped: 1,
          murphManagedAutomationUpdated: 0,
          safeErrorMessage: "Hosted execution runtime failed.",
        }),
      }),
    );
  });

  it("reports a degraded experiment lifecycle stage without failing the pass", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 2,
      experimentLifecycleFailure: new Error("Experiment storage rejected an entry."),
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    // The automations that do not depend on the experiment scan still landed.
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 2,
        murphManagedAutomationFailed: false,
      }),
    }));
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          murphManagedAutomationExperimentLifecycleFailed: true,
          murphManagedAutomationStage: "experiment_lifecycle",
        }),
      }),
    );
  });

  it("keeps the bounded retry ladder for a transient experiment lifecycle failure", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const transient = Object.assign(new Error("experiment snapshot busy"), {
      code: "EBUSY",
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 2,
      experimentLifecycleFailure: transient,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    // First rung of the existing 30s / 2m / 10m ladder, with the unrelated
    // automations that already landed preserved in the status.
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 2,
        murphManagedAutomationExperimentLifecycleFailed: true,
        murphManagedAutomationSetupRetryAttempt: 1,
        murphManagedAutomationSetupRetryable: true,
      }),
    }));
    // It must not also report the pass as a clean success.
    expect(result.redactedStatus).not.toEqual(expect.objectContaining({
      murphManagedAutomationFailed: false,
    }));
  });

  it("does not retry a deterministic experiment storage failure", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 2,
      experimentLifecycleFailure: Object.assign(
        new Error("Experiment storage contains an entry that could hold an experiment document."),
        { code: "EXPERIMENT_STORAGE_INVALID" },
      ),
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    // Retrying an unchanged vault every 30 seconds would buy nothing.
    expect(result).not.toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
    }));
    expect(result).toEqual(expect.objectContaining({
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 2,
      }),
    }));
  });

  it("logs stable-key metadata failures when background setup stays idle", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const stableKeyFailure = new Error("metadata unavailable");
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 0,
      skipped: 1,
      stableKeyFailure,
      stableKeyRetryNeeded: true,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    expect(result).not.toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
    }));
    expect(result).not.toEqual(expect.objectContaining({
      redactedStatus: expect.objectContaining({
        murphManagedAutomationFailed: true,
      }),
    }));
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          errorCode: "runtime_error",
          murphManagedAutomationCreated: 0,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSkipped: 1,
          murphManagedAutomationUpdated: 0,
          safeErrorMessage: "Hosted execution runtime failed.",
        }),
      }),
    );
  });

  it("persists bounded retries for a zero-change typed transient stable-key failure", async () => {
    const stableKeyFailure = new VaultCliError(
      "MURPH_MANAGED_AUTOMATION_SETUP_TRANSIENT",
      "workspace metadata is temporarily unavailable",
      { retryable: true },
    );
    mocks.applyMurphManagedAutomations.mockResolvedValue({
      created: 0,
      skipped: 1,
      stableKeyFailure,
      stableKeyRetryNeeded: true,
      updated: 0,
    });

    const firstRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    expect(firstRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 0,
        murphManagedAutomationSetupRetryAttempt: 1,
        murphManagedAutomationSetupRetryable: true,
        murphManagedAutomationUpdated: 0,
      }),
    }));

    const secondRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:01:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 1,
        },
      }),
    }));
    expect(secondRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:03:00.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 2,
      }),
    }));

    const thirdRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:04:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 2,
        },
      }),
    }));
    expect(thirdRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 3,
      }),
    }));
  });

  it("checkpoints partial managed changes without retrying a permanent stable-key failure", async () => {
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 1,
      stableKeyFailure: new Error("vault metadata failed schema validation"),
      stableKeyRetryNeeded: true,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationFailed: true,
        murphManagedAutomationSetupRetryAttempt: 0,
        murphManagedAutomationSetupRetryable: false,
      }),
    }));
    expect(result).not.toHaveProperty("nextWakeAt", expect.any(String));
  });

  it("does not schedule a retry loop for an unclassified managed setup failure", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const setupFailure = Object.assign(
      new TypeError("private managed automation failure detail"),
      {
        code: "MANAGED_SEED_SCHEMA_INVALID",
        statusCode: 409,
      },
    );
    mocks.applyMurphManagedAutomations.mockImplementationOnce(async (input) => {
      input.onDiagnosticStage?.({
        seedCount: 7,
        seedPosition: 3,
        stage: "managed_seed",
      });
      throw setupFailure;
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationFailed: true,
        murphManagedAutomationSetupRetryAttempt: 0,
        murphManagedAutomationSetupRetryExhausted: false,
        murphManagedAutomationSetupRetryable: false,
      }),
    }));
    expect(result).not.toHaveProperty("nextWakeAt", "2026-04-27T00:00:30.000Z");
    expect(logRequests.flatMap((request) => request.entries)).toContainEqual(
      expect.objectContaining({
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: expect.objectContaining({
          errorCodeDetail: "MANAGED_SEED_SCHEMA_INVALID",
          errorDetailPresent: true,
          errorName: "TypeError",
          errorStatus: 409,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSeedCount: 7,
          murphManagedAutomationSeedPosition: 3,
          murphManagedAutomationStage: "managed_seed",
          safeErrorMessage: "Hosted execution runtime failed.",
        }),
      }),
    );
    expect(JSON.stringify(logRequests)).not.toContain(
      "private managed automation failure detail",
    );
  });

  it("backs off typed transient managed setup failures and exhausts the retry budget", async () => {
    const setupFailure = new VaultCliError(
      "MURPH_MANAGED_AUTOMATION_SETUP_TRANSIENT",
      "workspace metadata is temporarily unavailable",
      { retryable: true },
    );
    mocks.applyMurphManagedAutomations.mockRejectedValue(setupFailure);

    const firstRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    expect(firstRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 1,
        murphManagedAutomationSetupRetryExhausted: false,
        murphManagedAutomationSetupRetryable: true,
      }),
    }));

    const secondRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:01:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 1,
        },
      }),
    }));
    expect(secondRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:03:00.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 2,
        murphManagedAutomationSetupRetryExhausted: false,
      }),
    }));

    const thirdRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:04:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 2,
        },
      }),
    }));
    expect(thirdRetry).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 3,
        murphManagedAutomationSetupRetryExhausted: false,
      }),
    }));

    const exhaustedRetry = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:12:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationSetupRetryAttempt: 3,
        },
      }),
    }));
    expect(exhaustedRetry).toEqual(expect.objectContaining({
      redactedStatus: expect.objectContaining({
        murphManagedAutomationSetupRetryAttempt: 3,
        murphManagedAutomationSetupRetryExhausted: true,
        murphManagedAutomationSetupRetryable: true,
      }),
    }));
    expect(exhaustedRetry).not.toHaveProperty("nextWakeAt", expect.any(String));
  });

  it("clears the managed setup retry budget after a later successful pass", async () => {
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 0,
      skipped: 1,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:03:00.000Z",
      workspace: createPhaseWorkspace({
        redactedStatus: {
          murphManagedAutomationFailed: true,
          murphManagedAutomationSetupRetryAttempt: 2,
          murphManagedAutomationSetupRetryable: true,
        },
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationFailed: false,
        murphManagedAutomationSetupRetryAttempt: 0,
        murphManagedAutomationSetupRetryExhausted: false,
        murphManagedAutomationSetupRetryable: false,
      }),
    }));
    expect(result).not.toHaveProperty("nextWakeAt", expect.any(String));
  });

  it("skips hosted managed automation work when background maintenance yields", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: expect.any(String),
      nextWakeReason: "assistant",
      progressed: false,
    }));
  });

  it("reschedules partial managed maintenance when foreground input arrives mid-pass", async () => {
    let shouldYieldNow = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYieldNow);
    mocks.applyMurphManagedAutomations.mockImplementationOnce(async (input) => {
      expect(input.shouldYield).toBe(shouldYieldBackgroundMaintenance);
      shouldYieldNow = true;
      return {
        created: 1,
        skipped: 0,
        updated: 0,
        yielded: true,
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
      shouldYieldBackgroundMaintenance,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationUpdated: 0,
        murphManagedAutomationYielded: true,
      }),
    }));
  });

  it("runs the automation lane for fresh conversation input even when background maintenance yields", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
      }),
    );
  });

  it("uses the fresh hosted conversation route for managed automation seeding", async () => {
    const seededNextWakeAt = "2026-04-30T17:00:00.000Z";
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadIsDirect: true,
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: seededNextWakeAt,
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(mocks.readAssistantInputEvent).not.toHaveBeenCalled();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.readAssistantInputEvent).toHaveBeenCalledWith({
      inputId: "ain_00000000000000000000000000000001",
      vault: "/tmp/murph-vault",
    });
    expect(mocks.applyMurphManagedAutomations).toHaveBeenCalledWith({
      defaultRoute,
      now: new Date("2026-04-27T00:00:00.000Z"),
      onDiagnosticStage: expect.any(Function),
      onOnboardingFollowupDiagnostic: expect.any(Function),
      operatorHomeRoot: "/tmp/murph-operator-home",
      routeValidationProfile: "hosted",
      runtimeEnv: {},
      shouldYield: null,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: seededNextWakeAt,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationSkipped: 0,
        murphManagedAutomationUpdated: 0,
      }),
    }));
  });

  it("does not wait on fresh managed automation cron status after foreground yield starts", async () => {
    vi.useFakeTimers();
    try {
      let shouldYield = false;
      const retryWakeAt = "2026-04-27T00:00:30.000Z";
      const defaultRoute = {
        channel: "linq",
        deliverySource: null,
        deliveryTarget: "chat_synthetic_seed_route",
        identityId: "identity_synthetic_seed_route",
        participantId: "participant_synthetic_seed_route",
        threadIsDirect: true,
        threadId: "thread_synthetic_seed_route",
      };
      mocks.readAssistantInputEvent.mockResolvedValueOnce({
        conversation: {
          accountId: defaultRoute.identityId,
          actorId: defaultRoute.participantId,
          actorIsSelf: false,
          source: defaultRoute.channel,
          threadId: defaultRoute.threadId,
          threadIsDirect: true,
        },
        replyTarget: {
          channel: defaultRoute.channel,
          messageId: "message_synthetic_seed_route",
          threadId: defaultRoute.deliveryTarget,
        },
      });
      mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
        created: 1,
        skipped: 0,
        updated: 0,
      });
      mocks.getAssistantCronStatus.mockImplementationOnce(() => {
        setTimeout(() => {
          shouldYield = true;
        }, 0);
        return new Promise(() => undefined);
      });
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 1,
        now: () => "2026-04-27T00:00:00.000Z",
        shouldYieldBackgroundMaintenance: () => shouldYield,
      }));

      expect(result.afterCheckpoint).toEqual(expect.any(Function));
      const postCheckpointPromise = result.afterCheckpoint?.();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(150);
      const postCheckpoint = await postCheckpointPromise;

      expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(1);
      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: retryWakeAt,
        redactedStatus: expect.objectContaining({
          murphManagedAutomationCreated: 1,
          murphManagedAutomationSkipped: 0,
          murphManagedAutomationUpdated: 0,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the recorded provider-cleanup wake when fresh managed automation seeding replaces the phase wake", async () => {
    // Regression: a fresh Linq inbound records deferred provider cleanup into
    // hosted-provider-cleanup.json, the single owner of the next cleanup
    // wake. The managed-automation post-checkpoint result replaces the phase
    // wake in the workspace runner, so it must include the owner's scheduled
    // wake instead of stranding the deletion until the next unrelated cron
    // wake.
    const cronNextWakeAt = "2026-04-27T17:00:00.000Z";
    const providerCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 3,
      skipped: 0,
      updated: 0,
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 3,
      nextRunAt: cronNextWakeAt,
      runningJobs: 0,
      totalJobs: 3,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      assistantAutomationTerminalLinqCleanup: ["linq_inbound_regression"],
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: providerCleanupWakeAt,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 3,
      }),
    }));
  });

  it("keeps the re-armed provider-cleanup wake when the persisted checkpoint is stale", async () => {
    // Regression: prepareHostedProviderCleanupPlan's deferred branch re-arms
    // a null/stale persisted checkpoint by writing the deferred wake back
    // into hosted-provider-cleanup.json. The managed-automation
    // post-checkpoint result must carry that durably re-armed owner wake.
    const cronNextWakeAt = "2026-04-27T17:00:00.000Z";
    const reArmedProviderCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 3,
      skipped: 0,
      updated: 0,
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 3,
      nextRunAt: cronNextWakeAt,
      runningJobs: 0,
      totalJobs: 3,
    });
    // Persisted owner state is stale: pending ids with a null checkpoint.
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue({
      nextWakeAt: null,
    });
    // After the deferred plan re-arms the stale checkpoint durably, the
    // owner file resolves to the re-armed wake.
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      reArmedProviderCleanupWakeAt,
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: reArmedProviderCleanupWakeAt,
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 3,
      }),
    }));
  });

  it("keeps an earlier assistant wake when fresh managed automation work is a no-op", async () => {
    const assistantWakeAt = "2026-04-27T00:05:00.000Z";
    const providerCleanupWakeAt = "2026-04-27T00:14:00.000Z";
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: assistantWakeAt,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: assistantWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toBeNull();
    expect(mocks.readAssistantInputEvent).toHaveBeenCalledWith({
      inputId: "ain_00000000000000000000000000000001",
      vault: "/tmp/murph-vault",
    });
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
  });

  it("does not add a cleanup wake to fresh managed automation post-checkpoint status", async () => {
    const assistantWakeAt = "2026-04-27T00:05:00.000Z";
    const providerCleanupWakeAt = "2026-04-27T00:14:00.000Z";
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadId: "thread_synthetic_seed_route",
    };
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: assistantWakeAt,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      nextWakeAt: assistantWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationCreated: 1,
        murphManagedAutomationSkipped: 0,
        murphManagedAutomationUpdated: 0,
      }),
    }));
    // A status-only post-checkpoint result never manufactures a wake, even
    // when the cleanup owner has one scheduled; the phase result already
    // carries the owner wake and the runner keeps it.
    expect(postCheckpoint).not.toHaveProperty("nextWakeAt");
  });

  it("preserves a current inbound result and schedules managed setup retry after its checkpoint", async () => {
    const defaultRoute = {
      channel: "linq",
      deliverySource: null,
      deliveryTarget: "chat_synthetic_seed_route",
      identityId: "identity_synthetic_seed_route",
      participantId: "participant_synthetic_seed_route",
      threadId: "thread_synthetic_seed_route",
    };
    mocks.readAssistantInputEvent.mockResolvedValueOnce({
      conversation: {
        accountId: defaultRoute.identityId,
        actorId: defaultRoute.participantId,
        actorIsSelf: false,
        source: defaultRoute.channel,
        threadId: defaultRoute.threadId,
        threadIsDirect: true,
      },
      replyTarget: {
        channel: defaultRoute.channel,
        messageId: "message_synthetic_seed_route",
        threadId: defaultRoute.deliveryTarget,
      },
    });
    const stableKeyFailure = new VaultCliError(
      "MURPH_MANAGED_AUTOMATION_SETUP_TRANSIENT",
      "metadata unavailable",
      { retryable: true },
    );
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 0,
      skipped: 1,
      stableKeyFailure,
      stableKeyRetryNeeded: true,
      updated: 0,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    // The current inbound phase completes and can be checkpointed before
    // background managed-automation setup is attempted.
    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      progressed: true,
    }));
    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    await expect(result.afterCheckpoint?.()).resolves.toEqual(
      expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: "2026-04-27T00:00:30.000Z",
        redactedStatus: expect.objectContaining({
          murphManagedAutomationFailed: true,
        }),
      }),
    );
  });

  it("fails closed for mixed fresh hosted inputs when any reply target lacks a route", async () => {
    const routedEvent = {
      conversation: {
        accountId: "identity_synthetic_mixed_route",
        actorId: "participant_synthetic_mixed_route",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_synthetic_mixed_route",
        threadIsDirect: true,
      },
      replyTarget: {
        channel: "linq",
        messageId: "message_synthetic_mixed_route",
        threadId: "chat_synthetic_mixed_route",
      },
    };
    const routeLessReplyEvent = {
      conversation: {
        accountId: "identity_synthetic_mixed_route",
        actorId: "participant_synthetic_mixed_route",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_synthetic_mixed_route",
        threadIsDirect: true,
      },
      replyTarget: {
        channel: "linq",
        messageId: "message_synthetic_mixed_routeless",
        threadId: null,
      },
    };
    mocks.readAssistantInputEvent
      .mockResolvedValueOnce(routedEvent)
      .mockResolvedValueOnce(routeLessReplyEvent);
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [
        "ain_00000000000000000000000000000001",
        "ain_00000000000000000000000000000002",
      ],
      importedCount: 2,
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    mocks.readAssistantInputEvent
      .mockReset()
      .mockResolvedValueOnce(routedEvent)
      .mockResolvedValueOnce(routeLessReplyEvent);
    const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const operationScope = laneInput?.operationScope as
      | AssistantAutomationOperationScope
      | undefined;
    if (!laneInput?.executionContext || !operationScope) {
      throw new Error("Expected hosted automation operation scope.");
    }
    await operationScope.runAutoReplyGroup({
      executionContext: laneInput.executionContext,
      inputIds: [
        "ain_00000000000000000000000000000001",
        "ain_00000000000000000000000000000002",
      ],
      operation: async (
        executionContext,
        _turnEnvironment,
        providerStartCriticalPath,
      ) => {
        expect(executionContext.hosted?.automationTool).toBeUndefined();
        expect(executionContext.hosted?.groupSharedReader).toBeUndefined();
        expect(providerStartCriticalPath).toEqual(expect.objectContaining({
          automationGroupAndOperationScopeDoneAtMonotonicMs: expect.any(Number),
          mailboxImportDoneAtMonotonicMs: 0,
        }));
      },
      providerStartCriticalPath: {
        mailboxImportDoneAtMonotonicMs: 0,
      },
      turnEnvironment: null,
    });
  });

  it("fails closed for mixed fresh hosted inputs when any reply target is null", async () => {
    const routedEvent = {
      conversation: {
        accountId: "identity_synthetic_null_mixed_route",
        actorId: "participant_synthetic_null_mixed_route",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_synthetic_null_mixed_route",
        threadIsDirect: true,
      },
      replyTarget: {
        channel: "linq",
        messageId: "message_synthetic_null_mixed_route",
        threadId: "chat_synthetic_null_mixed_route",
      },
    };
    const contextOnlyEvent = {
      conversation: {
        accountId: "identity_synthetic_null_mixed_route",
        actorId: "participant_synthetic_null_mixed_route",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_synthetic_null_mixed_route",
        threadIsDirect: true,
      },
      replyTarget: null,
    };
    mocks.readAssistantInputEvent
      .mockResolvedValueOnce(routedEvent)
      .mockResolvedValueOnce(contextOnlyEvent);
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [
        "ain_00000000000000000000000000000001",
        "ain_00000000000000000000000000000002",
      ],
      importedCount: 2,
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
  });

  it("routes accepted group inputs through the production operation scope to the supported access surface", async () => {
    const inputIds = {
      imessage: "ain_10101010101010101010101010101010",
      mixedRcs: "ain_20202020202020202020202020202020",
      mixedSms: "ain_30303030303030303030303030303030",
      sms: "ain_40404040404040404040404040404040",
      telegram: "ain_50505050505050505050505050505050",
    } as const;
    const syntheticGroup: HostedRuntimeGroupSummary = {
      displayName: null,
      id: "synthetic_group",
      kind: "friends",
      memberCount: 0,
      members: [],
      requestedVaultShareProjectionKinds: ["steps-days.v0"],
      requestedVaultShareProjectionScopes: [
        { projectionKind: "steps-days.v0" },
      ],
      status: "active",
    };
    const groupToolRequests: HostedRuntimeGroupToolRequest[] = [];
    const groupToolPort: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    > = {
      async request(request) {
        groupToolRequests.push(request);
        if (request.action === "post_join_offer") {
          return "linqThread" in request
            ? {
                action: "post_join_offer" as const,
                result: {
                  group: syntheticGroup,
                  joinUrl: "https://example.test/private-native-url",
                  status: "sent" as const,
                },
              }
            : {
                action: "post_join_offer" as const,
                result: {
                  group: null,
                  status: "unavailable" as const,
                  unavailableReason: "linq_thread_unavailable",
                },
              };
        }
        if (request.action === "create_join_link") {
          return {
            action: "create_join_link" as const,
            result: {
              group: syntheticGroup,
              joinUrl: "https://example.test/groups/join/exact",
              status: "ok" as const,
            },
          };
        }
        throw new Error(`Unexpected group tool request: ${request.action}`);
      },
    };
    const buildGroupEvent = (input: {
      channel: "linq" | "telegram";
      service?: string;
      threadId: string;
    }) => ({
      conversation: {
        accountId: `${input.channel}_identity`,
        actorId: `${input.channel}_participant`,
        actorIsSelf: false,
        source: input.channel,
        threadId: input.threadId,
        threadIsDirect: false,
      },
      replyTarget: {
        channel: input.channel,
        messageId: `${input.threadId}_message`,
        threadId: input.threadId,
      },
      sourceMetadata: input.channel === "linq"
        ? {
            externalThreadRouteAuthorityPresent: true,
            kind: "linq" as const,
            partCount: 0,
            reactionEligible: false,
            replyToMessageId: null,
            senderHandle: "+15555550123",
            service: input.service ?? null,
          }
        : {
            externalThreadRouteAuthorityPresent: true,
            kind: "telegram" as const,
            mediaGroupId: null,
            replyContext: null,
            senderHandle: "1234567890",
            senderUsername: "example_user",
          },
    });
    mocks.readAssistantInputEvent.mockImplementation(async ({ inputId }) => {
      if (inputId === inputIds.imessage) {
        return buildGroupEvent({
          channel: "linq",
          service: "iMessage",
          threadId: "imessage_group_chat",
        });
      }
      if (inputId === inputIds.sms) {
        return buildGroupEvent({
          channel: "linq",
          service: "SMS",
          threadId: "sms_group_chat",
        });
      }
      if (inputId === inputIds.telegram) {
        return buildGroupEvent({
          channel: "telegram",
          threadId: "telegram_group_chat",
        });
      }
      return buildGroupEvent({
        channel: "linq",
        service: inputId === inputIds.mixedSms ? "SMS" : "RCS",
        threadId: "mixed_group_chat",
      });
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: Object.values(inputIds),
      importedCount: Object.values(inputIds).length,
      runtimeGroupToolPort: groupToolPort,
    }));
    const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const operationScope = laneInput?.operationScope as
      | AssistantAutomationOperationScope
      | undefined;
    if (!laneInput?.executionContext || !operationScope) {
      throw new Error("Expected hosted automation operation scope.");
    }
    const offer = {
      action: "post_join_offer" as const,
      joinOffer: { projectionKinds: ["steps-days.v0" as const] },
    };
    const runOffer = async (
      ids: readonly string[],
      request: Extract<HostedRuntimeGroupToolRequest, {
        action: "post_join_offer";
      }> = offer,
    ) =>
      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: ids,
        operation: async (executionContext) =>
          await executionContext.hosted?.groupTool?.request(request),
        turnEnvironment: null,
      });

    await expect(runOffer([inputIds.imessage])).resolves.toMatchObject({
      action: "post_join_offer",
      result: { status: "sent" },
    });
    await expect(runOffer([inputIds.sms])).resolves.toMatchObject({
      action: "create_join_link",
      result: {
        joinUrl: "https://example.test/groups/join/exact",
        status: "ok",
      },
    });
    await expect(runOffer([inputIds.telegram])).resolves.toMatchObject({
      action: "create_join_link",
      result: {
        joinUrl: "https://example.test/groups/join/exact",
        status: "ok",
      },
    });
    const emptyOffer = {
      action: "post_join_offer" as const,
      joinOffer: { projectionScopes: [] },
    };
    await expect(runOffer([inputIds.sms], emptyOffer)).resolves.toMatchObject({
      action: "create_join_link",
      result: { status: "ok" },
    });
    await expect(runOffer([inputIds.telegram], emptyOffer)).resolves.toMatchObject({
      action: "create_join_link",
      result: { status: "ok" },
    });
    await expect(runOffer([inputIds.mixedSms, inputIds.mixedRcs]))
      .resolves.toMatchObject({
        action: "post_join_offer",
        result: { status: "unavailable" },
      });

    expect(groupToolRequests).toEqual([
      expect.objectContaining({
        action: "post_join_offer",
        linqThread: expect.objectContaining({ chatId: "imessage_group_chat" }),
      }),
      {
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionKinds: ["steps-days.v0"] },
      },
      {
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionKinds: ["steps-days.v0"] },
      },
      {
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionScopes: [] },
      },
      {
        action: "create_join_link",
        joinLink: { requestedVaultShareProjectionScopes: [] },
      },
      offer,
    ]);
  });

  it("carries persisted direct Linq service through the real operation scope to referral tools", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-referral-service-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const referralRequests: HostedRuntimeGroupToolRequest[] = [];
    const groupToolPort: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    > = {
      async request(request) {
        referralRequests.push(request);
        if (request.action === "read_usage_referral") {
          return {
            action: request.action,
            result: {
              referral: null,
              status: "unavailable" as const,
              unavailableReason: "synthetic_web_unavailable",
            },
          };
        }
        if (request.action === "arm_usage_referral") {
          return {
            action: request.action,
            result: {
              referral: null,
              status: "unavailable" as const,
              unavailableReason: "synthetic_web_unavailable",
            },
          };
        }
        throw new Error(`Unexpected group tool request: ${request.action}`);
      },
    };
    const serviceCases = [
      { expected: "imessage", observed: "iMessage" },
      { expected: "sms", observed: "SMS" },
      { expected: "rcs", observed: "RCS" },
      { expected: null, observed: null },
    ] as const;

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      const persistedInputs = await Promise.all(serviceCases.map(async (serviceCase, index) =>
        await upsertAssistantInputEvent({
          event: {
            content: {
              text: `direct referral service ${index}`,
              transcriptText: `direct referral service ${index}`,
              userMessageContent: [{
                text: `direct referral service ${index}`,
                type: "text" as const,
              }],
            },
            conversation: {
              accountId: `hid_${"1".repeat(32)}`,
              actorId: `hid_${"2".repeat(32)}`,
              actorIsSelf: false,
              source: "linq",
              threadId: `hid_${"3".repeat(32)}`,
              threadIsDirect: true,
            },
            occurredAt: `2026-04-27T00:00:0${index}.000Z`,
            receivedAt: `2026-04-27T00:00:0${index}.500Z`,
            replyTarget: {
              channel: "linq",
              messageId: `message_direct_referral_${index}`,
              threadId: "chat_direct_referral",
            },
            sourceMetadata: {
              externalThreadRouteAuthorityPresent: false,
              kind: "linq" as const,
              partCount: 0,
              reactionEligible: false,
              replyToMessageId: null,
              senderHandle: "+15555550123",
              service: serviceCase.observed,
            },
            sourceRef: {
              dedupeKey: `dedupe_direct_referral_${index}`,
              eventId: `event_direct_referral_${index}`,
              itemId: `mailbox_item_direct_referral_${index}`,
              kind: "hosted-mailbox" as const,
              lane: "conversation" as const,
              laneSeq: String(index),
              payloadSchema: "murph.hosted-mailbox-payload.v1",
              payloadSource: "inline" as const,
              source: "hosted-mailbox" as const,
              wakeSchema: "murph.hosted-execution-wake.v1",
            },
          },
          vault: vaultRoot,
        })
      ));
      const assistantAutomation = await vi.importActual<
        typeof import("@murphai/assistant-engine/assistant-automation")
      >("@murphai/assistant-engine/assistant-automation");
      mocks.readAssistantInputEvent.mockImplementation(
        assistantAutomation.readAssistantInputEvent,
      );

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: persistedInputs.map((persisted) => persisted.inputId),
        importedCount: persistedInputs.length,
        runtimeGroupToolPort: groupToolPort,
        vaultRoot,
      }));

      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      for (const [index, persisted] of persistedInputs.entries()) {
        const requestCountBefore = referralRequests.length;
        await operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [persisted.inputId],
          operation: async (executionContext) => {
            const groupTool = executionContext.hosted?.groupTool;
            if (!groupTool) {
              throw new Error("Expected operation-scoped group tool.");
            }
            await groupTool.request({ action: "read_usage_referral" });
            await groupTool.request({
              action: "arm_usage_referral",
              policyCodes: ["new_person_activation_v1"],
            });
          },
          turnEnvironment: null,
        });

        const expectedService = serviceCases[index]?.expected ?? null;
        const expectedSourceConversation = {
          channel: "linq" as const,
          ...(expectedService ? { linqService: expectedService } : {}),
          threadId: expect.stringMatching(/^hid_[a-f0-9]{32}$/u),
          threadIsDirect: true,
        };
        expect(referralRequests.slice(requestCountBefore)).toEqual([
          {
            action: "read_usage_referral",
            sourceConversation: expectedSourceConversation,
          },
          {
            action: "arm_usage_referral",
            policyCodes: ["new_person_activation_v1"],
            sourceConversation: expectedSourceConversation,
          },
        ]);
      }

      const requestCountBeforeMixed = referralRequests.length;
      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: persistedInputs.slice(0, 2).map((persisted) => persisted.inputId),
        operation: async (executionContext) => {
          await executionContext.hosted?.groupTool?.request({
            action: "read_usage_referral",
          });
        },
        turnEnvironment: null,
      });
      expect(referralRequests.slice(requestCountBeforeMixed)).toEqual([{
        action: "read_usage_referral",
        sourceConversation: {
          channel: "linq",
          threadId: expect.stringMatching(/^hid_[a-f0-9]{32}$/u),
          threadIsDirect: true,
        },
      }]);
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("binds a persisted direct iMessage route to generated contact cards through the real operation scope", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-contact-card-route-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const contactCardRequests: HostedRuntimeGroupToolRequest[] = [];
    const contactCardImageUrl =
      `https://murph-hosted.cobuildwithus.workers.dev/private-media/v1/v1.${"a".repeat(16)}.${"b".repeat(32)}/contact-card.jpg?exp=2000000000`;
    const groupToolPort: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    > = {
      async request(request) {
        contactCardRequests.push(request);
        if (request.action === "share_contact_card") {
          return {
            action: "share_contact_card" as const,
            result: { status: "sent" as const },
          };
        }
        throw new Error(`Unexpected group tool request: ${request.action}`);
      },
    };
    const buildContactCardEvent = (input: {
      index: number;
      threadIsDirect: boolean;
    }) => ({
      content: {
        text: `contact card request ${input.index}`,
        transcriptText: `contact card request ${input.index}`,
        userMessageContent: [{
          text: `contact card request ${input.index}`,
          type: "text" as const,
        }],
      },
      conversation: {
        accountId: `hid_${"1".repeat(32)}`,
        actorId: `hid_${"2".repeat(32)}`,
        actorIsSelf: false,
        source: "linq",
        threadId: `hid_${"3".repeat(32)}`,
        threadIsDirect: input.threadIsDirect,
      },
      occurredAt: `2026-04-27T00:00:0${input.index}.000Z`,
      receivedAt: `2026-04-27T00:00:0${input.index}.500Z`,
      replyTarget: {
        channel: "linq",
        messageId: `message_contact_card_${input.index}`,
        threadId: input.threadIsDirect
          ? "chat_direct_contact_card"
          : "chat_group_contact_card",
      },
      sourceMetadata: {
        // An ordinary direct wake carries no external thread-route authority:
        // its route lives in the member's own routing record. A group wake
        // does. This is the exact shape the production webhook persists.
        externalThreadRouteAuthorityPresent: !input.threadIsDirect,
        kind: "linq" as const,
        partCount: 0,
        reactionEligible: false,
        replyToMessageId: null,
        senderHandle: "+15555550123",
        service: "iMessage",
      },
      sourceRef: {
        dedupeKey: `dedupe_contact_card_${input.index}`,
        eventId: `event_contact_card_${input.index}`,
        itemId: `mailbox_item_contact_card_${input.index}`,
        kind: "hosted-mailbox" as const,
        lane: "conversation" as const,
        laneSeq: String(input.index),
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        payloadSource: "inline" as const,
        source: "hosted-mailbox" as const,
        wakeSchema: "murph.hosted-execution-wake.v1",
      },
    });

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      const directInput = await upsertAssistantInputEvent({
        event: buildContactCardEvent({ index: 0, threadIsDirect: true }),
        vault: vaultRoot,
      });
      const groupInput = await upsertAssistantInputEvent({
        event: buildContactCardEvent({ index: 1, threadIsDirect: false }),
        vault: vaultRoot,
      });
      const assistantAutomation = await vi.importActual<
        typeof import("@murphai/assistant-engine/assistant-automation")
      >("@murphai/assistant-engine/assistant-automation");
      mocks.readAssistantInputEvent.mockImplementation(
        assistantAutomation.readAssistantInputEvent,
      );

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [directInput.inputId, groupInput.inputId],
        importedCount: 2,
        runtimeGroupToolPort: groupToolPort,
        vaultRoot,
      }));

      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      const routeStatuses: unknown[] = [];
      const runShare = async (inputId: string) =>
        await operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext) => {
            const groupTool = executionContext.hosted?.groupTool;
            if (!groupTool) {
              throw new Error("Expected operation-scoped group tool.");
            }
            routeStatuses.push(groupTool.directAttachmentRouteStatus?.());
            return await groupTool.request({
              action: "share_contact_card",
              contactCardImageUrl,
              contactCardShareKey: inputId,
            });
          },
          turnEnvironment: null,
        });

      await expect(runShare(directInput.inputId)).resolves.toMatchObject({
        action: "share_contact_card",
        result: { status: "sent" },
      });
      // A group input must not read as a direct attachment route or
      // forward a partial personalized transport request.
      await expect(runShare(groupInput.inputId)).resolves.toEqual({
        action: "share_contact_card",
        result: {
          status: "unavailable",
          unavailableReason: "direct_attachment_route_unavailable",
        },
      });

      expect(routeStatuses).toEqual([
        { status: "ok" },
        {
          status: "unavailable",
          unavailableReason: "direct_attachment_route_unavailable",
        },
      ]);
      expect(contactCardRequests).toEqual([
        // The trusted host's exact direct chat, carried without any group
        // thread-route authority, which a direct home chat cannot have.
        {
          action: "share_contact_card",
          contactCardImageUrl,
          contactCardShareKey: directInput.inputId,
          directLinqChatId: "chat_direct_contact_card",
        },
      ]);
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("scopes automation and group mutation authority to each durable accepted input", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-automation-tool-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const emailInputId = "ain_00000000000000000000000000000001";
    const linqInputId = "ain_00000000000000000000000000000002";
    const telegramInputId = "ain_00000000000000000000000000000003";
    const groupRequestMock = vi.fn(async (request: HostedRuntimeGroupToolRequest) =>
      request.action === "read_shared"
        ? {
            action: request.action,
            result: {
              members: [] as const,
              requestedProjectionScopeKeys: ["steps-days.v0"] as const,
              status: "none" as const,
            },
          }
        : {
            action: "update_display_name" as const,
            result: {
              group: null,
              status: "unavailable" as const,
              unavailableReason: "test_backend_unavailable",
            },
          });
    const groupRequest: NonNullable<
      HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
    >["request"] = groupRequestMock;
    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockImplementation(async ({ inputId }) => {
        if (inputId === emailInputId) {
          return {
              conversation: {
                accountId: "email_identity",
                actorId: null,
                actorIsSelf: false,
                source: "email",
                threadId: "email_thread",
                threadIsDirect: false,
              },
              replyTarget: {
                channel: "email",
                messageId: "email_message",
                threadId: "email_delivery_thread",
              },
            };
        }
        if (inputId === telegramInputId) {
          return {
            conversation: {
              accountId: "telegram_identity",
              actorId: "telegram_participant",
              actorIsSelf: false,
              source: "telegram",
              threadId: "telegram_group_thread",
              threadIsDirect: false,
            },
            replyTarget: {
              channel: "telegram",
              messageId: "telegram_message",
              threadId: "telegram_group_chat",
            },
            sourceMetadata: {
              externalThreadRouteAuthorityPresent: true,
              kind: "telegram",
              mediaGroupId: null,
              replyContext: null,
              senderHandle: "1234567890",
              senderUsername: "alice_example",
            },
          };
        }
        return {
              conversation: {
                accountId: "linq_identity",
                actorId: "linq_participant",
                actorIsSelf: false,
                source: "linq",
                threadId: "linq_thread",
                threadIsDirect: false,
              },
              replyTarget: {
                channel: "linq",
                messageId: "linq_message",
                threadId: "linq_group_chat",
              },
              sourceMetadata: {
                externalThreadRouteAuthorityPresent: true,
                kind: "linq",
                partCount: 0,
                reactionEligible: false,
                replyToMessageId: null,
                senderHandle: "+15555550123",
                service: "imessage",
              },
            };
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [emailInputId, linqInputId, telegramInputId],
        importedCount: 3,
        runtimeGroupToolPort: { request: groupRequest },
        vaultRoot,
      }));

      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      const emailResult = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [emailInputId],
        operation: async (executionContext, turnEnvironment) => {
          expect(turnEnvironment?.env).toEqual({ BASE_ENV: "preserved" });
          expect(executionContext.hosted?.automationTool).toBeUndefined();
          expect(executionContext.hosted?.groupSharedReader).toEqual(
            expect.objectContaining({ request: expect.any(Function) }),
          );
          return await executionContext.hosted?.groupTool?.request({
            action: "update_display_name",
            updateDisplayName: { displayName: "Email cannot rename" },
          });
        },
        turnEnvironment: { env: { BASE_ENV: "preserved" } },
      });
      expect(emailResult).toEqual({
        action: "update_display_name",
        result: {
          group: null,
          status: "unavailable",
          unavailableReason: "authenticated_sender_required",
        },
      });
      expect(groupRequestMock).not.toHaveBeenCalled();

      const linqResult = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [linqInputId],
        operation: async (executionContext, turnEnvironment) => {
          expect(turnEnvironment?.env).toEqual({ BASE_ENV: "preserved" });
          expect(executionContext.hosted?.groupSharedReader).toEqual(
            expect.objectContaining({ request: expect.any(Function) }),
          );
          await expect(executionContext.hosted?.groupSharedReader?.request({
            projectionScopes: [{ projectionKind: "steps-days.v0" }],
          })).resolves.toMatchObject({ status: "none" });
          const saved = await executionContext.hosted?.automationTool?.request({
            action: "save",
            activeUntil: "2099-08-01T00:00:00.000Z",
            contextReferences: [
              { entityId: "wfmt_group_check_in", entityKind: "workout_format" },
              { entityId: "exp_group_check_in", entityKind: "experiment" },
            ],
            instructions: "Ask for one lightweight group check-in.",
            schedule: {
              kind: "dailyLocal",
              localTime: "21:00",
              timeZone: "America/Chicago",
            },
            slug: "group-check-in",
            supportKind: "check_in",
            supportSeriesId: "habit:group-check-in",
            title: "Group check-in",
          });
          if (!saved || saved.action !== "save") {
            throw new Error("Expected saved automation.");
          }
          const newsletter = await executionContext.hosted?.automationTool?.request({
            action: "save",
            continuityPolicy: "fresh",
            instructions: [
              "Read and follow the group-newsletter skill before every execution.",
              "Delivery: current_chat",
              "Health scopes: steps-days.v0, sleep-duration-days.v0",
              "Tone: supportive",
            ].join("\n"),
            schedule: { expression: "0 13 * * 1", kind: "cron" },
            slug: "group-health-newsletter",
            title: "Family weekly health newsletter",
          });
          if (!newsletter || newsletter.action !== "save") {
            throw new Error("Expected saved group newsletter.");
          }
          await expect(executionContext.hosted?.automationTool?.request({
            action: "save",
            automationId: newsletter.automationId,
            instructions: "Replace the group newsletter with free-form instructions.",
            schedule: { expression: "0 13 * * 1", kind: "cron" },
            title: "Family weekly health newsletter",
          })).rejects.toMatchObject({ code: "VAULT_AUTOMATION_CONFLICT" });
          await expect(executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Replace the group newsletter by slug.",
            schedule: { expression: "0 13 * * 1", kind: "cron" },
            slug: "group-health-newsletter",
            title: "Family weekly health newsletter",
          })).rejects.toMatchObject({ code: "VAULT_AUTOMATION_CONFLICT" });
          const rescheduledNewsletter = await executionContext.hosted?.automationTool?.request({
            action: "patch",
            expectedUpdatedAt: newsletter.updatedAt,
            lookup: "group-health-newsletter",
            schedule: { expression: "0 14 * * 1", kind: "cron" },
          });
          expect(rescheduledNewsletter).toMatchObject({
            action: "patch",
            routeBinding: "preserved",
          });
          if (!rescheduledNewsletter || rescheduledNewsletter.action !== "patch") {
            throw new Error("Expected rescheduled group newsletter.");
          }
          await expect(executionContext.hosted?.automationTool?.request({
            action: "patch",
            expectedUpdatedAt: rescheduledNewsletter.updatedAt,
            lookup: "group-health-newsletter",
            status: "paused",
          })).resolves.toEqual(expect.objectContaining({
            action: "patch",
            routeBinding: "preserved",
            status: "paused",
          }));
          const stale = await executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Archive this stale group check-in.",
            schedule: { kind: "dailyLocal", localTime: "08:45" },
            slug: "stale-group-check-in",
            supportKind: "check_in",
            supportSeriesId: "habit:group-check-in",
            title: "Stale group check-in",
          });
          const paused = await executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Keep this user-paused group check-in paused.",
            schedule: { kind: "dailyLocal", localTime: "09:00" },
            slug: "paused-group-check-in",
            status: "paused",
            supportKind: "check_in",
            supportSeriesId: "habit:group-check-in",
            title: "Paused group check-in",
          });
          const otherSeries = await executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "Keep this separate support series active.",
            schedule: { kind: "dailyLocal", localTime: "09:15" },
            slug: "other-group-check-in",
            supportKind: "check_in",
            supportSeriesId: "habit:other-group-check-in",
            title: "Other group check-in",
          });
          if (
            stale?.action !== "save"
            || paused?.action !== "save"
            || otherSeries?.action !== "save"
          ) {
            throw new Error("Expected support-series fixture automations.");
          }
          await expect(executionContext.hosted?.automationTool?.request({
            action: "reconcile",
            desiredAutomationIds: [saved.automationId],
            supportSeriesId: "habit:group-check-in",
          })).resolves.toEqual({
            action: "reconcile",
            archivedCount: 1,
            matchedCount: 3,
            missingDesiredAutomationIds: [],
            supportSeriesId: "habit:group-check-in",
            unchangedCount: 2,
          });
          await expect(executionContext.hosted?.automationTool?.request({
            action: "save",
            instructions: "This request must fail before persistence.",
            schedule: { kind: "dailyLocal", localTime: "08:30" },
            tags: ["system:support-series:habit:model-controlled"],
            title: "Invalid support tag",
          })).rejects.toThrow(
            "Reserved automation support tags must be set through supportSeriesId.",
          );
          await executionContext.hosted?.groupTool?.request({
            action: "update_display_name",
            updateDisplayName: { displayName: "Linq can rename" },
          });
          return saved;
        },
        turnEnvironment: { env: { BASE_ENV: "preserved" } },
      });
      expect(linqResult).toEqual(expect.objectContaining({
        action: "save",
        created: true,
        contextReferences: [
          { entityId: "wfmt_group_check_in", entityKind: "workout_format" },
          { entityId: "exp_group_check_in", entityKind: "experiment" },
        ],
        effectiveTimeZone: "America/Chicago",
        lookupId: "group-check-in",
        nextOccurrenceAt: expect.any(String),
        routeBinding: "current_conversation",
        schedule: {
          kind: "dailyLocal",
          localTime: "21:00",
          timeZone: "America/Chicago",
        },
        status: "active",
        timingVerified: true,
      }));
      const telegramResult = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [telegramInputId],
        operation: async (executionContext) => {
          // Telegram group evidence must survive operation-scope
          // reconstruction and reach Web channel-qualified.
          await executionContext.hosted?.groupTool?.request({
            action: "read_shared",
            projectionScopes: [{ projectionKind: "steps-days.v0" }],
          });
          const current = await showAutomation({
            slug: "group-health-newsletter",
            vaultRoot,
          });
          if (!current) {
            throw new Error("Expected current group newsletter.");
          }
          return await executionContext.hosted?.automationTool?.request({
            action: "patch",
            expectedUpdatedAt: current.updatedAt,
            lookup: "group-health-newsletter",
            retargetToCurrentConversation: true,
            title: "Telegram group health newsletter",
          });
        },
        turnEnvironment: null,
      });
      expect(groupRequestMock).toHaveBeenCalledWith({
        action: "read_shared",
        telegramSenderHandles: ["1234567890"],
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      expect(telegramResult).toEqual(expect.objectContaining({
        action: "patch",
        created: false,
        lookupId: "group-health-newsletter",
        routeBinding: "current_conversation",
        status: "paused",
      }));
      expect(groupRequestMock).toHaveBeenCalledWith({
        action: "read_shared",
        linqSenderHandles: ["+15555550123"],
        projectionScopes: [{ projectionKind: "steps-days.v0" }],
      });
      expect(groupRequestMock).toHaveBeenCalledWith({
        action: "update_display_name",
        updateDisplayName: { displayName: "Linq can rename" },
        linqThread: {
          authority: {
            channel: "linq",
            containerMemberId: "member_synthetic_phase",
            threadId: "linq_group_chat",
          },
          chatId: "linq_group_chat",
        },
      });
      await expect(showAutomation({
        slug: "group-check-in",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        activeUntil: "2099-08-01T00:00:00.000Z",
        contextReferences: [
          { entityId: "wfmt_group_check_in", entityKind: "workout_format" },
          { entityId: "exp_group_check_in", entityKind: "experiment" },
        ],
        route: expect.objectContaining({
          channel: "linq",
          deliveryTarget: "linq_group_chat",
          threadIsDirect: false,
        }),
        supportKind: "check_in",
        schedule: {
          kind: "dailyLocal",
          localTime: "21:00",
          timeZone: "America/Chicago",
        },
        tags: expect.arrayContaining([
          "system:support-series:habit:group-check-in",
        ]),
      }));
      await expect(showAutomation({
        slug: "group-health-newsletter",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        continuityPolicy: "fresh",
        route: expect.objectContaining({
          channel: "telegram",
          deliveryTarget: "telegram_group_chat",
          threadIsDirect: false,
        }),
        instructions: expect.stringContaining("group-newsletter skill"),
        status: "paused",
      }));
      await expect(showAutomation({
        slug: "stale-group-check-in",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({ status: "archived" }));
      await expect(showAutomation({
        slug: "paused-group-check-in",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({ status: "paused" }));
      await expect(showAutomation({
        slug: "other-group-check-in",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({ status: "active" }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("returns the scheduler's exact future occurrence after reactivation and schedule revision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-automation-timing-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const inputId = "ain_44444444444444444444444444444444";

    try {
      await initializeVault({
        createdAt: "2026-08-01T12:00:00.000Z",
        timezone: "America/New_York",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockResolvedValue({
        conversation: {
          accountId: "linq_identity_timing",
          actorId: "linq_participant_timing",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_thread_timing",
          threadIsDirect: true,
        },
        replyTarget: {
          channel: "linq",
          messageId: "linq_message_timing",
          threadId: "linq_chat_timing",
        },
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [inputId],
        importedCount: 1,
        vaultRoot,
      }));
      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      const requestAutomation = async (
        request: Parameters<
          NonNullable<
            NonNullable<AssistantExecutionContext["hosted"]>["automationTool"]
          >["request"]
        >[0],
      ) => await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request(request);
        },
        turnEnvironment: null,
      });

      const nextWorkout = await requestAutomation({
        action: "save",
        instructions: "Ask how the next workout felt.",
        schedule: {
          activityKind: "workout",
          after: "2026-08-01T12:00:00.000Z",
          kind: "deviceActivity",
          source: "whoop",
        },
        slug: "next-workout-check-in",
        title: "Next workout check-in",
      });
      if (nextWorkout.action !== "save") {
        throw new Error("Expected next-workout save result.");
      }
      expect(nextWorkout).toEqual(expect.objectContaining({
        effectiveTimeZone: null,
        nextOccurrenceAt: null,
        schedule: {
          activityKind: "workout",
          after: "2026-08-01T12:00:00.000Z",
          kind: "deviceActivity",
          source: "whoop",
        },
        status: "active",
        timingVerified: true,
      }));
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: nextWorkout.updatedAt,
        instructions: "Ask briefly how the next workout felt.",
        lookup: "next-workout-check-in",
      })).resolves.toEqual(expect.objectContaining({
        nextOccurrenceAt: null,
        schedule: expect.objectContaining({ kind: "deviceActivity" }),
        status: "active",
        timingVerified: true,
      }));

      const dailyEveningReminder = await requestAutomation({
        action: "save",
        instructions: "Send the daily evening reminder.",
        schedule: {
          kind: "dailyLocal",
          localTime: "21:00",
          timeZone: "America/Chicago",
        },
        slug: "daily-evening-reminder",
        status: "paused",
        title: "Daily evening reminder",
      });
      if (dailyEveningReminder.action !== "save") {
        throw new Error("Expected daily reminder save result.");
      }
      expect(dailyEveningReminder).toEqual(expect.objectContaining({
        nextOccurrenceAt: null,
        status: "paused",
        timingVerified: true,
      }));

      const oneTimeEveningReminder = await requestAutomation({
        action: "save",
        instructions: "Send the one-time evening reminder.",
        schedule: {
          at: "2026-08-01T13:00:00.000Z",
          kind: "at",
        },
        slug: "one-time-evening-reminder",
        status: "paused",
        title: "One-time evening reminder",
      });
      if (oneTimeEveningReminder.action !== "save") {
        throw new Error("Expected one-time reminder save result.");
      }
      expect(oneTimeEveningReminder).toEqual(expect.objectContaining({
        nextOccurrenceAt: null,
        status: "paused",
        timingVerified: true,
      }));

      const finiteOneTimeReminder = await requestAutomation({
        action: "save",
        activeUntil: "2026-08-01T12:45:00.000Z",
        instructions: "Send the finite one-time reminder.",
        schedule: {
          at: "2026-08-01T12:30:00.000Z",
          kind: "at",
        },
        slug: "finite-one-time-reminder",
        status: "paused",
        title: "Finite one-time reminder",
      });
      if (finiteOneTimeReminder.action !== "save") {
        throw new Error("Expected finite reminder save result.");
      }
      expect(finiteOneTimeReminder).toEqual(expect.objectContaining({
        nextOccurrenceAt: null,
        status: "paused",
        timingVerified: true,
      }));

      const recurringIntervalReminder = await requestAutomation({
        action: "save",
        instructions: "Send the recurring interval reminder.",
        schedule: {
          everyMs: 86_400_000,
          kind: "every",
        },
        slug: "recurring-interval-reminder",
        title: "Recurring interval reminder",
      });
      if (recurringIntervalReminder.action !== "save") {
        throw new Error("Expected recurring reminder save result.");
      }
      expect(recurringIntervalReminder).toEqual(expect.objectContaining({
        nextOccurrenceAt: "2026-08-02T12:00:00.000Z",
        status: "active",
        timingVerified: true,
      }));

      vi.setSystemTime(new Date("2026-08-01T13:00:00.000Z"));
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: finiteOneTimeReminder.updatedAt,
        lookup: "finite-one-time-reminder",
        status: "active",
      })).resolves.toEqual(expect.objectContaining({
        nextOccurrenceAt: null,
        status: "active",
        timingVerified: true,
      }));

      vi.setSystemTime(new Date("2026-08-10T00:27:19.000Z"));
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: recurringIntervalReminder.updatedAt,
        instructions: "Send the revised recurring interval reminder.",
        lookup: "recurring-interval-reminder",
      })).resolves.toEqual(expect.objectContaining({
        nextOccurrenceAt: null,
        schedule: {
          everyMs: 86_400_000,
          kind: "every",
        },
        status: "active",
        timingVerified: false,
        timingVerificationIssues: ["stale_recurring_occurrence"],
      }));
      await expect(requestAutomation({
        action: "patch",
        expectedUpdatedAt: oneTimeEveningReminder.updatedAt,
        lookup: "one-time-evening-reminder",
        status: "active",
      })).resolves.toEqual(expect.objectContaining({
        nextOccurrenceAt: null,
        schedule: {
          at: "2026-08-01T13:00:00.000Z",
          kind: "at",
        },
        status: "active",
        timingVerified: true,
      }));
      const dailyReactivated = await requestAutomation({
        action: "patch",
        expectedUpdatedAt: dailyEveningReminder.updatedAt,
        lookup: "daily-evening-reminder",
        status: "active",
      });
      if (dailyReactivated.action !== "patch") {
        throw new Error("Expected daily reminder patch result.");
      }
      expect(dailyReactivated).toEqual(expect.objectContaining({
        effectiveTimeZone: "America/Chicago",
        nextOccurrenceAt: "2026-08-10T02:00:00.000Z",
        timingVerified: true,
      }));
      await expect(getAssistantCronJob(
        vaultRoot,
        "daily-evening-reminder",
      )).resolves.toMatchObject({
        state: { nextRunAt: "2026-08-10T02:00:00.000Z" },
      });

      vi.setSystemTime(new Date("2026-08-10T00:28:19.000Z"));
      const dailyRevised = await requestAutomation({
        action: "patch",
        expectedUpdatedAt: dailyReactivated.updatedAt,
        lookup: "daily-evening-reminder",
        schedule: {
          kind: "dailyLocal",
          localTime: "22:00",
          timeZone: "America/Chicago",
        },
      });
      if (dailyRevised.action !== "patch") {
        throw new Error("Expected daily revised patch result.");
      }
      expect(dailyRevised).toEqual(expect.objectContaining({
        nextOccurrenceAt: "2026-08-10T03:00:00.000Z",
        schedule: {
          kind: "dailyLocal",
          localTime: "22:00",
          timeZone: "America/Chicago",
        },
        timingVerified: true,
      }));
      await expect(getAssistantCronJob(
        vaultRoot,
        "daily-evening-reminder",
      )).resolves.toMatchObject({
        state: { nextRunAt: "2026-08-10T03:00:00.000Z" },
      });

      const beforeInspect = await showAutomation({
        slug: "daily-evening-reminder",
        vaultRoot,
      });
      if (!beforeInspect) {
        throw new Error("Expected daily reminder before inspection.");
      }
      const recordPath = path.join(vaultRoot, beforeInspect.relativePath);
      const recordBytesBeforeInspect = await readFile(recordPath, "utf8");
      await expect(requestAutomation({
        action: "inspect",
        lookup: "daily-evening-reminder",
      })).resolves.toEqual({
        action: "inspect",
        automationId: beforeInspect.automationId,
        contextReferences: [],
        effectiveTimeZone: "America/Chicago",
        lookupId: "daily-evening-reminder",
        nextOccurrenceAt: "2026-08-10T03:00:00.000Z",
        routeBinding: "preserved",
        schedule: {
          kind: "dailyLocal",
          localTime: "22:00",
          timeZone: "America/Chicago",
        },
        status: "active",
        timingVerified: true,
        timingVerificationIssues: [],
        updatedAt: dailyRevised.updatedAt,
      });
      await expect(readFile(recordPath, "utf8")).resolves.toBe(
        recordBytesBeforeInspect,
      );
      await expect(showAutomation({
        slug: "daily-evening-reminder",
        vaultRoot,
      })).resolves.toEqual(beforeInspect);

      mocks.resolveAssistantCronDefaultTimeZoneProjection.mockResolvedValueOnce({
        timeZone: "America/New_York",
        vaultTimeZoneVerified: false,
      });
      const dailyPreservedTimeZone = await requestAutomation({
        action: "patch",
        expectedUpdatedAt: dailyRevised.updatedAt,
        lookup: "daily-evening-reminder",
        schedule: {
          kind: "dailyLocal",
          localTime: "23:00",
        },
      });
      if (dailyPreservedTimeZone.action !== "patch") {
        throw new Error("Expected daily preserved-timezone patch result.");
      }
      expect(dailyPreservedTimeZone).toEqual(expect.objectContaining({
        action: "patch",
        effectiveTimeZone: "America/Chicago",
        nextOccurrenceAt: "2026-08-10T04:00:00.000Z",
        schedule: {
          kind: "dailyLocal",
          localTime: "23:00",
          timeZone: "America/Chicago",
        },
        timingVerified: true,
      }));

      await expect(requestAutomation({
        action: "patch",
        activeUntil: "2026-08-10T02:30:00.000Z",
        expectedUpdatedAt: dailyPreservedTimeZone.updatedAt,
        lookup: "daily-evening-reminder",
      })).resolves.toEqual(expect.objectContaining({
        action: "patch",
        nextOccurrenceAt: null,
        timingVerified: true,
      }));
      await expect(getAssistantCronJob(
        vaultRoot,
        "daily-evening-reminder",
      )).resolves.toMatchObject({
        state: { nextRunAt: "2026-08-10T02:30:00.000Z" },
      });
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("logs content-free timing verification failure and recovery details", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T01:00:00.000Z"));
    const parentRoot = await mkdtemp(path.join(
      tmpdir(),
      "hosted-automation-verification-telemetry-",
    ));
    const vaultRoot = path.join(parentRoot, "vault");
    const inputId = "ain_45454545454545454545454545454545";
    const logRequests: HostedRuntimeLogRequest[] = [];

    try {
      await initializeVault({
        createdAt: "2026-08-13T01:00:00.000Z",
        timezone: "America/New_York",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockResolvedValue({
        conversation: {
          accountId: "linq_identity_verification_telemetry",
          actorId: "linq_participant_verification_telemetry",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_thread_verification_telemetry",
          threadIsDirect: true,
        },
        replyTarget: {
          channel: "linq",
          messageId: "linq_message_verification_telemetry",
          threadId: "linq_chat_verification_telemetry",
        },
      });
      mocks.resolveAssistantCronDefaultTimeZoneProjection
        .mockResolvedValueOnce({
          timeZone: "America/New_York",
          vaultTimeZoneVerified: false,
        })
        .mockResolvedValue({
          timeZone: "America/New_York",
          vaultTimeZoneVerified: true,
        });
      mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
        await laneInput.operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext: AssistantExecutionContext) => {
            const automationTool = executionContext.hosted?.automationTool;
            if (!automationTool) {
              throw new Error("Expected scoped hosted automation tool.");
            }
            const recoveredProjectionCallsBefore =
              mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length;
            const saved = await automationTool.request({
              action: "save",
              instructions: "Send the synthetic private reminder payload.",
              schedule: {
                kind: "dailyLocal",
                localTime: "22:30",
              },
              slug: "synthetic-private-verification-reminder",
              title: "Synthetic private verification reminder",
            });
            expect(saved).toEqual(expect.objectContaining({
              timingVerified: true,
              timingVerificationIssues: [],
            }));
            expect(
              mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length
              - recoveredProjectionCallsBefore,
            ).toBe(2);

            mocks.resolveAssistantCronDefaultTimeZoneProjection.mockResolvedValue({
              timeZone: "America/New_York",
              vaultTimeZoneVerified: false,
            });
            const persistentProjectionCallsBefore =
              mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length;
            await expect(automationTool.request({
              action: "save",
              instructions: "Send another synthetic private reminder payload.",
              schedule: {
                kind: "dailyLocal",
                localTime: "23:30",
              },
              slug: "synthetic-private-persistent-verification-reminder",
              title: "Synthetic private persistent verification reminder",
            })).resolves.toEqual(expect.objectContaining({
              timingVerified: false,
              timingVerificationIssues: ["default_timezone_unverified"],
            }));
            expect(
              mocks.resolveAssistantCronDefaultTimeZoneProjection.mock.calls.length
              - persistentProjectionCallsBefore,
            ).toBe(2);

            mocks.resolveAssistantCronDefaultTimeZoneProjection
              .mockImplementationOnce(async () => {
                const current = await showAutomation({
                  slug: "synthetic-readback-mismatch-reminder",
                  vaultRoot,
                });
                if (!current) {
                  throw new Error("Expected the readback mismatch fixture.");
                }
                await patchAutomation({
                  expectedUpdatedAt: current.updatedAt,
                  lookup: current.automationId,
                  schedule: {
                    kind: "dailyLocal",
                    localTime: "08:45",
                  },
                  vaultRoot,
                });
                return {
                  timeZone: "America/New_York",
                  vaultTimeZoneVerified: false,
                };
              })
              .mockResolvedValue({
                timeZone: "America/New_York",
                vaultTimeZoneVerified: true,
              });
            await expect(automationTool.request({
              action: "save",
              instructions: "Send the original synthetic mismatch reminder.",
              schedule: {
                kind: "dailyLocal",
                localTime: "08:30",
              },
              slug: "synthetic-readback-mismatch-reminder",
              title: "Synthetic readback mismatch reminder",
            })).resolves.toEqual(expect.objectContaining({
              nextOccurrenceAt: null,
              timingVerified: false,
              timingVerificationIssues: expect.arrayContaining([
                "record_readback_mismatch",
              ]),
            }));

            mocks.resolveAssistantCronDefaultTimeZoneProjection
              .mockImplementationOnce(async () => {
                const current = await showAutomation({
                  slug: "synthetic-projection-failure-reminder",
                  vaultRoot,
                });
                if (!current) {
                  throw new Error("Expected the projection failure fixture.");
                }
                await rm(path.join(vaultRoot, current.relativePath));
                return {
                  timeZone: "America/New_York",
                  vaultTimeZoneVerified: true,
                };
              });
            await expect(automationTool.request({
              action: "save",
              instructions: "Send the synthetic projection failure reminder.",
              schedule: {
                kind: "dailyLocal",
                localTime: "07:30",
              },
              slug: "synthetic-projection-failure-reminder",
              title: "Synthetic projection failure reminder",
            })).resolves.toEqual(expect.objectContaining({
              nextOccurrenceAt: null,
              timingVerified: false,
              timingVerificationIssues: expect.arrayContaining([
                "projection_unavailable",
                "record_readback_mismatch",
              ]),
            }));
          },
          turnEnvironment: null,
        });
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [inputId],
        importedCount: 1,
        logRequests,
        vaultRoot,
      }));

      const verificationEntries = logRequests
        .flatMap((request) => request.entries)
        .filter((entry) =>
          entry.eventCode === "assistant.automation_detail"
          && entry.redactedJson?.schema
            === "murph.hosted-automation-timing-verification.v1"
        );
      expect(verificationEntries).toHaveLength(8);
      expect(verificationEntries[0]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "save",
          automationTimingVerificationIssues: ["default_timezone_unverified"],
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "initial",
          detailComponent: "automation.tool",
        }),
      }));
      expect(verificationEntries[1]).toEqual(expect.objectContaining({
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "save",
          automationTimingVerificationRecovered: true,
          automationTimingVerificationStage: "readback",
          detailComponent: "automation.tool",
        }),
      }));
      expect(verificationEntries[2]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "save",
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "initial",
        }),
      }));
      expect(verificationEntries[3]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationAction: "save",
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "readback",
        }),
      }));
      expect(verificationEntries[5]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationIssues: expect.arrayContaining([
            "record_readback_mismatch",
          ]),
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "readback",
        }),
      }));
      expect(verificationEntries[7]).toEqual(expect.objectContaining({
        errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED",
        level: "info",
        redactedJson: expect.objectContaining({
          automationTimingVerificationIssues: expect.arrayContaining([
            "projection_unavailable",
            "record_readback_mismatch",
          ]),
          automationTimingVerificationRecovered: false,
          automationTimingVerificationStage: "readback",
        }),
      }));
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-private-verification-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic private reminder payload",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "Synthetic private verification reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-private-persistent-verification-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "another synthetic private reminder payload",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "Synthetic private persistent verification reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-readback-mismatch-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "original synthetic mismatch reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "Synthetic readback mismatch reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain("08:45");
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic-projection-failure-reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "synthetic projection failure reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain(
        "Synthetic projection failure reminder",
      );
      expect(JSON.stringify(logRequests)).not.toContain("07:30");
      expect(() => logRequests.forEach(parseHostedRuntimeLogRequest)).not.toThrow();
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("reuses the production-scoped Linq speaker reader across ordinary warm turns", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "hosted-warm-speaker-cache-",
    ));
    try {
      const firstInputId = "ain_81818181818181818181818181818181";
      const secondInputId = "ain_82828282828282828282828282828282";
      const senderHandle = "+15558880001";
      const groupRequest = vi.fn(async (
        request: HostedRuntimeGroupToolRequest,
      ) => {
        if (request.action !== "read_participant_display_names") {
          throw new Error(`Unexpected group action: ${request.action}`);
        }
        return {
          action: "read_participant_display_names" as const,
          result: {
            participants: [{
              displayName: "Warm Speaker",
              displayNameSource: "profile-name" as const,
              senderHandle,
            }],
            status: "ok" as const,
          },
        };
      });
      mocks.readAssistantInputEvent.mockImplementation(async ({ inputId }) => ({
        conversation: {
          accountId: "linq_identity_warm_speaker",
          actorId: "linq_participant_warm_speaker",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_hidden_warm_speaker_thread",
          threadIsDirect: false,
        },
        replyTarget: {
          channel: "linq",
          messageId: inputId === firstInputId
            ? "linq_warm_speaker_message_one"
            : "linq_warm_speaker_message_two",
          threadId: "linq_warm_speaker_chat",
        },
        sourceMetadata: {
          externalThreadRouteAuthorityPresent: true,
          kind: "linq",
          partCount: 1,
          reactionEligible: true,
          replyToMessageId: null,
          senderHandle,
          service: "imessage",
        },
      }));

      const runOrdinaryTurn = async (inputId: string) => {
        await runHostedWorkspaceAssistantPhase(createPhaseInput({
          assistantInputIds: [inputId],
          conversationImportedCount: 1,
          importedCount: 1,
          runtimeGroupToolPort: { request: groupRequest },
          vaultRoot,
        }));
        const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
        const operationScope = laneInput?.operationScope as
          | AssistantAutomationOperationScope
          | undefined;
        if (!laneInput?.executionContext || !operationScope) {
          throw new Error("Expected hosted automation operation scope.");
        }
        return await operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext) => {
            const reader =
              executionContext.hosted?.groupParticipantDisplayNameReader;
            if (!reader) {
              throw new Error("Expected the production-scoped speaker reader.");
            }
            return await reader.read({
              channel: "linq",
              senderHandles: [senderHandle],
            });
          },
          turnEnvironment: null,
        });
      };

      await expect(runOrdinaryTurn(firstInputId)).resolves.toEqual([{
        displayName: "Warm Speaker",
        displayNameSource: "profile-name",
        senderHandle,
      }]);
      await expect(runOrdinaryTurn(secondInputId)).resolves.toEqual([{
        displayName: "Warm Speaker",
        displayNameSource: "profile-name",
        senderHandle,
      }]);
      expect(groupRequest).toHaveBeenCalledTimes(1);
      expect(groupRequest).toHaveBeenCalledWith({
        action: "read_participant_display_names",
        linqSenderHandles: [senderHandle],
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("scopes the group port through the scheduled group tool factory", async () => {
    const groupRequest = vi.fn(async () => {
      throw new Error("The scheduled scope boundary test must not call the port.");
    });
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeGroupToolPort: { request: groupRequest },
    }));

    const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const createScheduledGroupTools =
      laneInput?.executionContext.hosted?.createScheduledGroupTools;
    if (!createScheduledGroupTools) {
      throw new Error("Expected hosted scheduled group tools.");
    }

    expect(createScheduledGroupTools({
      channel: "linq",
      target: "chat_current_group",
      threadIsDirect: false,
    })?.groupTool).toEqual({ request: groupRequest });
    expect(createScheduledGroupTools({
      channel: "linq",
      target: "chat_direct",
      threadIsDirect: true,
    })).toBeNull();
    expect(createScheduledGroupTools({
      channel: "telegram",
      target: "chat_other",
      threadIsDirect: null,
    })).toBeNull();
    expect(groupRequest).not.toHaveBeenCalled();
  });

  it("preserves an automation route unless the accepted current conversation explicitly retargets it", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-automation-retarget-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const inputId = "ain_11111111111111111111111111111111";
    const availabilityBase = [
      "Send the existing reminder.",
      "Availability conflict policy: skip-when-busy",
      "Availability source policy: calendar-only",
      "Availability calendar account: googlecalendar / calendar-account",
    ].join("\n");
    const availabilityBlock = [
      "<!-- murph:availability-conflicts:start -->",
      "Availability conflict snapshot:",
      "- generatedAt: 2026-07-30T03:15:00.000Z",
      "- expiresAt: 2026-08-06T03:15:00.000Z",
      "- 2026-07-30T14:00:00.000Z / 2026-07-30T15:00:00.000Z",
      "<!-- murph:availability-conflicts:end -->",
    ].join("\n");
    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await upsertAutomation({
        assistantTargetOverride: {
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
        },
        continuityPolicy: "preserve",
        instructions: `${availabilityBase}\n\n${availabilityBlock}`,
        route: {
          channel: "telegram",
          deliveryTarget: "telegram_existing_chat",
          identityId: null,
          participantId: null,
          threadId: "telegram_existing_chat",
          threadIsDirect: true,
        },
        schedule: { kind: "dailyLocal", localTime: "09:00" },
        slug: "existing-reminder",
        status: "active",
        title: "Existing reminder",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockResolvedValue({
        conversation: {
          accountId: "linq_identity_current",
          actorId: "linq_participant_current",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_thread_current",
          threadIsDirect: true,
        },
        replyTarget: {
          channel: "linq",
          messageId: "linq_message_current",
          threadId: "linq_chat_current",
        },
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [inputId],
        importedCount: 1,
        vaultRoot,
      }));
      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }

      const patchThroughScope = async (retargetToCurrentConversation: boolean) =>
        await operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext) => {
            expect(executionContext.hosted?.groupSharedReader).toBeUndefined();
            const automationTool = executionContext.hosted?.automationTool;
            if (!automationTool) {
              throw new Error("Expected scoped hosted automation tool.");
            }
            const current = await showAutomation({
              slug: "existing-reminder",
              vaultRoot,
            });
            if (!current) {
              throw new Error("Expected existing reminder.");
            }
            return await automationTool.request({
              action: "patch",
              expectedUpdatedAt: current.updatedAt,
              lookup: "existing-reminder",
              retargetToCurrentConversation,
              title: retargetToCurrentConversation
                ? "Retargeted reminder"
                : "Preserved reminder",
            });
          },
          turnEnvironment: null,
        });

      await expect(patchThroughScope(false)).resolves.toEqual(expect.objectContaining({
        action: "patch",
        routeBinding: "preserved",
        status: "active",
      }));
      await expect(showAutomation({
        slug: "existing-reminder",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        assistantTargetOverride: {
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
        },
        route: expect.objectContaining({
          channel: "telegram",
          deliveryTarget: "telegram_existing_chat",
        }),
      }));

      await expect(patchThroughScope(true)).resolves.toEqual(expect.objectContaining({
        action: "patch",
        routeBinding: "current_conversation",
        status: "active",
      }));
      await expect(showAutomation({
        slug: "existing-reminder",
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        route: expect.objectContaining({
          channel: "linq",
          deliveryTarget: "linq_chat_current",
          threadIsDirect: true,
        }),
      }));

      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          const current = await showAutomation({
            slug: "existing-reminder",
            vaultRoot,
          });
          if (!current) {
            throw new Error("Expected existing reminder.");
          }
          return await automationTool.request({
            action: "patch",
            expectedUpdatedAt: current.updatedAt,
            lookup: "existing-reminder",
            schedule: { at: "2026-08-01T13:00:00.000Z", kind: "at" },
          });
        },
        turnEnvironment: null,
      });
      const exactReminder = await showAutomation({
        slug: "existing-reminder",
        vaultRoot,
      });
      expect(exactReminder).toEqual(expect.objectContaining({
        schedule: { at: "2026-08-01T13:00:00.000Z", kind: "at" },
      }));
      expect(exactReminder?.instructions).toBe([
        "Send the existing reminder.",
        "Availability conflict policy: fixed",
      ].join("\n"));

      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          const current = await showAutomation({
            slug: "existing-reminder",
            vaultRoot,
          });
          if (!current) {
            throw new Error("Expected existing reminder.");
          }
          return await automationTool.request({
            action: "patch",
            expectedUpdatedAt: current.updatedAt,
            instructions: `${availabilityBase.replace(
              "Availability conflict policy: skip-when-busy",
              "Availability conflict policy: fixed",
            )}\n\n${availabilityBlock}`,
            lookup: "existing-reminder",
          });
        },
        turnEnvironment: null,
      });
      await expect(showAutomation({
        slug: "existing-reminder",
        vaultRoot,
      })).resolves.toMatchObject({
        instructions: [
          "Send the existing reminder.",
          "Availability conflict policy: fixed",
        ].join("\n"),
      });
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("creates the first personal read only on one private answered-completion transition", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-first-read-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const inputId = "ain_22222222222222222222222222222222";
    try {
      await initializeVault({
        createdAt: "2026-08-06T20:00:00.000Z",
        vaultRoot,
      });
      mocks.readAssistantInputEvent.mockResolvedValue({
        conversation: {
          accountId: "linq_identity_current",
          actorId: "linq_participant_current",
          actorIsSelf: false,
          source: "linq",
          threadId: "linq_thread_current",
          threadIsDirect: true,
        },
        replyTarget: {
          channel: "linq",
          messageId: "linq_message_current",
          threadId: "linq_chat_current",
        },
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [inputId],
        importedCount: 1,
        vaultRoot,
      }));
      const laneInput = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
      const operationScope = laneInput?.operationScope as
        | AssistantAutomationOperationScope
        | undefined;
      if (!laneInput?.executionContext || !operationScope) {
        throw new Error("Expected hosted automation operation scope.");
      }
      const firstReadRequest =
        buildOnboardingFirstPersonalReadAutomationSaveRequest({
          now: new Date("2026-08-06T21:00:00.000Z"),
        });
      const genericFixedTargetRequests = [
        {
          action: "save" as const,
          automationId: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
          instructions: "Replace the fixed first-read policy.",
          schedule: {
            at: "2026-08-06T21:02:00.000Z",
            kind: "at" as const,
          },
          title: "Replacement by identifier",
        },
        {
          action: "save" as const,
          instructions: "Replace the fixed first-read policy.",
          schedule: {
            at: "2026-08-06T21:02:00.000Z",
            kind: "at" as const,
          },
          slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
          title: "Replacement by slug",
        },
        {
          action: "save" as const,
          instructions: "Replace the fixed first-read policy.",
          schedule: {
            at: "2026-08-06T21:02:00.000Z",
            kind: "at" as const,
          },
          title: "Onboarding___first / personal read",
        },
      ];
      for (const request of genericFixedTargetRequests) {
        await expect(operationScope.runAutoReplyGroup({
          executionContext: laneInput.executionContext,
          inputIds: [inputId],
          operation: async (executionContext) => {
            const automationTool = executionContext.hosted?.automationTool;
            if (!automationTool) {
              throw new Error("Expected scoped hosted automation tool.");
            }
            return await automationTool.request(request);
          },
          turnEnvironment: null,
        })).rejects.toThrow(
          "only once during its answered-completion transition",
        );
      }
      await expect(operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request(genericFixedTargetRequests[0], {
            onboardingFirstReadCompletionTransition: true,
          });
        },
        turnEnvironment: null,
      })).rejects.toThrow(
        "only once during its answered-completion transition",
      );
      await expect(showAutomation({
        slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        vaultRoot,
      })).resolves.toBeNull();

      const unrelated = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request({
            action: "save",
            instructions: "Send the unrelated reminder.",
            schedule: {
              at: "2026-08-07T13:00:00.000Z",
              kind: "at",
            },
            title: "Unrelated reminder",
          });
        },
        turnEnvironment: null,
      });
      expect(unrelated).toEqual(expect.objectContaining({
        action: "save",
        created: true,
      }));
      await expect(operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request(firstReadRequest, {
            onboardingFirstReadCompletionTransition: true,
          });
        },
        turnEnvironment: null,
      })).rejects.toThrow(
        "only once during its answered-completion transition",
      );
      await completeAssistantOnboarding({
        completedAt: "2026-08-06T21:00:00.000Z",
        reason: "user_answered",
        vault: vaultRoot,
      });

      const saved = await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          await expect(automationTool.request(firstReadRequest)).rejects.toThrow(
            "only once during its answered-completion transition",
          );
          const result = await automationTool.request(firstReadRequest, {
            onboardingFirstReadCompletionTransition: true,
          });
          await expect(automationTool.request(firstReadRequest, {
            onboardingFirstReadCompletionTransition: true,
          })).rejects.toThrow(
            "only once during its answered-completion transition",
          );
          return result;
        },
        turnEnvironment: null,
      });
      expect(saved).toEqual(expect.objectContaining({
        action: "save",
        created: true,
        routeBinding: "current_conversation",
        status: "active",
      }));
      if (saved.action !== "save") {
        throw new Error("Expected first-read save result.");
      }
      await expect(showAutomation({
        slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({
        route: expect.objectContaining({
          channel: "linq",
          deliveryTarget: "linq_chat_current",
          threadIsDirect: true,
        }),
      }));

      await operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request({
            action: "patch",
            expectedUpdatedAt: saved.updatedAt,
            lookup: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
            status: "archived",
          });
        },
        turnEnvironment: null,
      });
      await expect(operationScope.runAutoReplyGroup({
        executionContext: laneInput.executionContext,
        inputIds: [inputId],
        operation: async (executionContext) => {
          const automationTool = executionContext.hosted?.automationTool;
          if (!automationTool) {
            throw new Error("Expected scoped hosted automation tool.");
          }
          return await automationTool.request(firstReadRequest, {
            onboardingFirstReadCompletionTransition: true,
          });
        },
        turnEnvironment: null,
      })).rejects.toThrow(
        "only once during its answered-completion transition",
      );
      await expect(showAutomation({
        slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
        vaultRoot,
      })).resolves.toEqual(expect.objectContaining({ status: "archived" }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("skips system mailbox maintenance after foreground input arrives during the run", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: expect.any(String),
      nextWakeReason: "assistant",
      progressed: false,
    }));
  });

  it("skips the assistant lane when foreground input arrives during system mailbox preparation", async () => {
    let shouldYield = false;
    let fetchSnapshotCalls = 0;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
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
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot() {
        fetchSnapshotCalls += 1;
        throw new Error("fetchSnapshot should not run after foreground preemption.");
      },
    } satisfies RuntimeDeviceSyncPort;
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      shouldYield = true;
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_processed",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(fetchSnapshotCalls).toBe(0);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();

    await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: expect.objectContaining({
        itemId: "system_mailbox_item_processed",
      }),
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("keeps foreground imports active while recording a clinical outcome", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: {
        ...createSystemMailboxItem(),
        postCheckpointRecord: {
          kind: "clinical-records.outcome-recorded" as const,
          request: {
            counts: {
              createdCount: 0,
              executableDecisionCount: 0,
              fetchedPageCount: 1,
              fetchedResourceFamilyCount: 1,
              rawFileCount: 2,
              retractedCount: 0,
              reviewDecisionCount: 0,
              skippedExistingCount: 0,
              supersededCount: 0,
            },
            generation: 1,
            runId: "clinical_run_1",
            status: "completed" as const,
          },
        },
        routeAction: "run-clinical-records-sync" as const,
        status: "recording" as const,
        wake: {
          eventId: "clinical-records.sync-requested:phase-test",
          generation: 1,
          kind: "clinical-records.sync-requested" as const,
          occurredAt: "2026-04-27T00:00:00.000Z",
          runId: "clinical_run_1",
          userId: "member_synthetic_phase",
        },
      },
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "clinical-records",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(result.afterCheckpointKeepsForegroundImportLoop).toBe(true);
    await result.afterCheckpoint?.();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: expect.objectContaining({
        routeAction: "run-clinical-records-sync",
      }),
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      signal: expect.any(AbortSignal),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("defers due provider cleanup when foreground input arrives during system mailbox preparation", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:08:00.000Z",
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      shouldYield = true;
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_processed",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    // The due checkpoint re-arms durably into the cleanup owner state.
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:09:00.000Z",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: expect.objectContaining({
        itemId: "system_mailbox_item_processed",
      }),
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("keeps provider cleanup deferred when foreground-yield input is not ingested yet", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:08:00.000Z",
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      shouldYield = true;
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_processed",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
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
      now: () => "2026-04-27T00:09:00.000Z",
      shouldYieldBackgroundMaintenance,
    }));

    // The due checkpoint re-arms durably into the cleanup owner state.
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:09:00.000Z",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: expect.objectContaining({
        itemId: "system_mailbox_item_processed",
      }),
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("checkpoints a consumed alarm wake when foreground input was ingested", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
    }));
  });

  it("defers cleanup planning when the foreground-yield hook is already tripped", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
      shouldYieldBackgroundMaintenance: () => true,
    }));

    expect(result).toBeDefined();
    for (const call of mocks.prepareHostedProviderCleanupPlan.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ deferred: true }));
    }
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("durably queues cleanup with a future wake when a foreground turn terminalizes Linq input without delivery effects", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      activeTurnInputIngested: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      assistantAutomationTerminalLinqCleanup: ["linq_terminal_1"],
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.prepareHostedProviderCleanupPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        deferred: true,
        terminalCleanupMessageIds: ["linq_terminal_1"],
      }),
    );
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["linq_terminal_1"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("lets assistant work consume a legacy assistant-labeled alarm without running device-sync", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

    expectAssistantLaneCallWithoutDeviceSyncOptions();
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
    expect("nextWakeReason" in result).toBe(false);
  });

  it("services a queued device-sync wake after a legacy assistant alarm has no work", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    const assistantContinuationAt = "2026-04-27T00:03:00.000Z";
    const deviceContinuationAt = "2026-04-27T00:05:00.000Z";
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "device-sync.wake:assistant-shadow-recovery",
        kind: "device-sync.wake" as const,
        occurredAt: dueAt,
        reason: "reconcile_due" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 1,
      })
      .mockResolvedValue({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-28T00:00:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: assistantContinuationAt,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: false,
      redactedLogEntries: [],
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_assistant_shadow_recovery",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        mailboxLane: "device-sync",
        nextWakeAt: deviceContinuationAt,
        nextWakeReason: "device-sync.reconcile",
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
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
      workspace: createDueAssistantWorkspace(),
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: ["run-device-sync-wake"],
        allowedWakeKinds: ["device-sync.wake"],
        runtimeLogContext: {
          attemptId: "attempt_synthetic_phase",
          leaseGeneration: "3",
          workspaceVersion: "8",
        },
        shouldYieldBackgroundMaintenance,
      }),
    );
    expect(
      mocks.runHostedAssistantAutomationLane.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      deviceSyncMaintenanceRan: true,
      nextWakeAt: assistantContinuationAt,
      progressed: true,
    }));
    expect("nextWakeReason" in result).toBe(false);
    await result.afterCheckpoint?.();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        item: deviceSyncItem,
      }),
    );
  });

  it("leaves unrelated maintenance untouched when shadow recovery finds no device wake", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-shadow-recovery-"));
    const vaultRoot = path.join(parentRoot, "vault");
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 1,
      })
      .mockResolvedValue({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-28T00:00:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
    mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault.mockResolvedValueOnce(1);

    try {
      await initializeVault({
        createdAt: dueAt,
        timezone: "America/New_York",
        vaultRoot,
      });
      await writeHostedPhaseExperimentSource(vaultRoot);
      await markAssistantContextSnapshotDirty({
        domains: ["experiments"],
        vaultRoot,
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => dueAt,
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
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));

      expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
      expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
      expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedRouteActions: ["run-device-sync-wake"],
          allowedWakeKinds: ["device-sync.wake"],
        }),
      );
      expect(mocks.queueHostedAssistantPendingMessageVolumeReceiptsForVault)
        .not.toHaveBeenCalled();
      expect(mocks.resolveHostedSystemMailboxNextWakeCandidate).not.toHaveBeenCalledWith(
        expect.objectContaining({
          allowedRouteActions: ["apply-member-preferences"],
        }),
      );
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect("deviceSyncMaintenanceRan" in result).toBe(false);
      expect(result.redactedStatus).toEqual(expect.objectContaining({
        hostedSystemMailboxPrepared: 0,
      }));
      await expect(readAssistantContextSnapshotState(vaultRoot)).resolves.toMatchObject({
        pendingDirtyDomains: ["experiments"],
      });
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps queued device-sync recovery behind real assistant progress", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: dueAt,
        runningJobs: 0,
        totalJobs: 1,
      })
      .mockResolvedValue({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-28T00:00:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: {
        ...createSystemMailboxItem(),
        routeAction: "run-device-sync-wake" as const,
        wake: {
          eventId: "device-sync.wake:assistant-progress-priority",
          kind: "device-sync.wake" as const,
          occurredAt: dueAt,
          reason: "reconcile_due" as const,
          userId: "member_synthetic_phase",
        },
      },
      itemId: "system_mailbox_item_assistant_progress_priority",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T00:05:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
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
      workspace: createDueAssistantWorkspace(),
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ progressed: true }));
  });

  it("keeps queued device-sync recovery behind fresh assistant input", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: {
        ...createSystemMailboxItem(),
        routeAction: "run-device-sync-wake" as const,
        wake: {
          eventId: "device-sync.wake:fresh-input-priority",
          kind: "device-sync.wake" as const,
          occurredAt: "2026-04-27T00:00:00.000Z",
          reason: "reconcile_due" as const,
          userId: "member_synthetic_phase",
        },
      },
      itemId: "system_mailbox_item_fresh_input_priority",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T00:05:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      resolvedDeviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "synthetic-whoop-client",
            clientSecret: "synthetic-device-sync-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      workspace: createDueAssistantWorkspace(),
    }));

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("does not run deferred device-sync work from an assistant-labeled wake", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: "assistant",
      progressed: false,
    }));
  });

  it("does not pass foreground-input yield hooks into the assistant lane", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
  });

  it("lets assistant work consume a legacy null-labeled alarm without running device-sync", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

    expectAssistantLaneCallWithoutDeviceSyncOptions();
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
    expect("nextWakeReason" in result).toBe(false);
  });

  it("does not re-arm a stale assistant wake as a skipped device-sync retry during a foreground nudge", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
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
    expect("nextWakeReason" in result).toBe(false);
  });

  it("does not run legacy assistant-labeled device-sync before assistant work", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
    }));
    expect("nextWakeReason" in result).toBe(false);
  });

  it("drops stale assistant automation wakes before reporting scheduled work", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
    }));

    expect(result).toEqual({
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: false,
      }),
    });
  });

  it("does not label an aggregate reminder as invocation-local foreground work", async () => {
    const reminderWakeAt = "2026-04-27T06:00:00.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      assistantAutomationSelectedInputWakeAt: null,
      nextWakeAt: reminderWakeAt,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result.nextWakeAt).toBe(reminderWakeAt);
    expect(result).not.toHaveProperty("invocationLocalAssistantWakeAt");
  });

  it("labels a selected foreground retry as invocation-local work", async () => {
    const retryWakeAt = "2026-04-27T00:00:30.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      assistantAutomationSelectedInputWakeAt: retryWakeAt,
      nextWakeAt: retryWakeAt,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result.nextWakeAt).toBe(retryWakeAt);
    expect(result.invocationLocalAssistantWakeAt).toBe(retryWakeAt);
  });

  it("does not checkpoint no-op alarms only because automation returned a future wake", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
    const existingWakeAt = "2026-04-27T00:05:00.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

  it("checkpoints a new future automation wake from manual runtime maintenance", async () => {
    const nextWakeAt = "2026-04-27T00:05:00.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
      foregroundReplyFailed: 0,
      nextWakeAt,
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: nextWakeAt,
        hostedAssistantProgressed: false,
      }),
    }));
  });

  it("schedules a near follow-up wake when active input consumes a due alarm and skips device sync", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
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
      nextWakeAt: null,
      progressed: true,
    }));
  });

  it("does not treat assistant-labeled nudge wakes as device-sync retries", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(result).toEqual({
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedAssistantProgressed: false,
      }),
    });
  });

  it("runs device-sync work for a due device-sync alarm without active input", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
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

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDirtyPendingFetch: false,
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("drains due provider cleanup after idle device-sync-only work", async () => {
    const nextWakeAt = "2026-04-27T00:01:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: {
          nextWakeAt: null,
        },
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
      }),
    }));
  });

  it("defers due provider cleanup when foreground input appears before post-checkpoint cleanup", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    const deviceSyncWakeAt = "2026-04-27T00:10:00.000Z";
    // The re-armed first-deferred wake (mocked as now + 5 minutes) recorded
    // into the cleanup owner state when the yielded drain defers.
    const providerCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue({
      nextWakeAt: null,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: deviceSyncWakeAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: deviceSyncWakeAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));

    shouldYield = true;
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    // The yielded drain re-arms the due checkpoint durably into the cleanup
    // owner state instead of carrying a plan-only wake.
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: providerCleanupWakeAt,
      },
      linqMessageIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      nextWakeAt: providerCleanupWakeAt,
      nextWakeReason: "assistant",
    }));
  });

  it("preserves durable outbox wakes after idle device-sync-only work", async () => {
    const outboxWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(outboxWakeAt);
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: outboxWakeAt,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      progressed: true,
    }));
  });

  it("checkpoints a consumed due device-sync alarm when no follow-up work remains", async () => {
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
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
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("keeps an earlier skipped device-sync retry before a later local schedule", async () => {
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-27T01:00:00.000Z");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("uses a skipped device-sync retry instead of a stale local schedule", async () => {
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-26T23:59:59.000Z");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("uses the local schedule when a due device-sync wake already ran in the invocation", async () => {
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-27T00:10:00.000Z");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncWorkspaceWakeHandled: {
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
      },
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("re-arms a newer due device-sync retry when an earlier wake already ran in the invocation", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncWorkspaceWakeHandled: {
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
      },
      importedCount: 1,
      now: () => "2026-04-27T00:00:30.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:00:30.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("preserves a future skipped device-sync retry after same-invocation maintenance", async () => {
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-27T01:00:00.000Z");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncWorkspaceWakeHandled: {
        nextWakeAt: "2026-04-26T23:59:59.000Z",
        nextWakeReason: "device-sync.reconcile",
      },
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:00:30.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("exposes safe hosted device list, connect, and reconcile actions from the platform port", async () => {
    const connectLinkRequests: RuntimeDeviceSyncConnectLinkRequest[] = [];
    const fetchSnapshotRequests: Array<Parameters<RuntimeDeviceSyncPort["fetchSnapshot"]>[0]> = [];
    const reconcileRequests: Array<Parameters<NonNullable<RuntimeDeviceSyncPort["reconcileAccount"]>>[0]> = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const accountSnapshots = Array.from({ length: 33 }, (_, index) => ({
      connection: {
        accessTokenExpiresAt: "2026-05-01T00:00:00.000Z",
        connectedAt: "2026-04-28T00:00:00.000Z",
        createdAt: new Date(Date.parse("2026-04-28T00:00:00.000Z") - index * 1_000)
          .toISOString(),
        displayName: index === 0 ? "Training wearable" : `Training wearable ${index + 1}`,
        externalAccountId: `external-account-not-for-assistant-${index + 1}`,
        id: index === 0
          ? "conn_synthetic_whoop"
          : `conn_synthetic_whoop_${String(index + 1).padStart(2, "0")}`,
        metadata: { privateProviderDetail: "not-for-assistant" },
        provider: "whoop",
        scopes: ["read:recovery"],
        status: "active" as const,
      },
      credential: {
        credentialMetadata: { privateCredentialDetail: "not-for-assistant" },
        kind: "none" as const,
      },
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: "2026-04-29T00:00:00.000Z",
        lastSyncErrorAt: null,
        lastSyncStartedAt: "2026-04-28T23:59:00.000Z",
        lastWebhookAt: "2026-04-28T23:58:00.000Z",
        nextReconcileAt: null,
      },
    }));
    const accountCursor = {
      createdAt: accountSnapshots[31]!.connection.createdAt,
      id: accountSnapshots[31]!.connection.id,
    };
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
      async fetchSnapshot(request) {
        const pageIndex = fetchSnapshotRequests.length;
        fetchSnapshotRequests.push(request);
        return {
          connections: pageIndex === 0
            ? accountSnapshots.slice(0, 32)
            : accountSnapshots.slice(32),
          generatedAt: "2026-04-29T00:00:00.000Z",
          nextCursor: pageIndex === 0 ? accountCursor : null,
          userId: "member_synthetic_phase",
        };
      },
      async reconcileAccount(request) {
        reconcileRequests.push(request);
        return {
          connectionId: request.connectionId,
          occurredAt: "2026-04-29T00:01:00.000Z",
          status: "queued" as const,
        };
      },
    } satisfies RuntimeDeviceSyncPort;

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      deviceSyncMessagingReturnTarget: "telegram",
      logRequests,
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["fitbit", "dexcom_v3", "dexcom"],
            region: "us",
          },
          strava: {
            clientId: "synthetic-strava-client",
            clientSecret: "synthetic-strava-secret",
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
          { label: "Dexcom (G6 and older)", provider: "dexcom" },
        ],
        deviceTool: expect.objectContaining({ request: expect.any(Function) }),
        memberId: "member_synthetic_phase",
      }),
    });
    const deviceTool = hydratedContext?.hosted?.deviceTool;
    if (!deviceTool) {
      throw new Error("Expected hosted device tool.");
    }
    const abortController = new AbortController();
    await expect(deviceTool.request({
      action: "list_accounts",
      provider: " whoop ",
      sourceProvider: " whoop_v2 ",
    }, { signal: abortController.signal })).resolves.toEqual({
      accounts: accountSnapshots.map(({ connection, localState }) => ({
        accountId: connection.id,
        displayName: connection.displayName,
        lastErrorCode: localState.lastErrorCode,
        lastSyncCompletedAt: localState.lastSyncCompletedAt,
        provider: connection.provider,
        status: connection.status,
      })),
      action: "list_accounts",
      provider: "whoop",
      sourceProvider: "whoop_v2",
    });
    expect(fetchSnapshotRequests).toEqual([
      {
        includeCredentialMaterial: false,
        provider: "whoop",
        signal: abortController.signal,
        sourceProviderSlug: "whoop_v2",
      },
      {
        cursor: accountCursor,
        includeCredentialMaterial: false,
        limit: 32,
        provider: "whoop",
        signal: abortController.signal,
        sourceProviderSlug: "whoop_v2",
      },
    ]);
    await expect(
      deviceTool.request({
        action: "connect",
        provider: "whoop",
      }),
    ).resolves.toEqual({
      action: "connect",
      link: {
        authorizationUrl: "https://connect.example.test/whoop",
        connectUrl: "https://connect.example.test/whoop",
        expiresAt: "2026-04-29T00:05:00.000Z",
        provider: "whoop",
        providerLabel: "WHOOP",
      },
    });
    expect(connectLinkRequests).toEqual([
      { connectTarget: "whoop", messagingReturnTarget: "telegram" },
    ]);
    await expect(deviceTool.request({
      accountId: "conn_synthetic_whoop",
      action: "reconcile",
    }, { signal: abortController.signal })).resolves.toEqual({
      accountId: "conn_synthetic_whoop",
      action: "reconcile",
      occurredAt: "2026-04-29T00:01:00.000Z",
      status: "queued",
    });
    expect(reconcileRequests).toEqual([{
      connectionId: "conn_synthetic_whoop",
      signal: abortController.signal,
    }]);
    await expect(deviceTool.request({
      action: "connect",
      provider: "unconfigured-provider",
    })).rejects.toThrow("not available to connect");
    await expect(deviceTool.request({
      action: "connect",
      provider: "strava",
    })).rejects.toThrow("not available to connect");
    await expect(deviceTool.request({
      action: "connect",
      provider: "dexcom_v3",
    })).rejects.toThrow("not available to connect");
    await expect(deviceTool.request({
      action: "connect",
      provider: "dexcom",
    })).resolves.toEqual({
      action: "connect",
      link: expect.objectContaining({ provider: "dexcom" }),
    });
    expect(connectLinkRequests).toEqual([
      { connectTarget: "whoop", messagingReturnTarget: "telegram" },
      { connectTarget: "dexcom", messagingReturnTarget: "telegram" },
    ]);
    await Promise.resolve();
    const deviceConnectLogs = logRequests
      .flatMap((request) => request.entries)
      .filter((entry) => entry.eventCode === "assistant.device_connect");
    expect(deviceConnectLogs.map((entry) => entry.redactedJson)).toEqual([
      expect.objectContaining({
        deviceConnectIssueLinkAvailable: true,
        deviceConnectPortPresent: true,
        deviceConnectProviderCount: 3,
        deviceConnectProviders: ["whoop", "fitbit", "dexcom"],
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
      expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "requested",
        deviceConnectReturnTarget: "telegram",
        provider: "dexcom",
      }),
      expect.objectContaining({
        deviceConnectStage: "request",
        deviceConnectStatus: "issued",
        deviceConnectReturnTarget: "telegram",
        expiresAtPresent: true,
        provider: "dexcom",
      }),
    ]);
    expect(JSON.stringify(deviceConnectLogs)).not.toContain("connect.example.test");
    expect(JSON.stringify(deviceConnectLogs)).not.toContain("synthetic-whoop-secret");
    expect(JSON.stringify(await deviceTool.request({ action: "list_accounts" })))
      .not.toContain("not-for-assistant");
  });

  it("exposes the existing Clinical Records link method to the hosted assistant context", async () => {
    const createConnectLink = vi.fn<
      NonNullable<RuntimeClinicalRecordsPort["createConnectLink"]>
    >(async () => ({
      connectUrl:
        `https://app.example.test/records/connect#clinicalRecordsIntent=cr_${"a".repeat(32)}`,
      expiresAt: "2026-07-16T12:15:00.000Z",
      ok: true,
    }));
    const clinicalRecordsPort: RuntimeClinicalRecordsPort = {
      createConnectLink,
      async fetchPage() {
        throw new Error("Clinical Records link test should not fetch a page.");
      },
      async readRun() {
        throw new Error("Clinical Records link test should not read a run.");
      },
      async recordOutcome() {
        throw new Error("Clinical Records link test should not record an outcome.");
      },
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeClinicalRecordsPort: clinicalRecordsPort,
    }));

    const hydratedContext = mocks.hydrateHostedExecutionDefaultTarget.mock.calls[0]?.[0];
    const controller = new AbortController();
    await expect(
      hydratedContext?.hosted?.clinicalRecordsConnectLinkTool?.createConnectLink({
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(createConnectLink).toHaveBeenCalledWith({ signal: controller.signal });
  });

  it("injects active hosted device connection status as dynamic context for due cron lanes", async () => {
    const fetchSnapshotRequests: Array<Parameters<RuntimeDeviceSyncPort["fetchSnapshot"]>[0]> = [];
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
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot(request) {
        fetchSnapshotRequests.push(request);
        return {
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-29T00:00:00.000Z",
                createdAt: "2026-04-29T00:00:00.000Z",
                displayName: null,
                externalAccountId: "synthetic-external-account",
                id: "conn_synthetic_whoop",
                metadata: {},
                provider: "junction",
                scopes: [],
                setupPhase: "source_confirmed",
                status: "active",
              },
              credential: {
                credentialMetadata: {},
                kind: "provider_config",
                providerConfigKey: "junction",
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: "2026-04-22T00:00:00.000Z",
                lastSyncErrorAt: null,
                lastSyncStartedAt: "2026-04-29T00:00:00.000Z",
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              sources: [
                {
                  displayName: null,
                  firstSeenAt: "2026-04-22T00:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  lastSeenAt: "2026-04-29T00:00:00.000Z",
                  lastDataAt: null,
                  resourceCount: 0,
                  sourceProviderSlug: "whoop_v2",
                  status: "connected",
                },
              ],
            },
          ],
          generatedAt: "2026-04-29T00:00:00.000Z",
          userId: "member_synthetic_phase",
        };
      },
    } satisfies RuntimeDeviceSyncPort;
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });
    let dynamicContextPrompt: string | null | undefined;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      dynamicContextPrompt =
        await laneInput.buildBackgroundDynamicContextPrompt?.({});
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    expect(fetchSnapshotRequests).toEqual([]);
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["fitbit", "garmin", "oura", "withings", "whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const assistantLaneCall = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    expect(assistantLaneCall?.executionContext.hosted?.automationTool).toBeUndefined();
    expect(assistantLaneCall?.executionContext.hosted?.groupTool).toBeUndefined();
    expect(assistantLaneCall?.executionContext.hosted?.groupSharedReader).toBeUndefined();
    expect(assistantLaneCall?.executionContext.hosted?.createScheduledGroupTools)
      .toEqual(expect.any(Function));
    expect(assistantLaneCall?.executionContext.hosted?.deviceTool).toEqual(
      expect.objectContaining({ request: expect.any(Function) }),
    );
    expect(fetchSnapshotRequests).toEqual([
      {
        includeCredentialMaterial: false,
        signal: expect.any(AbortSignal),
      },
    ]);
    for (const request of fetchSnapshotRequests) {
      expect(request).not.toHaveProperty("limit");
    }
    expect(assistantLaneCall?.signal).toBeUndefined();
    expect(assistantLaneCall).not.toHaveProperty("suppressActiveTurnInputRefresh");
    expect(assistantLaneCall?.executionContext.hosted?.dynamicContextPrompts)
      .toBeUndefined();
    expect(dynamicContextPrompt).toContain("WHOOP has an active connection");
    expect(dynamicContextPrompt).toContain(
      "Do not offer initial wearable connection",
    );
    expect(dynamicContextPrompt).not.toContain("member_alpha");
    expect(dynamicContextPrompt).not.toContain("member_beta");
    expect(dynamicContextPrompt).not.toContain("needs reconnect");
    expect(dynamicContextPrompt).not.toContain("synthetic-external-account");
    expect(dynamicContextPrompt).not.toContain("refresh failed");
    expect(dynamicContextPrompt).not.toContain("Private household label");
    expect(dynamicContextPrompt).not.toContain("group_private_runtime_identifier");
    expect(dynamicContextPrompt).not.toContain("<REDACTED_PHONE>");
    expect(dynamicContextPrompt).not.toContain("<REDACTED_EMAIL>");
  });

  it("does not read the current group when no background work is due", async () => {
    const request = vi.fn(async () => {
      throw new Error("Group reads should remain lazy when no background work is due.");
    });
    let dynamicContextPrompt: string | null | undefined;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
      dynamicContextPrompt =
        await laneInput.buildBackgroundDynamicContextPrompt?.({});
      return {
        assistantAutomationProgressed: false,
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      runtimeGroupToolPort: { request },
    }));

    expect(dynamicContextPrompt).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("omits Junction source commands when the public connect target resolves direct", async () => {
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
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot() {
        return {
          connections: [
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-29T00:00:00.000Z",
                createdAt: "2026-04-29T00:00:00.000Z",
                displayName: null,
                externalAccountId: "synthetic-external-account",
                id: "conn_synthetic_oura_junction",
                metadata: {},
                provider: "junction",
                scopes: [],
                setupPhase: "source_confirmed",
                status: "active",
              },
              credential: {
                credentialMetadata: {},
                kind: "provider_config",
                providerConfigKey: "junction",
              },
              localState: {
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSyncCompletedAt: "2026-04-22T00:00:00.000Z",
                lastSyncErrorAt: null,
                lastSyncStartedAt: "2026-04-29T00:00:00.000Z",
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
              sources: [
                {
                  displayName: null,
                  firstSeenAt: "2026-04-22T00:00:00.000Z",
                  lastErrorCode: "TOKEN_REFRESH_FAILED",
                  lastErrorMessage: "refresh failed",
                  lastSeenAt: "2026-04-29T00:00:00.000Z",
                  lastDataAt: null,
                  resourceCount: 0,
                  sourceProviderSlug: "oura",
                  status: "error",
                },
              ],
            },
            {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-28T00:00:00.000Z",
                createdAt: "2026-04-28T00:00:00.000Z",
                displayName: null,
                externalAccountId: "synthetic-strava-account",
                id: "conn_synthetic_strava",
                metadata: {},
                provider: "strava",
                scopes: ["activity:read"],
                setupPhase: "source_confirmed",
                status: "reauthorization_required",
              },
              credential: {
                credentialMetadata: {},
                kind: "none",
              },
              localState: {
                lastErrorCode: "TOKEN_REFRESH_FAILED",
                lastErrorMessage: "refresh failed",
                lastSyncCompletedAt: "2026-04-22T00:00:00.000Z",
                lastSyncErrorAt: "2026-04-29T00:00:00.000Z",
                lastSyncStartedAt: "2026-04-29T00:00:00.000Z",
                lastWebhookAt: null,
                nextReconcileAt: null,
              },
            },
          ],
          generatedAt: "2026-04-29T00:00:00.000Z",
          userId: "member_synthetic_phase",
        };
      },
    } satisfies RuntimeDeviceSyncPort;

    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["oura"],
            region: "us",
          },
          oura: {
            clientId: "synthetic-oura-client",
            clientSecret: "synthetic-oura-secret",
          },
          strava: {
            clientId: "synthetic-strava-client",
            clientSecret: "synthetic-strava-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const assistantLaneCall = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const prompt =
      await assistantLaneCall?.buildBackgroundDynamicContextPrompt?.({}) ?? "";

    expect(prompt).toContain("Oura currently needs reconnect");
    expect(prompt).toContain("source `oura`");
    expect(prompt).toContain("generic device-connect command is ambiguous");
    expect(prompt).not.toContain("vault-cli device connect oura --format json");
    expect(prompt).toContain("Strava currently needs reconnect");
    expect(prompt).toContain("Reconnect is not currently available for this wearable/source");
    expect(prompt).toContain("Do not offer or issue a reconnect link");
    expect(prompt).not.toContain("vault-cli device connect strava --format json");
  });

  it("skips lazy device context when pending input appears before the automation lane", async () => {
    const fetchSnapshot = vi.fn(async () => ({
      connections: [],
      generatedAt: "2026-04-29T00:00:00.000Z",
      userId: "member_synthetic_phase",
    }));
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
        throw new Error("createConnectLink should not be called.");
      },
      fetchSnapshot,
    } satisfies RuntimeDeviceSyncPort;

    mocks.resolveHostedPendingAssistantInputWakeAt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("2026-04-29T00:00:00.000Z");
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        nextWakeAt: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-29T00:00:00.000Z",
      progressed: true,
    }));
    expect(fetchSnapshot).not.toHaveBeenCalled();
  });

  it("skips lazy hosted device sync status reads after foreground preemption", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
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
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot() {
        throw new Error("fetchSnapshot should not run after foreground preemption.");
      },
    } satisfies RuntimeDeviceSyncPort;

    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
      shouldYieldBackgroundMaintenance,
    }));

    const assistantLaneCall = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    shouldYield = true;
    const prompt = await assistantLaneCall?.buildBackgroundDynamicContextPrompt?.({});
    expect(prompt).toBeNull();
    expect(assistantLaneCall?.executionContext.hosted?.dynamicContextPrompts).toBeUndefined();
  });

  it("uses an abortable signal for optional hosted device sync status reads before scheduled assistant work", async () => {
    let fetchSnapshotCalls = 0;
    let fetchSnapshotSignal: AbortSignal | null | undefined;
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
        throw new Error("createConnectLink should not be called.");
      },
      async fetchSnapshot(request) {
        fetchSnapshotCalls += 1;
        fetchSnapshotSignal = request?.signal;
        return {
          connections: [],
          generatedAt: "2026-04-29T00:00:00.000Z",
          userId: "member_synthetic_phase",
        };
      },
    } satisfies RuntimeDeviceSyncPort;

    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 1,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      resolvedDeviceSync: {
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: "us",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "synthetic-device-sync-secret",
      },
      runtimeDeviceSyncPort: deviceSyncPort,
    }));

    const assistantLaneCall = mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0];
    const prompt = await assistantLaneCall?.buildBackgroundDynamicContextPrompt?.({});
    expect(fetchSnapshotCalls).toBe(1);
    expect(fetchSnapshotSignal).toBeInstanceOf(AbortSignal);
    expect(prompt).toBeNull();
    expect(assistantLaneCall?.executionContext.hosted?.dynamicContextPrompts).toBeUndefined();
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
      deviceSyncMessagingReturnTarget: "telegram",
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
      hydratedContext?.hosted?.deviceTool?.request({
        action: "connect",
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
        safeErrorMessage: "Hosted execution authorization failed.",
      }),
    }));
    expect(JSON.stringify(logRequests)).not.toContain("connect.example.test");
    expect(JSON.stringify(logRequests)).not.toContain("opaque-secret");
    expect(JSON.stringify(logRequests)).not.toContain("synthetic-whoop-secret");
  });

  it("writes a durable assistant pass summary without requiring local log storage", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: "2026-04-27T00:05:00.000Z",
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
    }));
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(result.progressed).toBe(true);
    expect(filteredLogRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.automation_detail",
      "assistant.pass_finished",
    ]);
    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
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
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).not.toEqual(expect.objectContaining({
      assistantProviderRequest: expect.anything(),
    }));
    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      attemptId: "attempt_synthetic_phase",
      component: "assistant",
      eventCode: "assistant.pass_finished",
      leaseGeneration: "3",
      phase: "invoke",
      redactedJson: expect.objectContaining({
        automationLogCount: 1,
        deliveryEffectCount: 0,
        nextWakeAtPresent: true,
        parserProcessed: 0,
        progressed: true,
      }),
      workspaceVersion: "8",
    }));
  });

  it("flushes buffered automation detail logs before rethrowing assistant failures", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const failure = new Error("automation failed after timing trace");
    Object.defineProperty(failure, "hostedAssistantAutomationRedactedLogEntries", {
      configurable: true,
      value: [{
        component: "runtime.provider",
        level: "error",
        message: "Hosted assistant automation pass failed.",
        phase: "failed",
        redacted: {
          errorCode: "authorization_error",
          errorCodeDetail: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
          safeErrorMessage: "Hosted execution authorization failed.",
          schema: "murph.assistant-turn-timing.v1",
          type: "assistant.turn.timing",
          turnTimingDeliveryIntentId: "intent_timing_failure",
          turnTimingElapsedMs: 41,
          turnTimingProviderRequestElapsedMs: 31,
          turnTimingSinceProviderResultMs: 10,
          turnTimingStage: "reply-dispatched",
        },
      }],
    });
    mocks.runHostedAssistantAutomationLane.mockRejectedValueOnce(failure);

    await expect(
      runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests })),
    ).rejects.toThrow("automation failed after timing trace");

    expect(logRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      errorCode: "authorization_error",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        errorCode: "authorization_error",
        errorCodeDetail: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
        detailComponent: "runtime.provider",
        schema: "murph.assistant-turn-timing.v1",
        safeErrorMessage: "Hosted execution authorization failed.",
        turnTimingDeliveryIntentId: "intent_timing_failure",
        turnTimingElapsedMs: 41,
        turnTimingProviderRequestElapsedMs: 31,
        turnTimingSinceProviderResultMs: 10,
        turnTimingStage: "reply-dispatched",
      }),
    }));
    expect(() => parseHostedRuntimeLogRequest(logRequests[0])).not.toThrow();
  });

  it("persists redacted full Codex failure diagnostics in assistant detail logs", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      nextWakeAt: "2026-05-03T14:56:05.548Z",
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation event: input.reply-failed.",
        phase: "wake.running",
        redacted: {
          ...Object.fromEntries(
            Array.from({ length: 48 }, (_, index) => [
              `genericOverflow${index}Count`,
              index,
            ]),
          ),
          errorCode: "ASSISTANT_CODEX_FAILED",
          failureCodexAbortRequested: false,
          failureCodexDiagnosticsPresent: true,
          failureCodexExitCode: 1,
          failureCodexExitSignal: "SIGKILL",
          failureCodexFailureDetailPresent: true,
          failureCodexFailureStage: "process_exit",
          failureCodexJsonEventCount: 3,
          failureCodexLifecycleStage: "turn_running",
          failureCodexLiveTurnOpen: true,
          failureCodexPendingRpcCount: 1,
          failureCodexPendingRpcMethod: "turn/start",
          failureCodexProcessGroupPresent: true,
          failureCodexProcessLifetimeMs: 2041,
          failureCodexProviderRequestStarted: true,
          failureCodexShutdownRequested: false,
          failureCodexRetryable: false,
          failureCodexStderrPresent: true,
          failureCodexStderrBytes: 128,
          failureCodexTerminationSignalSent: null,
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
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);
    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
      component: "assistant",
      errorCode: "ASSISTANT_CODEX_FAILED",
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        errorCode: "ASSISTANT_CODEX_FAILED",
        failureCodexAbortRequested: false,
        failureCodexExitCode: 1,
        failureCodexExitSignal: "SIGKILL",
        failureCodexFailureDetailPresent: true,
        failureCodexFailureStage: "process_exit",
        failureCodexJsonEventCount: 3,
        failureCodexLifecycleStage: "turn_running",
        failureCodexLiveTurnOpen: true,
        failureCodexPendingRpcCount: 1,
        failureCodexPendingRpcMethod: "turn/start",
        failureCodexProcessGroupPresent: true,
        failureCodexProcessLifetimeMs: 2041,
        failureCodexProviderRequestStarted: true,
        failureCodexShutdownRequested: false,
        failureCodexRetryable: false,
        failureCodexStderrPresent: true,
        failureCodexStderrBytes: 128,
        failureCodexTerminationSignalSent: null,
        failureProviderActionCount: 4,
        failureRetryable: false,
        safeDetails: "provider usage limit reached (ASSISTANT_CODEX_FAILED)",
        safeErrorMessage:
          "Codex app-server failed. details: - usage limit reached; try again later - workspace: <REDACTED_PATH>",
        type: "input.reply-failed",
      }),
    }));
    const serializedLogRequests = JSON.stringify(logRequests);
    expect(serializedLogRequests).not.toContain('"itemId"');
    expect(serializedLogRequests).not.toContain('"mailboxDedupeKey"');
    expect(serializedLogRequests).not.toContain('"requestId"');
  });

  it("redacts unsafe diagnostic error text before persistence", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      nextWakeAt: null,
      redactedLogEntries: [{
        component: "runtime",
        level: "info",
        message: "Hosted assistant automation event: input.reply-failed.",
        phase: "wake.running",
        redacted: {
          errorCode: "ASSISTANT_CODEX_FAILED",
          safeErrorMessage:
            "Bearer raw-token-value https://api.openai.com/v1/responses",
          safeErrorPresent: true,
          safeErrorLength:
            "Bearer raw-token-value https://api.openai.com/v1/responses".length,
          type: "input.reply-failed",
        },
      }],
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({ logRequests }));
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      errorCode: "ASSISTANT_CODEX_FAILED",
      safeErrorLength:
        "Bearer raw-token-value https://api.openai.com/v1/responses".length,
      safeErrorMessage: "Bearer [redacted] <REDACTED_URL>",
      safeErrorPresent: true,
      type: "input.reply-failed",
    }));
    expect(JSON.stringify(logRequests)).not.toContain("raw-token-value");
    expect(JSON.stringify(logRequests)).not.toContain("api.openai.com");
  });

  it("persists diagnostics when Codex context is missing and error text needs path redaction", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      nextWakeAt: null,
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
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[0]?.entries[0]).toEqual(expect.objectContaining({
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
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).not.toEqual(expect.objectContaining({
      providerFailureRawPayloadReason: expect.anything(),
    }));
    expect(JSON.stringify(logRequests)).not.toContain("raw-provider-token");
    expect(JSON.stringify(logRequests)).not.toContain("raw payload should not persist");
  });

  it("writes an outbox delivery summary after committed delivery effects drain", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deliveryEffect = {
      ...createDeliveryEffect(),
      payload: {
        ...createDeliveryEffect().payload,
        media: [
          {
            alt: "Start",
            kind: "image" as const,
            source: "exercise_catalog:movement:1",
            url: "https://cdn.example.test/exercises/start.png",
          },
          {
            alt: "Finish",
            contentType: "image/png" as const,
            filename: "finish.png",
            kind: "vault_image" as const,
            ref: "generated/finish.png",
            sha256: "a".repeat(64),
            sizeBytes: 1234,
            source: "murph.generate_image",
          },
        ],
      },
    };
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
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
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
      "outbox.delivery_finished",
    ]);
    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "info",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 1,
        failed: 0,
        imageBearingIntentCount: 1,
        imageMediaItemCount: 2,
        maxMediaItemsPerIntent: 2,
        maxMessageLength: "Synthetic delivery".length,
        mediaItemCount: 2,
        mediaKindSummary: "image:1,vault_image:1",
        privateImageMediaItemCount: 1,
        publicImageMediaItemCount: 1,
        retryable: 0,
        sent: 1,
        statusSummary: "sent:1",
        totalImageAltTextLength: "Start".length + "Finish".length,
        totalMessageLength: "Synthetic delivery".length,
        vaultFileMediaItemCount: 0,
        voiceMemoMediaItemCount: 0,
      }),
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomes: [expect.objectContaining({
          deliveryChannel: "telegram",
          providerMessageId: "provider_synthetic",
        })],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
  });

  it("writes foreground delivery finished timing after deferred delivery drains", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const backgroundMaintenanceController = new AbortController();
    const shouldYieldBackgroundMaintenance = vi.fn(() => false);
    const deliveryEffect = createDeliveryEffect();
    const deferredDeliveryEffect = {
      ...deliveryEffect,
      payload: {
        ...deliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deferredDeliveryEffect.effectId],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deferredDeliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deferredDeliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deferredDeliveryEffect.fingerprint,
        effectId: deferredDeliveryEffect.effectId,
        journalMethod: "POST",
        journalStatus: "200",
        providerMessageId: "provider_deferred_foreground",
        providerMessageIds: [],
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      backgroundMaintenanceSignal: backgroundMaintenanceController.signal,
      importedCount: 1,
      logRequests,
      shouldYieldBackgroundMaintenance,
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson?.turnTimingStage)
        .filter(Boolean),
    ).not.toContain("foreground-delivery-phase-finished");

    await result.afterCheckpoint?.();

    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson?.turnTimingStage)
        .filter(Boolean),
    ).toEqual(expect.arrayContaining([
      "foreground-delivery-phase-started",
      "foreground-delivery-phase-finished",
    ]));
    const finishLogIndex = logRequests.findIndex(
      (request) =>
        request.entries[0]?.redactedJson?.turnTimingStage
          === "foreground-delivery-phase-finished",
    );
    const outboxLogIndex = logRequests.findIndex(
      (request) => request.entries[0]?.eventCode === "outbox.delivery_finished",
    );
    expect(outboxLogIndex).toBeGreaterThanOrEqual(0);
    expect(finishLogIndex).toBeGreaterThan(outboxLogIndex);
    expect(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.maintainAssistantAutoReplyRouteState.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.maintainAssistantAutoReplyRouteState).toHaveBeenCalledWith({
      shouldYield: shouldYieldBackgroundMaintenance,
      signal: backgroundMaintenanceController.signal,
      vault: "/tmp/murph-vault",
    });
  });

  it("waits for optional product feedback only after a queue-only foreground reply is sent", async () => {
    const deliveryEffect = {
      ...createDeliveryEffect(),
      payload: {
        ...createDeliveryEffect().payload,
        transportIdempotent: false,
      },
    };
    const feedback = {
      idempotencyKey: "feedback-after-member-delivery",
      kind: "feature_request" as const,
      relatedChangelogItemIds: [],
      summary: "Speculative: support the missing Murph path.",
    };
    let resolveFeedback: (value: {
      feedbackId: string;
      recorded: boolean;
    }) => void = () => {
      throw new Error("Product feedback completion was not initialized.");
    };
    const feedbackCompletion = new Promise<{
      feedbackId: string;
      recorded: boolean;
    }>((resolve) => {
      resolveFeedback = resolve;
    });
    let memberDeliveryCompleted = false;
    const recordProductFeedback = vi.fn(() => {
      expect(memberDeliveryCompleted).toBe(true);
      return feedbackCompletion;
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async (laneInput) => {
        laneInput.executionContext.hosted?.productFeedbackCandidateSink
          ?.acceptProductFeedbackCandidate(feedback);
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [
            deliveryEffect.effectId,
          ],
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(
      async () => {
        memberDeliveryCompleted = true;
        return [createSentDeliveryOutcome()];
      },
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      runtimeProductFeedbackPort: { recordProductFeedback },
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(recordProductFeedback).not.toHaveBeenCalled();

    const postCheckpointPromise = result.afterCheckpoint?.();
    await vi.waitFor(() => {
      expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledOnce();
      expect(recordProductFeedback).toHaveBeenCalledWith(feedback);
    });
    expect(memberDeliveryCompleted).toBe(true);

    let postCheckpointSettled = false;
    void postCheckpointPromise?.then(() => {
      postCheckpointSettled = true;
    });
    await Promise.resolve();
    expect(postCheckpointSettled).toBe(false);

    resolveFeedback({
      feedbackId: "feedback_synthetic",
      recorded: true,
    });
    await postCheckpointPromise;
  });

  it("does not record queued product feedback when the current delivery fails", async () => {
    const deliveryEffect = createDeliveryEffect();
    const feedback = {
      idempotencyKey: "feedback-after-failed-delivery",
      kind: "feature_request" as const,
      relatedChangelogItemIds: [],
      summary: "Speculative: support the missing Murph path.",
    };
    const recordProductFeedback = vi.fn();
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async (laneInput) => {
        laneInput.executionContext.hosted?.productFeedbackCandidateSink
          ?.acceptProductFeedbackCandidate(feedback);
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [
            deliveryEffect.effectId,
          ],
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "SYNTHETIC_DELIVERY_FAILURE",
        effectId: deliveryEffect.effectId,
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      runtimeProductFeedbackPort: { recordProductFeedback },
    }));
    await result.afterCheckpoint?.();

    expect(recordProductFeedback).not.toHaveBeenCalled();
  });

  it("records support escalations through the port inside the turn instead of the post-delivery flush", async () => {
    const supportFeedback = {
      idempotencyKey: "support-escalation-in-turn",
      kind: "frustration" as const,
      relatedChangelogItemIds: [],
      summary: "Support escalation: a connected source does not finish connecting.",
    };
    const recordProductFeedback = vi.fn(async () => ({
      feedbackId: "feedback_support_synthetic",
      recorded: true,
    }));
    let deliveredDuringLane: { recorded: boolean } | null = null;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(
      async (laneInput) => {
        const sink =
          laneInput.executionContext.hosted?.productFeedbackCandidateSink;
        if (!sink?.deliverProductSupportEscalation) {
          throw new Error(
            "Expected a durable support-escalation sink for the hosted lane.",
          );
        }
        deliveredDuringLane =
          await sink.deliverProductSupportEscalation(supportFeedback);
        return {
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      },
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      runtimeProductFeedbackPort: { recordProductFeedback },
    }));

    expect(deliveredDuringLane).toEqual({ recorded: true });
    expect(recordProductFeedback).toHaveBeenCalledExactlyOnceWith(
      supportFeedback,
    );

    await result.afterCheckpoint?.();
    expect(recordProductFeedback).toHaveBeenCalledOnce();
  });

  it("does not re-emit a stale pre-delivery outbox wake after deferred foreground delivery drains", async () => {
    const staleOutboxWakeAt = "2026-05-08T16:00:05.000Z";
    const deliveryEffect = createDeliveryEffect();
    const deferredDeliveryEffect = {
      ...deliveryEffect,
      payload: {
        ...deliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deferredDeliveryEffect.effectId],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deferredDeliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deferredDeliveryEffect),
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt
      .mockResolvedValueOnce(staleOutboxWakeAt)
      .mockResolvedValueOnce(null);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deferredDeliveryEffect.fingerprint,
        effectId: deferredDeliveryEffect.effectId,
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
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt: staleOutboxWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        nextWakeAt: null,
      }),
    }));
  });

  it("passes the runtime action-approval port into hosted delivery drain", async () => {
    const actionApprovalPort = {
      consume: vi.fn(),
      read: vi.fn(),
      request: vi.fn(),
    };
    const deliveryEffect = createDeliveryEffect();
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
        journalMethod: "POST",
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
      runtimeActionApprovalPort: actionApprovalPort,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        actionApprovalPort,
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        actionApprovalPort,
        assistantDeliveryEffects: [deliveryEffect],
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
        vaultRoot: "/tmp/murph-vault",
      }),
    );
  });

  it("yields prepared background outbox delivery when foreground work appears before post-checkpoint drain", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    let shouldYield = false;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      shouldYield = true;
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:00:30.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      shouldYieldBackgroundMaintenance: () => shouldYield,
      workspace: createDueAssistantWorkspace(),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: false,
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: "2026-04-27T00:00:00.000Z",
        hostedOutboxDeliveryYielded: 1,
        nextWakeAt: "2026-04-27T00:00:00.000Z",
      }),
    }));
  });

  it("yields prepared background outbox delivery when foreground work appears after the member-channel barrier", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    let shouldYield = false;
    const prepareAutoReplyDelivery = vi.fn(async () => {
      shouldYield = true;
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:00:30.000Z",
    );
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      prepareAutoReplyDelivery,
      shouldYieldBackgroundMaintenance: () => shouldYield,
      workspace: createDueAssistantWorkspace(),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      afterCheckpointKeepsForegroundImportLoop: true,
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
    expect(prepareAutoReplyDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliveryYielded: 1,
      }),
    }));
  });

  it("yields prepared background outbox delivery when foreground work appears inside the prepared drain", async () => {
    const firstDeliveryEffect = {
      ...createDeliveryEffect(),
      deliveryPhase: "background_retry" as const,
      effectId: "effect_late_yield_first",
      fingerprint: "fingerprint_late_yield_first",
      payload: {
        ...createDeliveryEffect().payload,
        idempotencyKey: "assistant-outbox:intent_late_yield_first",
      },
    };
    const secondDeliveryEffect = {
      ...createDeliveryEffect(),
      deliveryPhase: "background_retry" as const,
      effectId: "effect_late_yield_second",
      fingerprint: "fingerprint_late_yield_second",
      payload: {
        ...createDeliveryEffect().payload,
        idempotencyKey: "assistant-outbox:intent_late_yield_second",
      },
    };
    const preparedDispatches = [
      ...createPreparedDispatchesForDeliveryEffect(firstDeliveryEffect),
      ...createPreparedDispatchesForDeliveryEffect(secondDeliveryEffect),
    ];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      firstDeliveryEffect,
      secondDeliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:00:30.000Z",
    );
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async (input) => {
      expect(input.shouldYieldBackgroundDelivery?.()).toBe(false);
      input.onBackgroundDeliveryYield?.({ yieldedEffectCount: 1 });
      return [{
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: firstDeliveryEffect.fingerprint,
        effectId: firstDeliveryEffect.effectId,
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_late_yield_first",
        providerMessageIds: [],
        providerThreadId: "thread_late_yield_first",
        retryable: false,
        target: null,
        targetKind: null,
      }];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      shouldYieldBackgroundMaintenance: () => false,
      workspace: createDueAssistantWorkspace(),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [firstDeliveryEffect, secondDeliveryEffect],
        onBackgroundDeliveryYield: expect.any(Function),
        preparedDispatches,
        shouldYieldBackgroundDelivery: expect.any(Function),
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:05:00.000Z",
      },
      linqMessageIds: ["provider_late_yield_first"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: "2026-04-27T00:00:00.000Z",
        hostedOutboxDeliveryYielded: 1,
        nextWakeAt: "2026-04-27T00:00:00.000Z",
      }),
    }));
  });

  it("stages terminal delivery failure input before yielding prepared background outbox delivery", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-yield-",
    ));
    try {
      const now = "2026-04-27T00:00:00.000Z";
      const intentCreatedAt = "2026-04-26T23:59:50.000Z";
      await seedDirectLinqAssistantInputRoute({
        enabledAt: intentCreatedAt,
        vaultRoot,
      });
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const baseEffect = createDeliveryEffect();
      const firstDeliveryEffect = {
        ...baseEffect,
        deliveryPhase: "background_retry" as const,
        effectId: "intent_terminal_failure_late_yield_first",
        fingerprint: "fingerprint_terminal_failure_late_yield_first",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_terminal_failure_late_yield_first",
          media: [{
            approvalGeneration: "b".repeat(64),
            approvalId: "approval_terminal_failure_late_yield",
            contentType: "application/pdf",
            filename: "lab-results.pdf",
            kind: "vault_file" as const,
            ref: "documents/lab-results.pdf",
            sha256: "a".repeat(64),
            sizeBytes: 1234,
          }, {
            alt: "Start position",
            kind: "image" as const,
            source: "exercise_catalog:movement:1",
            url: "https://cdn.example.test/exercises/start.png",
          }],
        },
      };
      const secondDeliveryEffect = {
        ...createDeliveryEffect(),
        deliveryPhase: "background_retry" as const,
        effectId: "intent_terminal_failure_late_yield_second",
        fingerprint: "fingerprint_terminal_failure_late_yield_second",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_terminal_failure_late_yield_second",
        },
      };
      const preparedDispatches = [
        ...createPreparedDispatchesForDeliveryEffect(firstDeliveryEffect),
        ...createPreparedDispatchesForDeliveryEffect(secondDeliveryEffect),
      ];
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: firstDeliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: firstDeliveryEffect.fingerprint,
        retryable: false,
      };
      let shouldYield = false;
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === firstDeliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          bindingDeliveryTarget: "linq_chat_direct",
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: firstDeliveryEffect.effectId,
          explicitTarget: null,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        firstDeliveryEffect,
        secondDeliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
        preparedDispatches,
      });
      mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
        "2026-04-27T00:00:30.000Z",
      );
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async (input) => {
        expect(input.shouldYieldBackgroundDelivery?.()).toBe(false);
        const outcomes = [terminalFailure];
        shouldYield = true;
        expect(input.shouldYieldBackgroundDelivery?.()).toBe(true);
        input.onBackgroundDeliveryYield?.({ yieldedEffectCount: 1 });
        return outcomes;
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        shouldYieldBackgroundMaintenance: () => shouldYield,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = await result.afterCheckpoint?.();

      expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
      expect(mocks.resetHostedPreparedAssistantDeliveryEffects).not.toHaveBeenCalled();
      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: now,
        nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
        redactedStatus: expect.objectContaining({
          hostedAssistantNextWakeAt: now,
          hostedOutboxDeliveryYielded: 1,
          hostedOutboxTerminalFailureInputsStaged: 1,
          nextWakeAt: now,
        }),
      }));
      const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.sourceRef.kind).toBe("hosted-mailbox");
      if (event?.sourceRef.kind !== "hosted-mailbox") {
        throw new Error("Expected hosted-mailbox terminal failure input.");
      }
      expect(event.sourceRef.causalSeq).toBeUndefined();
      expect(event.sourceRef.eventId).toBe(
        `outbox-delivery-failed:${firstDeliveryEffect.effectId}`,
      );
      expect(event?.replyTarget).toEqual({
        channel: "linq",
        messageId: null,
        threadId: "linq_chat_direct",
      });
      expect(event?.occurredAt).toBe(intentCreatedAt);
      expect(event?.content.text).toContain(
        "outgoing message failed to send and was NOT delivered",
      );
      expect(event?.content.text).toContain('vault file "lab-results.pdf"');
      expect(event?.content.text).toContain("1 image");
      expect(event?.content.text).toContain(
        "A text-only substitute is not equivalent; do not offer or send one as recovery",
      );
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it.each([
    {
      bindingDelivery: { kind: "thread" as const, target: "linq_chat_direct" },
      cronStatusAvailable: true,
      label: "direct-thread",
    },
    {
      bindingDelivery: { kind: "participant" as const, target: "member_synthetic" },
      cronStatusAvailable: false,
      label: "participant",
    },
  ])(
    "re-arms cron without a failure note after an authority-stale $label delivery",
    async ({ bindingDelivery, cronStatusAvailable, label }) => {
      const vaultRoot = await mkdtemp(path.join(
        tmpdir(),
        `murph-outbox-authority-stale-${label}-`,
      ));
      try {
        const now = "2026-04-27T00:00:00.000Z";
        const cronRetryAt = "2026-04-27T00:00:30.000Z";
        const effect = {
          ...createDeliveryEffect(),
          deliveryPhase: "background_retry" as const,
          effectId: `intent_authority_stale_${label}`,
          fingerprint: `fingerprint_authority_stale_${label}`,
          payload: {
            ...createDeliveryEffect().payload,
            channel: "linq" as const,
            idempotencyKey: `assistant-outbox:intent_authority_stale_${label}`,
          },
        };
        const authorityStaleOutcome = {
          ...createFailedDeliveryOutcome({
            deliveryErrorCode: "ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE",
            effectId: effect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: effect.fingerprint,
          retryable: false,
        };
        let deliverySettled = false;
        mocks.readAssistantOutboxIntent.mockResolvedValue(
          createTerminalFailureOutboxIntent({
            bindingDelivery,
            createdAt: "2026-04-26T23:59:50.000Z",
            effectId: effect.effectId,
          }),
        );
        mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
          effect,
        ]);
        mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(
          async () => {
            deliverySettled = true;
            return [authorityStaleOutcome];
          },
        );
        mocks.getAssistantCronStatus.mockImplementation(async () => {
          if (deliverySettled && !cronStatusAvailable) {
            throw new Error("cron status temporarily unavailable");
          }
          return deliverySettled
            ? {
                dueJobs: 0,
                enabledJobs: 1,
                nextRunAt: cronRetryAt,
                runningJobs: 0,
                totalJobs: 1,
              }
            : {
                dueJobs: 0,
                enabledJobs: 0,
                nextRunAt: null,
                runningJobs: 0,
                totalJobs: 0,
              };
        });

        const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
          now: () => now,
          vaultRoot,
          workspace: createDueAssistantWorkspace(),
        }));
        const postCheckpoint = await result.afterCheckpoint?.();

        expect(postCheckpoint).toEqual(expect.objectContaining({
          checkpointReason: "outbox_receipt",
          nextWakeAt: cronRetryAt,
          redactedStatus: expect.objectContaining({
            hostedAssistantNextWakeAt: cronRetryAt,
            hostedOutboxTerminalFailureInputsStaged: 0,
            nextWakeAt: cronRetryAt,
          }),
        }));
        expect(mocks.getAssistantCronStatus).toHaveBeenLastCalledWith(
          vaultRoot,
          expect.any(Object),
        );
        await expect(readExistingHostedPendingAssistantInputIds({
          vaultRoot,
        })).resolves.toEqual([]);
      } finally {
        await rm(vaultRoot, { force: true, recursive: true });
      }
    },
  );

  it("does not carry device-sync next-wake reasons from the assistant automation lane", async () => {
    const nextWakeAt = new Date(Date.now() + 60_000).toISOString();
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: false,
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      workspace: createDueAssistantWorkspace(),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt,
      progressed: true,
    }));
    expect(result).not.toHaveProperty("nextWakeReason");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt,
    }));
    expect(postCheckpoint?.nextWakeReason).not.toBe("device-sync.reconcile");
  });

  it("clears a consumed assistant wake after post-checkpoint delivery", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: consumedWakeAt,
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
      now: () => now,
      workspace: createDueAssistantWorkspace(),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt: consumedWakeAt,
    }));

    now = "2026-05-08T16:00:08.000Z";
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedOutboxDeliveryAttempted: 1,
        hostedOutboxDeliverySent: 1,
        hostedOutboxPendingDeliveryEffects: 0,
        hostedOutboxTerminalizedSending: 1,
        nextWakeAt: null,
      }),
    }));
  });

  it("drops a consumed workspace assistant wake echo when post-delivery cron status is unavailable", async () => {
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.getAssistantCronStatus
      .mockResolvedValueOnce({
        dueJobs: 0,
        enabledJobs: 0,
        nextRunAt: null,
        runningJobs: 0,
        totalJobs: 0,
      })
      .mockRejectedValueOnce(new Error("cron status unavailable"));
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: consumedWakeAt,
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
      now: () => "2026-05-08T16:00:08.000Z",
      workspace: createDueAssistantWorkspace({
        checkpointedAt: "2026-05-08T16:00:00.000Z",
        createdAt: "2026-05-08T16:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        updatedAt: "2026-05-08T16:00:00.000Z",
      }),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: null,
      }),
    }));
  });

  it("preserves a post-delivery outbox-only wake with delivery ownership", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.resolveHostedAssistantOutboxNextWakeAt
      .mockResolvedValueOnce(consumedWakeAt);
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      assistantAutomationOutboxOnlyNextWakeAt: consumedWakeAt,
      nextWakeAt: consumedWakeAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      now = "2026-05-08T16:00:08.000Z";
      return [
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
      ];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => now,
      workspace: createDueAssistantWorkspace({
        checkpointedAt: "2026-05-08T16:00:00.000Z",
        createdAt: "2026-05-08T16:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        updatedAt: "2026-05-08T16:00:00.000Z",
      }),
    }));

    expect(mocks.resolveHostedAssistantOutboxNextWakeAt).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: consumedWakeAt,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: consumedWakeAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: consumedWakeAt,
      }),
    }));
  });

  it("drops a consumed workspace assistant wake after fresh system-mailbox delivery", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: consumedWakeAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      now = "2026-05-08T16:00:08.000Z";
      return [
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
      ];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      workspace: createDueAssistantWorkspace({
        checkpointedAt: "2026-05-08T16:00:00.000Z",
        createdAt: "2026-05-08T16:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        updatedAt: "2026-05-08T16:00:00.000Z",
      }),
    }));

    expect(mocks.resolveHostedAssistantOutboxNextWakeAt).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-05-08T16:05:08.000Z",
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: "2026-05-08T16:05:08.000Z",
        hostedOutboxDeliverySent: 1,
        nextWakeAt: "2026-05-08T16:05:08.000Z",
      }),
    }));
  });

  it("preserves a pending system-mailbox wake matching a consumed assistant wake after delivery", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.resolveHostedSystemMailboxNextWakeAt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(consumedWakeAt);
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationProgressed: true,
      nextWakeAt: consumedWakeAt,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      now = "2026-05-08T16:00:08.000Z";
      return [
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
      ];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => now,
      workspace: createDueAssistantWorkspace({
        checkpointedAt: "2026-05-08T16:00:00.000Z",
        createdAt: "2026-05-08T16:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        updatedAt: "2026-05-08T16:00:00.000Z",
      }),
    }));

    expect(mocks.resolveHostedSystemMailboxNextWakeAt).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: consumedWakeAt,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: consumedWakeAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: consumedWakeAt,
      }),
    }));
  });

  it("routes terminal delivery failure pending input to the failed intent thread, not the current session", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-route-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_a",
        deliveryTarget: "linq_chat_a",
        enabledAt: intentCreatedAt,
        identityId: "identity_linq_a",
        sessionId: "asst_linq_a",
        threadId: "thread_linq_a",
        vaultRoot,
      });
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_b",
        deliveryTarget: "linq_chat_b",
        enabledAt: "2026-05-08T16:00:05.000Z",
        identityId: "identity_linq_b",
        sessionId: "asst_linq_b",
        threadId: "thread_linq_b",
        vaultRoot,
      });
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const baseEffect = createDeliveryEffect();
      const deliveryEffect = {
        ...baseEffect,
        effectId: "intent_terminal_failure_thread_a",
        fingerprint: "fingerprint_terminal_failure_thread_a",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey: "assistant-outbox:intent_terminal_failure_thread_a",
        },
      };
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: deliveryEffect.fingerprint,
        retryable: false,
      };
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === deliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          actorId: "actor_linq_a",
          bindingDeliveryTarget: "linq_chat_a",
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_linq_a",
          replyToMessageId: "linq_message_a",
          threadId: "thread_linq_a",
          threadIsDirect: true,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(async () => {
        return [terminalFailure];
      });

      const firstResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const firstPostCheckpoint = firstResult.afterCheckpoint
        ? await firstResult.afterCheckpoint()
        : firstResult;

      expect(firstPostCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.conversation).toEqual({
        accountId: "identity_linq_a",
        actorId: "actor_linq_a",
        actorIsSelf: false,
        sessionId: null,
        source: "linq",
        threadId: "thread_linq_a",
        threadIsDirect: true,
      });
      expect(event?.replyTarget).toEqual({
        channel: "linq",
        messageId: null,
        threadId: "linq_chat_a",
      });
      expect(event?.conversation?.threadId).not.toBe("thread_linq_b");
      expect(event?.replyTarget?.threadId).not.toBe("linq_chat_b");
      expect(event?.occurredAt).toBe(intentCreatedAt);
      expect(event?.receivedAt).toBe(intentCreatedAt);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("routes terminal delivery failure pending input to the explicit target when it overrides binding delivery", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-explicit-target-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_a",
        deliveryTarget: "linq_chat_a",
        enabledAt: intentCreatedAt,
        identityId: "identity_linq_a",
        sessionId: "asst_linq_a",
        threadId: "thread_linq_a",
        vaultRoot,
      });
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_b",
        deliveryTarget: "linq_chat_b",
        enabledAt: "2026-05-08T16:00:05.000Z",
        identityId: "identity_linq_b",
        sessionId: "asst_linq_b",
        threadId: "thread_linq_b",
        vaultRoot,
      });
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const baseEffect = createDeliveryEffect();
      const deliveryEffect = {
        ...baseEffect,
        effectId: "intent_terminal_failure_explicit_target",
        fingerprint: "fingerprint_terminal_failure_explicit_target",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey: "assistant-outbox:intent_terminal_failure_explicit_target",
        },
      };
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: deliveryEffect.fingerprint,
        retryable: false,
      };
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === deliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          actorId: "actor_linq_b",
          bindingDelivery: { kind: "thread", target: "linq_chat_a" },
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: "linq_chat_b",
          identityId: "identity_linq_b",
          replyToMessageId: "linq_message_b",
          threadId: "thread_linq_b",
          threadIsDirect: true,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        terminalFailure,
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.replyTarget?.threadId).toBe("linq_chat_b");
      expect(event?.replyTarget?.threadId).not.toBe("linq_chat_a");
      expect(event?.conversation?.threadId).toBe("thread_linq_b");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps terminal delivery failure input idempotent after the current session changes", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-idempotent-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const laterNow = "2026-05-08T16:05:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_a",
        deliveryTarget: "linq_chat_a",
        enabledAt: intentCreatedAt,
        identityId: "identity_linq_a",
        sessionId: "asst_linq_a",
        threadId: "thread_linq_a",
        vaultRoot,
      });
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const baseEffect = createDeliveryEffect();
      const deliveryEffect = {
        ...baseEffect,
        effectId: "intent_terminal_failure_idempotent",
        fingerprint: "fingerprint_terminal_failure_idempotent",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey: "assistant-outbox:intent_terminal_failure_idempotent",
        },
      };
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: deliveryEffect.fingerprint,
        retryable: false,
      };
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === deliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          actorId: "actor_linq_a",
          bindingDeliveryTarget: "linq_chat_a",
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_linq_a",
          replyToMessageId: "linq_message_a",
          threadId: "thread_linq_a",
          threadIsDirect: true,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        terminalFailure,
      ]);

      const firstResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const firstPostCheckpoint = firstResult.afterCheckpoint
        ? await firstResult.afterCheckpoint()
        : firstResult;
      expect(firstPostCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
        }),
      }));
      const firstPendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(firstPendingInputIds).toHaveLength(1);
      const firstEvent = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: firstPendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(firstEvent?.replyTarget?.threadId).toBe("linq_chat_a");

      await seedDirectLinqAssistantInputRoute({
        actorId: "actor_linq_b",
        deliveryTarget: "linq_chat_b",
        enabledAt: laterNow,
        identityId: "identity_linq_b",
        sessionId: "asst_linq_b",
        threadId: "thread_linq_b",
        vaultRoot,
      });
      const secondResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => laterNow,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const secondPostCheckpoint = secondResult.afterCheckpoint
        ? await secondResult.afterCheckpoint()
        : secondResult;
      expect(secondPostCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
        }),
      }));
      const secondPendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(secondPendingInputIds).toEqual(firstPendingInputIds);
      const secondEvent = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: secondPendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(secondEvent?.replyTarget?.threadId).toBe("linq_chat_a");
      expect(secondEvent?.conversation?.threadId).toBe("thread_linq_a");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps terminal member-facing delivery failure pending input replyable through compaction and the next assistant pass", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-compaction-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const laterNow = "2026-05-08T16:05:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await seedDirectLinqAssistantInputRoute({
        enabledAt: intentCreatedAt,
        vaultRoot,
      });
      mocks.resolveHostedPendingAssistantInputWakeAt.mockImplementation(
        resolveHostedPendingAssistantInputWakeAtWithRealImplementation,
      );
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      mocks.readAssistantInputEvent.mockImplementation(
        actualAssistantAutomation.readAssistantInputEvent,
      );
      const baseEffect = createDeliveryEffect();
      const deliveryEffect = {
        ...baseEffect,
        effectId: "intent_vault_file_terminal_failure",
        fingerprint: "fingerprint_vault_file_terminal_failure",
        payload: {
          ...baseEffect.payload,
          channel: "linq" as const,
          idempotencyKey: "assistant-outbox:intent_vault_file_terminal_failure",
          media: [{
            approvalGeneration: "b".repeat(64),
            approvalId: "approval_vault_file_terminal_failure",
            contentType: "application/pdf",
            filename: "lab-results.pdf",
            kind: "vault_file" as const,
            ref: "documents/lab-results.pdf",
            sha256: "a".repeat(64),
            sizeBytes: 1234,
          }],
        },
      };
      const terminalFailure = {
        ...createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
        deliveryStatus: "failed" as const,
        effectFingerprint: deliveryEffect.fingerprint,
        retryable: false,
      };
      mocks.readAssistantOutboxIntent.mockImplementation(async (
        _vaultRoot: string,
        intentId: string,
      ) => intentId === deliveryEffect.effectId
        ? createTerminalFailureOutboxIntent({
          bindingDeliveryTarget: "linq_chat_direct",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
        })
        : null);
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        terminalFailure,
      ]);

      const firstResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const firstPostCheckpoint = firstResult.afterCheckpoint
        ? await firstResult.afterCheckpoint()
        : firstResult;

      expect(firstPostCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: now,
        nextWakeReason: "assistant",
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      let pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      await expect(resolveHostedPendingAssistantInputWakeAtWithRealImplementation({
        now: () => now,
        vaultRoot,
      })).resolves.toBe(now);
      pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.conversation?.source).toBe("linq");
      expect(event?.replyTarget).toEqual({
        channel: "linq",
        messageId: null,
        threadId: "linq_chat_direct",
      });
      expect(event?.occurredAt).toBe(intentCreatedAt);
      expect(event?.receivedAt).toBe(intentCreatedAt);
      expect(event?.content.text).toContain(
        "outgoing message failed to send and was NOT delivered",
      );
      expect(event?.content.text).toContain("channel: linq");
      expect(event?.content.text).toContain("failure code: LINQ_API_REQUEST_FAILED");
      expect(event?.content.text).toContain('vault file "lab-results.pdf"');
      expect(event?.content.text).toContain(
        "Any consumed vault-file approval must be re-requested before retrying",
      );
      expect(event?.content.text).not.toContain("documents/lab-results.pdf");
      expect(event?.content.text).not.toContain("presigned");

      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([]);
      const noteTextsSeenByAssistantPass: string[] = [];
      mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async (laneInput) => {
        expect(laneInput.freshAssistantInputIds).toEqual([event?.inputId]);
        for (const inputId of laneInput.freshAssistantInputIds) {
          const actualEvent = await actualAssistantAutomation.readAssistantInputEvent({
            inputId,
            vault: vaultRoot,
          });
          if (actualEvent?.content.text) {
            noteTextsSeenByAssistantPass.push(actualEvent.content.text);
          }
        }
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: true,
          nextWakeAt: null,
          redactedLogEntries: [],
        };
      });

      await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [event!.inputId],
        importedCount: 1,
        now: () => laterNow,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));

      expect(noteTextsSeenByAssistantPass).toHaveLength(1);
      expect(noteTextsSeenByAssistantPass[0]).toContain(
        "outgoing message failed to send and was NOT delivered",
      );

      pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      expect(pendingInputIds[0]).toBe(event?.inputId);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("stages terminal delivery failure input when a mixed reply answered a failure note and a user message", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-mixed-one-hop-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_terminal_failure_mixed_recovery_reply",
        fingerprint: "fingerprint_terminal_failure_mixed_recovery_reply",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_terminal_failure_mixed_recovery_reply",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          actorId: "actor_linq_direct",
          answeredMailboxItemIds: [
            "outbox-delivery-failed:intent_original_terminal_failure",
            "hosted-mailbox-item-user-b",
          ],
          bindingDeliveryTarget: "linq_chat_direct",
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_linq_direct",
          replyToMessageId: "linq_message_direct",
          threadId: "thread_linq_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryChannel: "linq",
            deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 1,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      });
      expect(pendingInputIds).toHaveLength(1);
      const event = await actualAssistantAutomation.readAssistantInputEvent({
        inputId: pendingInputIds[0]!,
        vault: vaultRoot,
      });
      expect(event?.sourceRef.kind).toBe("hosted-mailbox");
      if (event?.sourceRef.kind !== "hosted-mailbox") {
        throw new Error("Expected hosted-mailbox terminal failure input.");
      }
      expect(event.sourceRef.eventId).toBe(
        "outbox-delivery-failed:intent_terminal_failure_mixed_recovery_reply",
      );
      expect(event?.replyTarget).toEqual({
        channel: "linq",
        messageId: null,
        threadId: "linq_chat_direct",
      });
      expect(event?.conversation?.threadId).toBe("thread_linq_direct");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input when a terminal failure was itself replying to a failure note", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-one-hop-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_terminal_failure_recovery_reply",
        fingerprint: "fingerprint_terminal_failure_recovery_reply",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "telegram" as const,
          idempotencyKey:
            "assistant-outbox:intent_terminal_failure_recovery_reply",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          actorId: "actor_telegram_direct",
          answeredMailboxItemIds: [
            "outbox-delivery-failed:intent_original_terminal_failure",
          ],
          bindingDeliveryTarget: "telegram_chat_direct",
          channel: "telegram",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_telegram_direct",
          replyToMessageId: "telegram_message_direct",
          threadId: "thread_telegram_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryChannel: "telegram",
            deliveryErrorCode: "TELEGRAM_SEND_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input for terminal failures without a durable direct route on the intent", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-no-route-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: intentCreatedAt,
        }],
        updatedAt: intentCreatedAt,
        version: 1,
      });
      mocks.resolveHostedPendingAssistantInputWakeAt.mockImplementation(
        resolveHostedPendingAssistantInputWakeAtWithRealImplementation,
      );
      const actualAssistantAutomation =
        await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>(
          "@murphai/assistant-engine/assistant-automation",
        );
      mocks.readAssistantInputEvent.mockImplementation(
        actualAssistantAutomation.readAssistantInputEvent,
      );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_vault_file_terminal_failure_no_route",
        fingerprint: "fingerprint_vault_file_terminal_failure_no_route",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_vault_file_terminal_failure_no_route",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          bindingDeliveryTarget: null,
          channel: null,
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          threadId: null,
          threadIsDirect: null,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input for terminal reaction operation failures", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-reaction-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_telegram_reaction_terminal_failure",
        fingerprint: "fingerprint_telegram_reaction_terminal_failure",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "telegram" as const,
          idempotencyKey:
            "assistant-outbox:intent_telegram_reaction_terminal_failure",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          actorId: "actor_telegram_direct",
          bindingDeliveryTarget: "telegram_chat_direct",
          channel: "telegram",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          identityId: "identity_telegram_direct",
          operation: {
            kind: "message-reaction",
            reaction: "heart",
          },
          replyToMessageId: "telegram_message_direct",
          threadId: "thread_telegram_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryChannel: "telegram",
            deliveryErrorCode: "TELEGRAM_REACTION_DELIVERY_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
          hostedOutboxTerminalizedSending: 1,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input for participant terminal failure delivery candidates", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-terminal-failure-participant-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "linq",
          eligibleAfter: null,
          enabledAt: intentCreatedAt,
        }],
        updatedAt: intentCreatedAt,
        version: 1,
      });
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_vault_file_terminal_failure_participant",
        fingerprint: "fingerprint_vault_file_terminal_failure_participant",
        payload: {
          ...createDeliveryEffect().payload,
          channel: "linq" as const,
          idempotencyKey:
            "assistant-outbox:intent_vault_file_terminal_failure_participant",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          bindingDelivery: { kind: "participant", target: "+15550000001" },
          channel: "linq",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: null,
          threadId: "thread_linq_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage terminal failure input for email because it has no supported direct reply route here", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-email-terminal-failure-",
    ));
    try {
      const now = "2026-05-08T16:00:08.000Z";
      const intentCreatedAt = "2026-05-08T16:00:00.000Z";
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId: "intent_email_terminal_failure",
        fingerprint: "fingerprint_email_terminal_failure",
        payload: {
          ...createDeliveryEffect().payload,
          idempotencyKey: "assistant-outbox:intent_email_terminal_failure",
        },
      };
      mocks.readAssistantOutboxIntent.mockResolvedValue(
        createTerminalFailureOutboxIntent({
          bindingDeliveryTarget: "email_thread_direct",
          channel: "email",
          createdAt: intentCreatedAt,
          effectId: deliveryEffect.effectId,
          explicitTarget: "email_thread_direct",
          threadId: "email_thread_direct",
          threadIsDirect: true,
        }),
      );
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        {
          ...createFailedDeliveryOutcome({
            deliveryChannel: "email",
            deliveryErrorCode: "EMAIL_SEND_FAILED",
            effectId: deliveryEffect.effectId,
          }),
          deliveryStatus: "failed" as const,
          effectFingerprint: deliveryEffect.fingerprint,
          retryable: false,
        },
      ]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => now,
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not stage pending assistant input for retryable delivery failures", async () => {
    const vaultRoot = await mkdtemp(path.join(
      tmpdir(),
      "murph-outbox-retryable-failure-",
    ));
    try {
      const deliveryEffect = createDeliveryEffect();
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([
        deliveryEffect,
      ]);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValue([
        createFailedDeliveryOutcome({
          deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
          effectId: deliveryEffect.effectId,
        }),
      ]);
      mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(null);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        vaultRoot,
        workspace: createDueAssistantWorkspace(),
      }));
      const postCheckpoint = result.afterCheckpoint
        ? await result.afterCheckpoint()
        : result;

      expect(postCheckpoint).toEqual(expect.objectContaining({
        redactedStatus: expect.objectContaining({
          hostedOutboxTerminalFailureInputsStaged: 0,
        }),
      }));
      await expect(readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("fast-dispatches idempotent active nudge delivery before the runner checkpoint", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    await expect(result.afterCheckpoint?.()).resolves.toBeNull();
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedOutboxDeliveryAttempted: 1,
      hostedOutboxDeliverySent: 1,
      hostedOutboxPendingDeliveryEffects: 0,
      hostedOutboxTerminalizedSending: 1,
      nextWakeAt: null,
    }));
    expect(result.nextWakeAt).toBeNull();
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
  });

  it.each([
    {
      cronStatus: {
        dueJobs: 2,
        enabledJobs: 7,
        nextRunAt: "2026-05-08T16:00:00.000Z",
        runningJobs: 0,
        totalJobs: 7,
      },
      expectedNextWakeAt: "2026-05-08T16:00:00.000Z",
      label: "available due work",
    },
    {
      cronStatus: {
        dueJobs: 0,
        enabledJobs: 7,
        nextRunAt: "2026-05-08T17:00:00.000Z",
        runningJobs: 0,
        totalJobs: 7,
      },
      expectedNextWakeAt: "2026-05-08T17:00:00.000Z",
      label: "available future work",
    },
    {
      cronStatus: {
        dueJobs: 0,
        enabledJobs: 0,
        nextRunAt: null,
        runningJobs: 0,
        totalJobs: 0,
      },
      expectedNextWakeAt: null,
      label: "available empty state",
    },
    {
      cronStatus: null,
      expectedNextWakeAt: null,
      label: "unavailable status",
    },
  ])(
    "reconciles live post-scan cron status through clean fast dispatch: $label",
    async ({ cronStatus, expectedNextWakeAt }) => {
      const now = "2026-05-08T16:00:00.000Z";
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
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
        createSentDeliveryOutcome(),
      ]);
      mocks.getAssistantCronStatus.mockResolvedValueOnce({
        dueJobs: 1,
        enabledJobs: 7,
        nextRunAt: now,
        runningJobs: 0,
        totalJobs: 7,
      });
      if (cronStatus) {
        mocks.getAssistantCronStatus.mockResolvedValueOnce(cronStatus);
      } else {
        mocks.getAssistantCronStatus.mockRejectedValueOnce(
          new Error("synthetic cron status unavailable"),
        );
      }

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        conversationImportedCount: 0,
        importedCount: 1,
        now: () => now,
        workspace: createDueAssistantWorkspace({
          nextWakeAt: now,
        }),
      }));

      expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
      expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: expectedNextWakeAt,
        progressed: true,
      }));
    },
  );

  it("returns a fast-dispatch foreground reply without starting a stalled cron read", async () => {
    const cronStatusPromise = new Promise<never>(() => undefined);
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
    mocks.getAssistantCronStatus.mockReturnValueOnce(cronStatusPromise);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result.nextWakeAt).toBeNull();
  });

  it("clears bootstrap-only schedule writes before deciding whether foreground maintenance is needed", async () => {
    let scheduleChanged = true;
    const clearAssistantAutomationScheduleChanged = vi.fn(() => {
      scheduleChanged = false;
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      expect(clearAssistantAutomationScheduleChanged).toHaveBeenCalledTimes(1);
      expect(scheduleChanged).toBe(false);
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: ["effect_synthetic"],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantAutomationScheduleChanged: () => scheduleChanged,
      clearAssistantAutomationScheduleChanged,
      importedCount: 1,
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(clearAssistantAutomationScheduleChanged).toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result.nextWakeAt).toBeNull();
  });

  it("arms mutation-driven cron maintenance before deferred foreground delivery drains", async () => {
    const reconciliationWakeAt = "2026-05-08T16:00:00.000Z";
    const existingDeviceSyncWakeAt = "2026-05-08T16:05:00.000Z";
    const baseDeliveryEffect = createDeliveryEffect();
    const deliveryEffect = {
      ...baseDeliveryEffect,
      payload: {
        ...baseDeliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    let scheduleChanged = true;
    const clearAssistantAutomationScheduleChanged = vi.fn(() => {
      scheduleChanged = false;
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      expect(clearAssistantAutomationScheduleChanged).toHaveBeenCalledTimes(1);
      expect(scheduleChanged).toBe(false);
      scheduleChanged = true;
      return {
        assistantAutomationCronStatusDeferred: true,
        assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantAutomationScheduleChanged: () => scheduleChanged,
      clearAssistantAutomationScheduleChanged,
      importedCount: 1,
      now: () => reconciliationWakeAt,
      workspace: {
        checkpointedAt: "2026-05-08T15:59:00.000Z",
        createdAt: "2026-05-08T15:00:00.000Z",
        nextWakeAt: existingDeviceSyncWakeAt,
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T15:59:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(clearAssistantAutomationScheduleChanged).toHaveBeenCalledTimes(1);
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      checkpointReason: "outbox_sending",
      nextWakeAt: reconciliationWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: reconciliationWakeAt,
        hostedOutboxPendingDeliveryEffects: 1,
      }),
    }));
    expect(result).not.toHaveProperty("nextWakeReason");

    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createSentDeliveryOutcome(),
    ]);
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: reconciliationWakeAt,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: reconciliationWakeAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: reconciliationWakeAt,
      }),
    }));
  });

  it("arms foreground cron reconciliation without status reads when no delivery effects are produced", async () => {
    const reconciliationWakeAt = "2026-05-08T16:00:00.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCronStatusDeferred: true,
      assistantAutomationCurrentTurnDeliveryIntentIds: ["intent_missing"],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantAutomationScheduleChanged: () => true,
      importedCount: 1,
      now: () => reconciliationWakeAt,
    }));

    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: reconciliationWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: reconciliationWakeAt,
        hostedOutboxPendingDeliveryEffects: 0,
      }),
    }));
  });

  it("drops the consumed assistant cron wake after clean post-checkpoint delivery", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      vi.setSystemTime(new Date("2026-05-08T16:00:00.100Z"));
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: consumedWakeAt,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-05-08T16:00:01.000Z"));
        return [createSentDeliveryOutcome()];
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:50.000Z",
          createdAt: "2026-05-08T15:00:00.000Z",
          nextWakeAt: consumedWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:50.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        nextWakeAt: null,
        progressed: true,
        redactedStatus: expect.objectContaining({
          hostedOutboxPendingDeliveryEffects: 1,
        }),
      }));

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        redactedStatus: expect.objectContaining({
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: null,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops an available post-delivery cron wake when it is the consumed workspace wake", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      vi.setSystemTime(new Date("2026-05-08T16:00:00.100Z"));
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: consumedWakeAt,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-05-08T16:00:01.000Z"));
        mocks.getAssistantCronStatus.mockResolvedValueOnce({
          dueJobs: 1,
          enabledJobs: 1,
          nextRunAt: consumedWakeAt,
          runningJobs: 0,
          totalJobs: 1,
        });
        return [createSentDeliveryOutcome()];
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        now: () => consumedWakeAt,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:50.000Z",
          createdAt: "2026-05-08T15:00:00.000Z",
          nextWakeAt: consumedWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:50.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        nextWakeAt: null,
        progressed: true,
      }));

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        redactedStatus: expect.objectContaining({
          hostedAssistantNextWakeAt: null,
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: null,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the consumed assistant cron wake when system mailbox work is imported in the same pass", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      vi.setSystemTime(new Date("2026-05-08T16:00:00.100Z"));
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: consumedWakeAt,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-05-08T16:00:01.000Z"));
        return [createSentDeliveryOutcome()];
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        conversationImportedCount: 0,
        importedCount: 1,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:50.000Z",
          createdAt: "2026-05-08T15:00:00.000Z",
          nextWakeAt: consumedWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:50.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));

      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        progressed: true,
        redactedStatus: expect.objectContaining({
          hostedAssistantNextWakeAt: null,
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: null,
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not perform another cron read after delivering a consumed reminder", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      vi.setSystemTime(new Date("2026-05-08T16:00:00.100Z"));
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronProcessed: 1,
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: consumedWakeAt,
        parserProcessed: 0,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      });
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
        createDeliveryEffect(),
      ]);
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-05-08T16:00:01.000Z"));
        return [createSentDeliveryOutcome()];
      });
      mocks.getAssistantCronStatus
        .mockResolvedValueOnce({
          dueJobs: 0,
          enabledJobs: 0,
          nextRunAt: null,
          runningJobs: 0,
          totalJobs: 0,
        })
        .mockResolvedValueOnce({
          dueJobs: 0,
          enabledJobs: 0,
          nextRunAt: null,
          runningJobs: 0,
          totalJobs: 0,
        });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:50.000Z",
          createdAt: "2026-05-08T15:00:00.000Z",
          nextWakeAt: consumedWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:50.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        nextWakeAt: null,
        progressed: true,
      }));

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        redactedStatus: expect.objectContaining({
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: null,
        }),
      }));
      expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-arms and drains a sibling input after clean fast dispatch", async () => {
    const consumedWakeAt = "2026-05-08T16:00:00.000Z";
    const remainingInputWakeAt = "2026-05-08T16:00:01.000Z";
    const callOrder: string[] = [];
    mocks.runHostedAssistantAutomationLane
      .mockResolvedValueOnce({
        assistantAutomationProgressed: true,
        nextWakeAt: consumedWakeAt,
        redactedLogEntries: [],
      })
      .mockResolvedValueOnce({
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      callOrder.push("delivery-terminalized");
      return [createSentDeliveryOutcome()];
    });
    mocks.resolveHostedPendingAssistantInputWakeAt
      .mockImplementationOnce(async () => {
        callOrder.push("pending-index-read");
        return remainingInputWakeAt;
      })
      .mockImplementationOnce(async () => {
        callOrder.push("pending-index-read-follow-up");
        return remainingInputWakeAt;
      });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => remainingInputWakeAt,
      workspace: {
        checkpointedAt: "2026-05-08T15:59:50.000Z",
        createdAt: "2026-05-08T15:00:00.000Z",
        nextWakeAt: consumedWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T15:59:50.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));
    const followUpResult = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => remainingInputWakeAt,
      workspace: {
        checkpointedAt: remainingInputWakeAt,
        createdAt: "2026-05-08T15:00:00.000Z",
        nextWakeAt: remainingInputWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: remainingInputWakeAt,
        userId: "member_synthetic_phase",
        version: "9",
      },
    }));

    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(callOrder).toEqual([
      "pending-index-read",
      "delivery-terminalized",
      "pending-index-read-follow-up",
    ]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(2);
    expect(mocks.runHostedAssistantAutomationLane.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        freshAssistantInputIds: [],
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: remainingInputWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliverySent: 1,
        nextWakeAt: remainingInputWakeAt,
      }),
    }));
    expect(followUpResult).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: null,
      progressed: true,
    }));
  });

  it("preserves the assistant wake after clean fast dispatch", async () => {
    const assistantNextWakeAt = "2026-05-08T16:00:00.000Z";
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

  it("preserves a near-due workspace assistant wake echo after clean fast dispatch", async () => {
    const assistantNextWakeAt = "2026-05-08T16:00:00.000Z";
    mocks.getAssistantCronStatus.mockRejectedValue(new Error("cron status unavailable"));
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
      now: () => "2026-05-08T15:59:55.000Z",
      workspace: {
        checkpointedAt: "2026-05-08T15:59:40.000Z",
        createdAt: "2026-05-08T15:59:40.000Z",
        nextWakeAt: assistantNextWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-05-08T15:59:40.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: assistantNextWakeAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: assistantNextWakeAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: assistantNextWakeAt,
      }),
    }));
  });

  it.each([
    {
      deliveryNow: "2026-05-08T16:00:02.000Z",
      initialNow: "2026-05-08T16:00:01.000Z",
      label: "already due",
    },
    {
      deliveryNow: "2026-05-08T16:00:01.000Z",
      initialNow: "2026-05-08T15:59:59.000Z",
      label: "crosses due time during delivery",
    },
  ])(
    "preserves a deferred cron wake that is $label without another cron read",
    async ({ deliveryNow, initialNow }) => {
      const assistantWakeAt = "2026-05-08T16:00:00.000Z";
      let now = initialNow;
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
        assistantAutomationCronStatusDeferred: true,
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
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
        now = deliveryNow;
        return [createSentDeliveryOutcome()];
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 1,
        now: () => now,
        workspace: {
          checkpointedAt: "2026-05-08T15:59:40.000Z",
          createdAt: "2026-05-08T15:59:40.000Z",
          nextWakeAt: assistantWakeAt,
          nextWakeReason: "assistant",
          redactedStatus: null,
          snapshotRef: null,
          updatedAt: "2026-05-08T15:59:40.000Z",
          userId: "member_synthetic_phase",
          version: "8",
        },
      }));

      expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: assistantWakeAt,
        progressed: true,
        redactedStatus: expect.objectContaining({
          hostedOutboxDeliverySent: 1,
          nextWakeAt: assistantWakeAt,
        }),
      }));
    },
  );

  it.each(["assistant", null] as const)(
    "does not keep a synthetic legacy device-sync retry through clean fast dispatch for %s wakes",
    async (nextWakeReason) => {
      mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

      expectAssistantLaneCallWithoutDeviceSyncOptions({
        freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
      });
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_receipt",
        nextWakeAt: null,
        progressed: true,
      }));
      expect("nextWakeReason" in result).toBe(false);
    },
  );

  it("preserves a skipped non-assistant due wake after clean fast dispatch", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
    }));

    expect(result.afterCheckpoint).toBeUndefined();
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
  });

  it("fast-dispatches idempotent delivery for active-turn input admitted on an alarm wake", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
    }));

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(mocks.drainHostedPreparedAssistantDeliveries)
      .toHaveBeenCalledTimes(1);
    await result.afterCheckpoint?.();
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
        deliveryErrorCode: "HOSTED_PROVIDER_FETCH_UNAVAILABLE",
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
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
      "outbox.delivery_finished",
    ]);
    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "warn",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 1,
        deliveryErrorCodeSummary: "HOSTED_PROVIDER_FETCH_UNAVAILABLE:1",
        deliveryErrorSummaries: [
          {
            deliveryChannel: "telegram",
            deliveryStatus: "failed_ambiguous",
            deliveryErrorCode: "HOSTED_PROVIDER_FETCH_UNAVAILABLE",
            deliveryErrorMessage: "redacted",
            journalStatus: "500",
            retryable: true,
            targetKind: "none",
          },
        ],
        failed: 1,
        retryable: 1,
        sent: 0,
        statusSummary: "failed_ambiguous:1",
      }),
    }));
  });

  it("logs redacted delivery error diagnostics directly", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "ASSISTANT_DELIVERY_ABORTED",
        effectId: "effect_assistant_delivery",
      }),
      createFailedDeliveryOutcome({
        deliveryErrorCode: "provider.raw_tenant_123",
        deliveryErrorMessage:
          "Telegram HTTP 400 authorization: Bearer placeholder for file:///tmp/private note to person@example.invalid +1 555 010 9999",
        effectId: "effect_external_provider",
      }),
      createFailedDeliveryOutcome({
        deliveryErrorCode: "LINQ_API_TOKEN_REQUIRED",
        effectId: "effect_linq_safe",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "warn",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 3,
        deliveryErrorCodeSummary:
          "ASSISTANT_DELIVERY_ABORTED:1,LINQ_API_TOKEN_REQUIRED:1,provider.raw_tenant_123:1",
        deliveryErrorSummaries: [
          expect.objectContaining({
            deliveryErrorCode: "ASSISTANT_DELIVERY_ABORTED",
            deliveryErrorMessage: "redacted",
          }),
          expect.objectContaining({
            deliveryErrorCode: "provider.raw_tenant_123",
            deliveryErrorMessage:
              "Telegram HTTP 400 authorization [redacted] for <REDACTED_PATH> note to [redacted-email] [redacted-phone]",
          }),
          expect.objectContaining({
            deliveryErrorCode: "LINQ_API_TOKEN_REQUIRED",
            deliveryErrorMessage: "redacted",
          }),
        ],
        failed: 3,
        retryable: 3,
        sent: 0,
      }),
    }));
  });

  it("produces parser-safe delivery diagnostics from redacted home paths", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
        deliveryErrorDetails: {
          description:
            "Linq response referenced <HOME_DIR>/vault/outbox.json.",
        },
        deliveryErrorMessage:
          "Linq delivery failed while reading <HOME_DIR>/vault/outbox.json.",
        effectId: "effect_pre_redacted_home_path",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);
    const deliveryLogRequest = filteredLogRequests[1];

    expect(deliveryLogRequest?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      deliveryErrorSummaries: [
        expect.objectContaining({
          deliveryErrorDetailDescription:
            "Linq response referenced <REDACTED_PATH>",
          deliveryErrorMessage:
            "Linq delivery failed while reading <REDACTED_PATH>",
        }),
      ],
    }));
    expect(() => parseHostedRuntimeLogRequest(deliveryLogRequest)).not.toThrow();
  });

  it("projects bounded Linq attachment transport fields without provider request details", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
        deliveryErrorDetails: {
          authorization: "Bearer <REDACTED_TOKEN>",
          failureStage: "transport",
          method: "PUT",
          operation: "create_attachment_upload",
          path: "https://uploads.example.test/private-object?signature=private",
          requestOrigin: "https://uploads.example.test",
          retryable: false,
          timedOut: false,
          transportErrorName: "TypeError",
        },
        deliveryErrorMessage: "Linq attachment upload failed before a response was returned.",
        effectId: "effect_linq_attachment_transport",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);
    const deliveryLogRequest = filteredLogRequests[1];

    expect(deliveryLogRequest?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      deliveryErrorSummaries: [
        expect.objectContaining({
          deliveryErrorDetailFailureStage: "transport",
          deliveryErrorDetailMethod: "PUT",
          deliveryErrorDetailOperation: "create_attachment_upload",
          deliveryErrorDetailRetryable: false,
          deliveryErrorDetailTimedOut: false,
          deliveryErrorDetailTransportErrorName: "TypeError",
        }),
      ],
    }));
    const serializedLog = JSON.stringify(deliveryLogRequest);
    expect(serializedLog).not.toContain("REDACTED_TOKEN");
    expect(serializedLog).not.toContain("private-object");
    expect(serializedLog).not.toContain("uploads.example.test");
    expect(() => parseHostedRuntimeLogRequest(deliveryLogRequest)).not.toThrow();
  });

  it("projects Linq payload shape and response signatures without provider content", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryErrorCode: "LINQ_API_REQUEST_FAILED",
        deliveryErrorDetails: {
          failureStage: "http",
          method: "POST",
          name: "VaultCliError",
          operation: "send_message",
          providerErrorCode: "INVALID_MEDIA",
          providerErrorMessage: "provider response prose",
          providerRequestId: "trace_safe_123",
          requestAttachmentMediaPartCount: 1,
          requestBodyShape: "object:message|message:idempotency_key,parts",
          requestMediaPartCount: 8,
          requestMessageLength: 4321,
          requestMessagePartCount: 9,
          requestPublicUrlMediaPartCount: 7,
          requestTextPartCount: 1,
          responseBodyKeyCount: 4,
          responseBodyKeySummary: "code,errors,trace_id",
          responseBodyKind: "json_object",
          responseBodySha256: "a".repeat(64),
          responseBodyStringFieldCount: 3,
          responseBodyStringFieldSummary: "code,trace_id",
          responseBodyTextLength: 246,
          retryable: false,
          status: 400,
        },
        deliveryErrorMessage:
          "Linq request POST /chats/[chat]/messages failed with HTTP 400.",
        effectId: "effect_linq_payload_diagnostics",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const deliveryLogRequest = withoutAssistantTurnTimingLogs(logRequests)[1];

    expect(deliveryLogRequest?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      deliveryErrorSummaries: [
        expect.objectContaining({
          deliveryErrorDetailFailureStage: "http",
          deliveryErrorDetailMethod: "POST",
          deliveryErrorDetailOperation: "send_message",
          deliveryErrorDetailProviderCode: "INVALID_MEDIA",
          deliveryErrorDetailProviderRequestId: "trace_safe_123",
          deliveryErrorDetailRequestSummary: JSON.stringify({
            messageLength: 4321,
            partCount: 9,
            textPartCount: 1,
            mediaPartCount: 8,
            publicUrlMediaPartCount: 7,
            attachmentMediaPartCount: 1,
            bodyShape: "object:message|message:idempotency_key,parts",
          }),
          deliveryErrorDetailResponseSummary: JSON.stringify({
            kind: "json_object",
            textLength: 246,
            keyCount: 4,
            keySummary: "code,errors,trace_id",
            stringFieldCount: 3,
            stringFieldSummary: "code,trace_id",
          }),
          deliveryErrorDetailResponseSignature: "a".repeat(64),
          deliveryErrorDetailStatus: 400,
        }),
      ],
    }));
    const deliveryErrorSummaries = deliveryLogRequest?.entries[0]?.redactedJson
      ?.deliveryErrorSummaries;
    expect(Array.isArray(deliveryErrorSummaries)).toBe(true);
    if (!Array.isArray(deliveryErrorSummaries)) {
      throw new Error("Expected delivery error summaries.");
    }
    const deliveryErrorSummary = deliveryErrorSummaries[0];
    expect(deliveryErrorSummary).toBeDefined();
    if (
      deliveryErrorSummary === null
      || typeof deliveryErrorSummary !== "object"
      || Array.isArray(deliveryErrorSummary)
    ) {
      throw new Error("Expected a delivery error summary object.");
    }
    expect(Object.keys(deliveryErrorSummary)).toHaveLength(16);
    expect(JSON.stringify(deliveryLogRequest)).not.toContain("provider response prose");
    expect(() => parseHostedRuntimeLogRequest(deliveryLogRequest)).not.toThrow();
  });

  it("preserves safe Telegram reaction delivery error codes", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      createDeliveryEffect(),
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      createFailedDeliveryOutcome({
        deliveryChannel: "telegram",
        deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_FAILED",
        deliveryErrorDetails: {
          code: "ASSISTANT_TELEGRAM_REACTION_FAILED",
          description: "Forbidden: bot was blocked by the user",
          errorCode: 403,
          operation: "Telegram Bot API setMessageReaction",
          retryable: false,
          status: 403,
          target: "telegram:chat:123456789",
        },
        deliveryErrorMessage:
          "Telegram Bot API setMessageReaction failed with HTTP 403.",
        effectId: "effect_reaction_failed",
      }),
      createFailedDeliveryOutcome({
        deliveryChannel: "telegram",
        deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_TARGET_UNSUPPORTED",
        effectId: "effect_reaction_target_unsupported",
      }),
      createFailedDeliveryOutcome({
        deliveryChannel: "telegram",
        deliveryErrorCode: "TELEGRAM_API_BAD_REQUEST",
        effectId: "effect_telegram_provider",
      }),
      createFailedDeliveryOutcome({
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        effectId: "effect_missing_code",
      }),
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      workspace: createDueAssistantWorkspace(),
    }));
    await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(filteredLogRequests[1]?.entries[0]).toEqual(expect.objectContaining({
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: "warn",
      phase: "outbox",
      redactedJson: expect.objectContaining({
        attempted: 4,
        deliveryErrorCodeSummary:
          "ASSISTANT_TELEGRAM_REACTION_FAILED:1,ASSISTANT_TELEGRAM_REACTION_TARGET_UNSUPPORTED:1,none:1,TELEGRAM_API_BAD_REQUEST:1",
        deliveryErrorSummaries: [
          expect.objectContaining({
            deliveryChannel: "telegram",
            deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_FAILED",
            deliveryErrorDetailDescription: "Forbidden: bot was blocked by the user",
            deliveryErrorDetailFieldCount: 7,
            deliveryErrorDetailOperation: "Telegram Bot API setMessageReaction",
            deliveryErrorDetailProviderCode: 403,
            deliveryErrorDetailRetryable: false,
            deliveryErrorDetailStatus: 403,
            deliveryErrorDetailTarget: "[redacted-telegram-target:chat]",
            deliveryErrorMessage:
              "Telegram Bot API setMessageReaction failed with HTTP 403.",
          }),
          expect.objectContaining({
            deliveryChannel: "telegram",
            deliveryErrorCode: "ASSISTANT_TELEGRAM_REACTION_TARGET_UNSUPPORTED",
          }),
          expect.objectContaining({
            deliveryChannel: "telegram",
            deliveryErrorCode: "TELEGRAM_API_BAD_REQUEST",
          }),
          expect.objectContaining({
            deliveryChannel: "telegram",
            deliveryErrorCode: "none",
          }),
        ],
        failed: 4,
        retryable: 4,
        sent: 0,
      }),
    }));
  });

  it("writes a system mailbox processing summary", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_123456789",
      legacyUsageReferralAuthorityClassification: "identity_mismatch",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      routeAction: "dispatch-assistant-notification",
      status: "retryable_failed",
      wakeKind: "assistant.notification.requested",
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
        attemptCount: 2,
        errorCode: "system_mailbox.retryable",
        legacyUsageReferralAuthorityClassification: "identity_mismatch",
        nextWakeAtPresent: true,
        routeAction: "dispatch-assistant-notification",
        status: "retryable_failed",
        wakeKind: "assistant.notification.requested",
      }),
    }));
  });

  it("preserves a future device-sync retry while recording unrelated system mailbox work", async () => {
    const deviceSyncRetryAt = "2026-04-27T00:00:30.000Z";
    mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValueOnce("2026-04-27T01:00:00.000Z");
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: deviceSyncRetryAt,
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: deviceSyncRetryAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: deviceSyncRetryAt,
      nextWakeReason: "device-sync.reconcile",
    }));
  });

  it("preserves a runtime-only device-sync continuation after recording unrelated system mailbox work", async () => {
    const deviceSyncContinuationAt = "2026-04-27T00:00:30.000Z";
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 0,
      deviceSyncSkipped: false,
      nextWakeAt: deviceSyncContinuationAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
      redactedLogEntries: [],
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_processed",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:00:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: deviceSyncContinuationAt,
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: deviceSyncContinuationAt,
      nextWakeReason: "device-sync.reconcile",
    }));
  });

  it("preserves durable outbox wakes while recording unrelated system mailbox work", async () => {
    const outboxWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(outboxWakeAt);
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
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: outboxWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: outboxWakeAt,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    }));
  });

  it("preserves future provider cleanup wakes while recording unrelated system mailbox work", async () => {
    const providerCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: providerCleanupWakeAt,
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
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
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: providerCleanupWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: providerCleanupWakeAt,
      nextWakeReason: "assistant",
    }));
  });

  it("does not preserve a consumed system mailbox wake while draining provider cleanup", async () => {
    const staleSystemMailboxWakeAt = "2026-04-27T00:00:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.resolveHostedSystemMailboxNextWakeAt
      .mockResolvedValueOnce(staleSystemMailboxWakeAt)
      .mockResolvedValue(null);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createCodexAuthSystemMailboxItem(),
      itemId: "system_mailbox_item_codex_auth",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValueOnce({
      failed: 0,
      nextWakeAt: null,
      recorded: 1,
    });
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => staleSystemMailboxWakeAt,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: staleSystemMailboxWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
        nextWakeAt: null,
      }),
    }));
  });

  it("does not mark a retryable device-sync mailbox attempt as completed", async () => {
    const deviceSyncWorkspaceWakeAt = "2026-04-27T00:00:00.000Z";
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_retryable",
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      routeAction: "run-device-sync-wake",
      status: "retryable_failed",
      wakeKind: "device-sync.wake",
    });
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: deviceSyncWorkspaceWakeAt,
        nextWakeReason: "device-sync.reconcile",
      }),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result.nextWakeAt).toBe("2026-04-27T00:10:00.000Z");
    expect(result.nextWakeReason).toBeUndefined();
    expect(result.deviceSyncMaintenanceRan).toBeUndefined();
    expect(postCheckpoint).toBeUndefined();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).not.toHaveBeenCalled();
  });

  it("does not record a retryable mailbox item during an unrelated checkpoint", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_retryable",
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      routeAction: "dispatch-assistant-notification",
      status: "retryable_failed",
      wakeKind: "assistant.notification.requested",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    expect(
      logRequests.flatMap((request) => request.entries).filter((entry) =>
        entry.eventCode === "mailbox.system_processed"
      ),
    ).toEqual([
      expect.objectContaining({
        redactedJson: expect.objectContaining({
          status: "retryable_failed",
        }),
      }),
    ]);
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
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
    }));
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

  it("preserves an immediate assistant wake after recording a system mailbox item", async () => {
    const nextWakeAt = "2026-04-27T00:00:00.000Z";
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createSystemMailboxItem(),
      itemId: "system_mailbox_item_immediate_assistant_wake",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-notification",
        nextWakeAt,
        nextWakeReason: "assistant",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => nextWakeAt,
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      progressed: true,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt,
      nextWakeReason: "assistant",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("drops an immediate non-assistant system mailbox metrics wake", async () => {
    const nextWakeAt = "2026-04-27T00:00:00.000Z";
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_immediate_reconcile_wake",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "webhook" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_immediate_reconcile_wake",
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => nextWakeAt,
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
    expect(result).not.toHaveProperty("nextWakeAt");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("keeps an armed assistant cron wake when a device-sync mailbox wake is processed", async () => {
    // Prod regression (2026-06-10): an `at` reminder automation armed next_wake_at=02:45,
    // then WHOOP device-sync wakes at 01:59/02:03 early-returned a device-sync-only result
    // whose nextWakeAt replaced the armed cron wake, so the runtime slept through 02:45.
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-cron-wake-clobber-"));
    const vaultRoot = path.join(parentRoot, "vault");

    try {
      await initializeVault({
        createdAt: "2026-04-27T00:00:00.000Z",
        vaultRoot,
      });
      await upsertAutomation({
        continuityPolicy: "fresh",
        instructions: "Remind me to start red light therapy.",
        now: new Date("2026-04-27T00:00:00.000Z"),
        status: "active",
        route: {
          channel: "linq",
          deliverySource: {
            fromPhoneNumber: "+15555550199",
            kind: "linq",
          },
          deliveryTarget: "+15555550100",
          identityId: null,
          participantId: null,
          threadId: null,
        },
        schedule: {
          at: "2026-04-27T02:45:00.000Z",
          kind: "at",
        },
        title: "Red light therapy reminder",
        vaultRoot,
      });
      mocks.getAssistantCronStatus.mockResolvedValue({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-27T02:45:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });

      const deviceSyncItem = {
        ...createSystemMailboxItem(),
        routeAction: "run-device-sync-wake" as const,
        wake: {
          eventId: "evt_synthetic_device_sync_wake_clobber",
          kind: "device-sync.wake" as const,
          occurredAt: "2026-04-27T00:00:00.000Z",
          reason: "connected" as const,
          userId: "member_synthetic_phase",
        },
      };
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
        item: deviceSyncItem,
        itemId: "system_mailbox_item_device_sync_clobber",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "device-sync",
          nextWakeAt: "2026-04-27T08:03:00.000Z",
          postCheckpointRecord: null,
          redactedLogEntries: [],
        },
        status: "processed",
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      }));
      const postCheckpoint = await result.afterCheckpoint?.();

      // The device-sync-only pass must not narrow the alarm past the armed
      // cron occurrence at 02:45; the 08:03 device reconcile loses. The
      // recorded-receipt post-checkpoint recomputes its own wake, so assert
      // it directly instead of falling back to the pre-checkpoint result.
      expect(result.nextWakeAt).toBe("2026-04-27T02:45:00.000Z");
      expect(postCheckpoint?.nextWakeAt).toBe("2026-04-27T02:45:00.000Z");
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps an armed assistant cron wake when idle dirty device-sync work runs", async () => {
    // Same clobber as the mailbox-item route, but through the idle dirty
    // device-sync-only result (no system-mailbox item): the device reconcile
    // follow-up at 08:03 must not replace the earlier 02:45 cron occurrence.
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: "2026-04-27T02:45:00.000Z",
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T08:03:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T02:45:00.000Z",
      nextWakeReason: "assistant",
      progressed: true,
    }));
  });

  it("continues into the assistant lane when dirty device-sync work finds due cron", async () => {
    const dueAt = "2026-04-27T00:00:00.000Z";
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: dueAt,
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: dueAt,
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => dueAt,
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
        checkpointedAt: dueAt,
        createdAt: dueAt,
        nextWakeAt: dueAt,
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: dueAt,
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
  });

  it("keeps the earlier device-sync wake when the assistant cron occurrence is later", async () => {
    // The injected cron candidate stays earliest-wins: it must never delay an
    // earlier device-sync reconcile wake.
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: "2026-04-27T09:00:00.000Z",
      runningJobs: 0,
      totalJobs: 1,
    });
    mocks.runHostedDeviceSyncWakeLane.mockResolvedValueOnce({
      deviceSyncProcessed: 1,
      deviceSyncSkipped: false,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      parserProcessed: 0,
      postCheckpointRecord: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("retries an unavailable cron status read before mailbox post-checkpoint wake selection", async () => {
    mocks.getAssistantCronStatus
      .mockRejectedValueOnce(new Error("synthetic transient cron status read failure"))
      .mockResolvedValueOnce({
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: "2026-04-27T02:45:00.000Z",
        runningJobs: 0,
        totalJobs: 1,
      });
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_wake_transient_cron_read",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_device_sync_transient_cron_read",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T08:03:00.000Z",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    expect(result.nextWakeAt).toBe("2026-04-27T08:03:00.000Z");
    expect(postCheckpoint?.nextWakeAt).toBe("2026-04-27T02:45:00.000Z");
  });

  it("preserves an existing assistant workspace wake when cron status remains unavailable", async () => {
    mocks.getAssistantCronStatus.mockRejectedValue(
      new Error("synthetic persistent cron status read failure"),
    );
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_wake_existing_assistant_cron_read_failure",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_device_sync_existing_assistant_cron_read_failure",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T08:03:00.000Z",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T02:45:00.000Z",
      }),
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(2);
    expect(result.nextWakeAt).toBe("2026-04-27T02:45:00.000Z");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T02:45:00.000Z",
      nextWakeReason: "assistant",
    }));
  });

  it("still schedules the device-sync wake when the assistant cron status read fails", async () => {
    // Best-effort invariant: a failed cron-status vault read must not break
    // the device-sync lane or its wake selection, before or after checkpoint.
    mocks.getAssistantCronStatus.mockRejectedValue(
      new Error("synthetic cron status read failure"),
    );
    const deviceSyncItem = {
      ...createSystemMailboxItem(),
      routeAction: "run-device-sync-wake" as const,
      wake: {
        eventId: "evt_synthetic_device_sync_wake_cron_read_failure",
        kind: "device-sync.wake" as const,
        occurredAt: "2026-04-27T00:00:00.000Z",
        reason: "connected" as const,
        userId: "member_synthetic_phase",
      },
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: deviceSyncItem,
      itemId: "system_mailbox_item_device_sync_cron_read_failure",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "device-sync",
        nextWakeAt: "2026-04-27T08:03:00.000Z",
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T08:03:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect(postCheckpoint?.nextWakeAt).toBe("2026-04-27T08:03:00.000Z");
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

  it("drains queue-only signup welcome outbox after member activation mailbox checkpoint", async () => {
    const deliveryEffect = createDeliveryEffect();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: createMemberActivationSignupWelcomeSystemMailboxItem(),
      itemId: "system_mailbox_item_member_activation",
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "member-activated",
        nextWakeAt: null,
        postCheckpointRecord: null,
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:01:00.000Z",
    );
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
        journalMethod: "POST",
        journalStatus: "200",
        providerMessageId: "provider_signup_welcome",
        providerMessageIds: [],
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        vaultRoot: "/tmp/murph-vault",
        wake: expect.objectContaining({
          kind: "member.activated",
          signupWelcome: expect.any(Object),
        }),
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliverySent: 1,
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
      errorCode: "MEMBER_ACTION_OUTCOME_UNAVAILABLE",
      errorMessage: "Hosted member action outcome write was unavailable.",
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
        safeErrorMessage:
          "Hosted assistant notification failed and was skipped so the hosted runtime pass can continue.",
      }),
    }));
    expect(logRequests[2]?.entries[0]).toEqual(expect.objectContaining({
      component: "mailbox",
      errorCode: "MEMBER_ACTION_OUTCOME_UNAVAILABLE",
      eventCode: "mailbox.system_processed",
      level: "warn",
      redactedJson: expect.objectContaining({
        attemptCount: 2,
        errorCode: "MEMBER_ACTION_OUTCOME_UNAVAILABLE",
        nextWakeAtPresent: true,
        recordFailed: 1,
        recorded: 0,
        routeAction: "dispatch-assistant-notification",
        safeErrorMessage: "Hosted member action outcome write was unavailable.",
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
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(result.nextWakeAt).toBe("2026-04-27T00:12:00.000Z");
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedAssistantNextWakeAt: "2026-04-27T00:12:00.000Z",
      hostedSystemMailboxPrepared: 0,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();
    const filteredLogRequests = withoutAssistantTurnTimingLogs(logRequests);

    expect(postCheckpoint).toBeUndefined();
    expect(filteredLogRequests.map((request) => request.entries[0]?.eventCode)).toEqual([
      "assistant.pass_finished",
    ]);
    expect(filteredLogRequests[0]?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      nextWakeAtPresent: true,
      progressed: false,
      systemWakeAtPresent: true,
    }));
  });

  it("keeps due device-sync maintenance deferred while fresh conversation input runs", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => "2026-04-27T00:09:00.000Z",
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
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(mocks.createHostedAssistantChannelTypingDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        providerFetch: null,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.createHostedAssistantProgressDeliveryDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        providerFetch: null,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:09:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
    expect(logRequests.map((request) => request.entries[0]?.eventCode)).toContain(
      "assistant.pass_finished",
    );
    const passFinishedLog = logRequests.find(
      (request) => request.entries[0]?.eventCode === "assistant.pass_finished",
    );
    expect(passFinishedLog?.entries[0]?.redactedJson).toEqual(expect.objectContaining({
      nextWakeAtPresent: true,
      progressed: true,
    }));
  });

  it("passes foreground Linq delivery context into hosted progress dependencies", async () => {
    const linqDeliveryContext = {
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: "+15550000002",
      replyToMessageId: "linq-message-1",
      routeAuthority: null,
      service: null,
      target: "linq-thread-1",
      threadIsDirect: null,
    };

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      linqDeliveryContext,
    }));

    expect(mocks.createHostedAssistantProgressDeliveryDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        linqDeliveryContexts: [linqDeliveryContext],
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.createHostedAssistantChannelTypingDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        linqDeliveryContexts: [linqDeliveryContext],
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("passes foreground Linq delivery context into hosted outbox delivery", async () => {
    const linqDeliveryContext = {
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: "+15550000002",
      replyToMessageId: "linq-message-1",
      routeAuthority: null,
      service: null,
      target: "linq-thread-1",
      threadIsDirect: null,
    };
    const effect = createDeliveryEffect();
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([effect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      linqDeliveryContext,
    }));
    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [effect],
        linqDeliveryContexts: [linqDeliveryContext],
      }),
    );
  });

  it("passes a late active-turn Linq delivery context into hosted outbox delivery", async () => {
    const lateLinqDeliveryContext = {
      directRecipientPhoneNumber: "+15550000001",
      fromPhoneNumber: "+15550000002",
      replyToMessageId: "linq-message-late",
      routeAuthority: null,
      service: "imessage",
      target: "linq-thread-late",
      threadIsDirect: true,
    };
    const effect = createDeliveryEffect();
    let latestAssistantInputBatch:
      NonNullable<HostedWorkspaceRuntimeAssistantPhaseInput["initialAssistantInputBatch"]>
      | null = null;
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      latestAssistantInputBatch = {
        assistantInputIds: ["ain_00000000000000000000000000000002"],
        assistantInputRecords: [{
          assistantInputId: "ain_00000000000000000000000000000002",
          linqDeliveryContext: lateLinqDeliveryContext,
        }],
        emailDeliveryContexts: [],
        linqDeliveryContexts: [lateLinqDeliveryContext],
      };
      return {
        activeTurnInputIngested: true,
        assistantAutomationCurrentTurnDeliveryIntentIds: [effect.effectId],
        assistantAutomationProgressed: true,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([effect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      latestAssistantInputBatch: () => latestAssistantInputBatch,
    }));
    await result.afterCheckpoint?.();

    expect(mocks.prepareHostedAssistantDeliveryEffectsForDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [effect],
        linqDeliveryContexts: [lateLinqDeliveryContext],
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [effect],
        linqDeliveryContexts: [lateLinqDeliveryContext],
      }),
    );
  });

  it("passes restored foreground assistant input ids through as fresh ids", async () => {
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

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: assistantInputIds,
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
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: ["ain_00000000000000000000000000000007"],
      }),
    );
  });

  it("does not treat system-only mailbox imports as foreground conversation input", async () => {
    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      importedCount: 1,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: [],
      }),
    );
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
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
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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

    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
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
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecorded: 1,
      }),
    }));
  });

  it("does not continue non-manual runtime-control receipts into assistant automation", async () => {
    const browserVaultRefreshItem = createBrowserVaultRefreshSystemMailboxItem();
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

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalled();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: browserVaultRefreshItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      browserVaultReplicaRefreshRequested: true,
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedBrowserVaultReplicaRefreshRequested: true,
        hostedSystemMailboxPrepared: 1,
      }),
    }));
  });

  it("records maintenance runtime-control receipts without assistant automation", async () => {
    const maintenanceItem = createMaintenanceSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: maintenanceItem,
      itemId: "system_mailbox_item_runtime_maintenance",
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

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: maintenanceItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).not.toHaveProperty("browserVaultReplicaRefreshRequested");
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxPrepared: 1,
      }),
    }));
    expect(result.redactedStatus).not.toHaveProperty("hostedBrowserVaultReplicaRefreshRequested");
  });

  it("reconciles bounded pending delivery effects without continuing assistant automation", async () => {
    const deliveryEffect = createDeliveryEffect();
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        vaultRoot: "/tmp/murph-vault",
        wake: pendingEffectsItem.wake,
      }),
    );
  });

  it("drains a causal approval wake before simultaneously pending foreground input", async () => {
    let shouldYield = false;
    const shouldYieldBackgroundMaintenance = vi.fn(() => shouldYield);
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    const deliveryEffect = {
      ...createDeliveryEffect(),
      effectId: pendingEffectsItem.wake.effectId,
    };
    const preparation = {
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control" as const,
        redactedLogEntries: [],
      },
      status: "processed" as const,
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      shouldYield = true;
      return preparation;
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledTimes(1);
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        shouldYieldBackgroundDelivery: null,
        vaultRoot: "/tmp/murph-vault",
        wake: pendingEffectsItem.wake,
      }),
    );
  });

  it("drains a causal approval wake already queued with foreground input before automation", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    const deliveryEffect = {
      ...createDeliveryEffect(),
      effectId: pendingEffectsItem.wake.effectId,
    };
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "continue-assistant-ask",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "assistant.ask.completed",
        ],
      }),
    );
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: true,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      afterCheckpointKeepsForegroundImportLoop: true,
      checkpointReason: "outbox_sending",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        shouldYieldBackgroundDelivery: null,
        vaultRoot: "/tmp/murph-vault",
        wake: pendingEffectsItem.wake,
      }),
    );
  });

  it("drains a completed assistant ask before later foreground input", async () => {
    const now = "2026-04-27T00:03:00.000Z";
    const pendingInputAt = "2026-04-27T00:02:30.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    const completionItem = createAssistantAskCompletionSystemMailboxItem();
    const deliveryEffect = createDeliveryEffect();
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);
    mocks.resolveHostedOldestAssistantInputOccurredAt.mockResolvedValue(pendingInputAt);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: completionItem,
      itemId: completionItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "assistant-ask-completion",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      logRequests,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "continue-assistant-ask",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "assistant.ask.completed",
        ],
        assistantAskCompletionOccurredBefore: pendingInputAt,
      }),
    );
    expect(mocks.resolveHostedOldestAssistantInputOccurredAt).toHaveBeenCalledWith({
      assistantInputIds: ["ain_00000000000000000000000000000001"],
      signal: null,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resolveHostedOldestPendingAssistantInputAt).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      afterCheckpointKeepsForegroundImportLoop: true,
      checkpointReason: "outbox_sending",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantAskCompletionFirstAttemptDelayed: true,
      }),
    }));
    expect(logRequests.find((request) =>
      request.entries[0]?.eventCode === "mailbox.system_processed"
    )?.entries[0]).toEqual(expect.objectContaining({
      level: "warn",
      redactedJson: expect.objectContaining({
        assistantAskCompletionFirstAttemptDelayed: true,
      }),
    }));

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [deliveryEffect],
        shouldYieldBackgroundDelivery: null,
        vaultRoot: "/tmp/murph-vault",
        wake: completionItem.wake,
      }),
    );
  });

  it.each([
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_123",
      label: "phone-call result",
    },
    {
      dedupeKey:
        "assistant.notification.requested:usage-referral-reward:referral_123",
      label: "usage-referral reward",
    },
    {
      dedupeKey: "aask_done_private_completion",
      label: "legacy private Assistant Ask completion",
    },
    {
      dedupeKey: "aask_private_completion",
      label: "current private Assistant Ask completion",
    },
  ])("drains an exact $label through the causal-only fixed-route outbox once", async ({
    dedupeKey,
  }) => {
    const deferredUsageRecords: AssistantUsageRecord[] = [];
    const usageRecordPort: RuntimeUsageRecordPort = {
      recordUsage: vi.fn(async (record) => ({
        recorded: true,
        usageId: record.usageId,
      })),
    };
    const completionItem = createExternalCompletionSystemMailboxItem({
      dedupeKey,
    });
    const deliveryEffect: HostedAssistantDeliverySideEffect = {
      ...createDeliveryEffect(),
      effectId: `effect_${completionItem.itemId}`,
      payload: {
        ...createDeliveryEffect().payload,
        channel: "linq",
        explicitTarget: "linq_source_thread",
        idempotencyKey: dedupeKey.replace(
          "assistant.notification.requested:",
          "",
        ),
        identityId: "hbidx:phone:v1:test",
        threadId: "linq_source_thread",
        threadIsDirect: false,
      },
    };
    const deliveryIntentId = `intent_${completionItem.itemId}`;
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async ({ executionContext }) => {
        await executionContext.hosted?.usageRecorder?.recordUsage(
          createAssistantUsageRecord(),
        );
        return {
          item: completionItem,
          itemId: completionItem.itemId,
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            deliveryIntentIds: [deliveryIntentId],
            mailboxLane: "assistant-notification",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "linq",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
        journalMethod: "PUT",
        journalStatus: "200",
        providerMessageId: "provider_completion_123",
        providerMessageIds: [],
        providerThreadId: "linq_source_thread",
        retryable: false,
        target: "linq_source_thread",
        targetKind: "explicit",
      },
    ]);

    const input = createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => "2026-04-27T00:03:00.000Z",
      recordDeferredUsage: (record) => {
        deferredUsageRecords.push(record);
      },
      runtimeUsageRecordPort: usageRecordPort,
    });
    const result = await runHostedWorkspaceAssistantPhase(input);

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint)
      .toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          allowedMailboxDedupeKeyPrefixes: [
            "assistant.notification.requested:phone-call-result:",
            "assistant.notification.requested:usage-referral-reward:",
            "aask_done_",
            "aask_private_",
          ],
          allowedRouteActions: ["dispatch-assistant-notification"],
          allowedWakeKinds: ["assistant.notification.requested"],
          executionContext: {
            hosted: expect.objectContaining({
              memberId: "member_synthetic_phase",
              usageRecorder: {
                recordUsage: expect.any(Function),
              },
              userEnvKeys: [],
            }),
          },
        }),
      );
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [],
      preferredIntentIds: [deliveryIntentId],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(usageRecordPort.recordUsage).not.toHaveBeenCalled();

    await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [expect.objectContaining({
          effectId: deliveryEffect.effectId,
          payload: expect.objectContaining({
            explicitTarget: "linq_source_thread",
            threadId: "linq_source_thread",
          }),
        })],
        shouldYieldBackgroundDelivery: null,
        wake: completionItem.wake,
      }),
    );

    const replay = await runHostedWorkspaceAssistantPhase(input);
    expect(replay.progressed).toBe(false);
    expect(deferredUsageRecords).toHaveLength(1);
    expect(usageRecordPort.recordUsage).not.toHaveBeenCalled();
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
  });

  it("leaves an exact phone-call result queued behind pending assistant input", async () => {
    const pendingInputAt = "2026-09-01T15:02:00.000Z";
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(
      pendingInputAt,
    );
    mocks.resolveHostedOldestPendingAssistantInputAt.mockResolvedValue(
      pendingInputAt,
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 2,
      now: () => "2026-09-01T15:03:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMailboxDedupeKeyPrefixes: expect.arrayContaining([
          "assistant.notification.requested:phone-call-result:",
        ]),
      }),
    );
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalled();
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      progressed: false,
    }));
  });

  it.each([
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_telegram:generation:1",
      label: "generation-scoped phone-call result",
    },
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_manual_telegram",
      label: "generationless manual phone-call result",
    },
    {
      dedupeKey:
        "assistant.notification.requested:usage-referral-reward:referral_telegram",
      label: "usage-referral reward",
    },
  ])("keeps an exact Telegram $label in the ordinary background drain", async ({
    dedupeKey,
  }) => {
    const now = "2026-04-27T00:03:00.000Z";
    const completionItem = createExternalCompletionSystemMailboxItem({
      dedupeKey,
    });
    const baseDeliveryEffect = createDeliveryEffect();
    const deliveryEffect: HostedAssistantDeliverySideEffect = {
      ...baseDeliveryEffect,
      effectId: `effect_${completionItem.itemId}`,
      payload: {
        ...baseDeliveryEffect.payload,
        channel: "telegram",
        explicitTarget: "telegram_source_thread",
        idempotencyKey: dedupeKey.replace(
          "assistant.notification.requested:",
          "",
        ),
        identityId: "telegram-bot",
        threadId: "telegram_source_thread",
        threadIsDirect: false,
        transportIdempotent: false,
      },
    };
    const deliveryIntentId = `intent_${completionItem.itemId}`;
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        item: completionItem,
        itemId: completionItem.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          deliveryIntentIds: [deliveryIntentId],
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValueOnce(now);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [],
      preferredIntentIds: [deliveryIntentId],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resolveHostedAssistantOutboxNextWakeAt).toHaveBeenCalledWith({
      vaultRoot: "/tmp/murph-vault",
    });
    expect(
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch,
    ).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: now,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedOutboxPendingDeliveryEffects: 1,
      }),
    }));
    expect(result.afterCheckpointKeepsForegroundImportLoop).toBeUndefined();

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: now,
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    }));
  });

  it("keeps managed setup out of a causal-only exact delivery pass", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    const deliveryEffect = {
      ...createDeliveryEffect(),
      effectId: pendingEffectsItem.wake.effectId,
    };
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([deliveryEffect]);
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
      {
        actionApprovalPort: null,
        includeBackgroundDueIntents: false,
        messageVolumeReceiptPort: expect.any(Object),
        preferredEffectIds: [pendingEffectsItem.wake.effectId],
        preferredIntentIds: [],
        vaultRoot: "/tmp/murph-vault",
      },
    );
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.hydrateHostedExecutionDefaultTarget).not.toHaveBeenCalled();
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      progressed: true,
    }));
  });

  it("does not check external completions while assistant input is pending", async () => {
    const now = "2026-04-27T00:03:00.000Z";
    const armedWakeAt = "2026-04-27T00:08:00.000Z";
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);
    mocks.resolveHostedOldestPendingAssistantInputAt.mockResolvedValue(null);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValue(null);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: armedWakeAt,
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: ["apply-runtime-control-request"],
        allowedWakeKinds: ["runtime.pending-effects-reconcile-requested"],
      }),
    );
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: ["continue-assistant-ask"],
        allowedWakeKinds: ["assistant.ask.completed"],
        assistantAskCompletionOccurredBefore: null,
      }),
    );
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMailboxDedupeKeyPrefixes: expect.arrayContaining([
          "assistant.notification.requested:phone-call-result:",
        ]),
      }),
    );
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      inspectOnly: true,
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resolveHostedOldestPendingAssistantInputAt).toHaveBeenCalledWith({
      signal: null,
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.resolveHostedOldestAssistantInputOccurredAt).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: armedWakeAt,
      progressed: false,
    }));
  });

  it("drains a causal-only assistant ask completion when no private input is pending", async () => {
    const now = "2026-04-27T00:03:00.000Z";
    const completionItem = createAssistantAskCompletionSystemMailboxItem();
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(null);
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        item: completionItem,
        itemId: completionItem.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-ask-completion",
          redactedLogEntries: [],
        },
        status: "processed",
      });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        allowedRouteActions: ["continue-assistant-ask"],
        allowedWakeKinds: ["assistant.ask.completed"],
      }),
    );
    expect(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls[1]?.[0],
    ).not.toHaveProperty("assistantAskCompletionOccurredBefore");
    expect(mocks.resolveHostedOldestPendingAssistantInputAt).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
  });

  it("keeps due cron work out of a causal-only zero-effect pass", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });
    mocks.getAssistantCronStatus.mockResolvedValue({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: now,
      runningJobs: 0,
      totalJobs: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: now,
      }),
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));
  });

  it("preserves an armed workspace wake through a causal-only system mailbox checkpoint", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const armedWakeAt = "2026-04-27T00:05:00.000Z";
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      foregroundCausalOnly: true,
      conversationImportedCount: 0,
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
      workspace: createDueAssistantWorkspace({
        nextWakeAt: armedWakeAt,
      }),
    }));

    expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: armedWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: armedWakeAt,
      nextWakeReason: "assistant",
    }));
  });

  it("selects the exact approval ahead of an older local wake and due cron work", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-causal-approval-"));
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const effectId = "vault-file-send:effect_causal_exact";

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const unrelatedWake = buildHostedExecutionRuntimeControlWake({
        eventId: "evt_runtime_manual_causal_exact",
        kind: "runtime.manual-requested",
        occurredAt: "2026-04-26T23:59:00.000Z",
        userId: "member_synthetic_phase",
      });
      const approvalWake = buildHostedExecutionPendingEffectsReconcileRequestedWake({
        effectId,
        eventId: "evt_runtime_pending_effects_causal_exact",
        occurredAt: now,
        userId: "member_synthetic_phase",
      });
      for (const wake of [unrelatedWake, approvalWake]) {
        const outcome = await systemMailbox.enqueueHostedSystemMailboxItem({
          item: createResolvedForegroundAdmissionMailboxItem({
            kind: wake.kind,
            occurredAt: wake.occurredAt,
          }),
          vaultRoot,
          wake,
        });
        expect(outcome.status).toBe("imported");
      }

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId,
      };
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([deliveryEffect]);
      mocks.getAssistantCronStatus.mockResolvedValue({
        dueJobs: 1,
        enabledJobs: 1,
        nextRunAt: now,
        runningJobs: 0,
        totalJobs: 1,
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        foregroundCausalOnly: true,
        conversationImportedCount: 0,
        importedCount: 1,
        now: () => now,
        operatorHomeRoot,
        shouldYieldBackgroundMaintenance: () => true,
        vaultRoot,
        workspace: createDueAssistantWorkspace({ nextWakeAt: now }),
      }));

      expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedRouteActions: ["apply-runtime-control-request"],
          allowedWakeKinds: ["runtime.pending-effects-reconcile-requested"],
        }),
      );
      expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
        actionApprovalPort: null,
        includeBackgroundDueIntents: false,
        messageVolumeReceiptPort: expect.any(Object),
        preferredEffectIds: [effectId],
        preferredIntentIds: [],
        vaultRoot,
      });
      expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
      expect(mocks.createHostedAssistantChannelTypingDependencies).not.toHaveBeenCalled();
      expect(mocks.createHostedAssistantProgressDeliveryDependencies).not.toHaveBeenCalled();
      expect(mocks.hydrateHostedExecutionDefaultTarget).not.toHaveBeenCalled();
      expect(mocks.resolveHostedPendingAssistantInputWakeAt).not.toHaveBeenCalled();
      expect(mocks.resolveHostedSystemMailboxNextWakeCandidate).not.toHaveBeenCalled();
      expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
      expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        progressed: true,
      }));

      await result.afterCheckpoint?.();

      const mailboxState = await readHostedSystemMailboxState(vaultRoot);
      expect(mailboxState.pending).toEqual([
        expect.objectContaining({
          wake: expect.objectContaining({
            kind: "runtime.manual-requested",
          }),
        }),
      ]);
      expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantDeliveryEffects: [deliveryEffect],
          shouldYieldBackgroundDelivery: null,
          wake: approvalWake,
        }),
      );
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("keeps a due workspace wake armed through a causal-only exact delivery post-checkpoint", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-causal-due-wake-"));
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const effectId = "vault-file-send:effect_causal_due_wake";

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const approvalWake = buildHostedExecutionPendingEffectsReconcileRequestedWake({
        effectId,
        eventId: "evt_runtime_pending_effects_causal_due_wake",
        occurredAt: now,
        userId: "member_synthetic_phase",
      });
      const outcome = await systemMailbox.enqueueHostedSystemMailboxItem({
        item: createResolvedForegroundAdmissionMailboxItem({
          kind: approvalWake.kind,
          occurredAt: approvalWake.occurredAt,
        }),
        vaultRoot,
        wake: approvalWake,
      });
      expect(outcome.status).toBe("imported");

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      const deliveryEffect = {
        ...createDeliveryEffect(),
        effectId,
      };
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([deliveryEffect]);

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        assistantInputIds: [],
        foregroundCausalOnly: true,
        conversationImportedCount: 0,
        importedCount: 1,
        now: () => now,
        operatorHomeRoot,
        shouldYieldBackgroundMaintenance: () => true,
        vaultRoot,
        workspace: createDueAssistantWorkspace({ nextWakeAt: now }),
      }));

      expect(result).toEqual(expect.objectContaining({
        checkpointReason: "outbox_sending",
        progressed: true,
      }));

      const postCheckpoint = await result.afterCheckpoint?.();
      expect(mocks.getAssistantCronStatus).not.toHaveBeenCalled();
      expect(postCheckpoint).toEqual(expect.objectContaining({
        nextWakeAt: now,
      }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("terminates a causal-only approval pass when its exact effect is no longer deliverable", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const pendingEffectsItem = createPendingEffectsReconcileSystemMailboxItem();
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: pendingEffectsItem,
      itemId: pendingEffectsItem.itemId,
      metrics: {
        bootstrapResult: null,
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        redactedLogEntries: [],
      },
      status: "processed",
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      foregroundCausalOnly: true,
      importedCount: 1,
      now: () => now,
      shouldYieldBackgroundMaintenance: () => true,
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredEffectIds: [pendingEffectsItem.wake.effectId],
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.prepareHostedProviderCleanupPlan).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: pendingEffectsItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
  });

  it("keeps a future causal approval wake behind foreground input at pass admission", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "continue-assistant-ask",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "assistant.ask.completed",
        ],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
  });

  it("keeps unrelated system wakes behind foreground input at pass admission", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(now);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRouteActions: [
          "apply-runtime-control-request",
          "continue-assistant-ask",
        ],
        allowedWakeKinds: [
          "runtime.pending-effects-reconcile-requested",
          "assistant.ask.completed",
        ],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
  });

  it("drains a real exact approval wake ahead of its real pending conversation input", async () => {
    const scenario = await runRealForegroundApprovalAdmissionScenario({
      deliveryEffect: true,
      wake: "due-exact",
    });

    try {
      expect(scenario.pendingInputIds).toEqual([scenario.inputId]);
      expect(scenario.pendingInputIdsAfterRun).toEqual([scenario.inputId]);
      expect(scenario.pendingInputIdsAfterRun).not.toContain(scenario.oldInputId);
      expect(scenario.pendingIndexInspectionAfterRun).toEqual({
        hasCandidate: true,
        indexComplete: false,
      });
      expect(scenario.pendingWakeReads).toEqual([]);
      expect(scenario.pendingIndexStateAfterRun).toBe(scenario.pendingIndexStateBeforeRun);
      expect(scenario.systemMailboxPreparationStatuses[0]).toBe("processed");
      expect(mocks.hasCompleteAssistantAutoReplyTerminalEvidence).toHaveBeenCalledWith({
        captureId: null,
        inputId: scenario.inputId,
        vault: scenario.vaultRoot,
      });
      expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
        actionApprovalPort: null,
        includeBackgroundDueIntents: false,
        messageVolumeReceiptPort: expect.any(Object),
        preferredEffectIds: [scenario.effectId],
        preferredIntentIds: [],
        vaultRoot: scenario.vaultRoot,
      });
      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(scenario.result).toEqual(expect.objectContaining({
        afterCheckpointKeepsForegroundImportLoop: true,
        checkpointReason: "outbox_sending",
        progressed: true,
      }));
    } finally {
      await scenario.cleanup();
    }
  });

  it("ends a real causal-only pass when the exact wake has no effect", async () => {
    const scenario = await runRealForegroundApprovalAdmissionScenario({
      deliveryEffect: false,
      wake: "due-exact",
    });

    try {
      expect(scenario.pendingInputIds).toEqual([scenario.inputId]);
      expect(scenario.pendingInputIdsAfterRun).toEqual([scenario.inputId]);
      expect(scenario.pendingInputIdsAfterRun).not.toContain(scenario.oldInputId);
      expect(scenario.pendingIndexInspectionAfterRun).toEqual({
        hasCandidate: true,
        indexComplete: false,
      });
      expect(scenario.pendingWakeReads).toEqual([]);
      expect(scenario.pendingIndexStateAfterRun).toBe(scenario.pendingIndexStateBeforeRun);
      expect(scenario.systemMailboxPreparationStatuses[0]).toBe("processed");
      expect(mocks.hasCompleteAssistantAutoReplyTerminalEvidence).toHaveBeenCalledWith({
        captureId: null,
        inputId: scenario.inputId,
        vault: scenario.vaultRoot,
      });
      expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredEffectIds: [scenario.effectId],
          vaultRoot: scenario.vaultRoot,
        }),
      );
      expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
      expect(scenario.result).toEqual(expect.objectContaining({
        checkpointReason: "system_mailbox_receipt",
        progressed: true,
      }));
    } finally {
      await scenario.cleanup();
    }
  });

  it("keeps a real future exact wake behind real pending conversation input", async () => {
    const scenario = await runRealForegroundApprovalAdmissionScenario({
      deliveryEffect: false,
      wake: "future-exact",
    });

    try {
      expect(scenario.pendingInputIdsAfterRun).toEqual([scenario.inputId]);
      expect(scenario.pendingIndexInspectionAfterRun.indexComplete).toBe(false);
      expect(mocks.hasCompleteAssistantAutoReplyTerminalEvidence).toHaveBeenCalledWith({
        captureId: null,
        inputId: scenario.inputId,
        vault: scenario.vaultRoot,
      });
      expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
        expect.objectContaining({
          includeBackgroundDueIntents: true,
          preferredEffectIds: [scenario.effectId],
        }),
      );
      expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
        expect.objectContaining({
          freshAssistantInputIds: [scenario.inputId],
        }),
      );
      expect(scenario.systemMailboxState.pending).toEqual([
        expect.objectContaining({
          wake: expect.objectContaining({
            effectId: scenario.effectId,
            kind: "runtime.pending-effects-reconcile-requested",
          }),
        }),
      ]);
    } finally {
      await scenario.cleanup();
    }
  });

  it("keeps a real unrelated wake behind real pending conversation input", async () => {
    const scenario = await runRealForegroundApprovalAdmissionScenario({
      deliveryEffect: false,
      wake: "due-unrelated",
    });

    try {
      expect(scenario.pendingInputIdsAfterRun).toEqual([scenario.inputId]);
      expect(scenario.pendingIndexInspectionAfterRun.indexComplete).toBe(false);
      expect(mocks.hasCompleteAssistantAutoReplyTerminalEvidence).toHaveBeenCalledWith({
        captureId: null,
        inputId: scenario.inputId,
        vault: scenario.vaultRoot,
      });
      expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
        expect.objectContaining({
          includeBackgroundDueIntents: true,
          preferredEffectIds: [scenario.effectId],
        }),
      );
      expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledWith(
        expect.objectContaining({
          freshAssistantInputIds: [scenario.inputId],
        }),
      );
      expect(scenario.systemMailboxState.pending).toEqual([
        expect.objectContaining({
          wake: expect.objectContaining({
            kind: "runtime.manual-requested",
          }),
        }),
      ]);
    } finally {
      await scenario.cleanup();
    }
  });

  it("defers Codex auth terminal receipts until after the durable checkpoint", async () => {
    const codexAuthItem = createCodexAuthSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: codexAuthItem,
      itemId: "system_mailbox_item_codex_auth",
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
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      afterDurableCheckpoint: expect.any(Array),
      checkpointReason: "system_mailbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecordDeferred: true,
        hostedSystemMailboxRecorded: 0,
      }),
    }));

    const effects = postCheckpoint?.afterDurableCheckpoint;
    const effect = typeof effects === "function" ? effects : effects?.[0];
    if (!effect) {
      throw new Error("Expected deferred Codex auth durable checkpoint effect.");
    }
    await expect(effect()).resolves.toEqual({
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      nextWakeReason: "assistant",
      requiresFollowUpCheckpoint: true,
    });
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: codexAuthItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("defers vault-share projection work until after the durable checkpoint", async () => {
    const vaultShareItem = createVaultShareProjectionSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      item: vaultShareItem,
      itemId: vaultShareItem.itemId,
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
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      afterDurableCheckpoint: expect.any(Array),
      checkpointReason: "system_mailbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedSystemMailboxRecordDeferred: true,
      }),
    }));

    const effects = postCheckpoint?.afterDurableCheckpoint;
    const effect = typeof effects === "function" ? effects : effects?.[0];
    if (!effect) {
      throw new Error("Expected deferred vault-share projection effect.");
    }
    expect(effect.requiresVaultShareProjectionResult).toBe(true);
    await effect({
      vaultShareProjectionResult: { outcome: "delivered" },
    });
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: vaultShareItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultShareProjectionResult: { outcome: "delivered" },
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("does not discover terminal Linq cleanup for foreground assistant input ids", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: ["ain_00000000000000000000000000000007"],
      importedCount: 0,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result.checkpointReason).not.toBe("provider_cleanup");
  });

  it("collects only current-turn delivery effects on foreground conversation input", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: ["intent_fresh"],
      vaultRoot: expect.any(String),
    });
  });

  it("runs one requested member action after the current foreground reply", async () => {
    const sequence: string[] = [];
    let newerForegroundInputArrived = false;
    const deliveryEffect = createDeliveryEffect();
    const memberActionItem = createMemberActionSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
      async (preparationInput) => {
        if (
          preparationInput.allowedRouteActions?.includes("apply-member-action")
          && preparationInput.allowedWakeKinds?.includes("member.action.requested")
        ) {
          sequence.push("member-action");
          return {
            item: memberActionItem,
            itemId: memberActionItem.itemId,
            metrics: {
              bootstrapResult: null,
              conversationMetrics: null,
              mailboxLane: "member-action" as const,
              postCheckpointRecord: memberActionItem.postCheckpointRecord,
              redactedLogEntries: [],
            },
            status: "processed" as const,
          };
        }
        return null;
      },
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      sequence.push("provider");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        progressed: true,
        redactedLogEntries: [],
      };
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async () => {
      sequence.push("foreground-delivery");
      newerForegroundInputArrived = true;
      return [createSentDeliveryOutcome()];
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      shouldYieldBackgroundMaintenance: () => newerForegroundInputArrived,
    }));

    expect(sequence).toEqual(["provider", "foreground-delivery"]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(sequence).toEqual([
      "provider",
      "foreground-delivery",
      "member-action",
    ]);
    expect(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls.at(-1)?.[0],
    ).toEqual(expect.objectContaining({
      allowedRouteActions: [
        "apply-member-activation",
        "apply-member-action",
      ],
      allowedWakeKinds: [
        "member.activated",
        "member.action.requested",
      ],
      shouldYieldBackgroundMaintenance: null,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      afterDurableCheckpoint: expect.any(Function),
      checkpointReason: "system_mailbox_receipt",
    }));
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();

    await runHostedWorkspaceDurableCheckpointEffects(
      postCheckpoint?.afterDurableCheckpoint,
    );

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: memberActionItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("finishes member activation after the first foreground reply", async () => {
    const sequence: string[] = [];
    const activationItem = createMemberActivationSignupWelcomeSystemMailboxItem();
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
      async (preparationInput) => {
        if (
          preparationInput.allowedRouteActions?.includes("apply-member-activation")
          && preparationInput.allowedWakeKinds?.includes("member.activated")
        ) {
          sequence.push("member-activation");
          return {
            item: activationItem,
            itemId: activationItem.itemId,
            metrics: {
              bootstrapResult: null,
              conversationMetrics: null,
              mailboxLane: "member-activated" as const,
              nextWakeAt: null,
              postCheckpointRecord: null,
              redactedLogEntries: [],
            },
            status: "processed" as const,
          };
        }
        return null;
      },
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      sequence.push("provider");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        nextWakeAt: null,
        parserProcessed: 0,
        postCheckpointRecord: null,
        progressed: true,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(sequence).toEqual(["provider"]);

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(sequence).toEqual(["provider", "member-activation"]);
    expect(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls.at(-1)?.[0],
    ).toEqual(expect.objectContaining({
      allowedRouteActions: [
        "apply-member-activation",
        "apply-member-action",
      ],
      allowedWakeKinds: [
        "member.activated",
        "member.action.requested",
      ],
      shouldYieldBackgroundMaintenance: null,
    }));
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
    }));
  });

  it("removes a real queued member activation after the first foreground reply", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-member-activation-"));
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    const sequence: string[] = [];

    try {
      await initializeVault({ createdAt: now, vaultRoot });
      const systemMailbox = await loadHostedSystemMailboxRealImplementation();
      const activationWake = buildHostedExecutionMemberActivatedWake({
        eventId: "member.activated:synthetic:first-conversation",
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        memberId: "member_synthetic_phase",
        occurredAt: now,
      });
      const activationItem = createResolvedMemberActivationMailboxItem({
        occurredAt: now,
      });
      // Preserve recovery coverage for snapshots created before bootstrap-only
      // activations stopped creating a second queue item.
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [{
          attemptCount: 0,
          itemId: activationItem.item.id,
          lastAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          mailboxDedupeKey: activationItem.item.dedupeKey,
          mailboxLaneSeq: activationItem.item.laneSeq,
          nextAttemptAt: null,
          occurredAt: activationItem.item.occurredAt,
          postCheckpointRecord: null,
          preferenceCausalSeq: null,
          requestId: null,
          routeAction: "apply-member-activation",
          status: "pending",
          wake: activationWake,
        }],
      }));
      expect(await readHostedSystemMailboxState(vaultRoot)).toMatchObject({
        pending: [
          {
            routeAction: "apply-member-activation",
            wake: { kind: "member.activated" },
          },
        ],
      });

      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
        systemMailbox.prepareHostedSystemMailboxItemForCheckpoint,
      );
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(
        systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint,
      );
      mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
        systemMailbox.resolveHostedSystemMailboxNextWakeCandidate,
      );
      mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
        sequence.push("provider");
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: true,
          deviceSyncProcessed: 0,
          deviceSyncSkipped: true,
          nextWakeAt: null,
          parserProcessed: 0,
          postCheckpointRecord: null,
          progressed: true,
          redactedLogEntries: [],
        };
      });

      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 1,
        now: () => now,
        operatorHomeRoot,
        vaultRoot,
      }));

      expect(sequence).toEqual(["provider"]);
      expect(await readHostedSystemMailboxState(vaultRoot)).toMatchObject({
        pending: [
          {
            routeAction: "apply-member-activation",
            wake: { kind: "member.activated" },
          },
        ],
      });

      const postCheckpoint = await result.afterCheckpoint?.();

      expect(await readHostedSystemMailboxState(vaultRoot)).toEqual({ pending: [] });
      expect(postCheckpoint).toEqual(expect.objectContaining({
        checkpointReason: "activation_bootstrap",
      }));
    } finally {
      await rm(parentRoot, { force: true, recursive: true });
    }
  });

  it("does not scan terminal Linq cleanup during fresh conversation input", async () => {
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result.checkpointReason).not.toBe("provider_cleanup");
  });

  it("preserves scheduled cleanup wake after foreground non-fast delivery without provider ids", async () => {
    const providerCleanupWakeAt = "2026-04-27T00:14:00.000Z";
    const baseDeliveryEffect = createDeliveryEffect();
    const deliveryEffect = {
      ...baseDeliveryEffect,
      payload: {
        ...baseDeliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [deliveryEffect.effectId],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
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
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt: providerCleanupWakeAt,
      progressed: true,
    }));
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: providerCleanupWakeAt,
      redactedStatus: expect.objectContaining({
        nextWakeAt: providerCleanupWakeAt,
      }),
    }));
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
  });

  it("preserves queued provider cleanup during later foreground input with no delivery effects", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:12:00.000Z",
        nextWakeReason: "assistant",
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:12:00.000Z",
      progressed: true,
    }));
  });

  it("re-arms due provider cleanup when fresh foreground input has no delivery effects", async () => {
    // Stored cleanup checkpoint is already due when the foreground turn runs.
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue({
      nextWakeAt: "2026-04-27T00:08:00.000Z",
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "assistant",
      }),
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    // The due checkpoint re-arms durably into the cleanup owner state; the
    // phase wake derives from that single owner.
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("uses the persisted provider cleanup wake after foreground Linq delivery behind a stale mailbox wake", async () => {
    mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "mailbox",
      }),
    }));

    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["provider_message_from_reply"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("uses the persisted provider cleanup wake after active-turn Linq delivery behind a stale device-sync wake", async () => {
    mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["provider_message_from_active_turn"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("does not drain queued provider cleanup when fresh input also produces delivery effects", async () => {
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "assistant",
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["provider_message_from_reply"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("records provider cleanup only after foreground delivery drains", async () => {
    mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "mailbox",
      }),
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.recordHostedProviderCleanupBeforeCommit.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    );
  });

  it("defers cleanup when input is admitted during the active turn", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
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
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      messageVolumeReceiptPort: expect.any(Object),
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.listPendingAssistantAutoReplyLinqCleanupEvidence).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: "2026-04-27T00:14:00.000Z",
      },
      linqMessageIds: ["provider_message_from_active_turn"],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("skips managed automation seeding when pending input appears after system mailbox work", async () => {
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
    mocks.resolveHostedPendingAssistantInputWakeAt
      .mockResolvedValueOnce(null)
      .mockResolvedValue("2026-04-27T00:10:00.000Z");

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result.nextWakeAt).toBe("2026-04-27T00:10:00.000Z");
    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      nextWakeReason: "assistant",
    }));
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(
      mocks.resolveHostedPendingAssistantInputWakeAt.mock.calls[0]?.[0].now(),
    ).toBe("2026-04-27T00:10:00.000Z");
  });

  it("probes pending input when imported conversations have no eligible foreground ids", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [],
      conversationImportedCount: 1,
      importedCount: 1,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(3);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.prepareHostedAssistantAutomationForWake).toHaveBeenCalledTimes(1);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: false,
    }));
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      inspectOnly: false,
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(
      mocks.resolveHostedPendingAssistantInputWakeAt.mock.calls[0]?.[0].now(),
    ).toBe("2026-04-27T00:10:00.000Z");
  });

  it("defers queued provider cleanup behind a pending assistant attempt", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(3);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));
  });

  it("retries prepared room setup before planning the first group conversation", async () => {
    const callOrder: string[] = [];
    const now = "2026-07-29T18:01:00.000Z";
    const item = createGroupRoomModelInitializationSystemMailboxItem();
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) =>
      input?.allowedRouteActions?.includes("initialize-group-room-model")
        ? {
            at: now,
            reason: "assistant",
          }
        : {
            at: null,
            reason: null,
          }
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockImplementationOnce(async (input) => {
        callOrder.push("room-model-failed");
        expect(input.allowedRouteActions).toEqual([
          "initialize-group-room-model",
        ]);
        return {
          attemptCount: item.attemptCount,
          errorCode: "group_room_model_unavailable",
          errorMessage: "Group room model unavailable.",
          itemId: item.itemId,
          legacyUsageReferralAuthorityClassification: null,
          nextWakeAt: "2026-07-29T18:02:00.000Z",
          routeAction: item.routeAction,
          status: "retryable_failed",
          wakeKind: item.wake.kind,
        };
      })
      .mockImplementationOnce(async (input) => {
        callOrder.push("room-model-initialized");
        expect(input.allowedRouteActions).toEqual([
          "initialize-group-room-model",
        ]);
        return {
          item,
          itemId: item.itemId,
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            mailboxLane: "member-activated",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });
    const input = createPhaseInput({
      importedCount: 1,
      now: () => now,
    });

    const failed = await runHostedWorkspaceAssistantPhase(input);

    expect(failed).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-07-29T18:02:00.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedGroupRoomModelInitializationRetryableFailed: 1,
      }),
    }));
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();

    const replay = await runHostedWorkspaceAssistantPhase(input);

    expect(callOrder).toEqual([
      "room-model-failed",
      "room-model-initialized",
      "assistant",
    ]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expectAssistantLaneCallWithoutDeviceSyncOptions({
      freshAssistantInputIds: ["ain_00000000000000000000000000000001"],
    });
    expect(replay).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedGroupRoomModelInitializationProcessed: 1,
      }),
    }));
  });

  it("applies member preference mailbox work before planning fresh conversation input", async () => {
    const callOrder: string[] = [];
    let preferenceWakeChecks = 0;
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return {
          at: null,
          reason: null,
        };
      }
      if (input?.allowedRouteActions?.includes("apply-member-preferences")) {
        preferenceWakeChecks += 1;
        return preferenceWakeChecks === 1
          ? {
              at: "2026-04-27T00:00:00.000Z",
              reason: "assistant",
            }
          : {
              at: null,
              reason: null,
            };
      }
      return {
        at: null,
        reason: null,
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(
      async (input) => {
        callOrder.push("member-preferences");
        expect(input.allowedRouteActions).toEqual(["apply-member-preferences"]);
        return {
          item: createMemberPreferencesSystemMailboxItem(),
          itemId: "system_mailbox_item_member_preferences",
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            mailboxLane: "member-preferences-updated",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      },
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(callOrder).toEqual(["member-preferences", "assistant"]);
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningProcessed: 1,
      }),
    }));
  });

  it("drains one bounded due preference page before rescheduling fresh conversation input", async () => {
    const now = "2026-04-27T00:00:00.000Z";
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return {
          at: null,
          reason: null,
        };
      }
      if (
        input?.allowedRouteActions?.includes("initialize-group-room-model")
      ) {
        return {
          at: null,
          reason: null,
        };
      }
      return {
        at: now,
        reason: "assistant",
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(async (input) => {
      expect(input.allowedRouteActions).toEqual(["apply-member-preferences"]);
      const itemNumber = mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls.length;
      const item = {
        ...createMemberPreferencesSystemMailboxItem(),
        itemId: `system_mailbox_item_member_preferences_${itemNumber}`,
        mailboxDedupeKey: `dedupe_system_mailbox_item_member_preferences_${itemNumber}`,
      };
      return {
        item,
        itemId: item.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-preferences-updated",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => now,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(10);
    expect(mocks.resolveHostedSystemMailboxNextWakeCandidate).toHaveBeenCalledTimes(12);
    expect(mocks.runHostedAssistantAutomationLane).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: now,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningPageLimit: 10,
        hostedMemberPreferencesPrePlanningPending: 1,
        hostedMemberPreferencesPrePlanningProcessed: 10,
      }),
    }));
  });

  it("applies member preference mailbox work before background notification work", async () => {
    const callOrder: string[] = [];
    let preferenceWakeChecks = 0;
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (
        input?.allowedRouteActions?.length === 1
        && input.allowedRouteActions[0] === "apply-member-preferences"
      ) {
        preferenceWakeChecks += 1;
        return preferenceWakeChecks === 1
          ? {
              at: "2026-04-27T00:00:00.000Z",
              reason: "assistant",
            }
          : {
              at: null,
              reason: null,
            };
      }

      return {
        at: null,
        reason: null,
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(async (input) => {
      if (
        input.allowedRouteActions?.length === 1
        && input.allowedRouteActions[0] === "apply-member-preferences"
      ) {
        callOrder.push("member-preferences");
        return {
          item: createMemberPreferencesSystemMailboxItem(),
          itemId: "system_mailbox_item_member_preferences",
          metrics: {
            bootstrapResult: null,
            conversationMetrics: null,
            mailboxLane: "member-preferences-updated",
            redactedLogEntries: [],
          },
          status: "processed",
        };
      }

      callOrder.push("assistant-notification");
      expect(input.allowedRouteActions).toBeUndefined();
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_notification",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(callOrder).toEqual(["member-preferences", "assistant-notification"]);
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningProcessed: 1,
        hostedSystemMailboxPrepared: 1,
      }),
    }));
  });

  it("continues fresh conversation planning while member preferences are waiting to retry", async () => {
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return {
          at: null,
          reason: null,
        };
      }
      if (input?.allowedRouteActions?.includes("apply-member-preferences")) {
        return {
          at: "2026-04-27T00:01:00.000Z",
          reason: "assistant",
        };
      }
      return {
        at: null,
        reason: null,
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      progressed: false,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningPending: 1,
        hostedMemberPreferencesPrePlanningProcessed: 0,
      }),
    }));
  });

  it("continues fresh conversation planning when member preferences fail retryably", async () => {
    const callOrder: string[] = [];
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async (input) => {
      if (input?.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return {
          at: null,
          reason: null,
        };
      }
      if (input?.allowedRouteActions?.includes("apply-member-preferences")) {
        return {
          at: "2026-04-27T00:00:00.000Z",
          reason: "assistant",
        };
      }
      return {
        at: null,
        reason: null,
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      callOrder.push("member-preferences");
      return {
        attemptCount: 2,
        errorCode: "synthetic_preferences_retry",
        errorMessage: "Synthetic preferences retry.",
        itemId: "system_mailbox_item_member_preferences",
        legacyUsageReferralAuthorityClassification: null,
        nextWakeAt: "2026-04-27T00:01:00.000Z",
        routeAction: "apply-member-preferences",
        status: "retryable_failed",
        wakeKind: "member.preferences.updated",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
    }));

    expect(callOrder).toEqual(["member-preferences", "assistant"]);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedMemberPreferencesPrePlanningErrorCode: "synthetic_preferences_retry",
        hostedMemberPreferencesPrePlanningProcessed: 0,
        hostedMemberPreferencesPrePlanningRetryableFailed: 1,
      }),
    }));
  });

  it("attempts pending assistant input before due system mailbox work", async () => {
    const callOrder: string[] = [];
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(async (input) => {
      if (input.allowedWakeKinds?.includes("runtime.pending-effects-reconcile-requested")) {
        return null;
      }
      callOrder.push("system-mailbox");
      return {
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_processed",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(callOrder).toEqual(["assistant", "system-mailbox"]);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      nextWakeReason: "assistant",
    }));
  });

  it("attempts pending assistant input before due device-sync work", async () => {
    const callOrder: string[] = [];
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.runHostedDeviceSyncWakeLane.mockImplementationOnce(async () => {
      callOrder.push("device-sync");
      return {
        deviceSyncProcessed: 1,
        deviceSyncSkipped: false,
        nextWakeAt: "2026-04-27T00:11:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        parserProcessed: 0,
        postCheckpointRecord: null,
      };
    });
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: false,
        nextWakeAt: null,
        redactedLogEntries: [],
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
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
        nextWakeAt: "2026-04-27T00:09:59.000Z",
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: null,
        snapshotRef: null,
        updatedAt: "2026-04-27T00:00:00.000Z",
        userId: "member_synthetic_phase",
        version: "8",
      },
    }));

    expect(callOrder).toEqual(["assistant", "device-sync"]);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));
  });

  it("runs an assistant pass after deferred manual runtime-control work", async () => {
    const callOrder: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const manualRuntimeItem = {
      ...createSystemMailboxItem(),
      itemId: "system_mailbox_item_deferred_runtime_manual",
      mailboxDedupeKey: "dedupe_system_mailbox_item_deferred_runtime_manual",
      routeAction: "apply-runtime-control-request" as const,
      wake: {
        eventId: "evt_deferred_runtime_manual_requested",
        kind: "runtime.manual-requested" as const,
        occurredAt: "2026-04-27T00:10:01.000Z",
        userId: "member_synthetic_phase",
      },
    };
    mocks.runHostedAssistantAutomationLane
      .mockImplementationOnce(async () => {
        callOrder.push("assistant-1");
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: true,
          nextWakeAt: "2026-04-27T00:10:30.000Z",
          redactedLogEntries: [{
            component: "runtime.provider",
            level: "info",
            message: "First assistant pass timing.",
            phase: "wake.running",
            redacted: {
              schema: "murph.assistant-turn-timing.v1",
              type: "assistant.turn.timing",
              turnTimingElapsedMs: 11,
              turnTimingStage: "provider-result-returned",
            },
          }],
        };
      })
      .mockImplementationOnce(async () => {
        callOrder.push("assistant-2");
        return {
          assistantAutomationCurrentTurnDeliveryIntentIds: [],
          assistantAutomationProgressed: false,
          nextWakeAt: "2026-04-27T00:45:00.000Z",
          redactedLogEntries: [{
            component: "runtime.provider",
            level: "info",
            message: "Second assistant pass timing.",
            phase: "wake.running",
            redacted: {
              schema: "murph.assistant-turn-timing.v1",
              type: "assistant.turn.timing",
              turnTimingElapsedMs: 29,
              turnTimingStage: "usage-recorded",
            },
          }],
        };
      });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      callOrder.push("system-mailbox");
      return {
        item: manualRuntimeItem,
        itemId: manualRuntimeItem.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "runtime-control",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(callOrder).toEqual(["system-mailbox", "assistant-1"]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson)
        .filter((redactedJson) =>
          redactedJson?.detailComponent === "runtime.provider" &&
          redactedJson?.type === "assistant.turn.timing"
        )
        .map((redactedJson) => redactedJson?.turnTimingStage),
    ).toEqual(["provider-result-returned"]);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));

    await result.afterCheckpoint?.();

    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledWith({
      item: manualRuntimeItem,
      operatorHomeRoot: "/tmp/murph-operator-home",
      runtime: expect.any(Object),
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("keeps buffered first-pass detail logs when deferred manual runtime-control work runs once", async () => {
    const callOrder: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const manualRuntimeItem = {
      ...createSystemMailboxItem(),
      itemId: "system_mailbox_item_deferred_runtime_manual",
      mailboxDedupeKey: "dedupe_system_mailbox_item_deferred_runtime_manual",
      routeAction: "apply-runtime-control-request" as const,
      wake: {
        eventId: "evt_deferred_runtime_manual_requested",
        kind: "runtime.manual-requested" as const,
        occurredAt: "2026-04-27T00:10:01.000Z",
        userId: "member_synthetic_phase",
      },
    };
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant-1");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: "2026-04-27T00:10:30.000Z",
        redactedLogEntries: [{
          component: "runtime.provider",
          level: "info",
          message: "First assistant pass timing.",
          phase: "wake.running",
          redacted: {
            schema: "murph.assistant-turn-timing.v1",
            type: "assistant.turn.timing",
            turnTimingElapsedMs: 11,
            turnTimingStage: "provider-result-returned",
          },
        }],
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
      callOrder.push("system-mailbox");
      return {
        item: manualRuntimeItem,
        itemId: manualRuntimeItem.itemId,
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "runtime-control",
          redactedLogEntries: [],
        },
        status: "processed",
      };
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      logRequests,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(callOrder).toEqual(["system-mailbox", "assistant-1"]);
    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson)
        .filter((redactedJson) =>
          redactedJson?.detailComponent === "runtime.provider" &&
          redactedJson?.type === "assistant.turn.timing"
        )
        .map((redactedJson) => redactedJson?.turnTimingStage),
    ).toEqual(["provider-result-returned"]);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));
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

  it("records dirty post-checkpoint work for due device-sync work", async () => {
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
      recorded: 1,
      stillDirty: true,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:00:00.000Z",
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

    expect(result.progressed).toBe(true);
    expect(result.nextWakeAt).toBe("2026-04-27T00:11:00.000Z");
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).toHaveBeenCalledWith(
      expect.objectContaining({
        wake: expect.objectContaining({
          kind: "runtime.timer",
          userId: "member_synthetic_phase",
        }),
      }),
    );

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      afterDurableCheckpoint: expect.any(Function),
    }));
    await runHostedWorkspaceDurableCheckpointEffects(postCheckpoint?.afterDurableCheckpoint);
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
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:11:00.000Z",
      nextWakeReason: "device-sync.reconcile",
      redactedStatus: expect.objectContaining({
        hostedDeviceSyncDirtyAckDeferred: true,
        hostedDeviceSyncDirtyAckRecorded: false,
        hostedDeviceSyncDirtyStillPending: true,
      }),
    }));
  });

  it("logs dirty checkpoint failures and preserves the retry wake", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
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
    mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord.mockRejectedValueOnce(
      new Error("synthetic dirty checkpoint failure"),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
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
    const postCheckpoint = await result.afterCheckpoint?.();
    const effects = postCheckpoint?.afterDurableCheckpoint;
    const effect = typeof effects === "function" ? effects : effects?.[0];
    if (!effect) {
      throw new Error("Expected deferred device-sync dirty checkpoint effect.");
    }

    await expect(effect()).resolves.toEqual({
      nextWakeAt: "2026-04-27T00:11:00.000Z",
      nextWakeReason: "device-sync.reconcile",
    });
    const failureLog = logRequests
      .flatMap((request) => request.entries)
      .find((entry) => entry.redactedJson?.failureEventOrigin === "checkpoint");
    expect(failureLog).toEqual(expect.objectContaining({
      component: "device-sync",
      errorCode: "checkpoint_error",
      eventCode: "device-sync.dirty_ack_persistence_failed",
      level: "warn",
      phase: "checkpoint",
      redactedJson: expect.objectContaining({
        errorCode: "checkpoint_error",
        failureEventOrigin: "checkpoint",
        nextWakeAtPresent: true,
        safeErrorMessage: "Hosted execution failed while recording a checkpoint.",
      }),
    }));
    expect(JSON.stringify(logRequests)).not.toContain(
      "synthetic dirty checkpoint failure",
    );
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
    // Foreground Reply Critical Path: a cleanup-capable post-checkpoint step must
    // keep the foreground import loop alive so a message arriving mid-drain
    // is imported and preempts via the yield hook.
    expect(result.afterCheckpointKeepsForegroundImportLoop).toBe(true);
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
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
      nextWakeAt: expect.any(String),
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
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomes: [expect.objectContaining({
          deliveryChannel: "linq",
          providerMessageId: "provider_synthetic",
        })],
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    const deliveryDrainInput = mocks.drainHostedPreparedAssistantDeliveries
      .mock.calls[0]?.[0];
    await expect(deliveryDrainInput.assertLiveness()).resolves.toBeUndefined();
  });

  it("flushes member-channel updates before auto-reply delivery dispatch", async () => {
    const deliveryEffect = createDeliveryEffect();
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce({
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_notification",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      })
      .mockResolvedValueOnce({
        item: {
          ...createSystemMailboxItem(),
          itemId: "system_mailbox_item_member_channels",
          routeAction: "apply-member-channels-update",
        },
        itemId: "system_mailbox_item_member_channels",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-channels-updated",
          redactedLogEntries: [],
        },
        status: "processed",
      })
      .mockResolvedValueOnce(null);
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
    }));
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.calls[1]?.[0])
      .toEqual(expect.objectContaining({
        allowedRouteActions: ["apply-member-channels-update"],
      }));
    expect(
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mock.invocationCallOrder[1],
    ).toBeLessThan(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    );
  });

  it("stabilizes foreground imports before successful auto-reply delivery dispatch", async () => {
    const deliveryEffect = createDeliveryEffect();
    const prepareAutoReplyDelivery = vi.fn(async () => undefined);
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deliveryEffect.fingerprint,
        effectId: deliveryEffect.effectId,
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
      prepareAutoReplyDelivery,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      redactedStatus: expect.objectContaining({
        hostedOutboxDeliveryAttempted: 1,
        hostedOutboxDeliverySent: 1,
      }),
    }));
    expect(prepareAutoReplyDelivery).toHaveBeenCalledTimes(1);
    expect(
      prepareAutoReplyDelivery.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
    );
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).not.toHaveBeenCalled();
  });

  it("resets prepared delivery claims when the member-channel barrier blocks", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
      errorMessage: "Hosted member-channel update failed.",
      itemId: "system_mailbox_item_member_channels",
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      routeAction: "apply-member-channels-update",
      status: "retryable_failed",
      wakeKind: "member.channels.updated",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchBlocked: 1,
      }),
    }));
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("keeps the owner cleanup wake when a member-channel barrier blocks auto-reply delivery", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    // The cleanup owner state already carries a scheduled wake.
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      attemptCount: 2,
      errorCode: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
      errorMessage: "Hosted member-channel update failed.",
      itemId: "system_mailbox_item_member_channels",
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: "2026-04-27T00:30:00.000Z",
      routeAction: "apply-member-channels-update",
      status: "retryable_failed",
      wakeKind: "member.channels.updated",
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:09:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchBlocked: 1,
      }),
    }));
    expect(mocks.resolveHostedProviderCleanupScheduledWakeAt).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("drains due provider cleanup before returning a background member-channel barrier", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: null,
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint
      .mockResolvedValueOnce({
        item: createSystemMailboxItem(),
        itemId: "system_mailbox_item_notification",
        metrics: {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "assistant-notification",
          redactedLogEntries: [],
        },
        status: "processed",
      })
      .mockResolvedValueOnce({
        attemptCount: 2,
        errorCode: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
        errorMessage: "Hosted member-channel update failed.",
        itemId: "system_mailbox_item_member_channels",
        legacyUsageReferralAuthorityClassification: null,
        nextWakeAt: "2026-04-27T00:30:00.000Z",
        routeAction: "apply-member-channels-update",
        status: "retryable_failed",
        wakeKind: "member.channels.updated",
      });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({}));

    expect(result).toEqual(expect.objectContaining({
      afterCheckpoint: expect.any(Function),
      checkpointReason: "outbox_sending",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:30:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchBlocked: 1,
        hostedProviderCleanupAttemptedLinqItems: 1,
        hostedProviderCleanupDeletedLinqItems: 1,
        hostedProviderCleanupFailedLinqItems: 0,
      }),
    }));
    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: {
          nextWakeAt: null,
        },
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.resolveHostedProviderCleanupScheduledWakeAt).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("resets prepared delivery claims and returns a checkpointable barrier when the member-channel barrier throws", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    const barrierError = new Error("remote system mailbox catch-up failed");
    const prepareAutoReplyDelivery = vi.fn(async () => {
      throw barrierError;
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches,
    });
    mocks.readAssistantOutboxIntent.mockResolvedValueOnce({
      intentId: deliveryEffect.effectId,
      turnId: deliveryEffect.payload.turnId,
    });
    mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValueOnce(
      new Set([deliveryEffect.effectId]),
    );

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-04-27T00:00:00.000Z",
      prepareAutoReplyDelivery,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:00.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchBarrierFailed: 1,
      }),
    }));
    expect(prepareAutoReplyDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedPreparedAssistantDeliveries).not.toHaveBeenCalled();
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith({
      effects: [deliveryEffect],
      preparedDispatches,
      vaultRoot: "/tmp/murph-vault",
    });
  });

  it("preserves queued provider cleanup during later non-foreground assistant progress", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      "2026-04-27T00:14:00.000Z",
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: "2026-04-27T00:30:00.000Z",
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("preserves the post-scan cron wake through due provider cleanup", async () => {
    const now = "2026-04-27T00:10:00.000Z";
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: now,
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 3,
      enabledJobs: 7,
      nextRunAt: now,
      runningJobs: 0,
      totalJobs: 7,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => now,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: now,
      progressed: true,
    }));
    expect(
      withoutAssistantTurnTimingLogs(logRequests)
        .find((request) =>
          request.entries[0]?.eventCode === "assistant.pass_finished"
        )
        ?.entries[0]?.redactedJson,
    ).toEqual(expect.objectContaining({
      nextWakeAtPresent: true,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.drainHostedProviderCleanupAfterCommit).toHaveBeenCalledTimes(1);
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
      nextWakeAt: now,
      nextWakeReason: "assistant",
    }));
  });

  it("does not preserve a consumed provider cleanup wake after background delivery drains cleanup", async () => {
    const providerCleanupWakeAt = "2026-04-27T00:14:00.000Z";
    const deliveryEffect = createDeliveryEffect();
    const deferredDeliveryEffect = {
      ...deliveryEffect,
      payload: {
        ...deliveryEffect.payload,
        transportIdempotent: false,
      },
    };
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: providerCleanupWakeAt,
    });
    mocks.resolveHostedProviderCleanupScheduledWakeAt.mockResolvedValue(
      providerCleanupWakeAt,
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: null,
      parserProcessed: 0,
      postCheckpointRecord: null,
      progressed: true,
      redactedLogEntries: [],
    });
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([
      deferredDeliveryEffect,
    ]);
    mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValueOnce({
      preparedDispatches: createPreparedDispatchesForDeliveryEffect(deferredDeliveryEffect),
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([
      {
        cleanupMessages: [],
        cleanupTargetAliases: [],
        deliveryChannel: "telegram",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "sent",
        effectFingerprint: deferredDeliveryEffect.fingerprint,
        effectId: deferredDeliveryEffect.effectId,
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
    mocks.drainHostedProviderCleanupAfterCommit.mockResolvedValueOnce({
      attemptedLinqMessageCount: 1,
      deletedLinqMessageCount: 1,
      failedLinqMessageCount: 0,
      nextWakeAt: null,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_sending",
      nextWakeAt: providerCleanupWakeAt,
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    // Not-yet-due cleanup state must wait for its scheduled wake; the
    // background delivery pass records outbound ids instead of draining hot.
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultRoot: "/tmp/murph-vault",
      }),
    );
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: providerCleanupWakeAt,
    }));
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

  it("treats pending terminal Linq cleanup evidence as checkpoint progress", async () => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      assistantAutomationTerminalLinqCleanup: ["linq_msg_terminal_cleanup"],
      nextWakeAt: null,
      redactedLogEntries: [],
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
        nextWakeAt: expect.any(String),
      },
      linqMessageIds: ["linq_msg_terminal_cleanup"],
      vaultRoot: "/tmp/murph-vault",
    });

    const postCheckpoint = await result.afterCheckpoint?.();

    // Round-47 validation: current-pass terminal cleanup records durable
    // state and requests a checkpoint, but the same invocation never drains
    // provider-visible deletion; the scheduled wake after the durable
    // checkpoint does.
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "provider_cleanup",
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
          entryCount: 1,
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

async function runRealForegroundApprovalAdmissionScenario(input: {
  deliveryEffect: boolean;
  wake: "due-exact" | "due-unrelated" | "future-exact";
}) {
  const now = "2026-04-27T00:00:00.000Z";
  const parentRoot = await mkdtemp(path.join(tmpdir(), "hosted-approval-admission-"));
  const operatorHomeRoot = path.join(parentRoot, "home");
  const vaultRoot = path.join(parentRoot, "vault");
  const effectId = "vault-file-send:effect_real_pending_input";

  try {
    await initializeVault({
      createdAt: now,
      vaultRoot,
    });
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: now,
      }],
      updatedAt: now,
      version: 1,
    });
    const oldAssistantInput = await upsertAssistantInputEvent({
      event: {
        content: {
          text: "older unindexed pending input",
          transcriptText: "older unindexed pending input",
          userMessageContent: [{
            text: "older unindexed pending input",
            type: "text" as const,
          }],
        },
        conversation: {
          accountId: "acct_approval_admission",
          actorId: "actor_approval_admission",
          actorIsSelf: false,
          source: "linq",
          threadId: "thread_approval_admission",
          threadIsDirect: true,
        },
        occurredAt: "2026-04-26T23:59:00.000Z",
        receivedAt: "2026-04-26T23:59:00.000Z",
        replyTarget: {
          channel: "linq",
          messageId: "msg_old_approval_admission",
          threadId: "thread_approval_admission",
        },
        sourceRef: {
          dedupeKey: "dedupe_old_approval_admission",
          eventId: "evt_old_approval_admission",
          itemId: "mailbox_item_old_approval_admission_conversation",
          kind: "hosted-mailbox" as const,
          lane: "conversation" as const,
          laneSeq: "0",
          payloadSchema: "murph.hosted-mailbox-payload.v1",
          payloadSource: "inline" as const,
          source: "hosted-mailbox" as const,
          wakeSchema: "murph.hosted-execution-wake.v1",
        },
      },
      vault: vaultRoot,
    });
    const assistantInput = await upsertAssistantInputEvent({
      event: {
        content: {
          text: "I approved the secure request.",
          transcriptText: "I approved the secure request.",
          userMessageContent: [{
            text: "I approved the secure request.",
            type: "text" as const,
          }],
        },
        conversation: {
          accountId: "acct_approval_admission",
          actorId: "actor_approval_admission",
          actorIsSelf: false,
          source: "linq",
          threadId: "thread_approval_admission",
          threadIsDirect: true,
        },
        occurredAt: now,
        receivedAt: now,
        replyTarget: {
          channel: "linq",
          messageId: "msg_approval_admission",
          threadId: "thread_approval_admission",
        },
        sourceRef: {
          dedupeKey: "dedupe_approval_admission",
          eventId: "evt_approval_admission",
          itemId: "mailbox_item_approval_admission_conversation",
          kind: "hosted-mailbox" as const,
          lane: "conversation" as const,
          laneSeq: "1",
          payloadSchema: "murph.hosted-mailbox-payload.v1",
          payloadSource: "inline" as const,
          source: "hosted-mailbox" as const,
          wakeSchema: "murph.hosted-execution-wake.v1",
        },
      },
      vault: vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: assistantInput.inputId,
      vaultRoot,
    });
    const assistantAutomation = await vi.importActual<
      typeof import("@murphai/assistant-engine/assistant-automation")
    >("@murphai/assistant-engine/assistant-automation");
    mocks.readAssistantInputEvent.mockImplementation(
      assistantAutomation.readAssistantInputEvent,
    );

    const systemMailbox = await loadHostedSystemMailboxRealImplementation();
    const occurredAt = input.wake === "future-exact"
      ? "2026-04-27T00:01:00.000Z"
      : now;
    const wake = input.wake === "due-unrelated"
      ? buildHostedExecutionRuntimeControlWake({
          eventId: "evt_runtime_manual_approval_admission",
          kind: "runtime.manual-requested",
          occurredAt,
          userId: "member_synthetic_phase",
        })
      : buildHostedExecutionPendingEffectsReconcileRequestedWake({
          effectId,
          eventId: "evt_runtime_pending_effects_approval_admission",
          occurredAt,
          userId: "member_synthetic_phase",
        });
    const enqueueOutcome = await systemMailbox.enqueueHostedSystemMailboxItem({
      item: createResolvedForegroundAdmissionMailboxItem({
        kind: wake.kind,
        occurredAt,
      }),
      vaultRoot,
      wake,
    });
    if (enqueueOutcome.status !== "imported") {
      throw new Error(`Expected the system wake fixture to import, got ${enqueueOutcome.status}.`);
    }
    if (input.wake === "future-exact") {
      const claimed = await systemMailbox.claimHostedSystemMailboxItem({
        allowedRouteActions: ["apply-runtime-control-request"],
        now: () => now,
        vaultRoot,
      });
      if (!claimed) {
        throw new Error("Expected the future exact wake fixture to be claimable.");
      }
      await systemMailbox.requeueClaimedHostedSystemMailboxItem({
        item: claimed,
        nextAttemptAt: occurredAt,
        vaultRoot,
      });
    }

    const pendingWakeReads: Array<string | null> = [];
    mocks.resolveHostedPendingAssistantInputWakeAt.mockImplementation(async (request) => {
      const wakeAt = await resolveHostedPendingAssistantInputWakeAtWithRealImplementation(
        request,
      );
      pendingWakeReads.push(wakeAt);
      return wakeAt;
    });
    const systemMailboxPreparationStatuses: Array<string | null> = [];
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(
      async (request) => {
        const preparation = await systemMailbox.prepareHostedSystemMailboxItemForCheckpoint(
          request,
        );
        systemMailboxPreparationStatuses.push(preparation?.status ?? null);
        return preparation;
      },
    );
    mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(
      systemMailbox.resolveHostedSystemMailboxNextWakeCandidate,
    );
    if (input.deliveryEffect) {
      mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValue([{
        ...createDeliveryEffect(),
        effectId,
      }]);
    }
    const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
      vaultRoot,
    });
    const pendingInputStatePath = resolveHostedPendingAssistantInputStatePath(vaultRoot);
    const pendingIndexStateBeforeRun = await readFile(pendingInputStatePath, "utf8");

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      assistantInputIds: [assistantInput.inputId],
      foregroundCausalOnly: input.wake === "due-exact",
      conversationImportedCount: 1,
      importedCount: 1,
      now: () => now,
      operatorHomeRoot,
      shouldYieldBackgroundMaintenance: () => true,
      vaultRoot,
    }));

    return {
      cleanup: async () => rm(parentRoot, { force: true, recursive: true }),
      effectId,
      inputId: assistantInput.inputId,
      oldInputId: oldAssistantInput.inputId,
      pendingInputIds,
      pendingInputIdsAfterRun: await readExistingHostedPendingAssistantInputIds({
        vaultRoot,
      }),
      pendingIndexStateAfterRun: await readFile(pendingInputStatePath, "utf8"),
      pendingIndexStateBeforeRun,
      pendingIndexInspectionAfterRun:
        await inspectHostedPendingAssistantInputWakeCandidate({ vaultRoot }),
      pendingWakeReads,
      result,
      systemMailboxPreparationStatuses,
      systemMailboxState: await readHostedSystemMailboxState(vaultRoot),
      vaultRoot,
    };
  } catch (error) {
    await rm(parentRoot, { force: true, recursive: true });
    throw error;
  }
}

function createResolvedForegroundAdmissionMailboxItem(input: {
  kind: HostedMailboxItem["kind"];
  occurredAt: string;
}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: input.occurredAt,
    dedupeKey: `runtime-control:${input.kind}:approval-admission`,
    expiresAt: null,
    id: `mailbox_item_${input.kind.replaceAll(".", "_")}_approval_admission`,
    kind: input.kind,
    lane: "system",
    laneSeq: "1",
    occurredAt: input.occurredAt,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: input.occurredAt,
    userId: "member_synthetic_phase",
  };

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "apply-runtime-control-request",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}

function createResolvedMemberActivationMailboxItem(input: {
  occurredAt: string;
}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: input.occurredAt,
    dedupeKey: "member.activated:synthetic:first-conversation",
    expiresAt: null,
    id: "mailbox_item_member_activated_first_conversation",
    kind: "member.activated",
    lane: "system",
    laneSeq: "1",
    occurredAt: input.occurredAt,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: input.occurredAt,
    userId: "member_synthetic_phase",
  };

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "apply-member-activation",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}

function createPhaseWorkspace(input: {
  redactedStatus: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["workspace"]
  >["redactedStatus"];
}): NonNullable<HostedWorkspaceRuntimeAssistantPhaseInput["workspace"]> {
  return {
    checkpointedAt: "2026-04-27T00:00:00.000Z",
    createdAt: "2026-04-27T00:00:00.000Z",
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: input.redactedStatus,
    snapshotRef: null,
    updatedAt: "2026-04-27T00:00:00.000Z",
    userId: "member_synthetic_phase",
    version: "8",
  };
}

function createPhaseInput(input: {
  acceptedAssistantInputCausalSeq?: string;
  assistantAutomationScheduleChanged?: HostedWorkspaceRuntimeAssistantPhaseInput["assistantAutomationScheduleChanged"];
  backgroundMaintenanceSignal?: HostedWorkspaceRuntimeAssistantPhaseInput["backgroundMaintenanceSignal"];
  foregroundCausalOnly?: boolean;
  clearAssistantAutomationScheduleChanged?: HostedWorkspaceRuntimeAssistantPhaseInput["clearAssistantAutomationScheduleChanged"];
  assistantInputIds?: string[];
  assistantInputRecords?: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["initialMailboxImport"]["importResult"]["assistantInputRecords"]
  >;
  conversationImportedCount?: number;
  currentAssistantInputId?:
    HostedWorkspaceRuntimeAssistantPhaseInput["currentAssistantInputId"];
  deviceSyncMessagingReturnTarget?:
    HostedWorkspaceRuntimeAssistantPhaseInput["deviceSyncMessagingReturnTarget"];
  deviceSyncWorkspaceWakeHandled?: HostedWorkspaceRuntimeAssistantPhaseInput["deviceSyncWorkspaceWakeHandled"];
  importedCount?: number;
  initialAssistantInputBatch?: HostedWorkspaceRuntimeAssistantPhaseInput["initialAssistantInputBatch"];
  latestAssistantInputBatch?: HostedWorkspaceRuntimeAssistantPhaseInput["latestAssistantInputBatch"];
  linqDeliveryContext?: {
    directRecipientPhoneNumber: string | null;
    fromPhoneNumber: string | null;
    replyToMessageId: string | null;
    routeAuthority: null;
    service: string | null;
    target: string | null;
    threadIsDirect: boolean | null;
  };
  logRequests?: HostedRuntimeLogRequest[];
  now?: () => string;
  prepareAutoReplyDelivery?: HostedWorkspaceRuntimeAssistantPhaseInput["prepareAutoReplyDelivery"];
  recordDeferredUsage?: HostedWorkspaceRuntimeAssistantPhaseInput["recordDeferredUsage"];
  resolvedDeviceSync?: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["resolvedConfig"]["deviceSync"];
  runtimeClinicalRecordsPort?: RuntimeClinicalRecordsPort;
  runtimeConnectedApps?: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["connectedApps"]
  >;
  runtimeDeviceSyncPort?: RuntimeDeviceSyncPort;
  runtimeGroupToolPort?: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["groupToolPort"]
  >;
  runtimeForwardedEnv?: Record<string, string>;
  runtimeLatencyTraceRequests?: HostedRuntimeLatencyTraceRequest[];
  runtimePhoneCalls?: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["phoneCalls"]
  >;
  runtimeProductFeedbackPort?: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["productFeedbackPort"]
  >;
  runtimeEnv?: Record<string, string>;
  operatorHomeRoot?: string;
  shouldYieldBackgroundMaintenance?: HostedWorkspaceRuntimeAssistantPhaseInput["shouldYieldBackgroundMaintenance"];
  signal?: HostedWorkspaceRuntimeAssistantPhaseInput["signal"];
  runtimeActionApprovalPort?: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["actionApprovalPort"]
  >;
  runtimeAssistantPersonalizationToolPort?: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["assistantPersonalizationToolPort"]
  >;
  runtimeAssistantConfigurationToolPort?: RuntimeAssistantConfigurationToolPort;
  runtimeLabsToolPort?: RuntimeLabsToolPort;
  runtimeSubscriptionToolPort?: RuntimeSubscriptionToolPort;
  runtimeUsageRecordPort?: RuntimeUsageRecordPort;
  runtimeUserEnv?: Record<string, string>;
  vaultRoot?: string;
  workspace?: HostedWorkspaceRuntimeAssistantPhaseInput["workspace"];
}): HostedWorkspaceRuntimeAssistantPhaseInput {
  const assistantInputIds = input.assistantInputIds
    ?? (input.importedCount ? ["ain_00000000000000000000000000000001"] : []);
  return {
    ...(
      input.acceptedAssistantInputCausalSeq
        ? { acceptedAssistantInputCausalSeq: input.acceptedAssistantInputCausalSeq }
        : {}
    ),
    assistantAutomationScheduleChanged: input.assistantAutomationScheduleChanged,
    backgroundMaintenanceSignal: input.backgroundMaintenanceSignal,
    foregroundCausalOnly: input.foregroundCausalOnly,
    clearAssistantAutomationScheduleChanged:
      input.clearAssistantAutomationScheduleChanged,
    currentAssistantInputId: input.currentAssistantInputId,
    deviceSyncMessagingReturnTarget: input.deviceSyncMessagingReturnTarget,
    deviceSyncWorkspaceWakeHandled: input.deviceSyncWorkspaceWakeHandled,
    initialAssistantInputBatch: input.initialAssistantInputBatch,
    latestAssistantInputBatch: input.latestAssistantInputBatch,
    initialMailboxImport: {
      afterCheckpointEffects: [],
      checkpoint: null,
      checkpointDeferred: false,
      importResult: {
        assistantInputIds,
        ...(input.assistantInputRecords
          ? { assistantInputRecords: input.assistantInputRecords }
          : {}),
        blocked: [],
        conversationImportedCount: input.conversationImportedCount
          ?? (assistantInputIds.length > 0 ? input.importedCount ?? 0 : 0),
        consumedSeqByLane: {
          conversation: null,
          system: null,
        },
        fetchedCount: input.importedCount ?? 0,
        importedCount: input.importedCount ?? 0,
        ...(input.linqDeliveryContext ? { latestLinqDeliveryContext: input.linqDeliveryContext } : {}),
        ...(input.linqDeliveryContext ? { linqDeliveryContexts: [input.linqDeliveryContext] } : {}),
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
    prepareAutoReplyDelivery: input.prepareAutoReplyDelivery,
    recordDeferredUsage: input.recordDeferredUsage,
    platform: {
      artifactStore: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
      },
      effectsPort: {
        readRawEmailMessage: vi.fn(async () => null),
        recordOutboundMessageVolumeReceipt: vi.fn(async () => ({
          recordedAt: "2026-04-27T00:00:00.000Z",
        })),
        sendEmail: vi.fn(async () => undefined),
      },
      ...(input.runtimeGroupToolPort ? { groupToolPort: input.runtimeGroupToolPort } : {}),
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
      userId: "member_synthetic_phase",
      workspaceVersion: "8",
    },
    restored: {
      assistantStateRoot: "/tmp/murph-assistant-state",
      operatorHomeRoot: input.operatorHomeRoot ?? "/tmp/murph-operator-home",
      vaultRoot: input.vaultRoot ?? "/tmp/murph-vault",
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
          recordOutboundMessageVolumeReceipt: vi.fn(async () => ({
            recordedAt: "2026-04-27T00:00:00.000Z",
          })),
          sendEmail: vi.fn(async () => undefined),
        },
        ...(input.runtimeGroupToolPort ? { groupToolPort: input.runtimeGroupToolPort } : {}),
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
        ...(input.runtimeDeviceSyncPort ? { deviceSyncPort: input.runtimeDeviceSyncPort } : {}),
        ...(input.runtimeClinicalRecordsPort
          ? { clinicalRecordsPort: input.runtimeClinicalRecordsPort }
          : {}),
        ...(input.runtimeConnectedApps
          ? { connectedApps: input.runtimeConnectedApps }
          : {}),
        ...(input.runtimeActionApprovalPort
          ? { actionApprovalPort: input.runtimeActionApprovalPort }
          : {}),
        ...(input.runtimeAssistantPersonalizationToolPort
          ? {
              assistantPersonalizationToolPort:
                input.runtimeAssistantPersonalizationToolPort,
            }
          : {}),
        ...(input.runtimeAssistantConfigurationToolPort
          ? {
              assistantConfigurationToolPort:
                input.runtimeAssistantConfigurationToolPort,
            }
          : {}),
        ...(input.runtimeLabsToolPort
          ? { labsToolPort: input.runtimeLabsToolPort }
          : {}),
        ...(input.runtimePhoneCalls ? { phoneCalls: input.runtimePhoneCalls } : {}),
        ...(input.runtimeProductFeedbackPort
          ? { productFeedbackPort: input.runtimeProductFeedbackPort }
          : {}),
        ...(input.runtimeSubscriptionToolPort
          ? { subscriptionToolPort: input.runtimeSubscriptionToolPort }
          : {}),
        ...(input.runtimeUsageRecordPort ? { usageRecordPort: input.runtimeUsageRecordPort } : {}),
        ...(input.runtimeLatencyTraceRequests
          ? {
              latencyTracePort: {
                async record(request: HostedRuntimeLatencyTraceRequest) {
                  input.runtimeLatencyTraceRequests?.push(request);
                  return {
                    matchedCount: 1,
                    recorded: true,
                    unmatchedCount: 0,
                  };
                },
              },
            }
          : {}),
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
    runtimeEnv: input.runtimeEnv ?? {},
    shouldYieldBackgroundMaintenance: input.shouldYieldBackgroundMaintenance,
    signal: input.signal,
    workspace: input.workspace ?? null,
  };
}

function createDueAssistantWorkspace(
  overrides: Partial<NonNullable<HostedWorkspaceRuntimeAssistantPhaseInput["workspace"]>> = {},
): NonNullable<HostedWorkspaceRuntimeAssistantPhaseInput["workspace"]> {
  return {
    checkpointedAt: "2026-04-27T00:00:00.000Z",
    createdAt: "2026-04-27T00:00:00.000Z",
    nextWakeAt: "2026-04-26T23:59:59.000Z",
    nextWakeReason: "assistant",
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: "2026-04-27T00:00:00.000Z",
    userId: "member_synthetic_phase",
    version: "8",
    ...overrides,
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
    requestedModel: "gpt-5.6-terra",
    routeId: "primary",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: "gpt-5.6-terra",
    sessionId: "asst_direct_usage",
    stripeMeterSource: "murph",
    surface: null,
    tokenPricingBasis: "standard",
    totalTokens: 15,
    triggerKind: null,
    turnId: "turn_direct_usage",
    turnProfileJson: null,
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
      answeredMailboxItemIds: [],
      bindingDeliveryKind: null,
      bindingDeliveryTarget: null,
      channel: "linq",
      deliverySourceKey: null,
      explicitTarget: null,
      identityId: null,
      idempotencyKey: "assistant-outbox:intent_synthetic",
      media: [],
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

async function seedDirectLinqAssistantInputRoute(input: {
  actorId?: string;
  deliveryTarget?: string;
  enabledAt: string;
  identityId?: string;
  sessionId?: string;
  threadId?: string;
  vaultRoot: string;
}): Promise<void> {
  const sessionId = input.sessionId ?? "asst_linq_direct";
  const actorId = input.actorId ?? "actor_linq_direct";
  const deliveryTarget = input.deliveryTarget ?? "linq_chat_direct";
  const identityId = input.identityId ?? "identity_linq_direct";
  const threadId = input.threadId ?? "thread_linq_direct";
  await saveAssistantSession(input.vaultRoot, parseAssistantSessionRecord({
    alias: null,
    binding: {
      actorId,
      channel: "linq",
      conversationKey: null,
      delivery: {
        kind: "thread",
        target: deliveryTarget,
      },
      identityId,
      threadId,
      threadIsDirect: true,
    },
    createdAt: input.enabledAt,
    lastTurnAt: null,
    resumeState: null,
    schema: "murph.assistant-session.v1",
    sessionId,
    target: {
      adapter: "codex-cli",
      approvalPolicy: "never",
      codexCommand: null,
      codexHome: null,
      model: "gpt-5.6-terra",
      modelProvider: "vercel-ai-gateway",
      oss: false,
      profile: null,
      reasoningEffort: "medium",
      sandbox: "danger-full-access",
    },
    turnCount: 0,
    updatedAt: input.enabledAt,
  }));
  await saveAssistantAutomationState(input.vaultRoot, {
    autoReply: [{
      channel: "linq",
      eligibleAfter: null,
      enabledAt: input.enabledAt,
    }],
    updatedAt: input.enabledAt,
    version: 1,
  });
}

function createTerminalFailureOutboxIntent(input: {
  actorId?: string | null;
  answeredMailboxItemIds?: readonly string[];
  bindingDelivery?: { kind: "participant" | "thread"; target: string } | null;
  bindingDeliveryTarget?: string | null;
  channel?: string | null;
  createdAt: string;
  effectId: string;
  explicitTarget?: string | null;
  identityId?: string | null;
  replyToMessageId?: string | null;
  threadId?: string | null;
  threadIsDirect?: boolean | null;
  operation?: AssistantOutboxIntent["operation"];
}) {
  const bindingDeliveryTarget = "bindingDeliveryTarget" in input
    ? input.bindingDeliveryTarget
    : "linq_chat_direct";
  const bindingDelivery = "bindingDelivery" in input
    ? input.bindingDelivery ?? null
    : bindingDeliveryTarget
      ? { kind: "thread" as const, target: bindingDeliveryTarget }
      : null;
  const channel = "channel" in input ? input.channel : "linq";
  const actorId = "actorId" in input ? input.actorId : "actor_linq_direct";
  const identityId = "identityId" in input
    ? input.identityId
    : "identity_linq_direct";
  const replyToMessageId = "replyToMessageId" in input
    ? input.replyToMessageId
    : "linq_message_direct";
  const threadId = "threadId" in input ? input.threadId : "thread_linq_direct";
  const threadIsDirect = "threadIsDirect" in input
    ? input.threadIsDirect
    : true;
  return {
    actorId,
    answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
    bindingDelivery,
    channel,
    createdAt: input.createdAt,
    dedupeKey: `dedupe_${input.effectId}`,
    delivery: null,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: `assistant-outbox:${input.effectId}`,
    deliveryTransportIdempotent: true,
    explicitTarget: input.explicitTarget ?? null,
    identityId,
    intentId: input.effectId,
    lastAttemptAt: null,
    lastError: null,
    media: [],
    message: "Synthetic delivery",
    nextAttemptAt: null,
    operation: input.operation ?? null,
    replyToMessageId,
    sentAt: null,
    sessionId: "asst_linq_direct",
    status: "failed",
    subject: null,
    targetFingerprint: `target_${input.effectId}`,
    threadId,
    threadIsDirect,
    turnId: "turn_synthetic",
    updatedAt: input.createdAt,
  };
}

function createPreparedDispatchesForDeliveryEffect(
  effect: HostedAssistantDeliverySideEffect,
) {
  return [{
    intentId: effect.effectId,
    preparedDispatchToken: "prepared-dispatch-token-synthetic",
    previousDispatchState: {
      attemptCount: 0,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: effect.payload.idempotencyKey,
      deliveryTransportIdempotent: true,
      lastAttemptAt: null,
      lastError: null,
      nextAttemptAt: null,
      preparedDispatchToken: null,
      status: "pending" as const,
    },
  }];
}

function createFailedDeliveryOutcome(input: {
  deliveryChannel?: string | null;
  deliveryErrorCode: string | null;
  deliveryErrorDetails?: HostedAssistantDeliveryOutcome["deliveryErrorDetails"];
  deliveryErrorMessage?: string | null;
  effectId: string;
}): HostedAssistantDeliveryOutcome {
  return {
    cleanupMessages: [],
    cleanupTargetAliases: [],
    deliveryChannel: input.deliveryChannel ?? "linq",
    deliveryErrorCode: input.deliveryErrorCode,
    deliveryErrorDetails: input.deliveryErrorDetails ?? null,
    deliveryErrorMessage: input.deliveryErrorMessage ?? "redacted",
    deliveryStatus: "failed_ambiguous",
    effectFingerprint: `fingerprint_${input.effectId}`,
    effectId: input.effectId,
    journalMethod: "PUT",
    journalStatus: "500",
    providerMessageId: null,
    providerMessageIds: [],
    providerThreadId: null,
    retryable: true,
    target: null,
    targetKind: null,
  };
}

function createSentDeliveryOutcome(): HostedAssistantDeliveryOutcome {
  return {
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
  };
}

function createExternalCompletionSystemMailboxItem(input: {
  dedupeKey: string;
}) {
  const deliveryKey = input.dedupeKey.replace(
    "assistant.notification.requested:",
    "",
  );
  const itemId = input.dedupeKey.includes("phone-call-result")
    ? "system_mailbox_item_phone_call_completion"
    : "system_mailbox_item_usage_referral_completion";
  return {
    ...createSystemMailboxItem(),
    itemId,
    mailboxDedupeKey: input.dedupeKey,
    requestId: `request_${itemId}`,
    wake: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: input.dedupeKey,
      memberId: "member_synthetic_phase",
      notification: {
        deliveryDedupeToken: deliveryKey,
        deliveryIdempotencyKey: deliveryKey,
        instructions: "Celebrate the completed external task.",
        responsePolicy: {
          kind: "allow_send_or_skip",
        },
        route: {
          actorId: null,
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_source_thread",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_source_thread",
          threadIsDirect: false,
        },
      },
      occurredAt: "2026-04-27T00:02:00.000Z",
    }),
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
    mailboxLaneSeq: null,
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

function createMemberPreferencesSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_member_preferences",
    mailboxDedupeKey: "dedupe_system_mailbox_item_member_preferences",
    routeAction: "apply-member-preferences" as const,
    wake: {
      eventId: "member.preferences.updated:member_synthetic_phase:update_synthetic",
      kind: "member.preferences.updated" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      preferences: {
        tone: "formal" as const,
      },
      userId: "member_synthetic_phase",
    },
  };
}

function createMemberActionSystemMailboxItem() {
  const outcome = {
    actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243",
    completedAt: "2026-04-27T00:00:01.000Z",
    reason: null,
    schemaVersion: 1 as const,
    status: "applied" as const,
  };
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_member_action",
    mailboxDedupeKey:
      "member.action.requested:2f1c1fdc-c7b0-4d90-b902-8e6295959243",
    postCheckpointRecord: {
      kind: "member-action.outcome-recorded" as const,
      outcome,
    },
    requestId: "request_system_mailbox_item_member_action",
    routeAction: "apply-member-action" as const,
    wake: {
      eventId: "member.action.requested:2f1c1fdc-c7b0-4d90-b902-8e6295959243",
      kind: "member.action.requested" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      request: {
        action: {
          expectedWorkout: {
            actionBinding: "a".repeat(64),
            exercises: [{ name: "Leg press", sets: [{ logged: false }] }],
          },
          kind: "workout.live.apply" as const,
          mutations: [{
            exerciseName: "Leg press",
            exercisePosition: 1,
            expectedResult: null,
            kind: "set.put" as const,
            result: { kind: "reps" as const, reps: 8 },
            setPosition: 1,
          }],
          version: 1 as const,
        },
        actionId: outcome.actionId,
        requestedAt: "2026-04-27T00:00:00.000Z",
        schemaVersion: 1 as const,
      },
      userId: "member_synthetic_phase",
    },
  };
}

function createGroupRoomModelInitializationSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_group_room_model",
    mailboxDedupeKey: "member.activated:prepared-group-room-model",
    routeAction: "initialize-group-room-model" as const,
    wake: {
      eventId: "member.activated:prepared-group-room-model",
      initialGroupRoomModelMarkdown:
        "## Explicit setup\n\nKeep this room low-key.",
      kind: "member.activated" as const,
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      occurredAt: "2026-07-29T18:01:00.000Z",
      signupWelcome: null,
      userId: "member_synthetic_phase",
    },
  };
}

function createMemberActivationSignupWelcomeSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_member_activation",
    mailboxDedupeKey: "dedupe_system_mailbox_item_member_activation",
    routeAction: "apply-member-activation" as const,
    wake: {
      eventId: "member.activated:local:member_synthetic_phase:evt_signup_welcome",
      kind: "member.activated" as const,
      memberChannels: {
        email: false,
        linq: false,
        telegram: true,
      },
      occurredAt: "2026-04-27T00:00:00.000Z",
      signupWelcome: {
        route: {
          actorId: null,
          channel: "telegram" as const,
          delivery: {
            kind: "chat" as const,
            target: "12345",
          },
          identityId: "hbidx:telegram:v1:test",
          threadId: null,
          threadIsDirect: true,
        },
        text: "Welcome to Murph.",
      },
      userId: "member_synthetic_phase",
    },
  };
}

function createBrowserVaultRefreshSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_browser_vault_refresh",
    mailboxDedupeKey: "dedupe_system_mailbox_item_browser_vault_refresh",
    routeAction: "apply-runtime-control-request" as const,
    wake: {
      eventId: "evt_runtime_browser_vault_refresh_control",
      kind: "runtime.browser-vault-refresh-requested" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      userId: "member_synthetic_phase",
    },
  };
}

function createMaintenanceSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_runtime_maintenance",
    mailboxDedupeKey: "dedupe_system_mailbox_item_runtime_maintenance",
    routeAction: "apply-runtime-control-request" as const,
    wake: {
      eventId: "evt_runtime_maintenance_control",
      kind: "runtime.maintenance-requested" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      userId: "member_synthetic_phase",
    },
  };
}

function createPendingEffectsReconcileSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_pending_effects_reconcile",
    mailboxDedupeKey: "dedupe_system_mailbox_item_pending_effects_reconcile",
    routeAction: "apply-runtime-control-request" as const,
    wake: {
      effectId: "vault-file-send:effect_pending",
      eventId: "evt_runtime_pending_effects_reconcile",
      kind: "runtime.pending-effects-reconcile-requested" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      userId: "member_synthetic_phase",
    },
  };
}

function createAssistantAskCompletionSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    attemptCount: 1,
    itemId: "system_mailbox_item_assistant_ask_completion",
    lastAttemptAt: "2026-04-27T00:03:00.000Z",
    mailboxDedupeKey: "dedupe_system_mailbox_item_assistant_ask_completion",
    occurredAt: "2026-04-27T00:02:00.000Z",
    routeAction: "continue-assistant-ask" as const,
    wake: {
      ask: {
        expiresAt: "2026-04-27T00:10:00.000Z",
        originAssistantInputId: "ain_ask_origin_synthetic",
        originSessionId: "asst_ask_origin_synthetic",
        question: "What is today's synthetic group plan?",
        requestId: "aask_req_synthetic",
        result: {
          answer: "The synthetic plan is ready.",
          outcome: "answered" as const,
        },
        targetLabel: "Synthetic group",
      },
      eventId: "aask_done_synthetic",
      kind: "assistant.ask.completed" as const,
      occurredAt: "2026-04-27T00:02:00.000Z",
      userId: "member_synthetic_phase",
    },
  };
}

function createCodexAuthSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_codex_auth",
    mailboxDedupeKey: "dedupe_system_mailbox_item_codex_auth",
    postCheckpointRecord: {
      attemptId: "hca_abcdefghijklmnop",
      kind: "codex-auth.updated" as const,
      phase: "connected" as const,
    },
    routeAction: "apply-runtime-control-request" as const,
    wake: {
      action: "connect" as const,
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      kind: "runtime.codex-auth-requested" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      userId: "member_synthetic_phase",
    },
  };
}

function createVaultShareProjectionSystemMailboxItem() {
  return {
    ...createSystemMailboxItem(),
    itemId: "system_mailbox_item_vault_share_projection",
    mailboxDedupeKey: "runtime-control:group-share-projection:synthetic",
    postCheckpointRecord: {
      kind: "vault-share.projection" as const,
    },
    routeAction: "apply-runtime-control-request" as const,
    wake: {
      eventId: "runtime-control:group-share-projection:synthetic",
      kind: "runtime.maintenance-requested" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      userId: "member_synthetic_phase",
    },
  };
}
