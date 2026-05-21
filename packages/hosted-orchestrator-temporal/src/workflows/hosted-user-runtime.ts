import {
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
export const HOSTED_USER_RUNTIME_DEFAULT_DEMAND_FAILURE_RETRY_DELAY_MS = 30_000;
export const HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS = 30_000;
const HOSTED_USER_RUNTIME_LEGACY_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS = 630_000;
export const HOSTED_USER_RUNTIME_DEFAULT_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS = 660_000;
export const HOSTED_USER_RUNTIME_DEFAULT_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS = 10_000;
export const HOSTED_USER_RUNTIME_DEFAULT_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS = 30_000;
export const HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_ITERATION_THRESHOLD = 10_000;
export const HOSTED_USER_RUNTIME_MAX_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS = 3_600_000;
export const HOSTED_USER_RUNTIME_MIN_ACTIVE_WAKE_RECHECK_DELAY_MS = 5_000;
export const HOSTED_USER_RUNTIME_MAX_ACTIVE_WAKE_RECHECK_DELAY_MS = 3_600_000;
export const HOSTED_USER_RUNTIME_MAX_READ_DEMAND_START_TO_CLOSE_TIMEOUT_MS = 30_000;
export const HOSTED_USER_RUNTIME_MAX_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS = 3_600_000;
export const HOSTED_USER_RUNTIME_MIN_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS = 1_000;
export const HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS = 1_000;
const HOSTED_USER_RUNTIME_NON_RETRYABLE_FAILURE_SIGNAL_WAIT_PATCH =
  "hosted-user-runtime-non-retryable-failure-signal-wait-v1";

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
    continueAsNewSuggested: () => workflowInfo().continueAsNewSuggested,
    ensureCloudflareExecution: executionActivities.ensureCloudflareExecution,
    nowMs: () => Date.now(),
    readRuntimeDemand: demandActivities.readRuntimeDemand,
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
  ensureCloudflareExecution(input: {
    orchestrationAttemptId: string;
    reason: HostedRuntimeRunDemand["reason"];
    userId: string;
  }): Promise<HostedRuntimeEnsureExecutionResponse>;
  nowMs(): number;
  readRuntimeDemand(request: HostedRuntimeDemandRequest): Promise<HostedRuntimeDemand>;
  useSignalOnlyWaitForNonRetryableFailure(): boolean;
  uuid(): string;
  waitForSignalOrTimeout(
    predicate: () => boolean,
    timeoutMs: number | null,
  ): Promise<void>;
}

type HostedRuntimeRunDemand = Extract<HostedRuntimeDemand, { kind: "run" }>;
type HostedRuntimeMailboxSignal = Extract<
  HostedRuntimeSignal,
  { kind: "mailbox_appended" }
>;

export interface HostedUserRuntimeWorkflowMachine {
  applySignal(signal: unknown): void;
  readStatus(): HostedRuntimeWorkflowState;
  run(): Promise<void>;
}

interface NormalizedWorkflowOptions {
  activeWakeRecheckDelayMs: number;
  continueAsNewAfterIterations: number;
  ensureCloudflareExecutionStartToCloseTimeoutMs: number;
  readRuntimeDemandStartToCloseTimeoutMs: number;
  runtimeCompletedFailureRecheckDelayMs: number;
}

export function createHostedUserRuntimeWorkflowMachine(
  input: HostedUserRuntimeWorkflowInput,
  runtime: HostedUserRuntimeWorkflowRuntime,
): HostedUserRuntimeWorkflowMachine {
  const options = normalizeWorkflowOptions(input.options);
  const continueAsNewOptions = normalizeContinueAsNewOptions(input.options);
  const state = createInitialWorkflowState(input.userId, input.state);
  let completedIterations = 0;

  const readStatus = (): HostedRuntimeWorkflowState => ({ ...state });

  const applySignal = (rawSignal: unknown): void => {
    let signal: HostedRuntimeSignal;
    try {
      signal = parseHostedRuntimeSignal(rawSignal);
    } catch (error) {
      state.invalidSignalCount += 1;
      state.lastInvalidSignalErrorCode = readExecutionErrorCode(error);
      return;
    }

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
      if (
        runtime.continueAsNewSuggested()
        || completedIterations >= options.continueAsNewAfterIterations
      ) {
        await runtime.continueAsNew({
          options: continueAsNewOptions,
          state: readCarryForwardState(state),
          userId: input.userId,
        });
      }

      completedIterations += 1;
      const versionBeforeDemand = state.signalVersion;
      let demand: HostedRuntimeDemand;
      try {
        demand = await runtime.readRuntimeDemand({
          browserVaultRefreshRequested: state.browserVaultRefreshRequested,
          deviceSyncRecoveryRequested: state.deviceSyncRecoveryRequested,
          ignoredWorkspaceWakeKey: state.ignoredWorkspaceWakeKey,
          lagRecoveryObserved: state.lagRecoveryObserved,
          manualRunRequested: state.manualRunRequested,
          runtimeResultWakeAt: state.runtimeResultWakeAt,
          runtimeResultWakeReason: state.runtimeResultWakeReason,
          userId: input.userId,
        });
      } catch (error) {
        state.lastDemandKind = null;
        state.lastDemandNextWakeAt = null;
        state.lastDemandSource = "demand_read_failed";
        state.lastExecutionErrorCode = readExecutionErrorCode(error);
        if (state.signalVersion !== versionBeforeDemand) {
          continue;
        }
        await waitUntilTimestampOrSignal(
          runtime,
          readActivityFailureRetryAt({
            error,
            retryDelayMs: HOSTED_USER_RUNTIME_DEFAULT_DEMAND_FAILURE_RETRY_DELAY_MS,
            runtime,
          }),
          state.signalVersion,
          state,
        );
        continue;
      }

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
          readActivityFailureRetryAt({
            error,
            retryDelayMs: HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS,
            runtime,
          }),
          state.signalVersion,
          state,
        );
        continue;
      }

      state.lastExecutionAt = isoNow(runtime);
      state.lastExecutionErrorCode = null;
      state.lastExecutionKind = execution.kind;
      const signalArrivedDuringExecution =
        state.signalVersion !== versionBeforeExecution;

      if (execution.kind === "runtime_completed") {
        const failureRetryAt = recordRuntimeCompletionWake(
          runtime,
          state,
          execution,
          options.runtimeCompletedFailureRecheckDelayMs,
        );

        if (!signalArrivedDuringExecution) {
          if (demand.source === "workspace_wake") {
            state.ignoredWorkspaceWakeKey = createWorkspaceWakeKey(demand.workspace);
          }
          clearConsumedFlagsAfterRun(state, demand.source);
          if (failureRetryAt !== null) {
            await waitUntilTimestampOrSignal(
              runtime,
              failureRetryAt,
              state.signalVersion,
              state,
            );
          }
        }
        continue;
      }

      if (execution.kind === "runtime_wake_sent") {
        if (signalArrivedDuringExecution) {
          continue;
        }
        clearConsumedFlagsAfterRun(state, demand.source);
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

function recordRuntimeCompletionWake(
  runtime: HostedUserRuntimeWorkflowRuntime,
  state: HostedRuntimeWorkflowState,
  execution: Extract<
    HostedRuntimeEnsureExecutionResponse,
    { kind: "runtime_completed" }
  >,
  runtimeCompletedFailureRecheckDelayMs: number,
): string | null {
  if (
    execution.runtimeStatus === "failed"
    && execution.runtimeResultNextWakeAt === null
  ) {
    const retryAt = new Date(
      runtime.nowMs() + runtimeCompletedFailureRecheckDelayMs,
    ).toISOString();
    state.runtimeResultWakeAt = retryAt;
    state.runtimeResultWakeReason = "runtime.failed";
    return retryAt;
  }

  state.runtimeResultWakeAt = execution.runtimeResultNextWakeAt;
  state.runtimeResultWakeReason = execution.runtimeResultNextWakeAt
    ? execution.runtimeResultNextWakeReason
    : null;
  return null;
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
    invalidSignalCount: carryForward?.invalidSignalCount ?? 0,
    lagRecoveryObserved: carryForward?.lagRecoveryObserved ?? false,
    lastInvalidSignalErrorCode: carryForward?.lastInvalidSignalErrorCode ?? null,
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
    runtimeResultWakeReason: carryForward?.runtimeResultWakeReason ?? null,
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
    runtimeCompletedFailureRecheckDelayMs: normalizePositiveIntegerOption({
      fallback: HOSTED_USER_RUNTIME_DEFAULT_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
      max: HOSTED_USER_RUNTIME_MAX_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
      min: HOSTED_USER_RUNTIME_MIN_RUNTIME_COMPLETED_FAILURE_RECHECK_DELAY_MS,
      value: options?.runtimeCompletedFailureRecheckDelayMs,
    }),
  };
}

function normalizeContinueAsNewOptions(
  options: HostedUserRuntimeWorkflowOptions | undefined,
): NormalizedWorkflowOptions {
  const normalized = normalizeWorkflowOptions(options);
  return {
    ...normalized,
    ensureCloudflareExecutionStartToCloseTimeoutMs:
      normalized.ensureCloudflareExecutionStartToCloseTimeoutMs
        === HOSTED_USER_RUNTIME_LEGACY_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS
        ? HOSTED_USER_RUNTIME_DEFAULT_ENSURE_EXECUTION_START_TO_CLOSE_TIMEOUT_MS
        : normalized.ensureCloudflareExecutionStartToCloseTimeoutMs,
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

function parseHostedRuntimeSignal(value: unknown): HostedRuntimeSignal {
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
