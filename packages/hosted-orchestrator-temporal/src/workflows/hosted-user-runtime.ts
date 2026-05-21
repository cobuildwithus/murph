import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  uuid4,
} from "@temporalio/workflow";

import type * as activities from "../activities/index.js";
import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  type HostedRuntimeDemand,
  type HostedRuntimeDemandRequest,
  type HostedRuntimeDemandWorkspaceProjection,
  type HostedRuntimeEnsureExecutionResponse,
  type HostedRuntimeSignal,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedUserRuntimeWorkflowCarryForwardState,
  HostedUserRuntimeWorkflowInput,
  HostedUserRuntimeWorkflowOptions,
} from "../workflow-types.js";

export const HOSTED_USER_RUNTIME_DEFAULT_ACTIVE_WAKE_RECHECK_DELAY_MS = 65_000;
export const HOSTED_USER_RUNTIME_DEFAULT_CONTINUE_AS_NEW_ITERATION_THRESHOLD = 500;
export const HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS = 30_000;
export const HOSTED_USER_RUNTIME_DEFAULT_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS = 630_000;
export const HOSTED_USER_RUNTIME_DEFAULT_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS = 10_000;
export const HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_ITERATION_THRESHOLD = 10_000;
export const HOSTED_USER_RUNTIME_MAX_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS = 3_600_000;
export const HOSTED_USER_RUNTIME_MIN_ACTIVE_WAKE_RECHECK_DELAY_MS = 5_000;
export const HOSTED_USER_RUNTIME_MAX_ACTIVE_WAKE_RECHECK_DELAY_MS = 3_600_000;
export const HOSTED_USER_RUNTIME_MAX_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS = 30_000;
export const HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS = 1_000;

export const runtimeSignal = defineSignal<[HostedRuntimeSignal]>(
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
);

export const runtimeWorkflowStatus =
  defineQuery<HostedRuntimeWorkflowState>(
    HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
  );

export async function hostedUserRuntimeWorkflow(
  input: HostedUserRuntimeWorkflowInput,
): Promise<void> {
  const options = normalizeWorkflowOptions(input.options);
  const demandActivities = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "2 seconds",
      maximumAttempts: 6,
      maximumInterval: "1 minute",
    },
    startToCloseTimeout: options.readRuntimeDemandStartToCloseTimeoutMs,
  });
  const executionActivities = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "2 seconds",
      maximumAttempts: 6,
      maximumInterval: "1 minute",
    },
    startToCloseTimeout: options.ensureCloudflareExecutionStartToCloseTimeoutMs,
  });
  const machine = createHostedUserRuntimeWorkflowMachine(input, {
    continueAsNew: async (nextInput) => continueAsNew<typeof hostedUserRuntimeWorkflow>(
      nextInput,
    ),
    ensureCloudflareExecution: executionActivities.ensureCloudflareExecution,
    nowMs: () => Date.now(),
    readRuntimeDemand: demandActivities.readRuntimeDemand,
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
  ensureCloudflareExecution(input: {
    orchestrationAttemptId: string;
    reason: HostedRuntimeRunDemand["reason"];
    userId: string;
  }): Promise<HostedRuntimeEnsureExecutionResponse>;
  nowMs(): number;
  readRuntimeDemand(request: HostedRuntimeDemandRequest): Promise<HostedRuntimeDemand>;
  uuid(): string;
  waitForSignalOrTimeout(
    predicate: () => boolean,
    timeoutMs: number | null,
  ): Promise<void>;
}

type HostedRuntimeRunDemand = Extract<HostedRuntimeDemand, { kind: "run" }>;

export interface HostedUserRuntimeWorkflowMachine {
  applySignal(signal: HostedRuntimeSignal): void;
  readStatus(): HostedRuntimeWorkflowState;
  run(): Promise<void>;
}

interface NormalizedWorkflowOptions {
  activeWakeRecheckDelayMs: number;
  continueAsNewAfterIterations: number;
  ensureCloudflareExecutionStartToCloseTimeoutMs: number;
  readRuntimeDemandStartToCloseTimeoutMs: number;
}

export function createHostedUserRuntimeWorkflowMachine(
  input: HostedUserRuntimeWorkflowInput,
  runtime: HostedUserRuntimeWorkflowRuntime,
): HostedUserRuntimeWorkflowMachine {
  const options = normalizeWorkflowOptions(input.options);
  const state = createInitialWorkflowState(input.userId, input.state);
  let completedIterations = 0;

  const readStatus = (): HostedRuntimeWorkflowState => ({ ...state });

  const applySignal = (signal: HostedRuntimeSignal): void => {
    state.signalVersion += 1;

    switch (signal.kind) {
      case "mailbox_appended": {
        state.mailboxSignalCount += 1;
        state.latestMailboxPointer = {
          lane: signal.lane,
          laneSeq: signal.laneSeq,
          mailboxItemId: signal.mailboxItemId,
          source: signal.source,
        };
        state.ignoredWorkspaceWakeKey = null;
        break;
      }
      case "manual_run_requested": {
        state.manualRunRequested = true;
        state.ignoredWorkspaceWakeKey = null;
        break;
      }
      case "browser_vault_refresh_requested": {
        state.browserVaultRefreshRequested = true;
        state.ignoredWorkspaceWakeKey = null;
        break;
      }
      case "device_sync_recovery_requested": {
        state.deviceSyncRecoveryRequested = true;
        state.ignoredWorkspaceWakeKey = null;
        break;
      }
      case "mailbox_lag_observed": {
        state.lagRecoveryObserved = true;
        state.ignoredWorkspaceWakeKey = null;
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
      if (completedIterations >= options.continueAsNewAfterIterations) {
        await runtime.continueAsNew({
          options: input.options,
          state: readCarryForwardState(state),
          userId: input.userId,
        });
      }

      completedIterations += 1;
      const versionBeforeDemand = state.signalVersion;
      const demand = await runtime.readRuntimeDemand({
        browserVaultRefreshRequested: state.browserVaultRefreshRequested,
        deviceSyncRecoveryRequested: state.deviceSyncRecoveryRequested,
        ignoredWorkspaceWakeKey: state.ignoredWorkspaceWakeKey,
        lagRecoveryObserved: state.lagRecoveryObserved,
        manualRunRequested: state.manualRunRequested,
        runtimeResultWakeAt: state.runtimeResultWakeAt,
        userId: input.userId,
      });

      if (state.signalVersion !== versionBeforeDemand) {
        continue;
      }

      recordDemandSummary(state, demand);

      if (demand.kind === "blocked") {
        await waitUntilTimestampOrSignal(
          runtime,
          demand.retryAt,
          versionBeforeDemand,
          state,
        );
        continue;
      }

      if (demand.kind === "idle") {
        clearSatisfiedFlags(state, versionBeforeDemand);
        await waitUntilTimestampOrSignal(
          runtime,
          demand.nextWakeAt,
          state.signalVersion,
          state,
        );
        continue;
      }

      const versionBeforeExecution = state.signalVersion;
      let execution: HostedRuntimeEnsureExecutionResponse;
      try {
        execution = await runtime.ensureCloudflareExecution({
          orchestrationAttemptId: runtime.uuid(),
          reason: demand.reason,
          userId: input.userId,
        });
      } catch (error) {
        state.lastExecutionAt = isoNow(runtime);
        state.lastExecutionErrorCode = readExecutionErrorCode(error);
        state.lastExecutionKind = "failed";
        if (state.signalVersion !== versionBeforeExecution) {
          continue;
        }
        await waitUntilTimestampOrSignal(
          runtime,
          new Date(
            runtime.nowMs() + HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS,
          ).toISOString(),
          state.signalVersion,
          state,
        );
        continue;
      }

      state.lastExecutionAt = isoNow(runtime);
      state.lastExecutionErrorCode = null;
      state.lastExecutionKind = execution.kind;

      if (execution.kind === "runtime_completed") {
        state.runtimeResultWakeAt = execution.runtimeResultNextWakeAt;
        if (demand.source === "workspace_wake") {
          state.ignoredWorkspaceWakeKey = createWorkspaceWakeKey(demand.workspace);
        }
      }

      if (state.signalVersion === versionBeforeExecution) {
        clearConsumedFlagsAfterRun(state, demand.source);
      }

      if (execution.kind === "runtime_wake_sent") {
        const versionBeforeWakeWait = state.signalVersion;
        await waitUntilTimestampOrSignal(
          runtime,
          execution.recommendedRecheckAt
            ?? new Date(
              runtime.nowMs() + options.activeWakeRecheckDelayMs,
            ).toISOString(),
          versionBeforeWakeWait,
          state,
        );
      }
    }
  };

  return {
    applySignal,
    readStatus,
    run,
  };
}

export function createWorkspaceWakeKey(
  workspace: HostedRuntimeDemandWorkspaceProjection | null,
): string | null {
  if (!workspace?.nextWakeAt) {
    return null;
  }

  return [
    workspace.version ?? "0",
    workspace.nextWakeAt,
    workspace.nextWakeReason ?? "",
  ].join(":");
}

function createInitialWorkflowState(
  userId: string,
  carryForward: HostedUserRuntimeWorkflowCarryForwardState | undefined,
): HostedRuntimeWorkflowState {
  return {
    browserVaultRefreshRequested:
      carryForward?.browserVaultRefreshRequested ?? false,
    deviceSyncRecoveryRequested:
      carryForward?.deviceSyncRecoveryRequested ?? false,
    ignoredWorkspaceWakeKey: carryForward?.ignoredWorkspaceWakeKey ?? null,
    lagRecoveryObserved: carryForward?.lagRecoveryObserved ?? false,
    lastDemandKind: carryForward?.lastDemandKind ?? null,
    lastDemandNextWakeAt: carryForward?.lastDemandNextWakeAt ?? null,
    lastDemandSource: carryForward?.lastDemandSource ?? null,
    lastExecutionAt: carryForward?.lastExecutionAt ?? null,
    lastExecutionErrorCode: carryForward?.lastExecutionErrorCode ?? null,
    lastExecutionKind: carryForward?.lastExecutionKind ?? null,
    lastMailboxLagLaneCount: carryForward?.lastMailboxLagLaneCount ?? 0,
    latestMailboxPointer: carryForward?.latestMailboxPointer ?? null,
    mailboxSignalCount: carryForward?.mailboxSignalCount ?? 0,
    manualRunRequested: carryForward?.manualRunRequested ?? false,
    runtimeResultWakeAt: carryForward?.runtimeResultWakeAt ?? null,
    signalVersion: carryForward?.signalVersion ?? 0,
    userId,
  };
}

function normalizeWorkflowOptions(
  options: HostedUserRuntimeWorkflowOptions | undefined,
): NormalizedWorkflowOptions {
  return {
    activeWakeRecheckDelayMs: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_ACTIVE_WAKE_RECHECK_DELAY_MS,
      max: HOSTED_USER_RUNTIME_MAX_ACTIVE_WAKE_RECHECK_DELAY_MS,
      min: HOSTED_USER_RUNTIME_MIN_ACTIVE_WAKE_RECHECK_DELAY_MS,
      value: options?.activeWakeRecheckDelayMs,
    }),
    continueAsNewAfterIterations: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_CONTINUE_AS_NEW_ITERATION_THRESHOLD,
      max: HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_ITERATION_THRESHOLD,
      min: 1,
      value: options?.continueAsNewAfterIterations,
    }),
    ensureCloudflareExecutionStartToCloseTimeoutMs: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS,
      max: HOSTED_USER_RUNTIME_MAX_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS,
      min: HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      value: options?.ensureCloudflareExecutionStartToCloseTimeoutMs,
    }),
    readRuntimeDemandStartToCloseTimeoutMs: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS,
      max: HOSTED_USER_RUNTIME_MAX_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS,
      min: HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
      value: options?.readRuntimeDemandStartToCloseTimeoutMs,
    }),
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

function readCarryForwardState(
  state: HostedRuntimeWorkflowState,
): HostedUserRuntimeWorkflowCarryForwardState {
  const { userId: _userId, ...carryForward } = state;
  return carryForward;
}

function recordDemandSummary(
  state: HostedRuntimeWorkflowState,
  demand: HostedRuntimeDemand,
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
): void {
  if (state.signalVersion !== expectedSignalVersion) {
    return;
  }

  state.browserVaultRefreshRequested = false;
  state.deviceSyncRecoveryRequested = false;
  state.lagRecoveryObserved = false;
  state.latestMailboxPointer = null;
  state.mailboxSignalCount = 0;
  state.manualRunRequested = false;
}

function clearConsumedFlagsAfterRun(
  state: HostedRuntimeWorkflowState,
  source: HostedRuntimeRunDemand["source"],
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
      state.deviceSyncRecoveryRequested = false;
      return;
    }
    case "lag_recovery": {
      state.lagRecoveryObserved = false;
      return;
    }
    case "runtime_result_wake":
    case "workspace_wake": {
      return;
    }
    default: {
      const exhaustive: never = source;
      throw new Error(`Unsupported hosted runtime demand source ${String(exhaustive)}`);
    }
  }
}

async function waitUntilTimestampOrSignal(
  runtime: HostedUserRuntimeWorkflowRuntime,
  timestamp: string | null,
  versionBeforeWait: number,
  state: HostedRuntimeWorkflowState,
): Promise<void> {
  const timeoutMs = millisecondsUntil(timestamp, runtime.nowMs());
  if (timeoutMs === 0) {
    return;
  }

  await runtime.waitForSignalOrTimeout(
    () => state.signalVersion !== versionBeforeWait,
    timeoutMs,
  );
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

function readExecutionErrorCode(error: unknown): string {
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

function isSafeErrorCode(value: string): boolean {
  return value.length > 0 && value.length <= 96 && /^[A-Za-z0-9._:-]+$/u.test(value);
}
