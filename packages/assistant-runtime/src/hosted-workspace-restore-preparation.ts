import {
  attachHostedRuntimeFailurePhaseCode,
  type HostedRuntimeFailurePhaseName,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  type HostedExecutionLogPhase,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";

import type { HostedAssistantWorkspaceRuntimeJobInput } from "./hosted-runtime/models.ts";
import type { HostedRuntimePlatform } from "./hosted-runtime/platform.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
  type HostedWorkspaceRuntimeRestorePlatform,
  type HostedWorkspaceRuntimeRestoreResult,
} from "./hosted-runtime/workspace-restore.ts";

export class HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError extends Error {
  readonly actualWorkspaceVersion: string | null;
  readonly expectedWorkspaceVersion: string;

  constructor(input: {
    actualWorkspaceVersion: string | null;
    expectedWorkspaceVersion: string;
  }) {
    super("Hosted workspace runtime job read a stale workspace version.");
    this.name = "HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError";
    this.actualWorkspaceVersion = input.actualWorkspaceVersion;
    this.expectedWorkspaceVersion = input.expectedWorkspaceVersion;
  }
}

export interface HostedWorkspaceRestorePreparationResult {
  restored: HostedWorkspaceRuntimeRestoreResult;
  workspaceRead: HostedWorkspaceReadResponse;
  workspaceRestoreDoneAt: string;
}

export interface HostedWorkspaceRestorePreparation {
  /** @internal The invocation adopts its canonical abort guard before consumption. */
  adoptRuntimeAbortGuard(input: {
    assertLive: () => void;
    job: HostedAssistantWorkspaceRuntimeJobInput;
    vaultRoot: string;
  }): void;
  readonly phaseLogger: HostedRuntimePhaseLogger;
  readonly promise: Promise<HostedWorkspaceRestorePreparationResult>;
  readonly runtimePhaseStartedAt: string;
  readonly vaultRoot: string;
}

export type HostedWorkspaceRestorePreparationPlatform =
  HostedWorkspaceRuntimeRestorePlatform
  & Pick<HostedRuntimePlatform, "workspacePort">;

export interface StartHostedWorkspaceRestorePreparationInput {
  job: HostedAssistantWorkspaceRuntimeJobInput;
  platform: HostedWorkspaceRestorePreparationPlatform;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export type HostedRuntimePhaseName = HostedRuntimeFailurePhaseName;

type HostedRuntimePhaseLogStatus = "done" | "fail" | "start";

interface HostedRuntimePhaseLogState {
  ordinal: number;
  runtimeStartedAtMs: number;
  startedAtMsByStage: Map<HostedRuntimePhaseName, number>;
}

export interface HostedRuntimePhaseLogger {
  close(stage: HostedRuntimePhaseName): void;
  emit(input: HostedRuntimePhaseLogInput): void;
  failOpenPhases(
    input: Omit<HostedRuntimePhaseLogInput, "stage" | "status">,
  ): HostedRuntimePhaseName[];
}

export interface HostedRuntimePhaseLogInput {
  details?: HostedExecutionStructuredLogDetails;
  error?: unknown;
  input: HostedAssistantWorkspaceRuntimeJobInput;
  phase?: HostedExecutionLogPhase;
  requestId: string;
  stage: HostedRuntimePhaseName;
  status: HostedRuntimePhaseLogStatus;
}

export function startHostedWorkspaceRestorePreparation(
  input: StartHostedWorkspaceRestorePreparationInput,
): HostedWorkspaceRestorePreparation {
  const workspacePort = input.platform.workspacePort ?? null;
  if (!workspacePort) {
    throw new TypeError("Hosted workspace runtime job workspace port must be injected.");
  }
  const readWorkspace = workspacePort.read;
  if (typeof readWorkspace !== "function") {
    throw new TypeError("Hosted workspace runtime job workspace port must support read.");
  }

  const phaseLogger = createHostedRuntimePhaseLogger();
  const runtimePhaseStartedAt = new Date().toISOString();
  const requestId = `hosted-workspace-invocation:${input.job.request.attemptId}`;
  const runtimeLogContext = {
    attemptId: input.job.request.attemptId,
    leaseGeneration: input.job.request.leaseGeneration,
    workspaceVersion: input.job.request.workspaceVersion,
  };
  const signal = input.signal ?? null;
  const assertPreparationNotAborted = (): void => {
    if (signal?.aborted) {
      throw readHostedRuntimeAbortReason(signal);
    }
  };
  let assertRestoreArtifactAccessLive = assertPreparationNotAborted;
  let consumed = false;
  const guardedPlatform = createAbortGuardedHostedWorkspaceRestorePlatform(
    input.platform,
    () => assertRestoreArtifactAccessLive(),
  );

  const promise = (async (): Promise<HostedWorkspaceRestorePreparationResult> => {
    try {
      phaseLogger.emit({
        input: input.job,
        requestId,
        stage: "workspace.read",
        status: "start",
      });
      const workspaceRead = Object.hasOwn(input.job.request, "workspace")
        ? {
            fetchedAt: new Date().toISOString(),
            workspace: input.job.request.workspace ?? null,
          }
        : signal
          ? await raceHostedRuntimeCancellation(readWorkspace(), signal)
          : await readWorkspace();
      phaseLogger.emit({
        details: {
          actualWorkspaceVersion: workspaceRead.workspace?.version ?? null,
          workspaceReadSource: Object.hasOwn(input.job.request, "workspace")
            ? "invocation_request"
            : "workspace_port",
          workspacePresent: workspaceRead.workspace !== null,
        },
        input: input.job,
        requestId,
        stage: "workspace.read",
        status: "done",
      });
      assertPreparationNotAborted();
      assertWorkspaceRunVersionMatchesRequest({
        expectedWorkspaceVersion: input.job.request.workspaceVersion,
        workspace: workspaceRead.workspace,
      });
      if (
        workspaceRead.workspace !== null
        && workspaceRead.workspace.userId !== input.job.request.userId
      ) {
        const { HostedWorkspaceRunnerUserMismatchError } = await import(
          "./hosted-runtime/workspace-runner.ts"
        );
        throw new HostedWorkspaceRunnerUserMismatchError({
          actualUserId: workspaceRead.workspace.userId,
          expectedUserId: input.job.request.userId,
        });
      }

      phaseLogger.emit({
        input: input.job,
        requestId,
        stage: "workspace.restore",
        status: "start",
      });
      const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        logContext: runtimeLogContext,
        platform: guardedPlatform,
        signal,
        vaultRoot: input.vaultRoot,
        workspace: workspaceRead.workspace,
      });
      assertPreparationNotAborted();
      const workspaceRestoreDoneAt = new Date().toISOString();
      phaseLogger.emit({
        details: {
          materializedArtifactPathCount: restored.materializedArtifactPaths.size,
          restoreMode: restored.mode,
          restoreWasCold: restored.restoreWasCold,
        },
        input: input.job,
        requestId,
        stage: "workspace.restore",
        status: "done",
      });
      assertPreparationNotAborted();

      return {
        restored,
        workspaceRead,
        workspaceRestoreDoneAt,
      };
    } catch (error) {
      const failedRuntimePhases = phaseLogger.failOpenPhases({
        error,
        input: input.job,
        requestId,
      });
      throw attachHostedRuntimeFailurePhase(
        error,
        failedRuntimePhases[0] ?? "runtime",
      );
    }
  })();

  // Preparation is intentionally startable before the full runtime module is
  // loaded. The eventual invocation remains the owner that awaits/propagates
  // this exact promise; this observer only prevents a transient unhandled
  // rejection while module hydration overlaps a fast preparation failure.
  void promise.catch(() => undefined);

  return {
    adoptRuntimeAbortGuard(adoption) {
      if (consumed) {
        throw new Error("Hosted workspace restore preparation was already consumed.");
      }
      if (
        adoption.job.request !== input.job.request
        || adoption.vaultRoot !== input.vaultRoot
      ) {
        throw new Error("Hosted workspace restore preparation does not match the invocation.");
      }
      consumed = true;
      assertRestoreArtifactAccessLive = adoption.assertLive;
    },
    phaseLogger,
    promise,
    runtimePhaseStartedAt,
    vaultRoot: input.vaultRoot,
  };
}

export function attachHostedRuntimeFailurePhase(
  error: unknown,
  phase: HostedRuntimePhaseName,
): unknown {
  if (
    !(error instanceof Error)
    || deriveHostedExecutionErrorCode(error) !== "runtime_error"
  ) {
    return error;
  }

  return attachHostedRuntimeFailurePhaseCode(error, phase);
}

export function raceHostedRuntimeCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(readHostedRuntimeAbortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(readHostedRuntimeAbortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function readHostedRuntimeAbortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace runtime was aborted.");
}

function createHostedRuntimePhaseLogger(): HostedRuntimePhaseLogger {
  const state: HostedRuntimePhaseLogState = {
    ordinal: 0,
    runtimeStartedAtMs: Date.now(),
    startedAtMsByStage: new Map(),
  };

  return {
    close(stage) {
      state.startedAtMsByStage.delete(stage);
    },
    emit(logInput) {
      emitHostedRuntimePhaseLog(logInput, state);
    },
    failOpenPhases(logInput) {
      const openStages = Array.from(state.startedAtMsByStage.keys()).reverse();
      for (const stage of openStages) {
        emitHostedRuntimePhaseLog({
          ...logInput,
          stage,
          status: "fail",
        }, state);
      }
      return openStages;
    },
  };
}

function emitHostedRuntimePhaseLog(
  input: HostedRuntimePhaseLogInput,
  state: HostedRuntimePhaseLogState,
): void {
  const phaseTrace = buildHostedRuntimePhaseTraceMetadata(input, state);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      attemptId: input.input.request.attemptId,
      leaseGeneration: input.input.request.leaseGeneration,
      requestId: input.requestId,
      runtimePhase: input.stage,
      ...phaseTrace,
      runtimePhaseStatus: input.status,
      workspaceVersion: input.input.request.workspaceVersion,
      ...buildHostedRuntimePhaseFailureMetadata(input.error),
      ...(input.details ?? {}),
    },
    level: input.status === "fail" ? "error" : "info",
    message: "Hosted workspace runtime phase boundary.",
    phase: input.phase ?? (input.status === "fail" ? "failed" : "wake.running"),
    userId: null,
  });
}

function buildHostedRuntimePhaseFailureMetadata(
  error: unknown,
): HostedExecutionStructuredLogDetails {
  if (error === undefined) {
    return {};
  }
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);

  return {
    failureDetailsPresent: hasHostedRuntimePhaseOwnProperty(error, "details"),
    ...(typeof diagnostics?.errorCode === "string"
      ? { failureErrorCode: diagnostics.errorCode }
      : {}),
    ...(typeof diagnostics?.errorName === "string"
      ? { failureErrorName: diagnostics.errorName }
      : {}),
    failureErrorDetailPresent: typeof diagnostics?.errorDetail === "string",
    ...(typeof diagnostics?.errorStatus === "number"
      ? { failureErrorStatus: diagnostics.errorStatus }
      : {}),
    failureMessagePresent: error instanceof Error && error.message.trim().length > 0,
    failureName: readHostedExecutionSafeErrorName(error) ?? null,
  };
}

function hasHostedRuntimePhaseOwnProperty(error: unknown, key: string): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && Object.prototype.hasOwnProperty.call(error, key),
  );
}

function buildHostedRuntimePhaseTraceMetadata(
  input: Pick<HostedRuntimePhaseLogInput, "stage" | "status">,
  state: HostedRuntimePhaseLogState,
): HostedExecutionStructuredLogDetails {
  const nowMs = Date.now();
  state.ordinal += 1;
  const phaseStartedAtMs = state.startedAtMsByStage.get(input.stage) ?? null;
  const details: HostedExecutionStructuredLogDetails = {
    runtimeElapsedMs: Math.max(0, nowMs - state.runtimeStartedAtMs),
    runtimePhaseOrdinal: state.ordinal,
    ...(phaseStartedAtMs === null || input.status === "start"
      ? {}
      : { runtimePhaseDurationMs: Math.max(0, nowMs - phaseStartedAtMs) }),
  };

  if (input.status === "start") {
    state.startedAtMsByStage.set(input.stage, nowMs);
  } else {
    state.startedAtMsByStage.delete(input.stage);
  }

  return details;
}

function createAbortGuardedHostedWorkspaceRestorePlatform(
  platform: HostedWorkspaceRestorePreparationPlatform,
  assertLive: () => void,
): HostedWorkspaceRestorePreparationPlatform {
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    assertLive();
    const result = await run();
    assertLive();
    return result;
  };

  return {
    ...platform,
    artifactStore: {
      get: (sha256, context) =>
        guard(() => platform.artifactStore.get(sha256, context)),
      put: (putInput) => guard(() => platform.artifactStore.put(putInput)),
    },
    ...(platform.mediaStore
      ? {
          mediaStore: {
            ...(platform.mediaStore.delete
              ? {
                  delete: (deleteInput) =>
                    guard(() => platform.mediaStore!.delete!(deleteInput)),
                }
              : {}),
            get: (getInput, context) =>
              guard(() => platform.mediaStore!.get(getInput, context)),
            ...(platform.mediaStore.record
              ? {
                  record: (recordInput) =>
                    guard(() => platform.mediaStore!.record!(recordInput)),
                }
              : {}),
            put: (putInput) =>
              guard(() => platform.mediaStore!.put(putInput)),
          },
        }
      : {}),
  };
}

function assertWorkspaceRunVersionMatchesRequest(input: {
  expectedWorkspaceVersion: string;
  workspace: HostedWorkspaceState | null;
}): void {
  if (workspaceRunVersionMatchesRequest(input)) {
    return;
  }

  throw new HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError({
    actualWorkspaceVersion: input.workspace?.version ?? null,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
  });
}

function workspaceRunVersionMatchesRequest(input: {
  expectedWorkspaceVersion: string;
  workspace: HostedWorkspaceState | null;
}): boolean {
  const actualWorkspaceVersion = input.workspace?.version ?? null;

  if (actualWorkspaceVersion === input.expectedWorkspaceVersion) {
    return true;
  }

  if (actualWorkspaceVersion === null && input.expectedWorkspaceVersion === "0") {
    return true;
  }

  return false;
}
