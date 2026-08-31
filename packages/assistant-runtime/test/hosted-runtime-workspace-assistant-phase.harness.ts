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
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node";

type HostedAssistantPhaseMockName =
  | "applyMurphManagedAutomations"
  | "assertHostedAssistantLinqTurnCommitAuthority"
  | "buildHostedLinqChannelEnv"
  | "collectHostedAssistantDeliverySideEffects"
  | "collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes"
  | "createHostedAssistantChannelTypingDependencies"
  | "createHostedAssistantProgressDeliveryDependencies"
  | "drainHostedPreparedAssistantDeliveries"
  | "drainHostedProviderCleanupAfterCommit"
  | "findAssistantAutoReplyDeliveryIntentIds"
  | "getAssistantCronAutomationOccurrenceReceipt"
  | "getAssistantCronStatus"
  | "hasCompleteAssistantAutoReplyTerminalEvidence"
  | "hydrateHostedExecutionDefaultTarget"
  | "listPendingAssistantAutoReplyLinqCleanupEvidence"
  | "maintainAssistantAutoReplyRouteState"
  | "markAssistantAutoReplyLinqCleanupQueued"
  | "prepareHostedAssistantAutomationForWake"
  | "prepareHostedAssistantDeliveryEffectsForDispatch"
  | "prepareHostedProviderCleanupPlan"
  | "prepareHostedSystemMailboxItemForCheckpoint"
  | "queueHostedAssistantPendingMessageVolumeReceiptsForVault"
  | "readAssistantAutomationState"
  | "readAssistantInputEvent"
  | "readAssistantOutboxIntent"
  | "readHostedProviderCleanupCheckpoint"
  | "recordHostedDeviceSyncDirtyPostCheckpointRecord"
  | "recordHostedProviderCleanupAfterDelivery"
  | "recordHostedProviderCleanupBeforeCommit"
  | "recordHostedSystemMailboxItemAfterCheckpoint"
  | "refreshReminderAvailability"
  | "resetHostedPreparedAssistantDeliveryEffects"
  | "resolveAssistantCronDefaultTimeZoneProjection"
  | "resolveHostedAssistantOutboxNextWakeAt"
  | "resolveHostedDeviceSyncNextWakeAt"
  | "resolveHostedOldestAssistantInputOccurredAt"
  | "resolveHostedOldestPendingAssistantInputAt"
  | "resolveHostedPendingAssistantInputWakeAt"
  | "resolveHostedProviderCleanupCheckpointWakeAt"
  | "resolveHostedProviderCleanupFirstDeferredWakeAt"
  | "resolveHostedProviderCleanupScheduledWakeAt"
  | "resolveHostedSystemMailboxNextWakeAt"
  | "resolveHostedSystemMailboxNextWakeCandidate"
  | "runHostedAssistantAutomationLane"
  | "runHostedDeviceSyncWakeLane"
  | "scheduleDeviceActivityTriggeredAutomations";

const mocks: Record<HostedAssistantPhaseMockName, Mock> = vi.hoisted(() => ({
  applyMurphManagedAutomations: vi.fn(),
  assertHostedAssistantLinqTurnCommitAuthority: vi.fn(),
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
  getAssistantCronAutomationOccurrenceReceipt: vi.fn(),
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
    getAssistantCronAutomationOccurrenceReceipt:
      mocks.getAssistantCronAutomationOccurrenceReceipt,
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
  assertHostedAssistantLinqTurnCommitAuthority:
    mocks.assertHostedAssistantLinqTurnCommitAuthority,
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
  setAssistantCronJobEnabled,
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

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function setPendingAutomationDeliveryIntentForTest(input: {
  automationId: string;
  intentId: string;
  vaultRoot: string;
}): Promise<void> {
  const runtimeStatePath = resolveAssistantStatePaths(
    input.vaultRoot,
  ).cronAutomationStatePath;
  const runtimeStore: unknown = JSON.parse(
    await readFile(runtimeStatePath, "utf8"),
  );
  if (!isUnknownRecord(runtimeStore) || !Array.isArray(runtimeStore.jobs)) {
    throw new Error("Expected canonical cron runtime store.");
  }
  const runtimeRecord = runtimeStore.jobs.find(
    (candidate) =>
      isUnknownRecord(candidate) && candidate.jobId === input.automationId,
  );
  if (!isUnknownRecord(runtimeRecord) || !isUnknownRecord(runtimeRecord.state)) {
    throw new Error("Expected canonical cron runtime record.");
  }
  runtimeRecord.state.pendingDeliveryIntentId = input.intentId;
  await writeFile(runtimeStatePath, `${JSON.stringify(runtimeStore, null, 2)}\n`);
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
  mocks.getAssistantCronAutomationOccurrenceReceipt.mockResolvedValue({
    history: "not_observed",
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
  idSuffix?: string;
  kind: HostedMailboxItem["kind"];
  laneSeq?: string;
  occurredAt: string;
  routeAction?:
    | "apply-runtime-control-request"
    | "continue-assistant-ask"
    | "run-device-sync-wake";
}): HostedMailboxResolvedImportItem {
  const idSuffix = input.idSuffix ? `_${input.idSuffix}` : "";
  const item: HostedMailboxItem = {
    createdAt: input.occurredAt,
    dedupeKey: `runtime-control:${input.kind}:approval-admission${idSuffix}`,
    expiresAt: null,
    id: `mailbox_item_${input.kind.replaceAll(".", "_")}_approval_admission${idSuffix}`,
    kind: input.kind,
    lane: "system",
    laneSeq: input.laneSeq ?? "1",
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
      action: input.routeAction ?? "apply-runtime-control-request",
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
  runtimeIssueProvenance?: HostedWorkspaceRuntimeAssistantPhaseInput["runtimeIssueProvenance"];
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
  requestAttemptId?: string;
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
      attemptId: input.requestAttemptId ?? "attempt_synthetic_phase",
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
    runtimeIssueProvenance: input.runtimeIssueProvenance,
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
      onboardingFollowupEnrollment: false,
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

export {
  PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE,
  createAssistantAskCompletionSystemMailboxItem,
  createAssistantUsageRecord,
  createBrowserVaultRefreshSystemMailboxItem,
  createCodexAuthSystemMailboxItem,
  createDeliveryEffect,
  createDueAssistantWorkspace,
  createExternalCompletionSystemMailboxItem,
  createFailedDeliveryOutcome,
  createGroupRoomModelInitializationSystemMailboxItem,
  createMaintenanceSystemMailboxItem,
  createMemberActionSystemMailboxItem,
  createMemberActivationSignupWelcomeSystemMailboxItem,
  createMemberPreferencesSystemMailboxItem,
  createNoDirtyRuntimeDeviceSyncPortMethods,
  createPendingEffectsReconcileSystemMailboxItem,
  createPhaseInput,
  createPhaseWorkspace,
  createPreparedDispatchesForDeliveryEffect,
  createResolvedForegroundAdmissionMailboxItem,
  createResolvedMemberActivationMailboxItem,
  createSentDeliveryOutcome,
  createSystemMailboxItem,
  createTerminalFailureOutboxIntent,
  createVaultShareProjectionSystemMailboxItem,
  expectAssistantLaneCallWithoutDeviceSyncOptions,
  extractTopLevelFunctionBody,
  isUnknownRecord,
  loadHostedSystemMailboxRealImplementation,
  mocks,
  resolveHostedPendingAssistantInputWakeAtWithRealImplementation,
  runHostedWorkspaceDurableCheckpointEffects,
  runRealForegroundApprovalAdmissionScenario,
  seedDirectLinqAssistantInputRoute,
  setPendingAutomationDeliveryIntentForTest,
  withoutAssistantTurnTimingLogs,
  writeHostedPhaseExperimentSource,
};

export type {
  HostedPendingAssistantInputModule,
  HostedSystemMailboxModule,
  RuntimeAssistantConfigurationToolPort,
  RuntimeClinicalRecordsPort,
  RuntimeDeviceSyncConnectLinkRequest,
  RuntimeDeviceSyncPort,
  RuntimeLabsToolPort,
  RuntimeSubscriptionToolPort,
  RuntimeUsageRecordPort,
};
