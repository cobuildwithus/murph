import type {
  HostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  HostedRuntimeLatencyTraceRequest,
  HostedRuntimeLogRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  ASSISTANT_USAGE_SCHEMA,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyMurphManagedAutomations: vi.fn(),
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
  hydrateHostedExecutionDefaultTarget: vi.fn(),
  listPendingAssistantAutoReplyLinqCleanupEvidence: vi.fn(),
  markAssistantAutoReplyLinqCleanupQueued: vi.fn(),
  prepareHostedAssistantAutomationForWake: vi.fn(),
  prepareHostedAssistantDeliveryEffectsForDispatch: vi.fn(),
  prepareHostedSystemMailboxItemForCheckpoint: vi.fn(),
  readAssistantAutomationState: vi.fn(),
  readAssistantInputEvent: vi.fn(),
  readAssistantOutboxIntent: vi.fn(),
  recordHostedDeviceSyncDirtyPostCheckpointRecord: vi.fn(),
  recordHostedProviderCleanupBeforeCommit: vi.fn(),
  recordHostedSystemMailboxItemAfterCheckpoint: vi.fn(),
  readHostedProviderCleanupCheckpoint: vi.fn(),
  resolveHostedProviderCleanupDeferredWakeAt: vi.fn(),
  resolveHostedPendingAssistantInputWakeAt: vi.fn(),
  resolveHostedAssistantOutboxNextWakeAt: vi.fn(),
  resolveHostedDeviceSyncNextWakeAt: vi.fn(),
  resolveHostedSystemMailboxNextWakeCandidate: vi.fn(),
  resolveHostedSystemMailboxNextWakeAt: vi.fn(),
  resetHostedPreparedAssistantDeliveryEffects: vi.fn(),
  runHostedAssistantAutomationLane: vi.fn(),
  runHostedDeviceSyncWakeLane: vi.fn(),
  scheduleDeviceActivityTriggeredAutomations: vi.fn(),
}));

vi.mock("@murphai/assistant-engine/assistant-automation", () => ({
  findAssistantAutoReplyDeliveryIntentIds:
    mocks.findAssistantAutoReplyDeliveryIntentIds,
  listPendingAssistantAutoReplyLinqCleanupEvidence:
    mocks.listPendingAssistantAutoReplyLinqCleanupEvidence,
  markAssistantAutoReplyLinqCleanupQueued: mocks.markAssistantAutoReplyLinqCleanupQueued,
}));

vi.mock("@murphai/assistant-engine/assistant-store", () => ({
  readAssistantAutomationState: mocks.readAssistantAutomationState,
}));

vi.mock("@murphai/assistant-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/assistant-engine")>();
  return {
    ...actual,
    applyMurphManagedAutomations: mocks.applyMurphManagedAutomations,
    getAssistantCronStatus: mocks.getAssistantCronStatus,
    readAssistantInputEvent: mocks.readAssistantInputEvent,
    readAssistantOutboxIntent: mocks.readAssistantOutboxIntent,
    scheduleDeviceActivityTriggeredAutomations:
      mocks.scheduleDeviceActivityTriggeredAutomations,
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
  resetHostedPreparedAssistantDeliveryEffects:
    mocks.resetHostedPreparedAssistantDeliveryEffects,
  resolveHostedAssistantOutboxNextWakeAt: mocks.resolveHostedAssistantOutboxNextWakeAt,
}));

vi.mock("../src/hosted-runtime/channel-activity.ts", () => ({
  buildHostedLinqChannelEnv: mocks.buildHostedLinqChannelEnv,
  createHostedAssistantChannelTypingDependencies:
    mocks.createHostedAssistantChannelTypingDependencies,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget: mocks.hydrateHostedExecutionDefaultTarget,
  prepareHostedAssistantAutomationForWake:
    mocks.prepareHostedAssistantAutomationForWake,
}));

vi.mock("../src/hosted-runtime/maintenance.ts", () => ({
  resolveHostedDeviceSyncNextWakeAt: mocks.resolveHostedDeviceSyncNextWakeAt,
  runHostedAssistantAutomationLane: mocks.runHostedAssistantAutomationLane,
  runHostedDeviceSyncWakeLane: mocks.runHostedDeviceSyncWakeLane,
}));

vi.mock("../src/hosted-runtime/pending-assistant-input.ts", () => ({
  resolveHostedPendingAssistantInputWakeAt:
    mocks.resolveHostedPendingAssistantInputWakeAt,
}));

vi.mock("../src/hosted-runtime/provider-cleanup.ts", () => ({
  collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes:
    mocks.collectHostedProviderCleanupMessageIdsFromDeliveryOutcomes,
  drainHostedProviderCleanupAfterCommit: mocks.drainHostedProviderCleanupAfterCommit,
  recordHostedProviderCleanupBeforeCommit: mocks.recordHostedProviderCleanupBeforeCommit,
  readHostedProviderCleanupCheckpoint: mocks.readHostedProviderCleanupCheckpoint,
  resolveHostedProviderCleanupDeferredWakeAt:
    mocks.resolveHostedProviderCleanupDeferredWakeAt,
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
  upsertAutomation,
} from "@murphai/core";
import {
  markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotState,
} from "@murphai/assistant-engine";
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
import type {
  HostedWorkspaceDurableCheckpointEffects,
} from "../src/hosted-runtime/workspace-runner.ts";

type RuntimeDeviceSyncPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["deviceSyncPort"]
>;
type RuntimeUsageRecordPort = NonNullable<
  HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["usageRecordPort"]
>;
type RuntimeDeviceSyncConnectLinkRequest = Parameters<
  RuntimeDeviceSyncPort["createConnectLink"]
>[0];

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
  mocks.findAssistantAutoReplyDeliveryIntentIds.mockResolvedValue(new Set());
  mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValue(null);
  mocks.readAssistantOutboxIntent.mockResolvedValue(null);
  mocks.listPendingAssistantAutoReplyLinqCleanupEvidence.mockResolvedValue({
    captureIds: [],
    linqMessageIds: [],
  });
  mocks.markAssistantAutoReplyLinqCleanupQueued.mockResolvedValue(undefined);
  mocks.applyMurphManagedAutomations.mockResolvedValue({
    created: 0,
    skipped: 1,
    updated: 0,
  });
  mocks.prepareHostedAssistantAutomationForWake.mockResolvedValue(
    PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE,
  );
  mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue(undefined);
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
  mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValue(undefined);
  mocks.resolveHostedProviderCleanupDeferredWakeAt.mockImplementation((input = {}) => {
    const record = input as { nowMs?: number | null };
    const nowMs = Number.isFinite(record.nowMs)
      ? Number(record.nowMs)
      : Date.parse("2026-04-27T00:00:00.000Z");
    return new Date(nowMs + 5 * 60_000).toISOString();
  });
  mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockResolvedValue({
    failed: 0,
    nextWakeAt: null,
    recorded: 1,
  });
  mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue(null);
  mocks.resolveHostedAssistantOutboxNextWakeAt.mockResolvedValue(null);
  mocks.resolveHostedDeviceSyncNextWakeAt.mockReturnValue(null);
  mocks.resolveHostedSystemMailboxNextWakeAt.mockResolvedValue(null);
  mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(async () => {
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

  it("prepares hosted assistant automation state before running scheduled automation", async () => {
    const runtimeEnv = {};
    const runtimeForwardedEnv = {
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
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
    expect(deferredUsageRecords).toEqual([
      expect.objectContaining({
        usageId: "turn_direct_usage.attempt-1",
      }),
    ]);
    expect(events).toEqual(["assistant"]);

    events.push("checkpoint");
    await result.afterCheckpoint?.();

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
      "device-sync.job_failed",
    ]);
    const failureLog = logRequests
      .flatMap((request) => request.entries)
      .find((entry) => entry.eventCode === "device-sync.job_failed");
    expect(failureLog).toEqual(expect.objectContaining({
      component: "device-sync",
      errorCode: "runtime_error",
      eventCode: "device-sync.job_failed",
      level: "warn",
      phase: "idle",
      redactedJson: expect.objectContaining({
        errorCode: "runtime_error",
        errorMessagePresent: true,
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
        vaultRoot,
      });
      await writeHostedPhaseExperimentSource(vaultRoot);
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
        nextWakeReason: "assistant",
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
        nextWakeReason: "assistant",
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
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 1,
      skipped: 0,
      updated: 0,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      logRequests,
      now: () => "2026-04-27T00:00:00.000Z",
      operatorHomeRoot: "/tmp/murph-hosted-operator-home",
      vaultRoot: "/tmp/murph-hosted-vault",
    }));

    expect(mocks.applyMurphManagedAutomations).toHaveBeenCalledWith({
      now: new Date("2026-04-27T00:00:00.000Z"),
      operatorHomeRoot: "/tmp/murph-hosted-operator-home",
      routeValidationProfile: "hosted",
      runtimeEnv: {},
      vaultRoot: "/tmp/murph-hosted-vault",
    });
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(1);
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

  it("keeps a retry wake when hosted managed automation work partially succeeds", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    const stableKeyFailure = new Error("metadata unavailable");
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
        eventCode: "assistant.pass_finished",
        level: "info",
        redactedJson: expect.objectContaining({
          murphManagedAutomationCreated: 1,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSkipped: 1,
          murphManagedAutomationUpdated: 0,
        }),
      }),
    );
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

  it("logs stable-key metadata failures even when background setup stays idle", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.applyMurphManagedAutomations.mockResolvedValueOnce({
      created: 0,
      skipped: 1,
      stableKeyFailure: new Error("metadata unavailable"),
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

  it("logs hosted managed automation setup failures without forcing a background retry", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
    mocks.applyMurphManagedAutomations.mockRejectedValueOnce(
      new Error("metadata unavailable"),
    );

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
          murphManagedAutomationFailed: true,
        }),
      }),
    );
  });

  it("skips hosted managed automation work when background maintenance yields", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expectAssistantLaneCallWithoutDeviceSyncOptions();
  });

  it("uses the fresh hosted conversation route for managed automation seeding", async () => {
    const seededNextWakeAt = "2026-04-30T17:00:00.000Z";
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
      operatorHomeRoot: "/tmp/murph-operator-home",
      routeValidationProfile: "hosted",
      runtimeEnv: {},
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

  it("keeps a managed automation retry wake after a fresh-input checkpoint failure", async () => {
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
      created: 0,
      skipped: 1,
      stableKeyFailure: new Error("metadata unavailable"),
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

    expect(result.afterCheckpoint).toEqual(expect.any(Function));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:30.000Z",
      redactedStatus: expect.objectContaining({
        murphManagedAutomationFailed: true,
      }),
    }));
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

  it("skips system mailbox maintenance after foreground input arrives during the run", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);

    await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      shouldYieldBackgroundMaintenance,
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expectAssistantLaneCallWithoutDeviceSyncOptions();
  });

  it("continues the assistant lane when foreground input arrives during system mailbox preparation", async () => {
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
    expectAssistantLaneCallWithoutDeviceSyncOptions();
    expect(
      mocks.runHostedAssistantAutomationLane.mock.calls.at(-1)?.[0]
        .executionContext.hosted?.dynamicContextPrompts,
    ).toBeUndefined();

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
    expect(result.progressed).toBe(true);
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
      nextWakeReason: "assistant",
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
    await Promise.resolve();
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

  it("injects reconnect-required hosted device sync status as dynamic context for due cron lanes", async () => {
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
        if (request?.sourceProviderSlug !== "whoop_v2") {
          return {
            connections: [],
            generatedAt: "2026-04-29T00:00:00.000Z",
            userId: "member_synthetic_phase",
          };
        }

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
                  resourceCount: 0,
                  sourceProviderSlug: "whoop_v2",
                  status: "error",
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
    expect(fetchSnapshotRequests).toEqual([]);
    const dynamicContextPrompt =
      await assistantLaneCall?.buildBackgroundDynamicContextPrompt?.({});
    expect(fetchSnapshotRequests.map((request) => request?.sourceProviderSlug)).toEqual([
      "fitbit",
      "garmin",
      "oura",
      "withings",
      "whoop_v2",
    ]);
    expect(fetchSnapshotRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          includeCredentialMaterial: false,
          limit: 4,
          signal: expect.any(AbortSignal),
          sourceProviderSlug: "whoop_v2",
        }),
      ]),
    );
    expect(assistantLaneCall?.signal).toBeUndefined();
    expect(assistantLaneCall).not.toHaveProperty("suppressActiveTurnInputRefresh");
    expect(assistantLaneCall?.executionContext.hosted?.dynamicContextPrompts)
      .toBeUndefined();
    expect(dynamicContextPrompt).toContain("WHOOP currently needs reconnect");
    expect(dynamicContextPrompt).toContain("source `whoop_v2`");
    expect(dynamicContextPrompt).toContain("`TOKEN_REFRESH_FAILED`");
    expect(dynamicContextPrompt).toContain(
      "vault-cli device connect whoop --format json",
    );
    expect(dynamicContextPrompt).not.toContain("synthetic-external-account");
    expect(dynamicContextPrompt).not.toContain("refresh failed");
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
      async fetchSnapshot(request) {
        if (request?.sourceProviderSlug !== "oura") {
          return {
            connections: [],
            generatedAt: "2026-04-29T00:00:00.000Z",
            userId: "member_synthetic_phase",
          };
        }

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
                  resourceCount: 0,
                  sourceProviderSlug: "oura",
                  status: "error",
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
  });

  it("leaves pending-input device context suppression to the automation lane", async () => {
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
    expect(assistantLaneCall).toHaveProperty("buildBackgroundDynamicContextPrompt");
    expect(assistantLaneCall?.executionContext.hosted?.dynamicContextPrompts).toBeUndefined();
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
        level: "info",
        message: "Hosted assistant turn timing milestone captured.",
        phase: "wake.running",
        redacted: {
          schema: "murph.assistant-turn-timing.v1",
          type: "assistant.turn.timing",
          turnTimingElapsedMs: 41,
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
      eventCode: "assistant.automation_detail",
      redactedJson: expect.objectContaining({
        detailComponent: "runtime.provider",
        schema: "murph.assistant-turn-timing.v1",
        turnTimingElapsedMs: 41,
        turnTimingStage: "reply-dispatched",
      }),
    }));
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

  it("writes foreground delivery finished timing after deferred delivery drains", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];
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
      importedCount: 1,
      logRequests,
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
  });

  it("passes the runtime action-approval port into hosted delivery drain", async () => {
    const actionApprovalPort = {
      consume: vi.fn(),
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

  it("preserves a post-delivery outbox wake matching a consumed assistant wake", async () => {
    let now = "2026-05-08T16:00:00.000Z";
    const consumedWakeAt = "2026-05-08T16:00:05.000Z";
    mocks.resolveHostedAssistantOutboxNextWakeAt
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
      nextWakeAt: null,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: null,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: null,
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
  });

  it("uses the post-delivery assistant cron wake after clean fast dispatch", async () => {
    const postDeliveryAssistantWakeAt = "2026-05-08T16:02:00.000Z";
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
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 0,
      enabledJobs: 1,
      nextRunAt: postDeliveryAssistantWakeAt,
      runningJobs: 0,
      totalJobs: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => "2026-05-08T16:00:00.000Z",
    }));

    expect(result.checkpointReason).toBe("outbox_receipt");
    expect(result.nextWakeAt).toBe(postDeliveryAssistantWakeAt);
    expect(result.redactedStatus).toEqual(expect.objectContaining({
      hostedAssistantNextWakeAt: postDeliveryAssistantWakeAt,
      hostedOutboxDeliverySent: 1,
      nextWakeAt: postDeliveryAssistantWakeAt,
    }));
  });

  it("preserves a due assistant cron wake found after clean fast dispatch", async () => {
    const dueAt = "2026-05-08T16:00:00.000Z";
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
    mocks.getAssistantCronStatus.mockResolvedValueOnce({
      dueJobs: 1,
      enabledJobs: 1,
      nextRunAt: dueAt,
      runningJobs: 0,
      totalJobs: 1,
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      now: () => dueAt,
    }));

    expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "outbox_receipt",
      nextWakeAt: dueAt,
      progressed: true,
      redactedStatus: expect.objectContaining({
        hostedAssistantNextWakeAt: dueAt,
        hostedOutboxDeliverySent: 1,
        nextWakeAt: dueAt,
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

  it("keeps a retry wake when post-delivery assistant cron status cannot be read", async () => {
    vi.useFakeTimers();
    try {
      const consumedWakeAt = "2026-05-08T16:00:00.000Z";
      const retryWakeAt = "2026-05-08T16:00:31.000Z";
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
        })
        .mockRejectedValueOnce(new Error("cron status unavailable"));

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
        nextWakeAt: retryWakeAt,
        redactedStatus: expect.objectContaining({
          hostedOutboxDeliveryAttempted: 1,
          hostedOutboxDeliverySent: 1,
          hostedOutboxPendingDeliveryEffects: 0,
          nextWakeAt: retryWakeAt,
        }),
      }));
      expect(mocks.getAssistantCronStatus).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
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
              "Telegram HTTP 400 authorization=Bearer [redacted] for <REDACTED_PATH> note to [redacted-email] [redacted-phone]",
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
      nextWakeReason: "assistant",
    }));
  });

  it("preserves future provider cleanup wakes while recording unrelated system mailbox work", async () => {
    const providerCleanupWakeAt = "2026-04-27T00:05:00.000Z";
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: providerCleanupWakeAt,
    });
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

  it("preserves system mailbox retry wake without running idle device sync", async () => {
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockResolvedValueOnce({
      errorCode: "system_mailbox.retryable",
      errorMessage: "redacted",
      itemId: "system_mailbox_item_retryable",
      nextWakeAt: "2026-04-27T00:10:00.000Z",
      status: "retryable_failed",
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

    expect(result.nextWakeAt).toBe("2026-04-27T00:10:00.000Z");
    expect(postCheckpoint).toBeUndefined();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.recordHostedDeviceSyncDirtyPostCheckpointRecord).not.toHaveBeenCalled();
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
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      preferredIntentIds: [],
      vaultRoot: "/tmp/murph-vault",
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expect(
      mocks.collectHostedAssistantDeliverySideEffects.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.readHostedProviderCleanupCheckpoint.mock.invocationCallOrder[0] ??
        Number.MAX_SAFE_INTEGER,
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

  it("passes foreground Linq egress latency trace into hosted delivery dependencies", async () => {
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];
    const effect = createDeliveryEffect();
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce([effect]);
    mocks.drainHostedPreparedAssistantDeliveries.mockResolvedValueOnce([]);

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 1,
      runtimeLatencyTraceRequests: latencyTraceRequests,
    }));
    await result.afterCheckpoint?.();

    const expectedTrace = expect.objectContaining({
      assistantInputIds: ["ain_00000000000000000000000000000001"],
      latencyTracePort: expect.objectContaining({
        record: expect.any(Function),
      }),
      runtimeAttemptId: "attempt_synthetic_phase",
    });
    expect(mocks.createHostedAssistantProgressDeliveryDependencies).toHaveBeenCalledWith(
      expect.objectContaining({
        linqEgressLatencyTrace: expectedTrace,
      }),
    );
    expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantDeliveryEffects: [effect],
        linqEgressLatencyTrace: expectedTrace,
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
    expect(result.nextWakeAt).toBe("2026-04-27T00:14:00.000Z");
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
    expect(result.nextWakeAt).toBe("2026-04-27T00:14:00.000Z");
    expect(result.progressed).toBe(false);
    expect(result.checkpointReason).toBeUndefined();
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
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:12:00.000Z",
      progressed: true,
    }));
  });

  it("recovers hidden provider cleanup after a stale foreground mailbox wake is consumed", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
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
        nextWakeReason: "mailbox",
      }),
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("recovers hidden provider cleanup after a stale active-turn device-sync wake is consumed", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValue({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
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
      workspace: createDueAssistantWorkspace({
        nextWakeAt: "2026-04-27T00:08:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      }),
    }));

    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalledTimes(2);
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
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

  it("reads hidden provider cleanup only after foreground delivery drains", async () => {
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
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
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(
      mocks.drainHostedPreparedAssistantDeliveries.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.readHostedProviderCleanupCheckpoint.mock.invocationCallOrder[0] ??
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
    }));

    expect(mocks.collectHostedAssistantDeliverySideEffects).toHaveBeenCalledWith({
      actionApprovalPort: null,
      includeBackgroundDueIntents: false,
      preferredIntentIds: [],
      vaultRoot: expect.any(String),
    });
    expect(mocks.collectHostedAssistantDeliverySideEffects).not.toHaveBeenCalledWith(
      expect.objectContaining({
        includeBackgroundDueIntents: true,
      }),
    );
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalledTimes(2);
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(mocks.markAssistantAutoReplyLinqCleanupQueued).not.toHaveBeenCalled();
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

  it("schedules an immediate assistant wake when the pending input index has work after system mailbox work", async () => {
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
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("2026-04-27T00:10:00.000Z");

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));
    const postCheckpoint = await result.afterCheckpoint?.();

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
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

  it("runs pending assistant input before due system mailbox work", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      progressed: true,
    }));
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalledWith({
      now: expect.any(Function),
      vaultRoot: "/tmp/murph-vault",
    });
    expect(
      mocks.resolveHostedPendingAssistantInputWakeAt.mock.calls[0]?.[0].now(),
    ).toBe("2026-04-27T00:10:00.000Z");
  });

  it("preserves queued provider cleanup when pending assistant input runs first", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.readHostedProviderCleanupCheckpoint.mockResolvedValueOnce({
      nextWakeAt: "2026-04-27T00:14:00.000Z",
    });
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.readHostedProviderCleanupCheckpoint).toHaveBeenCalledWith("/tmp/murph-vault");
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "canonical_runtime_commit",
      nextWakeAt: "2026-04-27T00:14:00.000Z",
      progressed: true,
    }));
  });

  it("runs pending assistant input before due device-sync work", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: true,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
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

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(mocks.resolveHostedPendingAssistantInputWakeAt).toHaveBeenCalled();
    expect(mocks.runHostedDeviceSyncWakeLane).not.toHaveBeenCalled();
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      nextWakeReason: "device-sync.reconcile",
      progressed: true,
    }));
  });

  it("runs due system mailbox work after pending assistant input defers to retry", async () => {
    const callOrder: string[] = [];
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: "2026-04-27T00:10:30.000Z",
        redactedLogEntries: [],
      };
    });
    mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementationOnce(async () => {
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(callOrder).toEqual(["assistant", "system-mailbox"]);
    expect(mocks.applyMurphManagedAutomations).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
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
      nextWakeAt: "2026-04-27T00:10:30.000Z",
    }));
  });

  it("runs due device-sync work after pending assistant input defers to retry", async () => {
    const callOrder: string[] = [];
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
      callOrder.push("assistant");
      return {
        assistantAutomationCurrentTurnDeliveryIntentIds: [],
        assistantAutomationProgressed: true,
        nextWakeAt: "2026-04-27T00:10:30.000Z",
        redactedLogEntries: [],
      };
    });
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
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));
  });

  it("backs off pending assistant input when the attempted pass returns no retry", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      nextWakeAt: null,
      redactedLogEntries: [],
    });
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

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: true,
    }));

    const postCheckpoint = await result.afterCheckpoint?.();

    expect(postCheckpoint).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
    }));
  });

  it("backs off pending assistant input when deferred maintenance has no work", async () => {
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [],
      assistantAutomationProgressed: false,
      nextWakeAt: null,
      redactedLogEntries: [],
    });

    const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
      importedCount: 0,
      now: () => "2026-04-27T00:10:00.000Z",
    }));

    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      nextWakeAt: "2026-04-27T00:10:30.000Z",
      progressed: false,
    }));
  });

  it("runs a second assistant pass after deferred manual runtime-control work", async () => {
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
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
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

    expect(callOrder).toEqual(["assistant-1", "system-mailbox", "assistant-2"]);
    expect(mocks.runHostedAssistantAutomationLane).toHaveBeenCalledTimes(2);
    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson)
        .filter((redactedJson) =>
          redactedJson?.detailComponent === "runtime.provider" &&
          redactedJson?.type === "assistant.turn.timing"
        )
        .map((redactedJson) => redactedJson?.turnTimingStage),
    ).toEqual(["provider-result-returned", "usage-recorded"]);
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

  it("flushes buffered first-pass detail logs when a deferred assistant rerun fails", async () => {
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
    const failure = new Error("second assistant pass failed");
    Object.defineProperty(failure, "hostedAssistantAutomationRedactedLogEntries", {
      configurable: true,
      value: [{
        component: "runtime.provider",
        level: "info",
        message: "Second assistant pass timing.",
        phase: "wake.running",
        redacted: {
          schema: "murph.assistant-turn-timing.v1",
          type: "assistant.turn.timing",
          turnTimingElapsedMs: 29,
          turnTimingStage: "reply-dispatched",
        },
      }],
    });
    mocks.resolveHostedPendingAssistantInputWakeAt.mockResolvedValueOnce(
      "2026-04-27T00:10:00.000Z",
    );
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
        throw failure;
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

    await expect(
      runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0,
        logRequests,
        now: () => "2026-04-27T00:10:00.000Z",
      })),
    ).rejects.toThrow("second assistant pass failed");

    expect(callOrder).toEqual(["assistant-1", "system-mailbox", "assistant-2"]);
    expect(
      logRequests
        .map((request) => request.entries[0]?.redactedJson)
        .filter((redactedJson) =>
          redactedJson?.detailComponent === "runtime.provider" &&
          redactedJson?.type === "assistant.turn.timing"
        )
        .map((redactedJson) => redactedJson?.turnTimingStage),
    ).toEqual(["provider-result-returned", "reply-dispatched"]);
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

  it("runs remote system catch-up before successful auto-reply delivery dispatch", async () => {
    const deliveryEffect = createDeliveryEffect();
    const prepareAutoReplyDelivery = vi.fn(async () => null);
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
      errorCode: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
      errorMessage: "Hosted member-channel update failed.",
      itemId: "system_mailbox_item_member_channels",
      nextWakeAt: "2026-04-27T00:01:00.000Z",
      status: "retryable_failed",
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

  it("resets prepared delivery claims when remote system catch-up returns a barrier", async () => {
    const deliveryEffect = createDeliveryEffect();
    const preparedDispatches = createPreparedDispatchesForDeliveryEffect(deliveryEffect);
    const prepareAutoReplyDelivery = vi.fn(async () => ({
      nextWakeAt: "2026-04-27T00:00:15.000Z",
      nextWakeReason: "mailbox",
      redactedStatus: {
        hostedMemberChannelPreDispatchImportBlocked: 1,
      },
    }));
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
      prepareAutoReplyDelivery,
    }));

    expect(result).toEqual(expect.objectContaining({
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: "2026-04-27T00:00:15.000Z",
      redactedStatus: expect.objectContaining({
        hostedMemberChannelPreDispatchImportBlocked: 1,
      }),
    }));
    expect(prepareAutoReplyDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.prepareHostedSystemMailboxItemForCheckpoint).not.toHaveBeenCalled();
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
  deviceSyncWorkspaceWakeHandled?: HostedWorkspaceRuntimeAssistantPhaseInput["deviceSyncWorkspaceWakeHandled"];
  importedCount?: number;
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
  runtimeDeviceSyncPort?: RuntimeDeviceSyncPort;
  runtimeForwardedEnv?: Record<string, string>;
  runtimeLatencyTraceRequests?: HostedRuntimeLatencyTraceRequest[];
  runtimeEnv?: Record<string, string>;
  operatorHomeRoot?: string;
  shouldYieldBackgroundMaintenance?: HostedWorkspaceRuntimeAssistantPhaseInput["shouldYieldBackgroundMaintenance"];
  runtimeActionApprovalPort?: NonNullable<
    HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["actionApprovalPort"]
  >;
  runtimeUsageRecordPort?: RuntimeUsageRecordPort;
  runtimeUserEnv?: Record<string, string>;
  vaultRoot?: string;
  workspace?: HostedWorkspaceRuntimeAssistantPhaseInput["workspace"];
}): HostedWorkspaceRuntimeAssistantPhaseInput {
  const assistantInputIds = input.assistantInputIds
    ?? (input.importedCount ? ["ain_00000000000000000000000000000001"] : []);
  return {
    deviceSyncWorkspaceWakeHandled: input.deviceSyncWorkspaceWakeHandled,
    initialMailboxImport: {
      afterCheckpointEffects: [],
      checkpoint: null,
      checkpointDeferred: false,
      importResult: {
        assistantInputIds,
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
        ...(input.runtimeDeviceSyncPort ? { deviceSyncPort: input.runtimeDeviceSyncPort } : {}),
        ...(input.runtimeActionApprovalPort
          ? { actionApprovalPort: input.runtimeActionApprovalPort }
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
          whatsappCloudApiConfigured: false,
        },
        deviceSync: input.resolvedDeviceSync ?? null,
      },
      userEnv: input.runtimeUserEnv ?? {},
    },
    runtimeEnv: input.runtimeEnv ?? {},
    shouldYieldBackgroundMaintenance: input.shouldYieldBackgroundMaintenance,
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
    requestedModel: "gpt-5.5",
    routeId: "primary",
    schema: ASSISTANT_USAGE_SCHEMA,
    servedModel: "gpt-5.5",
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
      bindingDeliveryKind: null,
      bindingDeliveryTarget: null,
      channel: "telegram",
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
