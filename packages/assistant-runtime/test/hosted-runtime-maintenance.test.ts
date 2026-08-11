import assert from "node:assert/strict";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";
import { SqliteDeviceSyncStore } from "@murphai/device-syncd/service";
import {
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import { DEVICE_SYNC_DB_RELATIVE_PATH } from "@murphai/runtime-state/node/runtime-paths";

const mocks = vi.hoisted(() => ({
  closeHostedRuntimeDeviceSyncService: vi.fn(),
  createConfiguredDeviceSyncProvidersFromConfigs: vi.fn(),
  createDeviceSyncRegistry: vi.fn(),
  createHostedAssistantInputSource: vi.fn(),
  createHostedRuntimeDeviceSyncService: vi.fn(),
  createIntegratedInboxServices: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  detectWearableStorageMigrationCandidates: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  initInboxRuntime: vi.fn(),
  readConfiguredJunctionDeviceSyncProviderConfig: vi.fn(),
  readHostedAssistantRuntimeState: vi.fn(),
  reconcileHostedDeviceSyncControlPlaneState: vi.fn(),
  runAssistantAutomationPass: vi.fn(),
  selectHostedAssistantInputIds: vi.fn(),
  pruneWearableDenseRawTimeseries: vi.fn(),
  promoteHostedCompletedDirtyPayloadAcks: vi.fn(),
  syncHostedDeviceSyncControlPlaneState: vi.fn(),
}));

vi.mock("@murphai/device-syncd/config", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@murphai/device-syncd/config")
  >();
  return {
    ...actual,
    createConfiguredDeviceSyncProvidersFromConfigs:
      mocks.createConfiguredDeviceSyncProvidersFromConfigs,
    readConfiguredJunctionDeviceSyncProviderConfig:
      mocks.readConfiguredJunctionDeviceSyncProviderConfig,
  };
});

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
  HOSTED_ASSISTANT_TURN_TIMING_SCHEMA: "murph.assistant-turn-timing.v1",
  HOSTED_ASSISTANT_TURN_TIMING_TYPE: "assistant.turn.timing",
  runAssistantAutomationPass: mocks.runAssistantAutomationPass,
  stampAssistantProviderStartCriticalPath: (
    context: Record<string, number> | null | undefined,
    boundary: string,
  ) => context ? { ...context, [boundary]: 0 } : null,
}));

vi.mock("@murphai/inbox-services", () => ({
  createIntegratedInboxServices: mocks.createIntegratedInboxServices,
}));

vi.mock("@murphai/vault-usecases/vault-services", () => ({
  createIntegratedVaultServices: mocks.createIntegratedVaultServices,
}));

vi.mock("@murphai/core", () => ({
  detectWearableStorageMigrationCandidates:
    mocks.detectWearableStorageMigrationCandidates,
  pruneWearableDenseRawTimeseries: mocks.pruneWearableDenseRawTimeseries,
}));

vi.mock("../src/hosted-device-sync-runtime.ts", () => ({
  promoteHostedCompletedDirtyPayloadAcks:
    mocks.promoteHostedCompletedDirtyPayloadAcks,
  reconcileHostedDeviceSyncControlPlaneState:
    mocks.reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState: mocks.syncHostedDeviceSyncControlPlaneState,
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  readHostedAssistantRuntimeState: mocks.readHostedAssistantRuntimeState,
}));

vi.mock("../src/hosted-runtime/turn-input.ts", () => ({
  createHostedAssistantInputSource: mocks.createHostedAssistantInputSource,
  selectHostedAssistantInputIds: mocks.selectHostedAssistantInputIds,
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
  runHostedAssistantAutomationLane,
  runHostedNoopSystemWakeLane,
} from "../src/hosted-runtime/maintenance.ts";
import {
  resolveHostedDeviceSyncNextWakeAt,
  runHostedDeviceSyncPass,
  runHostedDeviceSyncWakeLane,
} from "../src/hosted-runtime/device-sync-maintenance.ts";
import {
  readHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";

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
type AssistantAutomationOperationScope =
  import("@murphai/assistant-engine").AssistantAutomationOperationScope;
type HostedTimerRuntime = Parameters<typeof runHostedAssistantAutomationLane>[0]["runtime"];

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
const FIXED_MAINTENANCE_VAULT_ROOT = "/tmp/vault-root";
const DENSE_RAW_RETENTION_MAILBOX_DEDUPE_KEY = "device-sync.wake:dense-raw-retention";

async function readDenseRawRetentionMailboxItem(vaultRoot = FIXED_MAINTENANCE_VAULT_ROOT) {
  const state = await readHostedSystemMailboxState(vaultRoot);
  return state.pending.find((item) =>
    item.mailboxDedupeKey === DENSE_RAW_RETENTION_MAILBOX_DEDUPE_KEY
    && item.status === "pending"
  ) ?? null;
}

async function expectDenseRawRetentionMailboxWakeAt(
  nextWakeAt: string | null,
  vaultRoot = FIXED_MAINTENANCE_VAULT_ROOT,
): Promise<void> {
  const item = await readDenseRawRetentionMailboxItem(vaultRoot);
  if (!nextWakeAt) {
    assert.equal(item, null);
    return;
  }

  assert.ok(item);
  assert.equal(item.nextAttemptAt, nextWakeAt);
  assert.equal(item.routeAction, "run-device-sync-wake");
  if (item.wake.kind !== "device-sync.wake") {
    assert.fail(`expected device-sync.wake, got ${item.wake.kind}`);
  }
  assert.equal(item.wake.reason, "reconcile_due");
}

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
      },
      deviceSync: input.deviceSync ?? null,
    },
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  await rm(FIXED_MAINTENANCE_VAULT_ROOT, {
    force: true,
    recursive: true,
  });
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
  mocks.createHostedAssistantInputSource.mockImplementation((input) => ({
    listInputCandidates: vi.fn(async (query) => ({
      inputs: [],
      nextCursor: query.afterCursor ?? null,
    })),
    listNewConversationInputs: vi.fn(async (query) => ({
      inputs: [],
      nextCursor: query.afterCursor ?? null,
    })),
    readObservedInputIds: vi.fn(() => [
      ...new Set([
        ...(input.initialPendingInputIds ?? []),
        ...(input.selectedInputIds ?? []),
      ]),
    ]),
    readSelectedInputIds: vi.fn(() => [...(input.selectedInputIds ?? [])]),
    refresh: vi.fn(async () => ({
      progressed: false,
      reason: "no_new_input",
    })),
  }));
  mocks.selectHostedAssistantInputIds.mockImplementation(async (input) => {
    if (input.mode === "foreground") {
      const freshInputIds = [...new Set(input.freshAssistantInputIds ?? [])];
      return {
        freshInputIds,
        inputIds: freshInputIds,
        mode: "foreground",
        pendingInputIds: [],
      };
    }
    return {
      inputIds: [],
      mode: "background",
      pendingInputIds: [],
    };
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
  mocks.runAssistantAutomationPass.mockResolvedValue({
    nextWakeAt: "2026-04-08T01:00:00.000Z",
    progressed: false,
  });
  mocks.detectWearableStorageMigrationCandidates.mockResolvedValue({
    denseProviderRawTimeseriesCount: 0,
    denseProviderSampleShardCount: 0,
    hasWork: false,
    legacyCanonicalArtifactCount: 0,
    legacyReceiptPayloadCount: 0,
    retentionEligibleDenseProviderRawTimeseriesBytes: 0,
    retentionEligibleDenseProviderRawTimeseriesCount: 0,
    suspectedBytes: 0,
  });
  mocks.pruneWearableDenseRawTimeseries.mockResolvedValue({
    bytesAfter: 0,
    bytesBefore: 0,
    bytesFreed: 0,
    compactedReceiptCount: 0,
    denseRawBytesAfter: 0,
    denseRawBytesBefore: 0,
    denseRawBytesFreed: 0,
    hasMore: false,
    mutated: false,
    skippedCount: 0,
    tombstonedCanonicalArtifactCount: 0,
    tombstonedDenseRawArtifactCount: 0,
    touchedPaths: [],
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
    pendingDirtyPayloadJobs: [],
    snapshot: null,
  });
  mocks.reconcileHostedDeviceSyncControlPlaneState.mockResolvedValue(undefined);
});

describe("runHostedAssistantAutomation", () => {
  it("persists safe raw reply failure messages and structured failure context", async () => {
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onEvent?.({
        errorCode: "ASSISTANT_CODEX_FAILED",
        failureContext: {
          codexAbortRequested: false,
          codexDiagnosticsPresent: true,
          codexExitCode: 1,
          codexExitSignal: "SIGKILL",
          codexLifecycleStage: "turn_running",
          codexLiveTurnOpen: true,
          codexPendingRpcCount: 1,
          codexPendingRpcMethod: "turn/start",
          codexProcessGroupPresent: true,
          codexProcessLifetimeMs: 2041,
          codexProviderRequestStarted: true,
          codexShutdownRequested: false,
          codexTerminationSignalSent: null,
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
            failureCodexAbortRequested: false,
            failureCodexDiagnosticsPresent: true,
            failureCodexExitCode: 1,
            failureCodexExitSignal: "SIGKILL",
            failureCodexLifecycleStage: "turn_running",
            failureCodexLiveTurnOpen: true,
            failureCodexPendingRpcCount: 1,
            failureCodexPendingRpcMethod: "turn/start",
            failureCodexProcessGroupPresent: true,
            failureCodexProcessLifetimeMs: 2041,
            failureCodexProviderRequestStarted: true,
            failureCodexShutdownRequested: false,
            failureCodexTerminationSignalSent: null,
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

  it("persists reply failure events after the ordinary automation event cap", async () => {
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      for (let index = 0; index < 13; index += 1) {
        input.onEvent?.({
          safeDetails: "scan_started",
          type: "scan.started",
        });
      }
      input.onEvent?.({
        errorCode: "ASSISTANT_PROVIDER_EMPTY_RESPONSE",
        safeDetails:
          "assistant provider failed (ASSISTANT_PROVIDER_EMPTY_RESPONSE)",
        safeErrorMessage:
          "Assistant provider completed without a final response. Use finish_without_reply for an intentional no-reply turn.",
        type: "input.reply-failed",
      });
      return {
        nextWakeAt: null,
        progressed: true,
      };
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_failure_cap",
      {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_failure_cap",
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
            errorCode: "ASSISTANT_PROVIDER_EMPTY_RESPONSE",
            safeErrorMessage:
              "Assistant provider completed without a final response. Use finish_without_reply for an intentional no-reply turn.",
            type: "input.reply-failed",
          }),
        }),
      ]),
    );
  });

  it("retains the structured error code and safe summary on failed automation logs", async () => {
    const actualHostedExecution = await vi.importActual<
      typeof import("@murphai/hosted-execution")
    >("@murphai/hosted-execution");
    mocks.emitHostedExecutionStructuredLog.mockImplementation(
      actualHostedExecution.emitHostedExecutionStructuredLog,
    );
    const failure = Object.assign(
      new Error("Linq egress target does not match the runtime user's Linq route."),
      {
        code: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
        status: 403,
      },
    );
    mocks.runAssistantAutomationPass.mockRejectedValueOnce(failure);

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_route_authority_failure",
        {
          hosted: {
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        {
          eventId: "evt_route_authority_failure",
          kind: "runtime.timer",
          occurredAt: "2026-07-13T23:19:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
      ),
    ).rejects.toBe(failure);
    mocks.emitHostedExecutionStructuredLog.mockReset();

    const attachedLogEntries = (
      failure as Error & {
        hostedAssistantAutomationRedactedLogEntries?: unknown;
      }
    ).hostedAssistantAutomationRedactedLogEntries;
    expect(attachedLogEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "error",
        message: expect.stringContaining("Hosted assistant automation pass failed."),
        redacted: expect.objectContaining({
          errorCode: "authorization_error",
          errorCodeDetail: "HOSTED_LINQ_EGRESS_ROUTE_AUTHORITY_MISMATCH",
          safeErrorMessage: "Hosted execution authorization failed.",
        }),
      }),
    ]));
  });

  it("persists the typed cron failure code from cron.job.completed events", async () => {
    // June 2026 quota incident: provider quota failures on scheduled
    // reminders must land queryable in hosted_runtime_log.
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onEvent?.({
        failureContext: {
          errorCode: "ASSISTANT_CODEX_USAGE_LIMIT",
          errorPresent: true,
          routeConfigured: true,
          runStatus: "failed",
          scheduleKind: "at",
          sourceKind: "automation",
        },
        safeDetails: "cron_job_enqueue_failed",
        safeErrorMessage: "Codex app-server failed before producing a reply.",
        type: "cron.job.completed",
      });
      return {
        nextWakeAt: null,
        progressed: true,
      };
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_cron_error_code",
      {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_cron_error_code",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
    );

    expect(result.redactedLogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Hosted assistant automation event: cron.job.completed.",
          redacted: expect.objectContaining({
            failureErrorCode: "ASSISTANT_CODEX_USAGE_LIMIT",
            failureErrorPresent: true,
            failureRunStatus: "failed",
            failureScheduleKind: "at",
            safeDetails: "cron_job_enqueue_failed",
            safeErrorLength:
              "Codex app-server failed before producing a reply.".length,
            safeErrorMessage:
              "Codex app-server failed before producing a reply.",
            safeErrorPresent: true,
            type: "cron.job.completed",
          }),
        }),
      ]),
    );
  });

  it("persists metadata-only onboarding follow-up decisions", async () => {
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onEvent?.({
        failureContext: {
          activeUntil: "2026-04-11T15:00:00.000Z",
          authorityGate: "initial",
          notificationDecisionKind: "skip",
          notificationDeliveryOutcomeKind: null,
          onboardingStateCreatedAt: null,
          onboardingStateReadError: null,
          onboardingStateSource: "default_missing",
          onboardingStateStatus: "open",
          onboardingStateUpdatedAt: null,
          occurrenceAt: "2026-04-09T13:30:00.000Z",
          runOutcome: "skipped",
          runReason: "notification_skip",
          scheduleKind: "dailyLocal",
        },
        safeDetails: "onboarding_followup_completed",
        type: "onboarding.followup.completed",
      });
      return {
        nextWakeAt: "2026-04-10T13:30:00.000Z",
        progressed: true,
      };
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_onboarding_followup",
      {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_onboarding_followup",
        kind: "runtime.timer",
        occurredAt: "2026-04-09T13:30:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
    );

    expect(result.redactedLogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "Hosted assistant automation event: onboarding.followup.completed.",
          redacted: expect.objectContaining({
            failureActiveUntil: "2026-04-11T15:00:00.000Z",
            failureAuthorityGate: "initial",
            failureNotificationDecisionKind: "skip",
            failureNotificationDeliveryOutcomeKind: null,
            failureOnboardingStateSource: "default_missing",
            failureOnboardingStateStatus: "open",
            failureOccurrenceAt: "2026-04-09T13:30:00.000Z",
            failureRunOutcome: "skipped",
            failureRunReason: "notification_skip",
            failureScheduleKind: "dailyLocal",
            safeDetails: "onboarding_followup_completed",
            type: "onboarding.followup.completed",
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
    mocks.createHostedAssistantInputSource.mockReturnValueOnce({
      listInputCandidates: vi.fn(async (query) => ({
        inputs: [],
        nextCursor: query.afterCursor ?? null,
      })),
      listNewConversationInputs,
      readObservedInputIds: vi.fn(() => []),
      readSelectedInputIds: vi.fn(() => []),
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

  it("binds input acquired after background selection at the provider boundary", async () => {
    const callOrder: string[] = [];
    const beforeProviderAcceptedInputs = vi.fn(async ({ acceptedInputs }) => {
      expect(acceptedInputs.map((item: { id: string }) => item.id)).toEqual([
        "input_after_selection",
      ]);
      callOrder.push("provider-bound");
    });
    mocks.selectHostedAssistantInputIds.mockImplementationOnce(async () => {
      callOrder.push("selected-empty");
      return {
        inputIds: [],
        mode: "background",
        pendingInputIds: [],
      };
    });
    mocks.createHostedAssistantInputSource.mockReturnValueOnce({
      listInputCandidates: vi.fn(async (query) => ({
        inputs: [],
        nextCursor: query.afterCursor ?? null,
      })),
      listNewConversationInputs: vi.fn(async (query) => ({
        inputs: [],
        nextCursor: query.afterCursor ?? null,
      })),
      readObservedInputIds: vi.fn(() => ["input_after_selection"]),
      readSelectedInputIds: vi.fn(() => ["input_after_selection"]),
      refresh: vi.fn(async () => {
        callOrder.push("refreshed-input");
        return {
          progressed: true,
          reason: "ingested_input",
        };
      }),
    });
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      await input.inputSource?.refresh({});
      expect(beforeProviderAcceptedInputs).not.toHaveBeenCalled();
      await input.beforeProviderAcceptedInputs?.({
        acceptedInputs: [
          {
            id: "input_after_selection",
            source: "assistant-input",
          },
        ],
      });
      return {
        nextWakeAt: null,
        progressed: true,
      };
    });

    await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_provider_bound_input",
      {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_provider_bound_input",
        kind: "runtime.timer",
        occurredAt: "2026-04-23T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      undefined,
      undefined,
      undefined,
      { beforeProviderAcceptedInputs },
    );

    expect(callOrder).toEqual([
      "selected-empty",
      "refreshed-input",
      "provider-bound",
    ]);
    expect(mocks.createHostedAssistantInputSource).toHaveBeenCalledWith(
      expect.objectContaining({ pendingInputRefreshMode: "compact" }),
    );
  });

  it("passes a lazy background dynamic context builder for background-only passes", async () => {
    const buildBackgroundDynamicContextPrompt = vi.fn(async () =>
      "Background wearable reconnect context."
    );
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      expect(input.buildDynamicContextPrompt).toBe(buildBackgroundDynamicContextPrompt);
      expect(input).not.toHaveProperty("inputSourceAlreadyRefreshed");
      expect(input.executionContext?.hosted?.dynamicContextPrompts).toBeUndefined();
      return {
        currentTurnDeliveryIntentIds: [],
        nextWakeAt: "2026-04-23T00:00:30.000Z",
        progressed: true,
        replies: {
          considered: 1,
          failed: 0,
          replied: 0,
          skipped: 1,
        },
      };
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_background_dynamic_context",
      {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_dynamic_context_active_turn_input",
        kind: "runtime.timer",
        occurredAt: "2026-04-23T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      undefined,
      undefined,
      undefined,
      {
        buildBackgroundDynamicContextPrompt,
      },
    );

    expect(result.currentTurnDeliveryIntentIds).toEqual([]);
    expect(result.timings?.activeTurnInputIngested).toBe(false);
    expect(buildBackgroundDynamicContextPrompt).not.toHaveBeenCalled();
  });

  it("skips background dynamic context when background selection already owns pending input", async () => {
    const buildBackgroundDynamicContextPrompt = vi.fn(async () =>
      "Background wearable reconnect context."
    );
    mocks.selectHostedAssistantInputIds.mockResolvedValueOnce({
      inputIds: ["pending-input-1"],
      mode: "background",
      pendingInputIds: ["pending-input-1"],
    });
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      expect(input).not.toHaveProperty("buildDynamicContextPrompt");
      expect(input).not.toHaveProperty("inputSourceAlreadyRefreshed");
      expect(input.executionContext?.hosted?.dynamicContextPrompts).toBeUndefined();
      return {
        currentTurnDeliveryIntentIds: ["foreground-intent"],
        nextWakeAt: null,
        progressed: true,
      };
    });

    const result = await runHostedAssistantAutomation(
      "/tmp/vault-root",
      "req_dynamic_context_existing_pending_input",
      {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      {
        eventId: "evt_dynamic_context_existing_pending_input",
        kind: "runtime.timer",
        occurredAt: "2026-04-23T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      undefined,
      undefined,
      undefined,
      {
        buildBackgroundDynamicContextPrompt,
      },
    );

    expect(result.currentTurnDeliveryIntentIds).toEqual(["foreground-intent"]);
    expect(buildBackgroundDynamicContextPrompt).not.toHaveBeenCalled();
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
    mocks.createHostedAssistantInputSource.mockReturnValueOnce({
      listInputCandidates: vi.fn(async () => ({
        inputs: [candidate],
        nextCursor: candidate.event.cursor,
      })),
      listNewConversationInputs: vi.fn(async (query) => ({
        inputs: [],
        nextCursor: query.afterCursor ?? null,
      })),
      readObservedInputIds: vi.fn(() => []),
      readSelectedInputIds: vi.fn(() => []),
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
      [],
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
        sourceDirectory: "raw/inbox/linq/acct_1/2026/04/cap_projection",
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
        message: "Hosted assistant automation pass finished.",
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
    ).not.toContain("autoReplyEligibleAfterSummary");
  });

  it("treats missing inbox runtime state as a non-fatal bootstrap gap", async () => {
    mocks.runAssistantAutomationPass.mockRejectedValue({
      code: "INBOX_NOT_INITIALIZED",
    });

    const runWithInputIds = (freshAssistantInputIds: readonly string[] = []) =>
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_123",
        {
          hosted: {
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
        freshAssistantInputIds,
      );

    const backgroundResult = await runWithInputIds();

    expect(backgroundResult).toEqual(expect.objectContaining({
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
    expect(backgroundResult.selectedInputWakeAt).toBeNull();

    const foregroundResult = await runWithInputIds(["ain_bootstrap_gap"]);
    expect(foregroundResult.selectedInputWakeAt).toBe(foregroundResult.nextWakeAt);
  });

  it("rethrows unexpected automation failures", async () => {
    const failure = new Error("automation failed");
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onTraceEvent?.({
        codexThreadId: null,
        rawEvent: {
          deliveryIntentPresent: true,
          deliveryOutcomeKind: "queued",
          finalReplySelected: true,
          providerRequestOrdinal: 0,
          schema: "murph.assistant-turn-timing.v1",
          type: "assistant.turn.timing",
          turnTimingElapsedMs: 17,
          turnTimingDeliveryIntentId: "intent_timing_123",
          turnTimingProviderRequestElapsedMs: 12,
          turnTimingSinceProviderResultMs: 5,
          turnTimingStage: "reply-dispatched",
        },
        updates: [],
      });
      throw failure;
    });

    await expect(
      runHostedAssistantAutomation(
        "/tmp/vault-root",
        "req_123",
        {
          hosted: {
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

    const attachedLogEntries =
      (failure as {
        hostedAssistantAutomationRedactedLogEntries?: unknown;
      }).hostedAssistantAutomationRedactedLogEntries;
    expect(Array.isArray(attachedLogEntries)).toBe(true);
    expect(attachedLogEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "Hosted assistant turn timing milestone captured.",
        redacted: expect.objectContaining({
          schema: "murph.assistant-turn-timing.v1",
          turnTimingElapsedMs: 17,
          turnTimingDeliveryIntentId: "intent_timing_123",
          turnTimingProviderRequestElapsedMs: 12,
          turnTimingSinceProviderResultMs: 5,
          turnTimingStage: "reply-dispatched",
        }),
      }),
      expect.objectContaining({
        message: "Hosted assistant automation pass failed.",
      }),
    ]));
    expect(Object.keys(failure)).not.toContain(
      "hostedAssistantAutomationRedactedLogEntries",
    );
  });
});

describe("resolveHostedDeviceSyncNextWakeAt", () => {
  it("reads durable store wakes without constructing configured providers", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-device-sync-wake-read-"));
    const store = new SqliteDeviceSyncStore(
      path.join(vaultRoot, DEVICE_SYNC_DB_RELATIVE_PATH),
    );

    try {
      store.upsertAccount({
        provider: "junction",
        externalAccountId: "junction-account",
        displayName: "Junction Account",
        scopes: ["offline"],
        tokens: {
          accessToken: "access-token",
          accessTokenEncrypted: "enc:access-token",
        },
        connectedAt: "2026-04-08T00:00:00.000Z",
        nextReconcileAt: "2026-04-08T01:00:00.000Z",
      });

      const wakeAt = resolveHostedDeviceSyncNextWakeAt({
        deviceSyncConfig: {
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
        vaultRoot,
      });

      assert.equal(wakeAt, "2026-04-08T01:00:00.000Z");
      expect(mocks.readConfiguredJunctionDeviceSyncProviderConfig).not.toHaveBeenCalled();
      expect(mocks.createConfiguredDeviceSyncProvidersFromConfigs).not.toHaveBeenCalled();
      expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
    } finally {
      store.close();
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("falls back to a bounded retry when the durable store wake cannot be read", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-device-sync-wake-read-failed-"));
    const vaultRoot = path.join(tempRoot, "vault-as-file");
    await writeFile(vaultRoot, "not a directory");
    const logPort = {
      write: vi.fn(async (request: HostedRuntimeLogRequest) => ({
        loggedCount: request.entries.length,
      })),
    };

    try {
      const wakeAt = await withHostedMaintenanceNow(
        "2026-04-08T00:00:00.000Z",
        async () => resolveHostedDeviceSyncNextWakeAt({
          deviceSyncConfig: {
            providerConfigs: {
              oura: {
                clientId: "oura-client",
                clientSecret: "oura-secret",
              },
            },
            publicBaseUrl: "https://device-sync.example.test",
            secret: "secret_123",
          },
          platform: { logPort },
          vaultRoot,
        }),
      );

      assert.equal(wakeAt, "2026-04-08T00:00:30.000Z");
      expect(logPort.write).toHaveBeenCalledWith({
        entries: [
          expect.objectContaining({
            component: "device-sync",
            eventCode: "device-sync.wake_projection_failed",
            level: "warn",
            phase: "invoke",
          }),
        ],
      });
    } finally {
      await rm(tempRoot, {
        force: true,
        recursive: true,
      });
    }
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

  it("passes staged dirty ack overlays into control-plane sync", async () => {
    const close = vi.fn();
    const service = {
      close,
      drainWorker: vi.fn(async () => 0),
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce: vi.fn(async () => undefined),
    };
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue(service);

    await runHostedDeviceSyncPass(
      {
        eventId: "evt_staged_dirty_ack_overlay",
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
        stagedDirtyAcks: [
          {
            connectionId: "dsc_123",
            processedDirtyPayloadIds: ["dsp_1"],
            processedRevision: "7",
          },
        ],
      },
    );

    expect(mocks.syncHostedDeviceSyncControlPlaneState).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDirtyPendingFetch: false,
        stagedDirtyAcks: [
          {
            connectionId: "dsc_123",
            processedDirtyPayloadIds: ["dsp_1"],
            processedRevision: "7",
          },
        ],
      }),
    );
  });

  it("builds a member-only provider runtime from one credential-bearing snapshot", async () => {
    const memberProviderConfigs = {
      strava: {
        clientId: "member-client",
        clientSecret: "member-secret",
      },
    };
    const snapshot = {
      connections: [{ connection: { id: "dsc_strava", status: "active" } }],
      providerConfigs: memberProviderConfigs,
      userId: "member_123",
    };
    const port = createMaintenanceDeviceSyncPortStub();
    port.fetchSnapshot.mockResolvedValue(snapshot);
    const service = {
      close: vi.fn(),
      drainWorker: vi.fn(async () => 0),
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce: vi.fn(async () => undefined),
    };
    mocks.createConfiguredDeviceSyncProvidersFromConfigs.mockReturnValue(["strava"]);
    mocks.createDeviceSyncRegistry.mockReturnValue({
      list: () => ["strava"],
    });
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue(service);

    await runHostedDeviceSyncPass(
      {
        eventId: "evt_member_provider_config",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      {
        providerConfigs: {},
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
      port,
      45_000,
    );

    expect(port.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(port.fetchSnapshot).toHaveBeenCalledWith({
      includeCredentialMaterial: true,
      signal: null,
    });
    expect(mocks.createConfiguredDeviceSyncProvidersFromConfigs).toHaveBeenCalledWith(
      memberProviderConfigs,
    );
    expect(mocks.createHostedRuntimeDeviceSyncService).toHaveBeenCalledTimes(1);
    expect(mocks.syncHostedDeviceSyncControlPlaneState).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot,
      }),
    );
    expect(
      mocks.syncHostedDeviceSyncControlPlaneState.mock.calls[0]?.[0]?.snapshot,
    ).toBe(snapshot);
  });

  it("logs stage-specific wearable import latency after successful dirty payload work", async () => {
    const service = {
      close: vi.fn(),
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce: vi.fn(async () => undefined),
    };
    const logPort = {
      write: vi.fn(async (request: HostedRuntimeLogRequest) => ({
        loggedCount: request.entries.length,
      })),
    };
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue(service);
    mocks.promoteHostedCompletedDirtyPayloadAcks.mockReturnValueOnce([{
      eventToProviderSendBucket: "under_5_minutes",
      firstWebhookReceivedAt: "2026-04-08T00:04:00.000Z",
      importCompletedAt: "2026-04-08T00:06:00.000Z",
      importExecutionStartedAt: "2026-04-08T00:05:00.000Z",
      jobCreatedAt: "2026-04-08T00:04:30.000Z",
      jobKind: "resource",
      provider: "junction",
      providerSendToWebhookMs: 60_000,
      sourceProvider: "garmin",
    }, {
      eventToProviderSendBucket: "5_to_30_minutes",
      firstWebhookReceivedAt: "2026-04-08T00:03:00.000Z",
      importCompletedAt: "2026-04-08T00:06:00.000Z",
      importExecutionStartedAt: null,
      jobCreatedAt: "2026-04-08T00:07:00.000Z",
      jobKind: "resource",
      provider: "strava",
      providerSendToWebhookMs: null,
      sourceProvider: "strava",
    }]);

    await runHostedDeviceSyncPass(
      {
        eventId: "evt_import_timing",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:06:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      "/tmp/vault-root",
      DEVICE_SYNC_CONFIG,
      createMaintenanceDeviceSyncPortStub(),
      45_000,
      {
        runtimeLogPlatform: { logPort },
      },
    );

    await vi.waitFor(() => {
      expect(logPort.write).toHaveBeenCalled();
    });
    const requests = logPort.write.mock.calls.map(([request]) => request);
    const entry = requests
      .flatMap((request) => request.entries)
      .find((candidate) => candidate.eventCode === "device-sync.import_completed");
    assert.ok(entry);
    expect(entry).toEqual({
      at: "2026-04-08T00:06:00.000Z",
      component: "device-sync",
      eventCode: "device-sync.import_completed",
      level: "info",
      phase: "invoke",
      redactedJson: {
        eventToProviderSendBucket: "under_5_minutes",
        importExecutionMs: 60_000,
        jobKind: "resource",
        provider: "junction",
        providerSendToWebhookMs: 60_000,
        runtimeQueueMs: 30_000,
        sourceProvider: "garmin",
        webhookToImportMs: 120_000,
      },
    });
    const skewedEntry = requests
      .flatMap((request) => request.entries)
      .find((candidate) => candidate.redactedJson?.provider === "strava");
    assert.ok(skewedEntry);
    expect(skewedEntry.redactedJson).toMatchObject({
      eventToProviderSendBucket: "5_to_30_minutes",
      provider: "strava",
      sourceProvider: "strava",
      webhookToImportMs: 180_000,
    });
    expect(skewedEntry.redactedJson).not.toHaveProperty("providerSendToWebhookMs");
    expect(skewedEntry.redactedJson).not.toHaveProperty("runtimeQueueMs");
    expect(skewedEntry.redactedJson).not.toHaveProperty("importExecutionMs");
    for (const privateField of [
      "connectionId",
      "deviceId",
      "eventCount",
      "eventToImportMs",
      "eventToProviderSendMs",
      "eventType",
      "externalAccountId",
      "healthValue",
      "importCompletedAt",
      "importExecutionStartedAt",
      "jobCreatedAt",
      "memberId",
      "oldestEventOccurredAt",
      "oldestProviderSentAt",
      "oldestWebhookReceivedAt",
      "resource",
      "resourceCategory",
      "sourceProviderSlug",
      "userId",
      "webhookBody",
    ]) {
      expect(entry.redactedJson).not.toHaveProperty(privateField);
      expect(skewedEntry.redactedJson).not.toHaveProperty(privateField);
    }
  });

  it("stops a superseded connection wake after hydration without running device-sync work", async () => {
    const close = vi.fn();
    const drainWorker = vi.fn(async () => 0);
    const runSchedulerOnce = vi.fn(async () => undefined);
    const service = {
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T01:00:00.000Z",
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce,
    };
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue(service);
    mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValueOnce({
      hostedToLocalAccountIds: new Map([["conn_replacement", "local_replacement"]]),
      localToHostedAccountIds: new Map([["local_replacement", "conn_replacement"]]),
      observedTokenVersions: new Map([["conn_replacement", 9]]),
      pendingDirtyAcks: [],
      pendingDirtyPayloadJobs: [],
      snapshot: null,
      wakeSuperseded: true,
    });

    const result = await runHostedDeviceSyncPass(
      {
        connectionId: "conn_replacement",
        eventId: "evt_stale_disconnect",
        expectedConnectedAt: "2026-04-08T00:00:00.000Z",
        kind: "device-sync.wake",
        occurredAt: "2026-04-08T00:30:00.000Z",
        reason: "disconnected",
        userId: "member_123",
      },
      FIXED_MAINTENANCE_VAULT_ROOT,
      DEVICE_SYNC_CONFIG,
      createMaintenanceDeviceSyncPortStub(),
      45_000,
      {
        stagedDirtyAcks: [{
          connectionId: "conn_dirty_pending",
          processedRevision: "7",
        }],
      },
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T01:00:00.000Z",
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: false,
      stagedDirtyAcks: [{
        connectionId: "conn_dirty_pending",
        processedRevision: "7",
      }],
    });
    expect(runSchedulerOnce).not.toHaveBeenCalled();
    expect(drainWorker).not.toHaveBeenCalled();
    expect(mocks.promoteHostedCompletedDirtyPayloadAcks).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(mocks.pruneWearableDenseRawTimeseries).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reschedules idle device sync when its abort signal fires during control-plane sync", async () => {
    await withHostedMaintenanceNow("2026-04-08T00:00:00.000Z", async () => {
      const controller = new AbortController();
      const close = vi.fn();
      const service = {
        close,
        drainWorker: vi.fn(async () => 0),
        getNextWakeAt: () => null,
        listJobFailureDiagnostics: vi.fn(() => []),
        listAccounts: vi.fn(() => []),
        runSchedulerOnce: vi.fn(async () => undefined),
      };
      mocks.createHostedRuntimeDeviceSyncService.mockReturnValue(service);
      mocks.syncHostedDeviceSyncControlPlaneState.mockImplementationOnce(async () => {
        controller.abort(new DOMException("foreground input arrived", "AbortError"));
        throw controller.signal.reason;
      });

      const result = await runHostedDeviceSyncPass(
        {
          eventId: "evt_idle_preempt",
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
          signal: controller.signal,
        },
      );

      expect(result).toEqual({
        nextWakeAt: "2026-04-08T00:00:30.000Z",
        postCheckpointRecord: null,
        processedJobs: 0,
        skipped: true,
      });
      expect(service.runSchedulerOnce).not.toHaveBeenCalled();
      await expectDenseRawRetentionMailboxWakeAt("2026-04-08T00:00:30.000Z");
      expect(close).toHaveBeenCalledTimes(1);
    });
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
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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
        deviceSyncPort: expect.anything(),
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
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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

  it("reports a push-primary source that silently stopped delivering", async () => {
    const logRequests: HostedRuntimeLogRequest[] = [];

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close: vi.fn(),
      drainWorker: vi.fn(async () => 0),
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => [
        {
          id: "dsc_stalled",
          provider: "aggregator",
          status: "active",
          sources: [
            // The aggregator still reports this source connected and every
            // resource available; only the arrival gap shows it is dead.
            {
              displayName: null,
              firstSeenAt: "2026-04-01T00:00:00.000Z",
              lastDataAt: "2026-04-01T00:00:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt: "2026-04-08T00:00:00.000Z",
              resourceCount: 20,
              sourceProviderSlug: "garmin",
              status: "connected",
            },
            {
              displayName: null,
              firstSeenAt: "2026-04-01T00:00:00.000Z",
              lastDataAt: "2026-04-01T00:00:00.000Z",
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSeenAt: "2026-04-08T00:00:00.000Z",
              resourceCount: 5,
              sourceProviderSlug: "oura",
              status: "connected",
            },
          ],
        },
      ]),
      runSchedulerOnce: vi.fn(async () => undefined),
    });

    await withHostedMaintenanceNow("2026-04-08T00:00:00.000Z", async () =>
      runHostedDeviceSyncPass(
        {
          eventId: "evt_device_sync_source_stalled",
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
          runtimeLogPlatform: {
            logPort: {
              async write(request) {
                logRequests.push(request);
                return { loggedCount: request.entries.length };
              },
            },
          },
        },
      )
    );

    const stalledEntries = logRequests
      .flatMap((request) => request.entries)
      .filter((entry) => entry.eventCode === "device-sync.source_stalled");

    assert.equal(stalledEntries.length, 1, "only the push-primary source is reported");
    const entry = stalledEntries[0];
    assert.ok(entry);
    assert.equal(entry.component, "device-sync");
    assert.equal(entry.level, "warn");
    assert.deepEqual(entry.redactedJson, {
      lastDataAt: "2026-04-01T00:00:00.000Z",
      provider: "aggregator",
      reason: "stopped_delivering",
      silentHours: 168,
      silentSinceAt: "2026-04-01T00:00:00.000Z",
      sourceProviderSlug: "garmin",
      thresholdHours: 36,
    });
  });

  it("completes the device-sync pass when source staleness reporting fails", async () => {
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close: vi.fn(),
      drainWorker: vi.fn(async () => 3),
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => {
        throw new Error("account projection unavailable");
      }),
      runSchedulerOnce: vi.fn(async () => undefined),
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_device_sync_source_stalled_failure",
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
        runtimeLogPlatform: {
          logPort: {
            async write(request) {
              return { loggedCount: request.entries.length };
            },
          },
        },
      },
    );

    // Observability must never cost the member their sync pass.
    assert.equal(result.skipped, false);
    assert.equal(result.processedJobs, 3);
  });

  it("runs bounded dense raw retention after device-sync drains and logs byte counts", async () => {
    const close = vi.fn();
    const logRequests: HostedRuntimeLogRequest[] = [];
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 2);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce,
    });
    mocks.pruneWearableDenseRawTimeseries.mockResolvedValueOnce({
      bytesAfter: 500,
      bytesBefore: 9_000,
      bytesFreed: 8_500,
      compactedReceiptCount: 0,
      denseRawBytesAfter: 500,
      denseRawBytesBefore: 9_000,
      denseRawBytesFreed: 8_500,
      hasMore: false,
      mutated: true,
      skippedCount: 1,
      tombstonedCanonicalArtifactCount: 0,
      tombstonedDenseRawArtifactCount: 2,
      touchedPaths: ["raw/integrations/wearable-provider/2026/04/import/01.json"],
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_device_sync_dense_raw_retention",
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
      processedJobs: 2,
      skipped: false,
    });
    await expectDenseRawRetentionMailboxWakeAt(null);
    expect(mocks.detectWearableStorageMigrationCandidates).not.toHaveBeenCalled();
    expect(mocks.pruneWearableDenseRawTimeseries).toHaveBeenCalledWith(expect.objectContaining({
      maxBytes: 512 * 1024 * 1024,
      maxFiles: 25,
      vaultRoot: "/tmp/vault-root",
    }));
    assert.equal(
      typeof mocks.pruneWearableDenseRawTimeseries.mock.calls[0]?.[0]?.deadlineMs,
      "number",
    );

    assert.equal(logRequests.length, 1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    assert.equal(entry.component, "device-sync");
    assert.equal(entry.eventCode, "device-sync.dense_raw_retention");
    assert.equal(entry.level, "info");
    assert.equal(entry.phase, "invoke");
    assert.deepEqual(entry.redactedJson, {
      denseRawAfterBytes: 500,
      denseRawBeforeBytes: 9_000,
      denseRawFreedBytes: 8_500,
      hasMore: false,
      processedJobs: 2,
      skippedCount: 1,
      tombstonedDenseRawArtifactCount: 2,
    });
    assert.equal(JSON.stringify(entry).includes("/tmp/vault-root"), false);
    assert.equal(JSON.stringify(entry).includes("sampleValues"), false);
  });

  it("schedules a near-term continuation when dense raw retention has more work", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce,
    });
    mocks.pruneWearableDenseRawTimeseries.mockResolvedValueOnce({
      bytesAfter: 1_000,
      bytesBefore: 10_000,
      bytesFreed: 9_000,
      compactedReceiptCount: 0,
      denseRawBytesAfter: 1_000,
      denseRawBytesBefore: 10_000,
      denseRawBytesFreed: 9_000,
      hasMore: true,
      mutated: true,
      skippedCount: 0,
      tombstonedCanonicalArtifactCount: 0,
      tombstonedDenseRawArtifactCount: 25,
      touchedPaths: ["raw/integrations/wearable-provider/2026/04/import/01.json"],
    });

    const result = await withHostedMaintenanceNow("2026-04-08T00:00:00.000Z", async () =>
      runHostedDeviceSyncPass(
        {
          eventId: "evt_device_sync_dense_raw_retention_more",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        createMaintenanceDeviceSyncPortStub(),
        45_000,
      )
    );

    assert.equal(result.nextWakeAt, "2026-04-08T00:00:30.000Z");
    await expectDenseRawRetentionMailboxWakeAt("2026-04-08T00:00:30.000Z");
    expect(mocks.pruneWearableDenseRawTimeseries).toHaveBeenCalledWith(expect.objectContaining({
      maxBytes: 512 * 1024 * 1024,
      maxFiles: 25,
      vaultRoot: "/tmp/vault-root",
    }));
  });

  it("keeps dense raw retention continuation across a hosted snapshot restore", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-dense-retention-snapshot-"));
    const vaultRoot = path.join(parentRoot, "vault");
    const operatorHomeRoot = path.join(parentRoot, "operator-home");
    const restoredWorkspaceRoot = path.join(parentRoot, "restored");

    try {
      await mkdir(operatorHomeRoot, { recursive: true });
      const close = vi.fn();
      mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
        close,
        drainWorker: vi.fn(async () => 0),
        getNextWakeAt: () => null,
        listJobFailureDiagnostics: vi.fn(() => []),
        listAccounts: vi.fn(() => []),
        runSchedulerOnce: vi.fn(async () => undefined),
      });
      mocks.pruneWearableDenseRawTimeseries.mockResolvedValueOnce({
        bytesAfter: 1_000,
        bytesBefore: 10_000,
        bytesFreed: 9_000,
        compactedReceiptCount: 0,
        denseRawBytesAfter: 1_000,
        denseRawBytesBefore: 10_000,
        denseRawBytesFreed: 9_000,
        hasMore: true,
        mutated: true,
        skippedCount: 0,
        tombstonedCanonicalArtifactCount: 0,
        tombstonedDenseRawArtifactCount: 25,
        touchedPaths: ["raw/integrations/wearable-provider/2026/04/import/01.json"],
      });

      const result = await withHostedMaintenanceNow("2026-04-08T00:00:00.000Z", async () =>
        runHostedDeviceSyncPass(
          {
            eventId: "evt_device_sync_dense_raw_retention_snapshot",
            kind: "runtime.timer",
            occurredAt: "2026-04-08T00:00:00.000Z",
            triggerKind: "runtime_timer",
            userId: "member_123",
          },
          vaultRoot,
          DEVICE_SYNC_CONFIG,
          createMaintenanceDeviceSyncPortStub(),
          45_000,
        )
      );
      assert.equal(result.nextWakeAt, "2026-04-08T00:00:30.000Z");
      await expectDenseRawRetentionMailboxWakeAt("2026-04-08T00:00:30.000Z", vaultRoot);

      const snapshot = await snapshotHostedExecutionContext({
        operatorHomeRoot,
        vaultRoot,
      });
      const restored = await restoreHostedExecutionContext({
        bundle: snapshot.bundle,
        workspaceRoot: restoredWorkspaceRoot,
      });

      await expectDenseRawRetentionMailboxWakeAt(
        "2026-04-08T00:00:30.000Z",
        restored.vaultRoot,
      );
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await rm(parentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps the prearmed dense raw retention continuation when yielding after retention reports more work", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);
    let shouldYieldNow = false;

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce,
    });
    mocks.pruneWearableDenseRawTimeseries.mockImplementationOnce(async () => {
      shouldYieldNow = true;
      return {
        bytesAfter: 1_000,
        bytesBefore: 10_000,
        bytesFreed: 9_000,
        compactedReceiptCount: 0,
        denseRawBytesAfter: 1_000,
        denseRawBytesBefore: 10_000,
        denseRawBytesFreed: 9_000,
        hasMore: true,
        mutated: true,
        skippedCount: 0,
        tombstonedCanonicalArtifactCount: 0,
        tombstonedDenseRawArtifactCount: 25,
        touchedPaths: ["raw/integrations/wearable-provider/2026/04/import/01.json"],
      };
    });

    const result = await withHostedMaintenanceNow("2026-04-08T00:00:00.000Z", async () =>
      runHostedDeviceSyncPass(
        {
          eventId: "evt_device_sync_dense_raw_retention_more_yield",
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
          shouldYield: () => shouldYieldNow,
        },
      )
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T00:00:30.000Z",
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    });
    await expectDenseRawRetentionMailboxWakeAt("2026-04-08T00:00:30.000Z");
  });

  it("does not start dense raw retention when the maintenance deadline is exhausted", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce,
    });

    const result = await withHostedMaintenanceNow("2026-04-08T00:00:00.000Z", async () =>
      runHostedDeviceSyncPass(
        {
          eventId: "evt_device_sync_dense_raw_retention_deadline",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        "/tmp/vault-root",
        DEVICE_SYNC_CONFIG,
        createMaintenanceDeviceSyncPortStub(),
        0,
      )
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T00:00:30.000Z",
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: false,
    });
    await expectDenseRawRetentionMailboxWakeAt("2026-04-08T00:00:30.000Z");
    expect(mocks.pruneWearableDenseRawTimeseries).not.toHaveBeenCalled();
    expect(mocks.detectWearableStorageMigrationCandidates).not.toHaveBeenCalled();
  });

  it("logs dense raw retention failures without blocking device-sync reconcile", async () => {
    const close = vi.fn();
    const logRequests: HostedRuntimeLogRequest[] = [];
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 1);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce,
    });
    mocks.pruneWearableDenseRawTimeseries.mockRejectedValueOnce(
      new Error("repair failed for /tmp/vault-root/raw/provider.json"),
    );

    const result = await withHostedMaintenanceNow("2026-04-08T00:00:00.000Z", async () =>
      runHostedDeviceSyncPass(
        {
          eventId: "evt_device_sync_dense_raw_retention_failure",
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
      )
    );

    assert.deepEqual(result, {
      nextWakeAt: "2026-04-08T00:00:30.000Z",
      postCheckpointRecord: null,
      processedJobs: 1,
      skipped: false,
    });
    await expectDenseRawRetentionMailboxWakeAt("2026-04-08T00:00:30.000Z");
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).toHaveBeenCalledTimes(1);
    assert.equal(logRequests.length, 1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    assert.equal(entry.eventCode, "device-sync.dense_raw_retention");
    assert.equal(entry.level, "warn");
    assert.equal(JSON.stringify(entry).includes("/tmp/vault-root"), false);
    assert.deepEqual(entry.redactedJson, {
      errorSummary: "repair failed for <redacted-path>",
      failed: true,
      hasMore: true,
      processedJobs: 1,
    });
  });

  it("returns a bounded batch dirty ack post-checkpoint record when multiple dirty states are handed off", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => null,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce,
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValueOnce({
      hostedToLocalAccountIds: new Map(),
      localToHostedAccountIds: new Map(),
      observedTokenVersions: new Map(),
      pendingDirtyAcks: [
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
      pendingDirtyPayloadJobs: [],
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
    assert.deepEqual(result.stagedDirtyAcks, [
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
    ]);
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("carries the local retry wake into a retained dirty payload acknowledgement", async () => {
    const close = vi.fn();
    const retryAt = "2026-04-08T00:05:00.000Z";
    const service = {
      close,
      drainWorker: vi.fn(async () => 0),
      getNextWakeAt: () => retryAt,
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce: vi.fn(async () => undefined),
    };
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue(service);
    mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValueOnce({
      hostedToLocalAccountIds: new Map(),
      localToHostedAccountIds: new Map(),
      observedTokenVersions: new Map(),
      pendingDirtyAcks: [{
        connectionId: "dsc_retry_pending",
        nextWakeAt: null,
        processedRevision: "13",
      }],
      pendingDirtyPayloadJobs: [{
        connectionId: "dsc_retry_pending",
        dirtyPayloadId: "dsp_retry_pending",
        jobId: "dsj_retry_pending",
        processedRevision: "13",
      }],
      snapshot: {
        connections: [],
        schema: "murph.hosted-device-sync-runtime-snapshot.v1",
      },
    });

    const result = await runHostedDeviceSyncPass(
      {
        eventId: "evt_device_sync_retry_pending",
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
      nextWakeAt: retryAt,
      postCheckpointRecord: {
        connectionId: "dsc_retry_pending",
        kind: "device-sync.dirty-processed",
        nextWakeAt: retryAt,
        processedRevision: "13",
      },
      processedJobs: 0,
      skipped: false,
      stagedDirtyAcks: [{
        connectionId: "dsc_retry_pending",
        nextWakeAt: retryAt,
        processedRevision: "13",
      }],
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
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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
    await expectDenseRawRetentionMailboxWakeAt(null);
    expect(close).not.toHaveBeenCalled();
  });

  it("carries staged dirty acks when foreground input arrives after dirty fetch", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);
    const shouldYield = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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
      pendingDirtyPayloadJobs: [{
        connectionId: "dsc_yield_after_fetch",
        dirtyPayloadId: "dsp_yield_after_fetch",
        jobId: "dsj_yield_after_fetch",
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
      postCheckpointRecord: {
        connectionId: "dsc_yield_after_fetch",
        kind: "device-sync.dirty-processed",
        nextWakeAt: "2026-04-08T00:00:30.000Z",
        processedRevision: "41",
      },
      processedJobs: 0,
      skipped: true,
      stagedDirtyAcks: [{
        connectionId: "dsc_yield_after_fetch",
        nextWakeAt: "2026-04-08T00:00:30.000Z",
        processedRevision: "41",
      }],
    });
    expect(mocks.syncHostedDeviceSyncControlPlaneState).toHaveBeenCalledTimes(1);
    expect(runSchedulerOnce).not.toHaveBeenCalled();
    expect(drainWorker).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedDeviceSyncControlPlaneState).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("carries staged dirty acks when foreground input arrives after scheduler work", async () => {
    const close = vi.fn();
    const runSchedulerOnce = vi.fn(async () => undefined);
    const drainWorker = vi.fn(async () => 0);
    const shouldYield = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-04-08T02:00:00.000Z",
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
      runSchedulerOnce,
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValueOnce({
      hostedToLocalAccountIds: new Map(),
      localToHostedAccountIds: new Map(),
      observedTokenVersions: new Map(),
      pendingDirtyAcks: [{
        connectionId: "dsc_yield_after_scheduler",
        nextWakeAt: "2026-04-08T00:06:00.000Z",
        processedDirtyPayloadIds: ["dsp_scheduler"],
        processedRevision: "42",
      }],
      pendingDirtyPayloadJobs: [],
      snapshot: {
        connections: [],
        schema: "murph.hosted-device-sync-runtime-snapshot.v1",
      },
    });

    const result = await withHostedMaintenanceNow(
      "2026-04-08T00:00:00.000Z",
      () => runHostedDeviceSyncPass(
        {
          eventId: "evt_yield_after_scheduler",
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
      postCheckpointRecord: {
        connectionId: "dsc_yield_after_scheduler",
        kind: "device-sync.dirty-processed",
        nextWakeAt: "2026-04-08T00:06:00.000Z",
        processedDirtyPayloadIds: ["dsp_scheduler"],
        processedRevision: "42",
      },
      processedJobs: 0,
      skipped: true,
      stagedDirtyAcks: [{
        connectionId: "dsc_yield_after_scheduler",
        nextWakeAt: "2026-04-08T00:06:00.000Z",
        processedDirtyPayloadIds: ["dsp_scheduler"],
        processedRevision: "42",
      }],
    });
    expect(mocks.syncHostedDeviceSyncControlPlaneState).toHaveBeenCalledTimes(1);
    expect(runSchedulerOnce).toHaveBeenCalledTimes(1);
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
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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
      listJobFailureDiagnostics: vi.fn(() => []),
      listAccounts: vi.fn(() => []),
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
      pendingDirtyPayloadJobs: [],
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
      failureDisposition: "retry",
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

  it("logs webhook-triggered job failures even when a later success cleared account error state", async () => {
    const close = vi.fn();
    const drainWorker = vi.fn(async () => 2);
    const runSchedulerOnce = vi.fn(async () => undefined);
    const logRequests: HostedRuntimeLogRequest[] = [];

    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue({
      close,
      drainWorker,
      getNextWakeAt: () => "2026-06-08T03:00:00.000Z",
      listJobFailureDiagnostics: vi.fn(() => [
        {
          accountId: "local_account_sleep_sensitive",
          accountStatus: null,
          at: "2026-06-08T02:00:02.000Z",
          attempts: 3,
          code: "JUNCTION_API_REQUEST_FAILED",
          details: {
            providerHttpStatus: 503,
            providerRequestEndpointKind: "junction_summary",
            providerRequestMethod: "GET",
          },
          jobKind: "resource",
          provider: "junction",
          resource: "sleep",
          retryable: true,
          summary: "Junction summary request failed with an ambiguous provider error.",
        },
      ]),
      listAccounts: vi.fn(() => [
        {
          id: "local_account_sleep_sensitive",
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncCompletedAt: "2026-06-08T02:00:03.000Z",
          lastSyncErrorAt: null,
          lastSyncStartedAt: "2026-06-08T02:00:01.000Z",
          nextReconcileAt: "2026-06-08T03:00:00.000Z",
          provider: "junction",
          setupPhase: null,
          status: "active",
        },
      ]),
      runSchedulerOnce,
    });
    mocks.syncHostedDeviceSyncControlPlaneState.mockResolvedValue({
      hostedToLocalAccountIds: new Map([
        ["hosted_connection_sleep_sensitive", "local_account_sleep_sensitive"],
      ]),
      localToHostedAccountIds: new Map([
        ["local_account_sleep_sensitive", "hosted_connection_sleep_sensitive"],
      ]),
      observedTokenVersions: new Map(),
      pendingDirtyAcks: [],
      pendingDirtyPayloadJobs: [],
      snapshot: {
        connections: [
          {
            connection: {
              id: "hosted_connection_sleep_sensitive",
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: "2026-06-07T02:00:00.000Z",
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
            },
          },
        ],
      },
    });

    await runHostedDeviceSyncPass(
      {
        eventId: "evt_device_sync_webhook_failure_log",
        hint: null,
        kind: "device-sync.wake",
        occurredAt: "2026-06-08T02:00:00.000Z",
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

    assert.equal(logRequests.length, 1);
    const entry = logRequests[0]?.entries[0];
    assert.ok(entry);
    assert.equal(entry.at, "2026-06-08T02:00:02.000Z");
    assert.equal(entry.component, "device-sync");
    assert.equal(entry.errorCode, "JUNCTION_API_REQUEST_FAILED");
    assert.equal(entry.eventCode, "device-sync.job_failed");
    assert.equal(entry.level, "warn");
    assert.equal(entry.phase, "invoke");
    assert.deepEqual(entry.redactedJson, {
      failureCode: "JUNCTION_API_REQUEST_FAILED",
      failureDisposition: "retry",
      failureJobAttempts: 3,
      failureJobKind: "resource",
      failureResource: "sleep",
      failureSummary: "Junction summary request failed with an ambiguous provider error.",
      failureRetryable: true,
      hadPriorFailure: false,
      hadPriorSuccess: true,
      hostedConnectionKnown: true,
      nextReconcileAt: "2026-06-08T03:00:00.000Z",
      processedJobs: 2,
      provider: "junction",
      providerHttpStatus: 503,
      providerRequestEndpointKind: "junction_summary",
      providerRequestMethod: "GET",
      setupPhase: null,
      status: "active",
      syncCompletedAt: "2026-06-08T02:00:03.000Z",
      syncFailedAt: null,
      syncStartedAt: "2026-06-08T02:00:01.000Z",
      wakeKind: "device-sync.wake",
      wakeReason: "webhook_hint",
    });
    const serializedWebhookFailureLogs = JSON.stringify(logRequests);
    expect(serializedWebhookFailureLogs).not.toContain("local_account_sleep_sensitive");
    expect(serializedWebhookFailureLogs).not.toContain("hosted_connection_sleep_sensitive");
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

describe("runHostedAssistantAutomationLane", () => {
  it("projects committed terminal non-replies into the existing latency trace", async () => {
    const latencyTraceRecord = vi.fn(async () => ({
      matchedCount: 2,
      recorded: true,
      unmatchedCount: 0,
    }));
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onTerminalNonReplyCommitted?.({
        inputIds: ["input_group_1", "input_group_2"],
        recordedAt: "2026-04-08T00:00:02.000Z",
        source: "linq",
      });
      return {
        nextWakeAt: null,
        progressed: true,
        replies: {
          considered: 2,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
          skipped: 2,
        },
      };
    });

    await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_assistant_terminal_non_reply",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      idleCheckpointDelayMs: 180_000,
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_terminal_non_reply",
      runtime: createHostedAutomationRuntime({
        platform: {
          latencyTracePort: {
            record: latencyTraceRecord,
          },
        },
      }),
      runtimeAttemptId: "attempt_terminal_non_reply",
      vaultRoot: "/tmp/vault-root",
    });

    await vi.waitFor(() => {
      expect(latencyTraceRecord).toHaveBeenCalledWith({
        event: {
          assistantInputIds: ["input_group_1", "input_group_2"],
          at: "2026-04-08T00:00:02.000Z",
          checkpointPublicationExpectedBy: "2026-04-08T00:27:47.000Z",
          milestone: "terminal_non_reply_committed",
          runtimeAttemptId: "attempt_terminal_non_reply",
          source: "linq",
          type: "assistant_milestone",
        },
      });
    });
  });

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

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_assistant_lane",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
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
      preProviderPhase: {
        workspaceAssistantPreAutomationMs: 11,
      },
      providerStartCriticalPath: {
        mailboxImportDoneAtMonotonicMs: 0,
      },
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toMatchObject({
      nextWakeAt: "2026-04-08T01:00:00.000Z",
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
    expect(result).not.toHaveProperty("deviceSyncProcessed");
    expect(result).not.toHaveProperty("deviceSyncSkipped");
    expect(result).not.toHaveProperty("parserProcessed");
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith({
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      inboxServices: expect.anything(),
      inputSource: expect.any(Object),
      maxPerScan: 50,
      onEvent: expect.any(Function),
      onProviderEvent: expect.any(Function),
      onProviderRequestStarted: expect.any(Function),
      onTerminalNonReplyCommitted: expect.any(Function),
      onTraceEvent: expect.any(Function),
      providerStartCriticalPath: {
        automationInputSelectionDoneAtMonotonicMs: 0,
        automationLaneStartedAtMonotonicMs: 0,
        automationReadinessDoneAtMonotonicMs: 0,
        mailboxImportDoneAtMonotonicMs: 0,
      },
      requestId: "req_123",
      shouldDeferCron: expect.any(Function),
      shouldYieldBackgroundMaintenance: null,
      signal: undefined,
      turnEnvironment: {
        currentWorkingDirectory: null,
        env: {
          MURPH_HOSTED_RUNTIME_PROCESS: "1",
          VAULT: "/tmp/vault-root",
        },
      },
      vault: "/tmp/vault-root",
      vaultServices: expect.anything(),
    });
    const automationPassInput =
      mocks.runAssistantAutomationPass.mock.calls[0]?.[0] as RunAssistantAutomationPassInput;
    automationPassInput.onProviderRequestStarted?.({
      autoReplyHistory: {
        outboxScanBytesRead: 8_192,
        outboxScanElapsedMs: 23,
        outboxScanFilesRead: 10,
        outboxScanPerformed: true,
        receiptScanBytesRead: 4_096,
        receiptScanElapsedMs: 19,
        receiptScanFilesRead: 12,
        receiptScanLockWaitMs: 3,
        receiptScanPerformed: true,
      },
      assistantInputIds: ["input_1"],
      codexAppServerInitializeMs: 7,
      codexAppServerPreProviderMs: 17,
      codexAppServerSpawnReadyMs: 1,
      codexAppServerThreadResumeMs: 9,
      codexAppServerWarmReuseMs: 0,
      providerStartCriticalPath: {
        assistantServicePreLockMs: 5,
        automationCandidateScanMs: 1,
        automationCrossSessionContextMs: 0,
        automationGroupAndOperationScopeMs: 1,
        automationInputSelectionMs: 1,
        automationLaneToAssistantServiceMs: 7,
        automationPassSetupMs: 1,
        automationPromptPreparationMs: 0,
        automationReadinessMs: 1,
        automationServiceHandoffMs: 0,
        automationSessionPreflightMs: 1,
        automationTerminalEvidenceMs: 1,
        codexAppServerPreProviderMs: 19,
        codexProcessPreparationMs: 3,
        mailboxImportDoneToAssistantPhaseMs: 29,
        preProviderSetupMs: 11,
        providerPlanAndGateMs: 13,
        turnLockWaitMs: 2,
        workspaceAssistantPreAutomationMs: 17,
      },
      providerRequestOrdinal: 0,
      source: "linq",
      startedAt: "2026-04-08T00:00:01.000Z",
    });
    await Promise.resolve();
    expect(latencyTraceRecord).toHaveBeenCalledWith({
      event: {
        assistantInputIds: ["input_1"],
        at: "2026-04-08T00:00:01.000Z",
        phaseBreakdown: {
          preProvider: {
            automationCandidateScanMs: 1,
            automationCrossSessionContextMs: 0,
            automationGroupAndOperationScopeMs: 1,
            automationInputSelectionMs: 1,
            outboxScanBytesRead: 8_192,
            outboxScanElapsedMs: 23,
            outboxScanFilesRead: 10,
            outboxScanPerformed: true,
            receiptScanBytesRead: 4_096,
            receiptScanElapsedMs: 19,
            receiptScanFilesRead: 12,
            receiptScanLockWaitMs: 3,
            receiptScanPerformed: true,
            automationLaneToAssistantServiceMs: 7,
            automationPassSetupMs: 1,
            automationPromptPreparationMs: 0,
            automationReadinessMs: 1,
            automationServiceHandoffMs: 0,
            automationSessionPreflightMs: 1,
            automationTerminalEvidenceMs: 1,
            mailboxImportDoneToAssistantPhaseMs: 29,
            workspaceAssistantPreAutomationMs: 17,
          },
          provider: {
            assistantServicePreLockMs: 5,
            codexAppServerInitializeMs: 7,
            codexAppServerPreProviderMs: 19,
            codexAppServerSpawnReadyMs: 1,
            codexAppServerThreadResumeMs: 9,
            codexAppServerWarmReuseMs: 0,
            codexProcessPreparationMs: 3,
            preProviderSetupMs: 11,
            providerPlanAndGateMs: 13,
            turnLockWaitMs: 2,
          },
          schemaVersion: 1,
        },
        providerRequestOrdinal: 0,
        runtimeAttemptId: "attempt_123",
        source: "linq",
        type: "provider_started",
      },
    });
    automationPassInput.onProviderEvent?.({
      id: "reasoning_1",
      kind: "reasoning",
      rawEvent: { sensitive: "must-not-leave-runtime" },
      state: "running",
      text: "private reasoning text",
    });
    await vi.waitFor(() => {
      expect(latencyTraceRecord).toHaveBeenCalledTimes(2);
    });
    expect(latencyTraceRecord).toHaveBeenLastCalledWith({
      event: expect.objectContaining({
        assistantInputIds: ["input_1"],
        milestone: "first_codex_output_observed",
        runtimeAttemptId: "attempt_123",
        source: "linq",
        type: "assistant_milestone",
      }),
    });
    automationPassInput.onProviderEvent?.({
      id: "message_1",
      kind: "message",
      rawEvent: { sensitive: "must-not-leave-runtime" },
      state: "running",
      text: "private response text",
    });
    await vi.waitFor(() => {
      expect(latencyTraceRecord).toHaveBeenCalledTimes(3);
    });
    expect(latencyTraceRecord).toHaveBeenLastCalledWith({
      event: expect.objectContaining({
        assistantInputIds: ["input_1"],
        milestone: "first_codex_text_observed",
        runtimeAttemptId: "attempt_123",
        source: "linq",
        type: "assistant_milestone",
      }),
    });
    expect(JSON.stringify(latencyTraceRecord.mock.calls)).not.toContain("private reasoning text");
    expect(JSON.stringify(latencyTraceRecord.mock.calls)).not.toContain("private response text");
    expect(JSON.stringify(latencyTraceRecord.mock.calls)).not.toContain("must-not-leave-runtime");
    automationPassInput.onProviderRequestStarted?.({
      assistantInputIds: ["input_2"],
      providerRequestOrdinal: 0,
      source: "telegram",
      startedAt: "2026-04-08T00:00:02.000Z",
    });
    await Promise.resolve();
    expect(latencyTraceRecord).toHaveBeenCalledTimes(4);
    expect(latencyTraceRecord).toHaveBeenLastCalledWith({
      event: {
        assistantInputIds: ["input_2"],
        at: "2026-04-08T00:00:02.000Z",
        phaseBreakdown: {
          preProvider: {
            workspaceAssistantPreAutomationMs: 11,
          },
          schemaVersion: 1,
        },
        providerRequestOrdinal: 0,
        runtimeAttemptId: "attempt_123",
        source: "telegram",
        type: "provider_started",
      },
    });
    const canonicalCriticalPath = {
      assistantServicePreLockMs: 5,
      automationLaneToAssistantServiceMs: 7,
      codexAppServerPreProviderMs: 19,
      codexProcessPreparationMs: 3,
      mailboxImportDoneToAssistantPhaseMs: 29,
      preProviderSetupMs: 11,
      providerPlanAndGateMs: 13,
      turnLockWaitMs: 2,
      workspaceAssistantPreAutomationMs: 17,
    };
    automationPassInput.onProviderRequestStarted?.({
      assistantInputIds: ["input_partial_subdivision"],
      providerRequestOrdinal: 1,
      providerStartCriticalPath: {
        ...canonicalCriticalPath,
        automationReadinessMs: 7,
      },
      source: "linq",
      startedAt: "2026-04-08T00:00:03.000Z",
    });
    await Promise.resolve();
    expect(latencyTraceRecord).toHaveBeenCalledTimes(5);
    expect(latencyTraceRecord).toHaveBeenLastCalledWith({
      event: expect.objectContaining({
        phaseBreakdown: expect.objectContaining({
          preProvider: {
            automationLaneToAssistantServiceMs: 7,
            mailboxImportDoneToAssistantPhaseMs: 29,
            workspaceAssistantPreAutomationMs: 17,
          },
        }),
      }),
    });
    automationPassInput.onProviderRequestStarted?.({
      assistantInputIds: ["input_mismatched_subdivision"],
      providerRequestOrdinal: 2,
      providerStartCriticalPath: {
        ...canonicalCriticalPath,
        automationCandidateScanMs: 1,
        automationCrossSessionContextMs: 0,
        automationGroupAndOperationScopeMs: 1,
        automationInputSelectionMs: 1,
        automationPassSetupMs: 1,
        automationPromptPreparationMs: 0,
        automationReadinessMs: 2,
        automationServiceHandoffMs: 0,
        automationSessionPreflightMs: 1,
        automationTerminalEvidenceMs: 1,
      },
      source: "linq",
      startedAt: "2026-04-08T00:00:04.000Z",
    });
    await Promise.resolve();
    expect(latencyTraceRecord).toHaveBeenCalledTimes(6);
    expect(latencyTraceRecord).toHaveBeenLastCalledWith({
      event: expect.objectContaining({
        phaseBreakdown: expect.objectContaining({
          preProvider: {
            automationLaneToAssistantServiceMs: 7,
            mailboxImportDoneToAssistantPhaseMs: 29,
            workspaceAssistantPreAutomationMs: 17,
          },
        }),
      }),
    });
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("passes the background-yield signal into hosted cron deferral", async () => {
    const shouldYieldBackgroundMaintenance = vi.fn().mockReturnValue(true);
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      nextWakeAt: "2026-04-08T01:00:00.000Z",
      progressed: false,
    });

    await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_assistant_lane_yield",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_yield",
      runtime: createHostedAutomationRuntime(),
      shouldYieldBackgroundMaintenance,
      vaultRoot: "/tmp/vault-root",
    });

    const automationPassInput =
      mocks.runAssistantAutomationPass.mock.calls[0]?.[0] as RunAssistantAutomationPassInput;
    expect(automationPassInput.requestId).toBe("req_yield");
    expect(automationPassInput.shouldDeferCron?.()).toBe(true);
    expect(automationPassInput.shouldYieldBackgroundMaintenance)
      .toBe(shouldYieldBackgroundMaintenance);
  });

  it("forwards provider-bound input and operation scope through the lane", async () => {
    const now = new Date("2026-04-08T00:00:00.000Z");
    const beforeProviderAcceptedInputs = vi.fn(async () => undefined);
    const operationScope: AssistantAutomationOperationScope = {
      async runAutoReplyGroup({ executionContext, operation, turnEnvironment }) {
        return await operation(executionContext, turnEnvironment);
      },
    };
    await runHostedAssistantAutomationLane({
      assistantRuntimeState: {
        assistantActiveProfileId: "platform-default",
        assistantActiveProfileManagedBy: "platform",
        assistantActiveProfileReady: true,
        assistantConfigInvalid: false,
        assistantConfigPresent: true,
        assistantConfigStatus: "hosted-env",
        assistantConfigured: true,
        assistantProvider: "codex-cli",
      },
      beforeProviderAcceptedInputs,
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      now,
      operationScope,
      requestId: "req_integrated_lane_bindings",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
      wake: {
        eventId: "evt_integrated_lane_bindings",
        kind: "runtime.timer",
        occurredAt: now.toISOString(),
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
    });

    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeProviderAcceptedInputs,
        operationScope,
      }),
    );
  });

  it("defers hosted cron when the current pass selected fresh foreground input", async () => {
    const callOrder: string[] = [];
    let shouldDeferCronDuringPass: boolean | null = null;
    mocks.selectHostedAssistantInputIds.mockResolvedValueOnce({
      freshInputIds: ["ain_current_foreground"],
      inputIds: ["ain_current_foreground"],
      mode: "foreground",
      pendingInputIds: ["ain_transition_proof"],
    });
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      callOrder.push("provider");
      input.onProviderRequestStarted?.({
        assistantInputIds: ["ain_current_foreground"],
        providerRequestOrdinal: 0,
        source: "linq",
        startedAt: "2026-04-08T00:00:01.000Z",
      });
      callOrder.push("cron-check");
      shouldDeferCronDuringPass = input.shouldDeferCron?.() ?? null;
      return {
        cronProcessed: shouldDeferCronDuringPass ? 0 : 1,
        nextWakeAt: shouldDeferCronDuringPass ? "2026-04-08T00:00:30.000Z" : null,
        passTiming: {
          cronStatusDeferred: true,
          cronStatusElapsedMs: null,
          postScanTailElapsedMs: 4,
          scanElapsedMs: 12,
        },
        progressed: false,
        replies: {
          considered: 1,
          failed: 0,
          replied: 0,
          skipped: 1,
        },
        routing: {
          considered: 0,
          failed: 0,
          noAction: 0,
          routed: 0,
          skipped: 0,
        },
      };
    });

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_assistant_lane_current_foreground",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      freshAssistantInputIds: ["ain_current_foreground"],
      now: new Date("2026-04-08T00:00:00.000Z"),
      requestId: "req_current_foreground",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(shouldDeferCronDuringPass).toBe(true);
    expect(callOrder).toEqual(["provider", "cron-check"]);
    expect(result.assistantAutomationCronProcessed).toBe(0);
    expect(result.assistantAutomationCronStatusDeferred).toBe(true);
    expect(result.assistantAutomationCronStatusElapsedMs).toBeNull();
    expect(result.assistantAutomationPostScanTailElapsedMs).toBe(4);
    expect(result.assistantAutomationScanElapsedMs).toBe(12);
    const automationPassInput =
      mocks.runAssistantAutomationPass.mock.calls[0]?.[0] as RunAssistantAutomationPassInput;
    expect(automationPassInput.shouldYieldBackgroundMaintenance).toBeNull();
    expect(mocks.selectHostedAssistantInputIds).toHaveBeenCalledWith(
      expect.objectContaining({
        freshAssistantInputIds: ["ain_current_foreground"],
        mode: "foreground",
      }),
    );
    expect(mocks.createHostedAssistantInputSource).toHaveBeenCalledWith(
      expect.objectContaining({ pendingInputRefreshMode: "none" }),
    );
  });

  it("records provider trace diagnostics from the maintenance automation lane", async () => {
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      input.onTraceEvent?.({
        providerSessionId: "raw-provider-session-id",
        rawEvent: {
          schema: "murph.assistant-provider-plan-diagnostics.v1",
          type: "assistant.provider.plan",
          codexContinuation: "provider-state-optimization",
          messageTargetDynamicToolsAvailable: true,
          messageTargetingAvailable: true,
          providerRequestOrdinal: 0,
          resumeCodexThreadIdPresent: true,
          routePlanningElapsedMs: 42,
          routePlanningRawPath: "/tmp/raw-provider-path",
          prompt: "raw prompt text should not persist",
          workingDirectoryKind: "hosted-stable-proc-cwd",
        },
        updates: [],
      });
      return {
        nextWakeAt: null,
        progressed: false,
      };
    });

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_assistant_provider_trace",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_provider_trace",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    const providerLog = (result.redactedLogEntries ?? []).find((entry) =>
      entry.component === "runtime.provider"
    );
    expect(providerLog).toEqual(expect.objectContaining({
      component: "runtime.provider",
      eventId: "evt_assistant_provider_trace",
      level: "info",
      message: "Hosted assistant provider plan captured.",
      phase: "wake.running",
      redacted: expect.objectContaining({
        codexContinuation: "provider-state-optimization",
        messageTargetDynamicToolsAvailable: true,
        messageTargetingAvailable: true,
        providerPlanKind: "provider.plan",
        providerRequestOrdinal: 0,
        requestId: "req_provider_trace",
        resumeCodexThreadIdPresent: true,
        routePlanningElapsedMs: 42,
        workingDirectoryKind: "hosted-stable-proc-cwd",
      }),
    }));
    expect(providerLog?.redacted).not.toHaveProperty("providerSessionId");
    expect(providerLog?.redacted).not.toHaveProperty("routePlanningRawPath");
    expect(providerLog?.redacted).not.toHaveProperty("prompt");
    expect(JSON.stringify(providerLog?.redacted)).not.toContain("raw-provider-session-id");
    expect(JSON.stringify(providerLog?.redacted)).not.toContain("/tmp/raw-provider-path");
    expect(JSON.stringify(providerLog?.redacted)).not.toContain("raw prompt text");
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime.provider",
        details: expect.objectContaining({
          codexContinuation: "provider-state-optimization",
          providerPlanKind: "provider.plan",
          requestId: "req_provider_trace",
        }),
        message: "Hosted assistant provider plan captured.",
        phase: "wake.running",
      }),
    );
  });

  it("uses prepared hosted assistant readiness without re-reading ambient config", async () => {
    const result = await runHostedAssistantAutomationLane({
      assistantRuntimeState: {
        assistantActiveProfileId: "platform-default",
        assistantActiveProfileManagedBy: "platform",
        assistantActiveProfileReady: true,
        assistantConfigInvalid: false,
        assistantConfigPresent: true,
        assistantConfigStatus: "hosted-env",
        assistantConfigured: true,
        assistantProvider: "codex-cli",
      },
      wake: {
        eventId: "evt_prepared_assistant_state",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_prepared_assistant_state",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.readHostedAssistantRuntimeState).not.toHaveBeenCalled();
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledTimes(1);
    expect(result.nextWakeAt).toBe("2026-04-08T01:00:00.000Z");
  });

  it("falls back to the restored operator home when readiness is not supplied", async () => {
    const operatorHomeRoot = "/tmp/murph-hosted-operator-home";

    await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_direct_assistant_state",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      operatorHomeRoot,
      requestId: "req_direct_assistant_state",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.readHostedAssistantRuntimeState).toHaveBeenCalledWith({
      homeDirectory: operatorHomeRoot,
    });
    expect(mocks.runAssistantAutomationPass).toHaveBeenCalledTimes(1);
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

    await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_assistant_latency_retry",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
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

  it("keeps device-sync out of the assistant automation lane even when configured", async () => {
    const nextWakeAt = "2026-04-08T00:30:00.000Z";
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      nextWakeAt,
      progressed: false,
    });

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_tied_device_sync_wake",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
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

    expect(result).toMatchObject({ nextWakeAt });
    expect(result).not.toHaveProperty("deviceSyncProcessed");
    expect(result).not.toHaveProperty("deviceSyncSkipped");
    expect(mocks.createHostedRuntimeDeviceSyncService).not.toHaveBeenCalled();
  });

  it("reserves bounded pass capacity for input discovered during pre-scan refresh", async () => {
    const selectedInputIds: string[] = [];
    mocks.createHostedAssistantInputSource.mockReturnValueOnce({
      listInputCandidates: vi.fn(async (query) => ({
        inputs: [],
        nextCursor: query.afterCursor ?? null,
      })),
      listNewConversationInputs: vi.fn(async (query) => ({
        inputs: [],
        nextCursor: query.afterCursor ?? null,
      })),
      readObservedInputIds: vi.fn(() => [...selectedInputIds]),
      readSelectedInputIds: vi.fn(() => [...selectedInputIds]),
      refresh: vi.fn(async () => {
        selectedInputIds.push(
          "ain_refresh_batch_000000000000000001",
          "ain_refresh_batch_000000000000000002",
          "ain_refresh_batch_000000000000000003",
        );
        return {
          progressed: true,
          reason: "ingested_input" as const,
        };
      }),
    });
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      await input.inputSource?.refresh();
      expect(input.maxPerScan).toBe(50);
      expect(input.shouldDeferCron?.()).toBe(true);
      return {
        nextWakeAt: null,
        progressed: true,
        replies: {
          considered: 3,
          failed: 0,
          nextWakeAt: null,
          replied: 1,
          skipped: 0,
        },
      };
    });

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_background_scan_limit",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_background_scan_limit",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.runAssistantAutomationPass.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        maxPerScan: 50,
      }),
    );
    expect(result).toMatchObject({
      activeTurnInputIngested: true,
      assistantAutomationSelectedInputIds: selectedInputIds,
      nextWakeAt: "2026-04-08T00:00:00.000Z",
    });
  });

  it("processes multiple already-due cron automations in one inputless background pass", async () => {
    const dueAutomationIds = [
      "older-due-automation",
      "later-exact-time-reminder",
    ];
    const processedAutomationIds: string[] = [];
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      const limit = input.maxPerScan ?? Number.POSITIVE_INFINITY;
      processedAutomationIds.push(...dueAutomationIds.slice(0, limit));
      expect(input.shouldDeferCron?.()).toBe(false);
      return {
        cronProcessed: processedAutomationIds.length,
        nextWakeAt: processedAutomationIds.length === dueAutomationIds.length
          ? null
          : "2026-04-08T00:08:00.000Z",
        progressed: processedAutomationIds.length > 0,
      };
    });

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_multiple_due_cron",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:05:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      idleCheckpointDelayMs: 180_000,
      requestId: "req_multiple_due_cron",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.runAssistantAutomationPass.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ maxPerScan: 50 }),
    );
    expect(processedAutomationIds).toEqual(dueAutomationIds);
    expect(result.assistantAutomationCronProcessed).toBe(2);
    expect(result.nextWakeAt).toBeNull();
  });

  it("selects a background causal batch once after readiness and sizes the scan to it", async () => {
    const callOrder: string[] = [];
    const selectedInputIds = [
      "ain_background_batch_000000000000000001",
      "ain_background_batch_000000000000000002",
    ];
    mocks.readHostedAssistantRuntimeState.mockImplementationOnce(async () => {
      callOrder.push("readiness");
      return {
        assistantActiveProfileId: null,
        assistantActiveProfileManagedBy: null,
        assistantActiveProfileReady: false,
        assistantConfigInvalid: false,
        assistantConfigPresent: true,
        assistantConfigStatus: "saved",
        assistantConfigured: true,
        assistantProvider: "codex-cli",
      };
    });
    mocks.selectHostedAssistantInputIds.mockImplementationOnce(async () => {
      callOrder.push("selection");
      return {
        inputIds: selectedInputIds,
        mode: "background",
        pendingInputIds: selectedInputIds,
      };
    });
    mocks.runAssistantAutomationPass.mockImplementationOnce(async (input) => {
      callOrder.push("automation");
      expect(input.shouldDeferCron?.()).toBe(true);
      return {
        nextWakeAt: null,
        progressed: true,
      };
    });

    await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_background_causal_batch",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_background_causal_batch",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.runAssistantAutomationPass.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        maxPerScan: selectedInputIds.length,
      }),
    );
    expect(callOrder).toEqual(["readiness", "selection", "automation"]);
    expect(mocks.selectHostedAssistantInputIds).toHaveBeenCalledOnce();
  });

  it("does not synthesize a wake when assistant work progressed without a due time", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runAssistantAutomationPass.mockResolvedValueOnce({
        nextWakeAt: null,
        progressed: true,
      });

      const result = await runHostedAssistantAutomationLane({
        wake: {
          eventId: "evt_assistant_progress",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        executionContext: {
          hosted: {
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        requestId: "req_123",
        runtime: createHostedAutomationRuntime(),
        vaultRoot: "/tmp/vault-root",
      });

      expect(result).toMatchObject({
        nextWakeAt: null,
        redactedLogEntries: [
          expect.objectContaining({
            message: "Hosted assistant automation pass starting.",
          }),
          expect.objectContaining({
            message: "Hosted assistant automation pass finished.",
          }),
        ],
      });
      expect(result).not.toHaveProperty("deviceSyncProcessed");
      expect(result).not.toHaveProperty("deviceSyncSkipped");
      expect(result).not.toHaveProperty("parserProcessed");
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

      const result = await runHostedAssistantAutomationLane({
        wake: {
          eventId: "evt_assistant_backlog",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        executionContext: {
          hosted: {
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

  it("does not infer backlog when an exact foreground scan reaches its input count", async () => {
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      nextWakeAt: null,
      progressed: true,
      replies: {
        considered: 1,
        failed: 0,
        nextWakeAt: null,
        replied: 1,
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

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_exact_foreground_scan",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      freshAssistantInputIds: ["ain_exact_foreground"],
      requestId: "req_exact_foreground_scan",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(mocks.runAssistantAutomationPass.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        maxPerScan: 1,
      }),
    );
    expect(result.nextWakeAt).toBeNull();
  });

  it("keeps an aggregate reminder out of foreground input wake provenance", async () => {
    const reminderWakeAt = "2026-04-08T06:00:00.000Z";
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      cronProcessed: 0,
      nextWakeAt: reminderWakeAt,
      progressed: false,
      replies: {
        considered: 1,
        failed: 0,
        nextWakeAt: null,
        replied: 0,
        skipped: 1,
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

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_foreground_with_reminder",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      freshAssistantInputIds: ["ain_foreground_with_reminder"],
      requestId: "req_foreground_with_reminder",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toEqual(expect.objectContaining({
      assistantAutomationSelectedInputWakeAt: null,
      nextWakeAt: reminderWakeAt,
    }));
  });

  it("exposes a foreground input retry before aggregate wake ownership is lost", async () => {
    const retryWakeAt = "2026-04-08T00:00:30.000Z";
    mocks.runAssistantAutomationPass.mockResolvedValueOnce({
      cronProcessed: 0,
      nextWakeAt: retryWakeAt,
      progressed: false,
      replies: {
        considered: 1,
        failed: 0,
        nextWakeAt: retryWakeAt,
        replied: 0,
        skipped: 1,
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

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_foreground_retry",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      freshAssistantInputIds: ["ain_foreground_retry"],
      requestId: "req_foreground_retry",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toEqual(expect.objectContaining({
      assistantAutomationSelectedInputWakeAt: retryWakeAt,
      nextWakeAt: retryWakeAt,
    }));
  });

  it("schedules an immediate wake when the capped background scan saturates", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runAssistantAutomationPass.mockResolvedValueOnce({
        nextWakeAt: null,
        progressed: true,
        replies: {
          considered: 1,
          failed: 0,
          nextWakeAt: null,
          replied: 1,
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

      const result = await runHostedAssistantAutomationLane({
        wake: {
          eventId: "evt_assistant_capped_backlog",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        executionContext: {
          hosted: {
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        requestId: "req_assistant_capped_backlog",
        runtime: createHostedAutomationRuntime(),
        vaultRoot: "/tmp/vault-root",
      });

      expect(mocks.runAssistantAutomationPass.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          maxPerScan: 50,
        }),
      );
      expect(result.nextWakeAt).toBe("2026-04-08T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a deferred retry when the capped background scan saturates on the same candidate", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));
      mocks.runAssistantAutomationPass.mockResolvedValueOnce({
        nextWakeAt: "2026-04-08T00:00:30.000Z",
        progressed: false,
        replies: {
          considered: 1,
          failed: 0,
          nextWakeAt: "2026-04-08T00:00:30.000Z",
          replied: 0,
          skipped: 1,
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

      const result = await runHostedAssistantAutomationLane({
        wake: {
          eventId: "evt_assistant_capped_retry",
          kind: "runtime.timer",
          occurredAt: "2026-04-08T00:00:00.000Z",
          triggerKind: "runtime_timer",
          userId: "member_123",
        },
        executionContext: {
          hosted: {
            memberId: "member_123",
            userEnvKeys: [],
          },
        },
        requestId: "req_assistant_capped_retry",
        runtime: createHostedAutomationRuntime(),
        vaultRoot: "/tmp/vault-root",
      });

      expect(result.nextWakeAt).toBe("2026-04-08T00:00:30.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips assistant automation without warning when the caller explicitly disables it", async () => {
    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_skip_requested",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime(),
      skipAssistantAutomation: true,
      vaultRoot: "/tmp/vault-root",
    });

    assert.deepEqual({ nextWakeAt: result.nextWakeAt }, { nextWakeAt: null });
    expect(result).not.toHaveProperty("deviceSyncProcessed");
    expect(result).not.toHaveProperty("deviceSyncSkipped");
    expect(result).not.toHaveProperty("parserProcessed");
    expect(result).not.toHaveProperty("postCheckpointRecord");
    assert.equal(typeof result.totalElapsedMs, "number");
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
    expect(mocks.selectHostedAssistantInputIds).not.toHaveBeenCalled();
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
  });

  it("does not expose device-sync metrics from the assistant automation lane", async () => {
    const service = {
      close: vi.fn(),
      drainWorker: vi.fn(async () => 1),
      getNextWakeAt: () => "2026-04-08T00:30:00.000Z",
      runSchedulerOnce: vi.fn(async () => undefined),
    };
    mocks.createHostedRuntimeDeviceSyncService.mockReturnValue(service);

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_skip_device_sync",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime({
        deviceSync: DEVICE_SYNC_CONFIG,
      }),
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).not.toHaveProperty("deviceSyncProcessed");
    expect(result).not.toHaveProperty("deviceSyncSkipped");
    expect(service.runSchedulerOnce).not.toHaveBeenCalled();
    expect(service.drainWorker).not.toHaveBeenCalled();
  });

  it("logs skipped automation when the hosted assistant is not configured", async () => {
    mocks.readHostedAssistantRuntimeState.mockResolvedValue({
      assistantConfigStatus: "missing",
      assistantConfigured: false,
      assistantProvider: null,
    });

    const result = await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_skip_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
          memberId: "member_123",
          userEnvKeys: [],
        },
      },
      requestId: "req_123",
      runtime: createHostedAutomationRuntime(),
      vaultRoot: "/tmp/vault-root",
    });

    expect(result).toMatchObject({
      nextWakeAt: null,
      redactedLogEntries: [
        expect.objectContaining({
          message:
            "Hosted assistant automation skipped because no explicit hosted assistant profile is configured.",
        }),
      ],
    });
    expect(mocks.runAssistantAutomationPass).not.toHaveBeenCalled();
    expect(mocks.selectHostedAssistantInputIds).not.toHaveBeenCalled();
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

    await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_invalid_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
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

    await runHostedAssistantAutomationLane({
      wake: {
        eventId: "evt_unready_automation",
        kind: "runtime.timer",
        occurredAt: "2026-04-08T00:00:00.000Z",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      executionContext: {
        hosted: {
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
