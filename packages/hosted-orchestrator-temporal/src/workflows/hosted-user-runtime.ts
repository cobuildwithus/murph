import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
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
  type HostedRuntimeCurrentWaitReason,
  type HostedRuntimeEnsureProcessingResponse,
  type HostedRuntimePrewarmResponse,
  type HostedRuntimePrewarmSource,
  type HostedRuntimeReconciliationFacts,
  type HostedRuntimeReconciliationFactsRequest,
  type HostedRuntimeSignal,
  type HostedRuntimeWorkflowState,
} from "@murphai/hosted-execution/orchestration-control";
import {
  isHostedMailboxLane,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedUserRuntimeWorkflowCarryForwardState,
  HostedUserRuntimeWorkflowInput,
  HostedUserRuntimeWorkflowOptions,
} from "../workflow-types.js";

export const HOSTED_USER_RUNTIME_DEFAULT_CONTINUE_AS_NEW_ITERATION_THRESHOLD = 500;
export const HOSTED_USER_RUNTIME_DEFAULT_CONTINUE_AS_NEW_HISTORY_LENGTH = 750;
export const HOSTED_USER_RUNTIME_DEFAULT_RECONCILIATION_FAILURE_RETRY_DELAY_MS = 30_000;
export const HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS = 30_000;
export const HOSTED_USER_RUNTIME_DEFAULT_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS = 15_000;
// Workflow command timeout is replay-sensitive. The hard cut terminates old
// histories first; keep the value pinned with response slack over the shared
// 5s prewarm HTTP/container budget.
export const HOSTED_USER_RUNTIME_DEFAULT_PREWARM_START_TO_CLOSE_TIMEOUT_MS = 6_000;
export const HOSTED_USER_RUNTIME_DEFAULT_READ_RECONCILIATION_FACTS_START_TO_CLOSE_TIMEOUT_MS = 10_000;
export const HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_HISTORY_LENGTH = 10_000;
export const HOSTED_USER_RUNTIME_MAX_CONTINUE_AS_NEW_ITERATION_THRESHOLD = 10_000;
export const HOSTED_USER_RUNTIME_MAX_ENSURE_PROCESSING_START_TO_CLOSE_TIMEOUT_MS = 3_600_000;
export const HOSTED_USER_RUNTIME_MAX_READ_RECONCILIATION_FACTS_START_TO_CLOSE_TIMEOUT_MS = 30_000;
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
  const options = normalizeHostedUserRuntimeWorkflowOptions(input.options);
  const reconciliationActivities = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "2 seconds",
      maximumAttempts: 6,
      maximumInterval: "1 minute",
    },
    startToCloseTimeout:
      options.readRuntimeReconciliationFactsStartToCloseTimeoutMs,
  });
  const processingActivities = proxyActivities<typeof activities>({
    retry: {
      initialInterval: "2 seconds",
      maximumAttempts: 6,
      maximumInterval: "1 minute",
    },
    startToCloseTimeout: options.ensureRuntimeProcessingStartToCloseTimeoutMs,
  });
  const prewarmActivities = proxyActivities<typeof activities>({
    cancellationType: ActivityCancellationType.ABANDON,
    retry: {
      initialInterval: "1 second",
      maximumAttempts: 2,
      maximumInterval: "5 seconds",
    },
    scheduleToStartTimeout: "2 seconds",
    startToCloseTimeout: Math.min(
      options.ensureRuntimeProcessingStartToCloseTimeoutMs,
      HOSTED_USER_RUNTIME_DEFAULT_PREWARM_START_TO_CLOSE_TIMEOUT_MS,
    ),
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
    readRuntimeReconciliationFacts:
      reconciliationActivities.readRuntimeReconciliationFacts,
    startRuntimePrewarm: (prewarmInput) => {
      const scope = new CancellationScope();
      return {
        cancel: () => scope.cancel(),
        result: scope.run(() =>
          prewarmActivities.prewarmRuntimeContainer(prewarmInput)
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
    userId: string;
  }): Promise<HostedRuntimeEnsureProcessingResponse>;
  nowMs(): number;
  readRuntimeReconciliationFacts(
    request: HostedRuntimeReconciliationFactsRequest,
  ): Promise<HostedRuntimeReconciliationFacts>;
  startRuntimePrewarm(input: {
    prewarmAttemptId: string;
    source: HostedRuntimePrewarmSource;
    userId: string;
  }): HostedUserRuntimePrewarmHandle;
  startSignalWait(
    predicate: () => boolean,
    timeoutMs: number | null,
  ): HostedUserRuntimeSignalWaitHandle;
  uuid(): string;
  waitForSignalOrTimeout(
    predicate: () => boolean,
    timeoutMs: number | null,
  ): Promise<void>;
}

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
  readRuntimeReconciliationFactsStartToCloseTimeoutMs: number;
}

export function createHostedUserRuntimeWorkflowMachine(
  input: HostedUserRuntimeWorkflowInput,
  runtime: HostedUserRuntimeWorkflowRuntime,
): HostedUserRuntimeWorkflowMachine {
  const options = normalizeHostedUserRuntimeWorkflowOptions(input.options);
  const continueAsNewOptions = normalizeContinueAsNewOptions(input.options);
  const state = createInitialWorkflowState(input.userId, input.state);
  let completedIterations = 0;
  let mailboxSignalVersion = 0;
  let latestMailboxSignalVersion: number | null = null;
  let lastMailboxSignalVersionRead =
    state.latestMailboxPointer !== null ? -1 : mailboxSignalVersion;

  const readStatus = (): HostedRuntimeWorkflowState => ({ ...state });

  const continueAsNewWithCurrentState = async (): Promise<never> =>
    await runtime.continueAsNew({
      options: continueAsNewOptions,
      state: readCarryForwardState(state),
      userId: input.userId,
    });

  const applySignal = (rawSignal: unknown): void => {
    let signal: HostedRuntimeSignal;
    try {
      signal = parseHostedRuntimeWorkflowSignal(rawSignal);
    } catch (error) {
      recordInvalidSignal(state, readExecutionErrorCode(error));
      return;
    }

    if (signal.kind === "runtime_recheck_requested") {
      state.signalVersion += 1;
      return;
    }

    if (signal.kind === "runtime_prewarm_requested") {
      state.signalVersion += 1;
      state.prewarmRequested = true;
      state.prewarmSignalCount += 1;
      state.latestPrewarmRequestedAt = signal.occurredAt;
      state.lastPrewarmErrorCode = null;
      return;
    }

    if (signal.kind === "mailbox_appended") {
      state.signalVersion += 1;
      mailboxSignalVersion += 1;
      latestMailboxSignalVersion = mailboxSignalVersion;
      state.mailboxSignalCount += 1;
      state.latestMailboxPointer = {
        lane: signal.lane,
        laneSeq: signal.laneSeq,
        mailboxItemId: signal.mailboxItemId,
      };
      return;
    }

    const exhaustive: never = signal;
    throw new Error(`Unsupported hosted runtime signal ${String(exhaustive)}`);
  };

  const executeRuntimeProcessing = async (processingInput: {
    clearMailboxPointerOnAccepted: boolean;
  }): Promise<void> => {
    const signalVersionBeforeExecution = state.signalVersion;
    const mailboxVersionBeforeExecution = mailboxSignalVersion;
    let execution: HostedRuntimeEnsureProcessingResponse;
    const orchestrationAttemptId = runtime.uuid();
    state.lastOrchestrationAttemptId = orchestrationAttemptId;
    clearPendingRuntimePrewarm(state);
    try {
      execution = await runtime.ensureRuntimeProcessing({
        orchestrationAttemptId,
        userId: input.userId,
      });
    } catch (error) {
      state.lastExecutionAt = isoNow(runtime);
      state.lastExecutionErrorCode = readExecutionErrorCode(error);
      state.lastExecutionKind = "failed";
      state.lastRuntimeAttemptId = null;
      state.lastRuntimeStatus = null;
      if (mailboxSignalVersion !== mailboxVersionBeforeExecution) {
        return;
      }
      const retryAt = readActivityFailureRetryAt({
        error,
        retryDelayMs:
          HOSTED_USER_RUNTIME_DEFAULT_EXECUTION_FAILURE_RETRY_DELAY_MS,
        runtime,
      });
      if (
        retryAt === null
        && shouldContinueAsNewBeforePostReconciliationWait({ options, runtime })
      ) {
        await continueAsNewWithCurrentState();
      }
      await waitUntilTimestampOrSignal(
        runtime,
        retryAt,
        state.signalVersion,
        state,
        retryAt === null ? "non_retryable_signal_only" : "execution_failure_retry",
      );
      return;
    }

    state.lastExecutionAt = isoNow(runtime);
    state.lastExecutionErrorCode = null;
    state.lastExecutionKind = execution.kind;
    const signalArrivedDuringExecution =
      state.signalVersion !== signalVersionBeforeExecution;
    const mailboxSignalArrivedDuringExecution =
      mailboxSignalVersion !== mailboxVersionBeforeExecution;

    if (execution.kind === "runtime_processing_accepted") {
      recordRuntimeProcessingAccepted(state, execution);
      if (
        !mailboxSignalArrivedDuringExecution
        && processingInput.clearMailboxPointerOnAccepted
      ) {
        clearMailboxPointer(state);
      }
      if (mailboxSignalArrivedDuringExecution || signalArrivedDuringExecution) {
        return;
      }
      const versionBeforeWakeWait = state.signalVersion;
      await waitUntilTimestampOrSignal(
        runtime,
        execution.recommendedRecheckAt,
        versionBeforeWakeWait,
        state,
        "runtime_wake_recheck",
      );
      return;
    }

    if (execution.kind === "retry_later") {
      state.lastRuntimeAttemptId = null;
      state.lastRuntimeStatus = "retry_later";
      if (mailboxSignalArrivedDuringExecution || signalArrivedDuringExecution) {
        return;
      }
      await waitUntilTimestampOrSignal(
        runtime,
        execution.retryAt,
        state.signalVersion,
        state,
        "processing_retry_later",
      );
      return;
    }
  };

  const run = async (): Promise<void> => {
    for (;;) {
      if (shouldContinueAsNewBeforeReconciliation({
        completedIterations,
        hasUnreadMailboxSignal:
          mailboxSignalVersion !== lastMailboxSignalVersionRead,
        options,
        runtime,
      })) {
        await continueAsNewWithCurrentState();
      }

      completedIterations += 1;

      if (
        state.latestMailboxPointer !== null
        && latestMailboxSignalVersion === mailboxSignalVersion
      ) {
        latestMailboxSignalVersion = null;
        lastMailboxSignalVersionRead = mailboxSignalVersion;
        recordDirectMailboxProcessingSummary(state);
        await executeRuntimeProcessing({
          clearMailboxPointerOnAccepted: true,
        });
        continue;
      }

      const versionBeforeReconciliation = state.signalVersion;
      let facts: HostedRuntimeReconciliationFacts;
      try {
        facts = await runtime.readRuntimeReconciliationFacts({
          userId: input.userId,
        });
      } catch (error) {
        state.lastReconciliationStatus = null;
        state.lastReconciliationNextWakeAt = null;
        state.lastReconciliationBlockedReason = null;
        state.lastExecutionErrorCode = readExecutionErrorCode(error);
        if (state.signalVersion !== versionBeforeReconciliation) {
          continue;
        }
        lastMailboxSignalVersionRead = mailboxSignalVersion;
        const retryAt = readActivityFailureRetryAt({
          error,
          retryDelayMs:
            HOSTED_USER_RUNTIME_DEFAULT_RECONCILIATION_FAILURE_RETRY_DELAY_MS,
          runtime,
        });
        if (
          retryAt === null
          && shouldContinueAsNewBeforePostReconciliationWait({ options, runtime })
        ) {
          await continueAsNewWithCurrentState();
        }
        await waitUntilTimestampOrSignal(
          runtime,
          retryAt,
          state.signalVersion,
          state,
          retryAt === null
            ? "non_retryable_signal_only"
            : "reconciliation_failure_retry",
        );
        continue;
      }

      if (state.signalVersion !== versionBeforeReconciliation) {
        continue;
      }
      lastMailboxSignalVersionRead = mailboxSignalVersion;
      recordReconciliationFactsSummary(state, facts);

      if (facts.blocked !== null) {
        clearPendingRuntimePrewarm(state);
        if (shouldContinueAsNewBeforePostReconciliationWait({ options, runtime })) {
          await continueAsNewWithCurrentState();
        }
        await waitUntilTimestampOrSignal(
          runtime,
          facts.blocked.retryAt,
          versionBeforeReconciliation,
          state,
          "blocked_retry",
        );
        continue;
      }

      if (hasAnyMailboxLag(facts)) {
        await executeRuntimeProcessing({
          clearMailboxPointerOnAccepted: true,
        });
        continue;
      }

      if (state.prewarmRequested) {
        const mailboxVersionBeforePrewarm = mailboxSignalVersion;
        await runRuntimePrewarmUntilMailboxSignal({
          getMailboxSignalVersion: () => mailboxSignalVersion,
          mailboxSignalVersionBeforePrewarm: mailboxVersionBeforePrewarm,
          runtime,
          state,
          workflowInput: input,
        });
        if (mailboxSignalVersion !== mailboxVersionBeforePrewarm) {
          continue;
        }
        if (state.signalVersion !== versionBeforeReconciliation) {
          continue;
        }
      }

      clearMailboxPointer(state);

      const nextWakeAt = facts.workspace?.nextWakeAt ?? null;
      if (isDueTimestamp(nextWakeAt, runtime.nowMs())) {
        await executeRuntimeProcessing({
          clearMailboxPointerOnAccepted: false,
        });
        continue;
      }

      if (shouldContinueAsNewBeforePostReconciliationWait({ options, runtime })) {
        await continueAsNewWithCurrentState();
      }
      await waitUntilTimestampOrSignal(
        runtime,
        nextWakeAt,
        state.signalVersion,
        state,
        nextWakeAt === null ? "non_retryable_signal_only" : "idle_next_wake",
      );
      continue;
    }
  };

  return {
    applySignal,
    readStatus,
    run,
  };
}

async function runRuntimePrewarmUntilMailboxSignal(input: {
  getMailboxSignalVersion(): number;
  mailboxSignalVersionBeforePrewarm: number;
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
  const mailboxSignalWait = input.runtime.startSignalWait(
    () =>
      input.getMailboxSignalVersion()
        !== input.mailboxSignalVersionBeforePrewarm,
    null,
  );

  const outcome = await Promise.race([
    prewarmHandle.result.then(
      (result) => ({ kind: "completed" as const, result }),
      (error: unknown) => ({ error, kind: "failed" as const }),
    ),
    mailboxSignalWait.result.then(
      () => ({ kind: "mailbox_signal" as const }),
      (error: unknown) => ({ error, kind: "wait_failed" as const }),
    ),
  ]);

  input.state.prewarmRequested = false;

  if (outcome.kind === "mailbox_signal") {
    prewarmHandle.cancel();
    input.state.lastPrewarmResult = null;
    input.state.lastPrewarmErrorCode = "abandoned_for_mailbox_signal";
    return;
  }

  mailboxSignalWait.cancel();

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

function parseHostedRuntimeWorkflowSignal(value: unknown): HostedRuntimeSignal {
  const record = requireWorkflowRecord(value, "Hosted runtime signal");
  const kind = requireWorkflowString(record.kind, "Hosted runtime signal kind");

  if (kind === "runtime_recheck_requested") {
    assertWorkflowExactKeys(record, "Hosted runtime recheck signal", [
      "kind",
    ]);
    return { kind };
  }

  if (kind === "runtime_prewarm_requested") {
    assertWorkflowExactKeys(record, "Hosted runtime prewarm signal", [
      "eventId",
      "kind",
      "occurredAt",
      "source",
    ]);
    const source = requireWorkflowString(
      record.source,
      "Hosted runtime prewarm signal source",
    );
    if (source !== HOSTED_RUNTIME_PREWARM_SOURCE) {
      throw new TypeError("Unsupported hosted runtime prewarm signal source.");
    }

    return {
      eventId: requireWorkflowOpaqueString(
        record.eventId,
        "Hosted runtime prewarm signal eventId",
      ),
      kind,
      occurredAt: requireWorkflowIsoTimestamp(
        record.occurredAt,
        "Hosted runtime prewarm signal occurredAt",
      ),
      source,
    };
  }

  if (kind === "mailbox_appended") {
    assertWorkflowExactKeys(record, "Hosted runtime mailbox signal", [
      "kind",
      "lane",
      "laneSeq",
      "mailboxItemId",
    ]);
    const lane = requireWorkflowString(
      record.lane,
      "Hosted runtime mailbox signal lane",
    );
    if (!isHostedMailboxLane(lane)) {
      throw new TypeError("Unsupported hosted runtime mailbox signal lane.");
    }

    return {
      kind,
      lane,
      laneSeq: requireWorkflowNonNegativeBigIntString(
        record.laneSeq,
        "Hosted runtime mailbox signal laneSeq",
      ),
      mailboxItemId: requireWorkflowOpaqueString(
        record.mailboxItemId,
        "Hosted runtime mailbox signal mailboxItemId",
      ),
    };
  }

  throw new TypeError("Unsupported hosted runtime signal kind.");
}

function requireWorkflowRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertWorkflowExactKeys(
  record: Record<string, unknown>,
  label: string,
  expectedKeys: readonly string[],
): void {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} had unsupported fields.`);
  }
}

function requireWorkflowString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  return value;
}

function requireWorkflowOpaqueString(value: unknown, label: string): string {
  const normalized = requireWorkflowString(value, label).trim();
  if (!normalized) {
    throw new TypeError(`${label} must be non-empty.`);
  }
  return normalized;
}

function requireWorkflowIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requireWorkflowString(value, label);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function requireWorkflowNonNegativeBigIntString(
  value: unknown,
  label: string,
): string {
  const text = requireWorkflowString(value, label);
  if (!/^(0|[1-9]\d*)$/.test(text)) {
    throw new TypeError(`${label} must be a non-negative integer string.`);
  }
  return text;
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

function createInitialWorkflowState(
  userId: string,
  carryForward: HostedUserRuntimeWorkflowCarryForwardState | undefined,
): HostedRuntimeWorkflowState {
  return {
    currentWaitReason: null,
    currentWaitUntil: null,
    invalidSignalCount: carryForward?.invalidSignalCount ?? 0,
    lastOrchestrationAttemptId: carryForward?.lastOrchestrationAttemptId ?? null,
    lastInvalidSignalErrorCode: carryForward?.lastInvalidSignalErrorCode ?? null,
    lastExecutionAt: carryForward?.lastExecutionAt ?? null,
    lastExecutionErrorCode: carryForward?.lastExecutionErrorCode ?? null,
    lastExecutionKind: carryForward?.lastExecutionKind ?? null,
    lastMailboxLagLaneCount: carryForward?.lastMailboxLagLaneCount ?? 0,
    lastReconciliationBlockedReason:
      carryForward?.lastReconciliationBlockedReason ?? null,
    lastReconciliationNextWakeAt:
      carryForward?.lastReconciliationNextWakeAt ?? null,
    lastReconciliationStatus: carryForward?.lastReconciliationStatus ?? null,
    lastRuntimeAttemptId: carryForward?.lastRuntimeAttemptId ?? null,
    lastRuntimeStatus: carryForward?.lastRuntimeStatus ?? null,
    latestMailboxPointer: carryForward?.latestMailboxPointer ?? null,
    latestPrewarmRequestedAt: carryForward?.latestPrewarmRequestedAt ?? null,
    mailboxSignalCount: carryForward?.mailboxSignalCount ?? 0,
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

function clearMailboxPointer(state: HostedRuntimeWorkflowState): void {
  state.latestMailboxPointer = null;
  state.mailboxSignalCount = 0;
}

function shouldContinueAsNewBeforeReconciliation(input: {
  completedIterations: number;
  hasUnreadMailboxSignal: boolean;
  options: NormalizedWorkflowOptions;
  runtime: HostedUserRuntimeWorkflowRuntime;
}): boolean {
  if (input.runtime.continueAsNewSuggested()) {
    return true;
  }

  const iterationThresholdReached =
    input.completedIterations >= input.options.continueAsNewAfterIterations;
  const historyThresholdReached =
    input.runtime.currentHistoryLength()
      >= input.options.continueAsNewAfterHistoryEvents;

  if (!iterationThresholdReached && !historyThresholdReached) {
    return false;
  }

  return !input.hasUnreadMailboxSignal;
}

function shouldContinueAsNewBeforePostReconciliationWait(input: {
  options: NormalizedWorkflowOptions;
  runtime: HostedUserRuntimeWorkflowRuntime;
}): boolean {
  if (input.runtime.continueAsNewSuggested()) {
    return true;
  }

  return input.runtime.currentHistoryLength()
    >= input.options.continueAsNewAfterHistoryEvents;
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
    readRuntimeReconciliationFactsStartToCloseTimeoutMs:
      normalizePositiveIntegerOption({
        fallback:
          HOSTED_USER_RUNTIME_DEFAULT_READ_RECONCILIATION_FACTS_START_TO_CLOSE_TIMEOUT_MS,
        max:
          HOSTED_USER_RUNTIME_MAX_READ_RECONCILIATION_FACTS_START_TO_CLOSE_TIMEOUT_MS,
        min: HOSTED_USER_RUNTIME_MIN_ACTIVITY_START_TO_CLOSE_TIMEOUT_MS,
        value: options?.readRuntimeReconciliationFactsStartToCloseTimeoutMs,
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
    readRuntimeReconciliationFactsStartToCloseTimeoutMs:
      normalized.readRuntimeReconciliationFactsStartToCloseTimeoutMs,
  };
}

function readCarryForwardState(
  state: HostedRuntimeWorkflowState,
): HostedUserRuntimeWorkflowCarryForwardState {
  const { userId: _userId, ...carryForward } = state;
  return carryForward;
}

function recordReconciliationFactsSummary(
  state: HostedRuntimeWorkflowState,
  facts: HostedRuntimeReconciliationFacts,
): void {
  state.lastMailboxLagLaneCount = facts.mailboxLag.length;

  if (facts.blocked !== null) {
    state.lastReconciliationStatus = "blocked";
    state.lastReconciliationBlockedReason = facts.blocked.reason;
    state.lastReconciliationNextWakeAt = facts.blocked.retryAt;
    return;
  }

  state.lastReconciliationBlockedReason = null;

  if (hasAnyMailboxLag(facts)) {
    state.lastReconciliationStatus = "work_pending";
    state.lastReconciliationNextWakeAt = null;
    return;
  }

  state.lastReconciliationStatus = "idle";
  state.lastReconciliationNextWakeAt = facts.workspace?.nextWakeAt ?? null;
}

function recordDirectMailboxProcessingSummary(
  state: HostedRuntimeWorkflowState,
): void {
  state.lastReconciliationStatus = "work_pending";
  state.lastReconciliationNextWakeAt = null;
  state.lastReconciliationBlockedReason = null;
  state.lastMailboxLagLaneCount = 0;
}

function hasAnyMailboxLag(facts: HostedRuntimeReconciliationFacts): boolean {
  return facts.mailboxLag.some((lane) => BigInt(lane.lag) > 0n);
}

function isDueTimestamp(timestamp: string | null, nowMs: number): boolean {
  if (timestamp === null) {
    return false;
  }

  const targetMs = Date.parse(timestamp);
  return Number.isFinite(targetMs) && targetMs <= nowMs;
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
  if (isNonRetryableFailure(input.error)) {
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
