import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  patched,
  proxyActivities,
  setHandler,
  uuid4,
  workflowInfo,
} from "@temporalio/workflow";

import type * as activities from "../activities/index.js";
import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  HOSTED_USER_RUNTIME_PREWARM_TASK_QUEUE,
  HOSTED_RUNTIME_PREWARM_SOURCE,
  type HostedRuntimeDemand,
  type HostedRuntimeDemandRequest,
  type HostedRuntimeCurrentWaitReason,
  type HostedRuntimeEnsureProcessingResponse,
  type HostedRuntimePrewarmResponse,
  type HostedRuntimePrewarmSource,
  type HostedRuntimeSignal,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedUserRuntimeWorkflowCarryForwardState,
  HostedUserRuntimeWorkflowInput,
  HostedUserRuntimeWorkflowOptions,
} from "../workflow-types.js";

export const HOSTED_USER_RUNTIME_DEFAULT_CONTINUE_AS_NEW_ITERATION_THRESHOLD = 500;
export const HOSTED_USER_RUNTIME_DEFAULT_CONTINUE_AS_NEW_HISTORY_LENGTH = 750;
export const HOSTED_USER_RUNTIME_DEFAULT_DEMAND_FAILURE_RETRY_DELAY_MS = 30_000;
export const HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS = 30_000;
export const HOSTED_USER_RUNTIME_DEFAULT_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS = 15_000;
// Workflow command timeout is replay-sensitive. Keep it pinned with response
// slack over the shared 5s prewarm HTTP/container budget unless versioned.
export const HOSTED_USER_RUNTIME_DEFAULT_PREWARM_START_TO_CLOSE_TIMEOUT_MS = 6_000;
export const HOSTED_USER_RUNTIME_DEFAULT_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS = 10_000;
export const HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_HISTORY_LENGTH = 10_000;
export const HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_ITERATION_THRESHOLD = 10_000;
export const HOSTED_USER_RUNTIME_MAX_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS = 3_600_000;
export const HOSTED_USER_RUNTIME_MAX_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS = 30_000;
export const HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS = 1_000;
const HOSTED_USER_RUNTIME_NON_RETRYABLE_FAILURE_SIGNAL_WAIT_PATCH =
  "hosted-user-runtime-non-retryable-failure-signal-wait-v1";
const HOSTED_USER_RUNTIME_ENSURE_PROCESSING_PATCH =
  "hosted-user-runtime-ensure-runtime-processing-v1";
const HOSTED_USER_RUNTIME_SAME_RUNTIME_WAKE_COUNT_PATCH =
  "hosted-user-runtime-same-runtime-wake-count-v1";
const HOSTED_USER_RUNTIME_RECHECK_SIGNAL_PATCH =
  "hosted-user-runtime-recheck-signal-v1";
const HOSTED_USER_RUNTIME_PREWARM_SIGNAL_PATCH =
  "hosted-user-runtime-prewarm-signal-v1";
const HOSTED_USER_RUNTIME_PREWARM_DEDICATED_TASK_QUEUE_PATCH =
  "hosted-user-runtime-prewarm-dedicated-task-queue-v1";
const HOSTED_USER_RUNTIME_COALESCED_PENDING_SIGNAL_PATCH =
  "hosted-user-runtime-coalesced-pending-signal-v1";
const HOSTED_USER_RUNTIME_ENSURE_PROCESSING_SOURCE_PATCH =
  "hosted-user-runtime-ensure-processing-source-v1";
const HOSTED_USER_RUNTIME_DROP_DEVICE_SYNC_RECOVERY_PATCH =
  "hosted-user-runtime-drop-device-sync-recovery-v1";
const HOSTED_USER_RUNTIME_HISTORY_LENGTH_CONTINUE_AS_NEW_PATCH =
  "hosted-user-runtime-history-length-continue-as-new-v1";
const HOSTED_USER_RUNTIME_UNREAD_DEMAND_BEFORE_CONTINUE_AS_NEW_PATCH =
  "hosted-user-runtime-unread-demand-before-continue-as-new-v1";
const LEGACY_DEVICE_SYNC_RECOVERY_SOURCE = "device_sync_recovery";
const HOSTED_USER_RUNTIME_DEVICE_SYNC_RECOVERY_WAKE_ACCEPTED_LIMIT = 3;

type HostedUserRuntimeSignal =
  | HostedRuntimeSignal
  | {
      kind: "device_sync_recovery_requested";
    };

export const runtimeSignal = defineSignal<[HostedUserRuntimeSignal]>(
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
);

export const runtimeWorkflowStatus =
  defineQuery<HostedRuntimeWorkflowState>(
    HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  );

export async function hostedUserRuntimeWorkflow(
  input: HostedUserRuntimeWorkflowInput,
): Promise<void> {
  const options = normalizeHostedUserRuntimeWorkflowOptions(input.options);
  const demandActivities = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "2 seconds",
      maximumAttempts: 6,
      maximumInterval: "1 minute",
    },
    startToCloseTimeout: options.readRuntimeDemandStartToCloseTimeoutMs,
  });
  const processingActivities = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "2 seconds",
      maximumAttempts: 6,
      maximumInterval: "1 minute",
    },
    startToCloseTimeout: options.ensureRuntimeProcessingStartToCloseTimeoutMs,
  });
  const sharedQueuePrewarmActivities = proxyActivities<typeof activities>({
    cancellationType: ActivityCancellationType.ABANDON,
    retry: {
      initialInterval: "1 second",
      maximumAttempts: 1,
      maximumInterval: "5 seconds",
    },
    startToCloseTimeout: HOSTED_USER_RUNTIME_DEFAULT_PREWARM_START_TO_CLOSE_TIMEOUT_MS,
  });
  const dedicatedQueuePrewarmActivities = proxyActivities<typeof activities>({
    cancellationType: ActivityCancellationType.ABANDON,
    retry: {
      initialInterval: "1 second",
      maximumAttempts: 2,
      maximumInterval: "5 seconds",
    },
    startToCloseTimeout: Math.min(
      options.ensureRuntimeProcessingStartToCloseTimeoutMs,
      HOSTED_USER_RUNTIME_DEFAULT_PREWARM_START_TO_CLOSE_TIMEOUT_MS,
    ),
    scheduleToStartTimeout: "2 seconds",
    taskQueue: options.prewarmTaskQueue,
  });
  const machine = createHostedUserRuntimeWorkflowMachine(input, {
    continueAsNew: async (nextInput) => continueAsNew<typeof hostedUserRuntimeWorkflow>(
      nextInput,
    ),
    continueAsNewSuggested: () => workflowInfo().continueAsNewSuggested,
    currentHistoryLength: () => workflowInfo().historyLength,
    ensureRuntimeProcessing: processingActivities.ensureRuntimeProcessing,
    nowMs: () => Date.now(),
    readRuntimeDemand: demandActivities.readRuntimeDemand,
    startRuntimePrewarm: (prewarmInput) => {
      const scope = new CancellationScope();
      return {
        cancel: () => scope.cancel(),
        result: scope.run(() =>
          patched(HOSTED_USER_RUNTIME_PREWARM_DEDICATED_TASK_QUEUE_PATCH)
            ? dedicatedQueuePrewarmActivities.prewarmRuntimeContainer(prewarmInput)
            : sharedQueuePrewarmActivities.prewarmRuntimeContainer(prewarmInput)
        ),
      };
    },
    startSignalWait: (predicate, timeoutMs) => {
      const scope = new CancellationScope();
      return {
        cancel: () => scope.cancel(),
        result: scope.run(async () => {
          if (timeoutMs === null) {
            await condition(predicate);
            return;
          }
          await condition(predicate, timeoutMs);
        }),
      };
    },
    useEnsureRuntimeProcessingPatch: () =>
      patched(HOSTED_USER_RUNTIME_ENSURE_PROCESSING_PATCH),
    preserveSameRuntimeWakeAcceptedCountPatchMarker: () =>
      patched(HOSTED_USER_RUNTIME_SAME_RUNTIME_WAKE_COUNT_PATCH),
    useRuntimePrewarmSignalPatch: () =>
      patched(HOSTED_USER_RUNTIME_PREWARM_SIGNAL_PATCH),
    useRuntimeRecheckSignalPatch: () =>
      patched(HOSTED_USER_RUNTIME_RECHECK_SIGNAL_PATCH),
    useCoalescedPendingSignalPatch: () =>
      patched(HOSTED_USER_RUNTIME_COALESCED_PENDING_SIGNAL_PATCH),
    useEnsureRuntimeProcessingSourcePatch: () =>
      patched(HOSTED_USER_RUNTIME_ENSURE_PROCESSING_SOURCE_PATCH),
    useDeviceSyncRecoveryDeletionPatch: () =>
      patched(HOSTED_USER_RUNTIME_DROP_DEVICE_SYNC_RECOVERY_PATCH),
    useHistoryLengthContinueAsNewPatch: () =>
      patched(HOSTED_USER_RUNTIME_HISTORY_LENGTH_CONTINUE_AS_NEW_PATCH),
    useUnreadDemandBeforeContinueAsNewPatch: () =>
      patched(HOSTED_USER_RUNTIME_UNREAD_DEMAND_BEFORE_CONTINUE_AS_NEW_PATCH),
    useSignalOnlyWaitForNonRetryableFailure: () =>
      patched(HOSTED_USER_RUNTIME_NON_RETRYABLE_FAILURE_SIGNAL_WAIT_PATCH),
    uuid: uuid4,
    waitForSignalOrTimeout: async (predicate, timeoutMs) => {
      if (timeoutMs === null) {
        await condition(predicate);
        return;
      }
      await condition(predicate, timeoutMs);
    },
  });

  setHandler(runtimeSignal, machine.applySignal);
  setHandler(runtimeWorkflowStatus, machine.readStatus);

  await machine.run();
}

export interface HostedUserRuntimeWorkflowRuntime {
  continueAsNew(input: HostedUserRuntimeWorkflowInput): Promise<never>;
  continueAsNewSuggested(): boolean;
  currentHistoryLength(): number;
  ensureRuntimeProcessing(input: {
    orchestrationAttemptId: string;
    reason: HostedRuntimeRunDemand["reason"];
    source?: LegacyHostedRuntimeDemandRunSource | null;
    userId: string;
  }): Promise<HostedRuntimeEnsureProcessingResponse>;
  nowMs(): number;
  readRuntimeDemand(request: HostedRuntimeDemandRequest): Promise<HostedUserRuntimeDemand>;
  startRuntimePrewarm(input: {
    prewarmAttemptId: string;
    source: HostedRuntimePrewarmSource;
    userId: string;
  }): HostedUserRuntimePrewarmHandle;
  startSignalWait(
    predicate: () => boolean,
    timeoutMs: number | null,
  ): HostedUserRuntimeSignalWaitHandle;
  useEnsureRuntimeProcessingPatch(): void;
  useRuntimePrewarmSignalPatch(): boolean;
  useRuntimeRecheckSignalPatch(): boolean;
  useCoalescedPendingSignalPatch(): boolean;
  useEnsureRuntimeProcessingSourcePatch(): boolean;
  preserveSameRuntimeWakeAcceptedCountPatchMarker(): boolean;
  useDeviceSyncRecoveryDeletionPatch(): boolean;
  useHistoryLengthContinueAsNewPatch(): boolean;
  useUnreadDemandBeforeContinueAsNewPatch(): boolean;
  useSignalOnlyWaitForNonRetryableFailure(): boolean;
  uuid(): string;
  waitForSignalOrTimeout(
    predicate: () => boolean,
    timeoutMs: number | null,
  ): Promise<void>;
}

type HostedRuntimeRunDemand = Extract<HostedRuntimeDemand, { kind: "run" }>;
type LegacyHostedRuntimeDemandRunSource =
  | HostedRuntimeRunDemand["source"]
  | typeof LEGACY_DEVICE_SYNC_RECOVERY_SOURCE;
type LegacyHostedRuntimeRunDemand = Omit<HostedRuntimeRunDemand, "source"> & {
  source: typeof LEGACY_DEVICE_SYNC_RECOVERY_SOURCE;
};
type HostedUserRuntimeDemand = HostedRuntimeDemand | LegacyHostedRuntimeRunDemand;
type LegacyHostedRuntimeDemandRequest = HostedRuntimeDemandRequest & {
  deviceSyncRecoveryRequested?: boolean;
};
type LegacyHostedUserRuntimeWorkflowCarryForwardState =
  HostedUserRuntimeWorkflowCarryForwardState & {
    deviceSyncRecoveryRequested?: boolean;
    sameRuntimeWakeAcceptedCount?: number;
  };
type HostedRuntimeMailboxSignal = Extract<
  HostedRuntimeSignal,
  { kind: "mailbox_appended" }
>;

export interface HostedUserRuntimePrewarmHandle {
  cancel(): void;
  result: Promise<HostedRuntimePrewarmResponse>;
}

export interface HostedUserRuntimeSignalWaitHandle {
  cancel(): void;
  result: Promise<void>;
}

export interface HostedUserRuntimeWorkflowMachine {
  applySignal(signal: unknown): void;
  readStatus(): HostedRuntimeWorkflowState;
  run(): Promise<void>;
}

interface NormalizedWorkflowOptions {
  continueAsNewAfterHistoryEvents: number;
  continueAsNewAfterIterations: number;
  ensureRuntimeProcessingStartToCloseTimeoutMs: number;
  prewarmTaskQueue: string;
  readRuntimeDemandStartToCloseTimeoutMs: number;
}

export function createHostedUserRuntimeWorkflowMachine(
  input: HostedUserRuntimeWorkflowInput,
  runtime: HostedUserRuntimeWorkflowRuntime,
): HostedUserRuntimeWorkflowMachine {
  const options = normalizeHostedUserRuntimeWorkflowOptions(input.options);
  const continueAsNewOptions = normalizeContinueAsNewOptions(input.options);
  const state = createInitialWorkflowState(input.userId, input.state);
  let legacyDeviceSyncRecoveryRequested =
    readLegacyBooleanProperty(input.state, "deviceSyncRecoveryRequested");
  let legacySameRuntimeWakeAcceptedCount =
    readLegacyNonNegativeIntegerProperty(input.state, "sameRuntimeWakeAcceptedCount");
  let completedIterations = 0;
  let demandSignalVersion = 0;
  let lastDemandSignalVersionRead =
    hasPendingCurrentRuntimeDemand(state) ? -1 : demandSignalVersion;

  const readStatus = (): HostedRuntimeWorkflowState => ({ ...state });

  const wakeSignalOnlyWaitForCoalescedDemandSignal = (): void => {
    if (state.currentWaitReason !== "non_retryable_signal_only") {
      return;
    }
    state.signalVersion += 1;
    demandSignalVersion += 1;
  };

  const applySignal = (rawSignal: unknown): void => {
    let signal: HostedUserRuntimeSignal;
    try {
      signal = parseHostedRuntimeSignal(rawSignal);
    } catch (error) {
      recordInvalidSignal(state, readExecutionErrorCode(error));
      return;
    }

    if (signal.kind === "runtime_recheck_requested") {
      if (!runtime.useRuntimeRecheckSignalPatch()) {
        recordInvalidSignal(state, "TypeError");
        return;
      }
      state.signalVersion += 1;
      return;
    }

    if (signal.kind === "runtime_prewarm_requested") {
      if (!runtime.useRuntimePrewarmSignalPatch()) {
        recordInvalidSignal(state, "TypeError");
        return;
      }
      state.signalVersion += 1;
      state.prewarmRequested = true;
      state.prewarmSignalCount += 1;
      state.latestPrewarmRequestedAt = signal.occurredAt;
      state.lastPrewarmErrorCode = null;
      return;
    }

    switch (signal.kind) {
      case "mailbox_appended": {
        state.signalVersion += 1;
        demandSignalVersion += 1;
        state.mailboxSignalCount += 1;
        state.latestMailboxPointer = {
          lane: signal.lane,
          laneSeq: signal.laneSeq,
          mailboxItemId: signal.mailboxItemId,
          source: signal.source,
        };
        break;
      }
      case "manual_run_requested": {
        state.signalVersion += 1;
        demandSignalVersion += 1;
        state.manualRunRequested = true;
        break;
      }
      case "browser_vault_refresh_requested": {
        if (
          runtime.useCoalescedPendingSignalPatch() &&
          state.browserVaultRefreshRequested
        ) {
          wakeSignalOnlyWaitForCoalescedDemandSignal();
          break;
        }
        state.signalVersion += 1;
        demandSignalVersion += 1;
        state.browserVaultRefreshRequested = true;
        break;
      }
      case "device_sync_recovery_requested": {
        if (runtime.useDeviceSyncRecoveryDeletionPatch()) {
          state.signalVersion += 1;
          demandSignalVersion += 1;
          break;
        }
        if (
          runtime.useCoalescedPendingSignalPatch()
          && legacyDeviceSyncRecoveryRequested
        ) {
          wakeSignalOnlyWaitForCoalescedDemandSignal();
          break;
        }
        state.signalVersion += 1;
        demandSignalVersion += 1;
        legacyDeviceSyncRecoveryRequested = true;
        break;
      }
      case "mailbox_lag_observed": {
        if (
          runtime.useCoalescedPendingSignalPatch() &&
          state.lagRecoveryObserved
        ) {
          wakeSignalOnlyWaitForCoalescedDemandSignal();
          break;
        }
        state.signalVersion += 1;
        demandSignalVersion += 1;
        state.lagRecoveryObserved = true;
        break;
      }
      default: {
        const exhaustive: never = signal;
        throw new Error(`Unsupported hosted runtime signal ${String(exhaustive)}`);
      }
    }
  };

  const run = async (): Promise<void> => {
    for (;;) {
      if (shouldContinueAsNewBeforeDemand({
        completedIterations,
        hasUnreadDemandSignal:
          demandSignalVersion !== lastDemandSignalVersionRead,
        options,
        runtime,
      })) {
        const deviceSyncRecoveryDeleted =
          runtime.useDeviceSyncRecoveryDeletionPatch();
        await runtime.continueAsNew({
          options: continueAsNewOptions,
          state: readCarryForwardState(
            state,
            deviceSyncRecoveryDeleted
              ? null
              : {
                  deviceSyncRecoveryRequested: legacyDeviceSyncRecoveryRequested,
                  sameRuntimeWakeAcceptedCount: legacySameRuntimeWakeAcceptedCount,
                },
          ),
          userId: input.userId,
        });
      }

      completedIterations += 1;
      const versionBeforeDemand = state.signalVersion;
      let demand: HostedUserRuntimeDemand;
      try {
        const deviceSyncRecoveryDeleted =
          runtime.useDeviceSyncRecoveryDeletionPatch();
        demand = await runtime.readRuntimeDemand({
          browserVaultRefreshRequested: state.browserVaultRefreshRequested,
          ...(!deviceSyncRecoveryDeleted && legacyDeviceSyncRecoveryRequested
            ? { deviceSyncRecoveryRequested: true }
            : {}),
          lagRecoveryObserved: state.lagRecoveryObserved,
          manualRunRequested: state.manualRunRequested,
          userId: input.userId,
        } satisfies LegacyHostedRuntimeDemandRequest);
      } catch (error) {
        state.lastDemandKind = null;
        state.lastDemandNextWakeAt = null;
        state.lastDemandSource = "demand_read_failed";
        state.lastExecutionErrorCode = readExecutionErrorCode(error);
        if (state.signalVersion !== versionBeforeDemand) {
          continue;
        }
        lastDemandSignalVersionRead = demandSignalVersion;
        const retryAt = readActivityFailureRetryAt({
          error,
          retryDelayMs: HOSTED_USER_RUNTIME_DEFAULT_DEMAND_FAILURE_RETRY_DELAY_MS,
          runtime,
        });
        await waitUntilTimestampOrSignal(
          runtime,
          retryAt,
          state.signalVersion,
          state,
          retryAt === null ? "non_retryable_signal_only" : "demand_failure_retry",
        );
        continue;
      }

      if (state.signalVersion !== versionBeforeDemand) {
        continue;
      }
      lastDemandSignalVersionRead = demandSignalVersion;

      recordDemandSummary(state, demand);

      if (demand.kind === "blocked") {
        clearPendingRuntimePrewarm(state);
        await waitUntilTimestampOrSignal(
          runtime,
          demand.retryAt,
          versionBeforeDemand,
          state,
          "blocked_retry",
        );
        continue;
      }

      if (demand.kind === "idle") {
        if (state.prewarmRequested) {
          const demandVersionBeforePrewarm = demandSignalVersion;
          await runRuntimePrewarmUntilDemandSignal({
            demandSignalVersionBeforePrewarm: demandVersionBeforePrewarm,
            getDemandSignalVersion: () => demandSignalVersion,
            workflowInput: input,
            runtime,
            state,
          });
          if (demandSignalVersion !== demandVersionBeforePrewarm) {
            continue;
          }
          if (state.signalVersion !== versionBeforeDemand) {
            continue;
          }
        }
        if (clearSatisfiedFlags(state, versionBeforeDemand)) {
          legacyDeviceSyncRecoveryRequested = false;
        }
        await waitUntilTimestampOrSignal(
          runtime,
          demand.nextWakeAt,
          state.signalVersion,
          state,
          "idle_next_wake",
        );
        continue;
      }

      const versionBeforeExecution = state.signalVersion;
      const demandVersionBeforeExecution = demandSignalVersion;
      let execution: HostedRuntimeEnsureProcessingResponse;
      const orchestrationAttemptId = runtime.uuid();
      state.lastOrchestrationAttemptId = orchestrationAttemptId;
      clearPendingRuntimePrewarm(state);
      try {
        runtime.useEnsureRuntimeProcessingPatch();
        const forwardDemandSource =
          runtime.useEnsureRuntimeProcessingSourcePatch()
          || isLegacyDeviceSyncRecoverySource(demand.source);
        execution = await runtime.ensureRuntimeProcessing({
          orchestrationAttemptId,
          reason: demand.reason,
          ...(forwardDemandSource ? { source: demand.source } : {}),
          userId: input.userId,
        });
      } catch (error) {
        state.lastExecutionAt = isoNow(runtime);
        state.lastExecutionErrorCode = readExecutionErrorCode(error);
        state.lastExecutionKind = "failed";
        state.lastRuntimeAttemptId = null;
        state.lastRuntimeStatus = null;
        legacySameRuntimeWakeAcceptedCount = 0;
        if (demandSignalVersion !== demandVersionBeforeExecution) {
          continue;
        }
        const retryAt = readActivityFailureRetryAt({
          error,
          retryDelayMs: HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS,
          runtime,
        });
        await waitUntilTimestampOrSignal(
          runtime,
          retryAt,
          state.signalVersion,
          state,
          retryAt === null ? "non_retryable_signal_only" : "execution_failure_retry",
        );
        continue;
      }

      state.lastExecutionAt = isoNow(runtime);
      state.lastExecutionErrorCode = null;
      state.lastExecutionKind = execution.kind;
      const signalArrivedDuringExecution =
        state.signalVersion !== versionBeforeExecution;
      const demandSignalArrivedDuringExecution =
        demandSignalVersion !== demandVersionBeforeExecution;

      if (execution.kind === "runtime_processing_accepted") {
        // Keep this marker for histories that recorded the removed recovery-count patch.
        const sameRuntimeWakeCountPatchEnabled =
          runtime.preserveSameRuntimeWakeAcceptedCountPatchMarker();
        legacySameRuntimeWakeAcceptedCount = recordLegacyRuntimeWakeAcceptedCount({
          currentCount: legacySameRuntimeWakeAcceptedCount,
          execution,
          lastRuntimeAttemptId: state.lastRuntimeAttemptId,
          patchEnabled: sameRuntimeWakeCountPatchEnabled,
        });
        recordRuntimeProcessingAccepted(state, execution);
        if (demandSignalArrivedDuringExecution) {
          continue;
        }
        clearConsumedFlagsAfterRun(state, demand.source);
        legacyDeviceSyncRecoveryRequested = clearLegacyDeviceSyncRecoveryAfterRun({
          currentRequested: legacyDeviceSyncRecoveryRequested,
          execution,
          source: demand.source,
          wakeCount: legacySameRuntimeWakeAcceptedCount,
          wakeLimitEnabled: sameRuntimeWakeCountPatchEnabled,
        });
        if (signalArrivedDuringExecution) {
          continue;
        }
        const versionBeforeWakeWait = state.signalVersion;
        await waitUntilTimestampOrSignal(
          runtime,
          execution.recommendedRecheckAt,
          versionBeforeWakeWait,
          state,
          "runtime_wake_recheck",
        );
        continue;
      }

      if (execution.kind === "retry_later") {
        state.lastRuntimeAttemptId = null;
        state.lastRuntimeStatus = "retry_later";
        legacySameRuntimeWakeAcceptedCount = 0;
        if (demandSignalArrivedDuringExecution) {
          continue;
        }
        await waitUntilTimestampOrSignal(
          runtime,
          execution.retryAt,
          state.signalVersion,
          state,
          "processing_retry_later",
        );
        continue;
      }

    }
  };

  return {
    applySignal,
    readStatus,
    run,
  };
}

async function runRuntimePrewarmUntilDemandSignal(input: {
  demandSignalVersionBeforePrewarm: number;
  getDemandSignalVersion(): number;
  runtime: HostedUserRuntimeWorkflowRuntime;
  state: HostedRuntimeWorkflowState;
  workflowInput: HostedUserRuntimeWorkflowInput;
}): Promise<void> {
  const prewarmAttemptId = input.runtime.uuid();
  input.state.lastPrewarmAttemptId = prewarmAttemptId;
  const prewarmHandle = input.runtime.startRuntimePrewarm({
    prewarmAttemptId,
    source: HOSTED_RUNTIME_PREWARM_SOURCE,
    userId: input.workflowInput.userId,
  });
  const demandSignalWait = input.runtime.startSignalWait(
    () =>
      input.getDemandSignalVersion()
        !== input.demandSignalVersionBeforePrewarm,
    null,
  );

  const outcome = await Promise.race([
    prewarmHandle.result.then(
      (result) => ({ kind: "completed" as const, result }),
      (error: unknown) => ({ error, kind: "failed" as const }),
    ),
    demandSignalWait.result.then(
      () => ({ kind: "demand_signal" as const }),
      (error: unknown) => ({ error, kind: "wait_failed" as const }),
    ),
  ]);

  input.state.prewarmRequested = false;

  if (outcome.kind === "demand_signal") {
    prewarmHandle.cancel();
    input.state.lastPrewarmResult = null;
    input.state.lastPrewarmErrorCode = "abandoned_for_demand";
    return;
  }

  demandSignalWait.cancel();

  if (outcome.kind === "wait_failed") {
    input.state.lastPrewarmResult = "failed";
    input.state.lastPrewarmErrorCode = readExecutionErrorCode(outcome.error);
    return;
  }

  if (outcome.kind === "failed") {
    input.state.lastPrewarmResult = "failed";
    input.state.lastPrewarmErrorCode = readExecutionErrorCode(outcome.error);
    return;
  }

  input.state.lastPrewarmErrorCode = null;
  input.state.lastPrewarmResult =
    outcome.result.kind === "runtime_prewarm_accepted"
      ? "accepted"
      : "retry_later";
}

function recordInvalidSignal(
  state: HostedRuntimeWorkflowState,
  errorCode: string,
): void {
  state.invalidSignalCount += 1;
  state.lastInvalidSignalErrorCode = errorCode;
}

function recordRuntimeProcessingAccepted(
  state: HostedRuntimeWorkflowState,
  execution: Extract<
    HostedRuntimeEnsureProcessingResponse,
    { kind: "runtime_processing_accepted" }
  >,
): void {
  state.lastRuntimeAttemptId = execution.runtimeAttemptId;
  state.lastRuntimeStatus = "scheduled";
}

function recordLegacyRuntimeWakeAcceptedCount(input: {
  currentCount: number;
  execution: Extract<
    HostedRuntimeEnsureProcessingResponse,
    { kind: "runtime_processing_accepted" }
  >;
  lastRuntimeAttemptId: string | null;
  patchEnabled: boolean;
}): number {
  const wakeAccepted = isRuntimeWakeAcceptedAction(input.execution.action);
  const sameRuntimeWake =
    input.lastRuntimeAttemptId === input.execution.runtimeAttemptId
    && wakeAccepted;

  if (!wakeAccepted) {
    return 0;
  }

  if (sameRuntimeWake) {
    return input.currentCount + 1;
  }

  return input.patchEnabled ? 1 : 0;
}

function clearLegacyDeviceSyncRecoveryAfterRun(input: {
  currentRequested: boolean;
  execution: Extract<
    HostedRuntimeEnsureProcessingResponse,
    { kind: "runtime_processing_accepted" }
  >;
  source: string;
  wakeCount: number;
  wakeLimitEnabled: boolean;
}): boolean {
  if (!input.currentRequested || !isLegacyDeviceSyncRecoverySource(input.source)) {
    return input.currentRequested;
  }

  if (!isRuntimeWakeAcceptedAction(input.execution.action)) {
    return false;
  }

  if (!input.wakeLimitEnabled) {
    return true;
  }

  return input.wakeCount
    < HOSTED_USER_RUNTIME_DEVICE_SYNC_RECOVERY_WAKE_ACCEPTED_LIMIT;
}

function isRuntimeWakeAcceptedAction(
  action: Extract<
    HostedRuntimeEnsureProcessingResponse,
    { kind: "runtime_processing_accepted" }
  >["action"],
): boolean {
  return action === "woken" || action === "already_running";
}

function createInitialWorkflowState(
  userId: string,
  carryForward: HostedUserRuntimeWorkflowCarryForwardState | undefined,
): HostedRuntimeWorkflowState {
  return {
    browserVaultRefreshRequested:
      carryForward?.browserVaultRefreshRequested ?? false,
    currentWaitReason: null,
    currentWaitUntil: null,
    invalidSignalCount: carryForward?.invalidSignalCount ?? 0,
    lagRecoveryObserved: carryForward?.lagRecoveryObserved ?? false,
    lastOrchestrationAttemptId: carryForward?.lastOrchestrationAttemptId ?? null,
    lastInvalidSignalErrorCode: carryForward?.lastInvalidSignalErrorCode ?? null,
    lastDemandKind: carryForward?.lastDemandKind ?? null,
    lastDemandNextWakeAt: carryForward?.lastDemandNextWakeAt ?? null,
    lastDemandSource: carryForward?.lastDemandSource ?? null,
    lastExecutionAt: carryForward?.lastExecutionAt ?? null,
    lastExecutionErrorCode: carryForward?.lastExecutionErrorCode ?? null,
    lastExecutionKind: carryForward?.lastExecutionKind ?? null,
    lastMailboxLagLaneCount: carryForward?.lastMailboxLagLaneCount ?? 0,
    lastRuntimeAttemptId: carryForward?.lastRuntimeAttemptId ?? null,
    lastRuntimeStatus: carryForward?.lastRuntimeStatus ?? null,
    latestMailboxPointer: carryForward?.latestMailboxPointer ?? null,
    latestPrewarmRequestedAt: carryForward?.latestPrewarmRequestedAt ?? null,
    mailboxSignalCount: carryForward?.mailboxSignalCount ?? 0,
    manualRunRequested: carryForward?.manualRunRequested ?? false,
    lastPrewarmAttemptId: carryForward?.lastPrewarmAttemptId ?? null,
    lastPrewarmErrorCode: carryForward?.lastPrewarmErrorCode ?? null,
    lastPrewarmResult: carryForward?.lastPrewarmResult ?? null,
    prewarmRequested: carryForward?.prewarmRequested ?? false,
    prewarmSignalCount: carryForward?.prewarmSignalCount ?? 0,
    signalVersion: carryForward?.signalVersion ?? 0,
    userId,
  };
}

function clearPendingRuntimePrewarm(state: HostedRuntimeWorkflowState): void {
  state.prewarmRequested = false;
}

function shouldContinueAsNewBeforeDemand(input: {
  completedIterations: number;
  hasUnreadDemandSignal: boolean;
  options: NormalizedWorkflowOptions;
  runtime: HostedUserRuntimeWorkflowRuntime;
}): boolean {
  if (input.runtime.continueAsNewSuggested()) {
    return true;
  }

  const iterationThresholdReached =
    input.completedIterations >= input.options.continueAsNewAfterIterations;
  const historyThresholdReached =
    input.runtime.useHistoryLengthContinueAsNewPatch()
    && input.runtime.currentHistoryLength()
      >= input.options.continueAsNewAfterHistoryEvents;

  if (!iterationThresholdReached && !historyThresholdReached) {
    return false;
  }

  return !(
    input.hasUnreadDemandSignal
    && input.runtime.useUnreadDemandBeforeContinueAsNewPatch()
  );
}

function hasPendingCurrentRuntimeDemand(
  state: HostedRuntimeWorkflowState,
): boolean {
  return state.browserVaultRefreshRequested
    || state.lagRecoveryObserved
    || state.latestMailboxPointer !== null
    || state.manualRunRequested
    || state.prewarmRequested;
}

export function normalizeHostedUserRuntimeWorkflowOptions(
  options: HostedUserRuntimeWorkflowOptions | undefined,
): NormalizedWorkflowOptions {
  return {
    continueAsNewAfterHistoryEvents: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_CONTINUE_AS_NEW_HISTORY_LENGTH,
      max: HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_HISTORY_LENGTH,
      min: 1,
      value: options?.continueAsNewAfterHistoryEvents,
    }),
    continueAsNewAfterIterations: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_CONTINUE_AS_NEW_ITERATION_THRESHOLD,
      max: HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_ITERATION_THRESHOLD,
      min: 1,
      value: options?.continueAsNewAfterIterations,
    }),
    ensureRuntimeProcessingStartToCloseTimeoutMs: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS,
      max: HOSTED_USER_RUNTIME_MAX_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS,
      min: HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      value: options?.ensureRuntimeProcessingStartToCloseTimeoutMs,
    }),
    prewarmTaskQueue: normalizeTaskQueueOption(
      options?.prewarmTaskQueue,
      HOSTED_USER_RUNTIME_PREWARM_TASK_QUEUE,
    ),
    readRuntimeDemandStartToCloseTimeoutMs: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS,
      max: HOSTED_USER_RUNTIME_MAX_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS,
      min: HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      value: options?.readRuntimeDemandStartToCloseTimeoutMs,
    }),
  };
}

function normalizeContinueAsNewOptions(
  options: HostedUserRuntimeWorkflowOptions | undefined,
): HostedUserRuntimeWorkflowOptions {
  const normalized = normalizeHostedUserRuntimeWorkflowOptions(options);
  const ensureRuntimeProcessingStartToCloseTimeoutMs = normalizePositiveIntegerOption({
    fallback: HOSTED_USER_RUNTIME_DEFAULT_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS,
    max: HOSTED_USER_RUNTIME_MAX_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS,
    min: HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
    value: options?.ensureRuntimeProcessingStartToCloseTimeoutMs,
  });
  return {
    continueAsNewAfterHistoryEvents:
      normalized.continueAsNewAfterHistoryEvents,
    continueAsNewAfterIterations: normalized.continueAsNewAfterIterations,
    ensureRuntimeProcessingStartToCloseTimeoutMs,
    prewarmTaskQueue: normalized.prewarmTaskQueue,
    readRuntimeDemandStartToCloseTimeoutMs:
      normalized.readRuntimeDemandStartToCloseTimeoutMs,
  };
}

function normalizePositiveIntegerOption(input: {
  fallback: number;
  max: number;
  min: number;
  value: number | undefined;
}): number {
  if (input.value === undefined) {
    return input.fallback;
  }
  if (!Number.isInteger(input.value)) {
    throw new TypeError("Hosted runtime workflow numeric options must be integers.");
  }
  return Math.min(Math.max(input.value, input.min), input.max);
}

function normalizeTaskQueueOption(
  value: string | undefined,
  fallback: string,
): string {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new TypeError("Hosted runtime workflow task queue options must be bounded non-empty strings.");
  }
  return normalized;
}

function readCarryForwardState(
  state: HostedRuntimeWorkflowState,
  legacy: {
    deviceSyncRecoveryRequested: boolean;
    sameRuntimeWakeAcceptedCount: number;
  } | null,
): LegacyHostedUserRuntimeWorkflowCarryForwardState {
  const { userId: _userId, ...carryForward } = state;
  if (legacy === null) {
    return carryForward;
  }

  return {
    ...carryForward,
    deviceSyncRecoveryRequested: legacy.deviceSyncRecoveryRequested,
    sameRuntimeWakeAcceptedCount: legacy.sameRuntimeWakeAcceptedCount,
  };
}

function recordDemandSummary(
  state: HostedRuntimeWorkflowState,
  demand: HostedUserRuntimeDemand,
): void {
  state.lastDemandKind = demand.kind;
  state.lastMailboxLagLaneCount = demand.mailboxLag.length;

  switch (demand.kind) {
    case "run": {
      state.lastDemandNextWakeAt = null;
      state.lastDemandSource = demand.source;
      break;
    }
    case "idle": {
      state.lastDemandNextWakeAt = demand.nextWakeAt;
      state.lastDemandSource = null;
      break;
    }
    case "blocked": {
      state.lastDemandNextWakeAt = demand.retryAt;
      state.lastDemandSource = demand.reason;
      break;
    }
    default: {
      const exhaustive: never = demand;
      throw new Error(`Unsupported hosted runtime demand ${String(exhaustive)}`);
    }
  }
}

function clearSatisfiedFlags(
  state: HostedRuntimeWorkflowState,
  expectedSignalVersion: number,
): boolean {
  if (state.signalVersion !== expectedSignalVersion) {
    return false;
  }

  state.browserVaultRefreshRequested = false;
  state.lagRecoveryObserved = false;
  state.latestMailboxPointer = null;
  state.mailboxSignalCount = 0;
  state.manualRunRequested = false;
  return true;
}

function clearConsumedFlagsAfterRun(
  state: HostedRuntimeWorkflowState,
  source: LegacyHostedRuntimeDemandRunSource,
): void {
  switch (source) {
    case "mailbox_backlog": {
      state.latestMailboxPointer = null;
      state.mailboxSignalCount = 0;
      return;
    }
    case "manual": {
      state.manualRunRequested = false;
      return;
    }
    case "browser_vault_refresh": {
      state.browserVaultRefreshRequested = false;
      return;
    }
    case "device_sync_recovery": {
      return;
    }
    case "lag_recovery": {
      state.lagRecoveryObserved = false;
      return;
    }
    case "workspace_wake": {
      return;
    }
    default: {
      const exhaustive: never = source;
      throw new Error(`Unsupported hosted runtime demand source ${String(exhaustive)}`);
    }
  }
}

function isLegacyDeviceSyncRecoverySource(source: string): boolean {
  return source === LEGACY_DEVICE_SYNC_RECOVERY_SOURCE;
}

function readLegacyBooleanProperty(
  value: object | undefined,
  key: string,
): boolean {
  if (value === undefined) {
    return false;
  }
  return readObjectProperty(value, key) === true;
}

function readLegacyNonNegativeIntegerProperty(
  value: object | undefined,
  key: string,
): number {
  if (value === undefined) {
    return 0;
  }
  const property = readObjectProperty(value, key);
  return typeof property === "number"
    && Number.isSafeInteger(property)
    && property >= 0
    ? property
    : 0;
}

async function waitUntilTimestampOrSignal(
  runtime: HostedUserRuntimeWorkflowRuntime,
  timestamp: string | null,
  versionBeforeWait: number,
  state: HostedRuntimeWorkflowState,
  reason: Exclude<HostedRuntimeCurrentWaitReason, null>,
): Promise<void> {
  const timeoutMs = millisecondsUntil(timestamp, runtime.nowMs());
  if (timeoutMs === 0) {
    return;
  }

  state.currentWaitReason = reason;
  state.currentWaitUntil = timeoutMs === null ? null : timestamp;
  try {
    await runtime.waitForSignalOrTimeout(
      () => state.signalVersion !== versionBeforeWait,
      timeoutMs,
    );
  } finally {
    state.currentWaitReason = null;
    state.currentWaitUntil = null;
  }
}

function millisecondsUntil(
  timestamp: string | null,
  nowMs: number,
): number | null {
  if (!timestamp) {
    return null;
  }

  const targetMs = Date.parse(timestamp);
  if (!Number.isFinite(targetMs)) {
    return 0;
  }

  return Math.max(0, targetMs - nowMs);
}

function isoNow(runtime: HostedUserRuntimeWorkflowRuntime): string {
  return new Date(runtime.nowMs()).toISOString();
}

function readActivityFailureRetryAt(input: {
  error: unknown;
  retryDelayMs: number;
  runtime: HostedUserRuntimeWorkflowRuntime;
}): string | null {
  if (
    isNonRetryableFailure(input.error)
    && input.runtime.useSignalOnlyWaitForNonRetryableFailure()
  ) {
    return null;
  }

  return new Date(input.runtime.nowMs() + input.retryDelayMs).toISOString();
}

function readExecutionErrorCode(error: unknown): string {
  const applicationFailureType = readApplicationFailureType(error, 0);
  if (
    applicationFailureType !== null
    && isSafeErrorCode(applicationFailureType)
  ) {
    return applicationFailureType;
  }

  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && isSafeErrorCode(code)) {
      return code;
    }

    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && isSafeErrorCode(name)) {
      return name;
    }
  }

  return "unknown";
}

function readApplicationFailureType(
  error: unknown,
  depth: number,
): string | null {
  if (!error || typeof error !== "object" || depth > 5) {
    return null;
  }

  const type = readObjectProperty(error, "type");
  if (typeof type === "string" && type.length > 0) {
    return type;
  }

  return readApplicationFailureType(readObjectProperty(error, "cause"), depth + 1);
}

function isNonRetryableFailure(error: unknown): boolean {
  return hasNonRetryableFailureFlag(error, 0);
}

function hasNonRetryableFailureFlag(error: unknown, depth: number): boolean {
  if (!error || typeof error !== "object" || depth > 5) {
    return false;
  }

  if (readObjectProperty(error, "nonRetryable") === true) {
    return true;
  }

  return hasNonRetryableFailureFlag(readObjectProperty(error, "cause"), depth + 1);
}

function readObjectProperty(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

function isSafeErrorCode(value: string): boolean {
  return value.length > 0 && value.length <= 96 && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function parseHostedRuntimeSignal(value: unknown): HostedUserRuntimeSignal {
  const record = requireSignalRecord(value, "Hosted runtime signal");
  const kind = requireString(record.kind, "Hosted runtime signal kind");

  switch (kind) {
    case "mailbox_appended": {
      assertExactSignalKeys(record, "Hosted runtime mailbox signal", [
        "kind",
        "lane",
        "laneSeq",
        "mailboxItemId",
        "source",
      ]);

      return {
        kind,
        lane: parseHostedMailboxLane(record.lane),
        laneSeq: requireNonNegativeBigIntString(
          record.laneSeq,
          "Hosted runtime mailbox signal laneSeq",
        ),
        mailboxItemId: requireOpaqueIdentifier(
          record.mailboxItemId,
          "Hosted runtime mailbox signal mailboxItemId",
        ),
        source: requireSafeRuntimeSignalSource(
          record.source,
          "Hosted runtime mailbox signal source",
        ),
      };
    }
    case "manual_run_requested": {
      assertKindOnlySignal(record, "Hosted runtime manual-run signal");
      return { kind };
    }
    case "browser_vault_refresh_requested": {
      assertKindOnlySignal(record, "Hosted runtime browser-vault refresh signal");
      return { kind };
    }
    case "device_sync_recovery_requested": {
      assertKindOnlySignal(record, "Hosted runtime device-sync recovery signal");
      return { kind };
    }
    case "mailbox_lag_observed": {
      assertKindOnlySignal(record, "Hosted runtime mailbox-lag signal");
      return { kind };
    }
    case "runtime_recheck_requested": {
      assertKindOnlySignal(record, "Hosted runtime recheck signal");
      return { kind };
    }
    case "runtime_prewarm_requested": {
      assertExactSignalKeys(record, "Hosted runtime prewarm signal", [
        "eventId",
        "kind",
        "occurredAt",
        "scopeHash",
        "source",
      ]);
      // Legacy replay tolerance: older prewarm signals carried a raw chat-id hash.
      // New producers must not send it, and the workflow deliberately ignores it.
      if (record.scopeHash !== undefined && record.scopeHash !== null) {
        requireOpaqueIdentifier(
          record.scopeHash,
          "Hosted runtime prewarm signal scopeHash",
        );
      }
      return {
        eventId: requireOpaqueIdentifier(
          record.eventId,
          "Hosted runtime prewarm signal eventId",
        ),
        kind,
        occurredAt: requireIsoTimestamp(
          record.occurredAt,
          "Hosted runtime prewarm signal occurredAt",
        ),
        source: requirePrewarmSource(
          record.source,
          "Hosted runtime prewarm signal source",
        ),
      };
    }
    default:
      throw new TypeError("Hosted runtime signal kind is not supported.");
  }
}

function requireSignalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function parseHostedMailboxLane(value: unknown): HostedRuntimeMailboxSignal["lane"] {
  const text = requireString(value, "Hosted runtime mailbox signal lane");
  if (text === "system" || text === "conversation") {
    return text;
  }

  throw new TypeError("Hosted runtime mailbox signal lane is not supported.");
}

function requireOpaqueIdentifier(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (text.length > 192 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text)) {
    throw new TypeError(`${label} must be a bounded opaque identifier.`);
  }

  return text;
}

function requireSafeRuntimeSignalSource(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (
    text.length > 64
    || text.trim() !== text
    || !/^[a-z0-9._:-]+$/u.test(text)
  ) {
    throw new TypeError(
      `${label} must be a non-empty trimmed safe source string with at most 64 characters.`,
    );
  }

  return text;
}

function requirePrewarmSource(
  value: unknown,
  label: string,
): HostedRuntimePrewarmSource {
  const text = requireString(value, label);
  if (text !== HOSTED_RUNTIME_PREWARM_SOURCE) {
    throw new TypeError(`${label} is not supported.`);
  }
  return HOSTED_RUNTIME_PREWARM_SOURCE;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(text)
    || Number.isNaN(Date.parse(text))
  ) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }
  return text;
}

function requireNonNegativeBigIntString(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (!/^[0-9]+$/u.test(text)) {
    throw new TypeError(`${label} must be a non-negative base-10 integer string.`);
  }

  return text;
}

function assertKindOnlySignal(
  record: Record<string, unknown>,
  label: string,
): void {
  assertExactSignalKeys(record, label, ["kind"]);
}

function assertExactSignalKeys(
  record: Record<string, unknown>,
  label: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} must not include ${key}.`);
    }
  }
}
