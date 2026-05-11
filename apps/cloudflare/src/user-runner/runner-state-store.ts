import {
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
import type {
  HostedWorkspaceInvocationReason,
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";
import { ensureRunnerStateSchema } from "./runner-state-schema.js";
import {
  createDefaultRunnerMetaRow,
  projectRunnerStateRecord,
  normalizeRetryFailureCount,
  resolveRunnerNextWakeAt,
  stringifyRunnerDeferredCheckpointMailboxStatus,
  type RunnerMetaRow,
} from "./runner-state-helpers.js";
import {
  type DurableObjectStateLike,
  type RunnerAlarmKind,
  type RunnerStateRecord,
} from "./types.js";

type RunnerMetaBundleRow = RunnerMetaRow;

export interface RunnerInvocationLease {
  attemptId: string;
  expiresAt: string;
  leaseGeneration: string;
  reason: HostedWorkspaceInvocationReason;
  startedAt: string;
  userId: string;
  workerVersionId: string | null;
  workspaceVersion: string | null;
}

export class RunnerInvocationAlreadyActiveError extends Error {
  readonly record: RunnerStateRecord;

  constructor(record: RunnerStateRecord) {
    super("Hosted runner invocation is already active.");
    this.name = "RunnerInvocationAlreadyActiveError";
    this.record = record;
  }
}

export interface RunnerInvocationLeaseOwnershipResult {
  clearedOrphanObservation: boolean;
  owns: boolean;
  record: RunnerStateRecord;
}

export type RunnerDueAlarm =
  | {
    kind: "none";
    record: RunnerStateRecord;
  }
  | {
    kind: "work";
    record: RunnerStateRecord;
  }
  | {
    checkpointNextWakeAt: string | null;
    idleWorkspaceVersion: string;
    kind: "idle_checkpoint";
    record: RunnerStateRecord;
  };

export interface RunnerInvocationCheckpointResult {
  clearedOrphanObservation: boolean;
  recorded: boolean;
  record: RunnerStateRecord;
}

export type RunnerInvocationHeartbeatResult =
  | {
    ok: true;
    record: RunnerStateRecord;
  }
  | {
    ok: false;
    reason:
      | "no_active_invocation"
      | "stale_attempt"
      | "stale_generation"
      | "wrong_user";
    record: RunnerStateRecord;
  };

export type RunnerStaleInvocationRecoveryResult =
  | {
    attemptId: string | null;
    cleared: false;
    nextRecoveryAt: string | null;
    reason: "none";
    record: RunnerStateRecord;
  }
  | {
    attemptId: string | null;
    cleared: true;
    nextRecoveryAt: null;
    reason: "container_stopped" | "expired" | "worker_version_mismatch";
    record: RunnerStateRecord;
  };

export type RunnerPendingWorkDecision =
  | {
    alreadyRunning: boolean;
    kind: "start";
    preemptedPersistedActiveInvocation: boolean;
    record: RunnerStateRecord;
    resetRetryFailureCount: boolean;
    staleRecovery: RunnerStaleInvocationRecoveryResult | null;
  }
  | {
    activeInvocation: {
      attemptId: string;
      leaseGeneration: string;
      userId: string;
    };
    alreadyRunning: true;
    kind: "preempt_local_idle_checkpoint";
    preemptedPersistedActiveInvocation: false;
    record: RunnerStateRecord;
    resetRetryFailureCount: boolean;
    staleRecovery: RunnerStaleInvocationRecoveryResult | null;
  }
  | {
    alreadyRunning: true;
    kind: "wait";
    preemptedPersistedActiveInvocation: false;
    record: RunnerStateRecord;
    resetRetryFailureCount: boolean;
    staleRecovery: RunnerStaleInvocationRecoveryResult | null;
  };

export type RunnerHeartbeatInstruction =
  | {
    kind: "abort";
    reason:
      | "no_active_invocation"
      | "stale_attempt"
      | "stale_generation"
      | "wrong_user";
    record: RunnerStateRecord;
  }
  | {
    kind: "continue";
    record: RunnerStateRecord;
  }
  | {
    activeInvocation: {
      attemptId: string;
      leaseGeneration: string;
      reason: HostedWorkspaceInvocationReason;
      userId: string;
    };
    kind: "yield";
    nextWakeAt: string | null;
    record: RunnerStateRecord;
    status: "scheduled";
  };

export type ActiveInvocationRecoveryDecision =
  | {
    kind: "live";
    nextRecoveryAt: string | null;
    reason: "heartbeating" | "starting";
  }
  | {
    kind: "recover";
    reason:
      | "container_stopped"
      | "hard_timeout"
      | "heartbeat_stale"
      | "startup_timeout"
      | "worker_version_mismatch";
  };

export function resolveActiveInvocationRecoveryDecision(input: {
  activeWorkerVersionId?: string | null;
  containerStopped?: boolean | null;
  currentWorkerVersionId?: string | null;
  expiresAt?: string | null;
  heartbeatStaleMs: number;
  lastHeartbeatAt?: string | null;
  nowMs: number;
  readyTimeoutMs: number;
  startedAt?: string | null;
  timeoutMs: number;
}): ActiveInvocationRecoveryDecision {
  const startedAtMs = input.startedAt ? Date.parse(input.startedAt) : Number.NaN;
  const expiresAtMs = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  const lastHeartbeatAtMs = input.lastHeartbeatAt
    ? Date.parse(input.lastHeartbeatAt)
    : Number.NaN;
  const hasHeartbeat = Number.isFinite(lastHeartbeatAtMs);
  const heartbeatStaleMs = Math.max(0, Math.floor(input.heartbeatStaleMs));
  const hasRecentHeartbeat = hasHeartbeat
    && input.nowMs - lastHeartbeatAtMs < heartbeatStaleMs;

  if (input.containerStopped === true) {
    return {
      kind: "recover",
      reason: "container_stopped",
    };
  }

  const currentWorkerVersionId = normalizeOptionalString(
    input.currentWorkerVersionId ?? null,
  );
  const activeWorkerVersionId = normalizeOptionalString(
    input.activeWorkerVersionId ?? null,
  );
  if (
    currentWorkerVersionId !== null
    && activeWorkerVersionId !== currentWorkerVersionId
    && !hasRecentHeartbeat
  ) {
    return {
      kind: "recover",
      reason: "worker_version_mismatch",
    };
  }

  const hardDeadlineMs = Number.isFinite(expiresAtMs)
    ? expiresAtMs
    : Number.isFinite(startedAtMs)
    ? startedAtMs + input.timeoutMs
    : 0;
  const startupDeadlineMs = !hasHeartbeat && Number.isFinite(startedAtMs)
    ? startedAtMs + Math.max(0, Math.floor(input.readyTimeoutMs))
    : Number.POSITIVE_INFINITY;
  const heartbeatDeadlineMs = hasHeartbeat
    ? lastHeartbeatAtMs + heartbeatStaleMs
    : Number.POSITIVE_INFINITY;
  const nextDeadlineMs = Math.min(
    startupDeadlineMs,
    heartbeatDeadlineMs,
    hardDeadlineMs,
  );

  if (input.nowMs < nextDeadlineMs) {
    return {
      kind: "live",
      nextRecoveryAt: Number.isFinite(nextDeadlineMs)
        ? new Date(nextDeadlineMs).toISOString()
        : null,
      reason: hasHeartbeat ? "heartbeating" : "starting",
    };
  }

  if (!hasHeartbeat && input.nowMs >= startupDeadlineMs) {
    return {
      kind: "recover",
      reason: "startup_timeout",
    };
  }
  if (hasHeartbeat && input.nowMs >= heartbeatDeadlineMs) {
    return {
      kind: "recover",
      reason: "heartbeat_stale",
    };
  }
  return {
    kind: "recover",
    reason: "hard_timeout",
  };
}

export class RunnerStateStore {
  private userId: string | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
  ) {
    ensureRunnerStateSchema(this.sql);
  }

  async bindUser(userId: string): Promise<string> {
    const meta = this.selectMetaRowSync();

    if (meta) {
      if (meta.user_id !== userId) {
        throw new Error(
          `Hosted runner Durable Object is already bound to ${meta.user_id}, not ${userId}.`,
        );
      }

      this.userId = userId;
      return userId;
    }

    this.insertMetaRowSync(createDefaultRunnerMetaRow(userId));
    this.userId = userId;
    return userId;
  }

  async readState(): Promise<RunnerStateRecord> {
    return this.readStateSync();
  }

  async deleteStateForUser(userId: string): Promise<{ deleted: boolean }> {
    const meta = this.selectMetaRowSync();

    if (meta && meta.user_id !== userId) {
      throw new Error(
        `Hosted runner Durable Object is bound to ${meta.user_id}, not ${userId}.`,
      );
    }

    if (!meta) {
      this.userId = null;
      return { deleted: false };
    }

    this.sql.exec("DELETE FROM runner_meta WHERE singleton = 1");
    this.userId = null;
    return { deleted: true };
  }

  async assertStateForUser(userId: string): Promise<void> {
    const meta = this.selectMetaRowSync();

    if (meta && meta.user_id !== userId) {
      throw new Error(
        `Hosted runner Durable Object is bound to ${meta.user_id}, not ${userId}.`,
      );
    }
  }

  async consumeDueRunnerAlarm(nowMs: number): Promise<RunnerDueAlarm> {
    const meta = this.requireMetaRowSync();
    this.syncLegacyAlarmIntoV2MetaSync(meta);
    const hasPendingWork = meta.pending_work === 1 || meta.pending_nudge === 1;
    const alarm = this.readStateFromMetaSync(meta).alarm;
    const dueAtMs = alarm ? Date.parse(alarm.dueAt) : Number.NaN;
    if (!alarm) {
      if (hasPendingWork) {
        return {
          kind: "work",
          record: this.readStateFromMetaSync(meta),
        };
      }
      return {
        kind: "none",
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (alarm.kind === "work") {
      if (
        !hasPendingWork
        && (!Number.isFinite(dueAtMs) || dueAtMs > nowMs)
      ) {
        return {
          kind: "none",
          record: this.readStateFromMetaSync(meta),
        };
      }
      this.clearAlarmMetaSync(meta);
      this.writeMetaRowSync(meta);
      return {
        kind: "work",
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (hasPendingWork) {
      this.clearAlarmMetaSync(meta);
      this.writeMetaRowSync(meta);
      return {
        kind: "work",
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (!Number.isFinite(dueAtMs) || dueAtMs > nowMs) {
      return {
        kind: "none",
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (!alarm.workspaceVersion) {
      this.clearAlarmMetaSync(meta);
      this.writeMetaRowSync(meta);
      return {
        kind: "none",
        record: this.readStateFromMetaSync(meta),
      };
    }

    return {
      checkpointNextWakeAt: alarm.checkpointNextWakeAt,
      idleWorkspaceVersion: alarm.workspaceVersion,
      kind: "idle_checkpoint",
      record: this.readStateFromMetaSync(meta),
    };
  }

  async markPendingWorkAndDecide(input: {
    activeInThisIsolate: boolean;
    currentWorkerVersionId?: string | null;
    defaultRetryDelayMs: number;
    heartbeatStaleMs: number;
    immediateRetryDelayMs: number;
    maxEventAttempts: number;
    maxRetryDelayMs: number;
    nowMs: number;
    pendingWorkContinuationDelayMs: number;
    retryBackoffMultiplier: number;
    runnerReadyTimeoutMs: number;
    runnerTimeoutMs: number;
  }): Promise<RunnerPendingWorkDecision> {
    let staleRecovery: RunnerStaleInvocationRecoveryResult | null = null;
    let runningRecord = this.readStateSync();
    if (!input.activeInThisIsolate && runningRecord.inFlight) {
      staleRecovery = await this.clearStaleInvocationIfExpired({
        currentWorkerVersionId: input.currentWorkerVersionId ?? null,
        heartbeatStaleMs: input.heartbeatStaleMs,
        nowMs: input.nowMs,
        readyTimeoutMs: input.runnerReadyTimeoutMs,
        timeoutMs: input.runnerTimeoutMs,
      });
      runningRecord = staleRecovery.record;
    }

    const alreadyRunning = input.activeInThisIsolate || runningRecord.inFlight;
    const activeWorkspaceInvocation = runningRecord.workspaceInvocation;
    const activeIdleShutdownCheckpoint =
      activeWorkspaceInvocation?.reason === "idle_shutdown_checkpoint"
        ? activeWorkspaceInvocation
        : null;
    const resetRetryFailureCount = runningRecord.retryFailureCount >= input.maxEventAttempts;
    const retryFailureCount = resetRetryFailureCount
      ? 0
      : runningRecord.retryFailureCount;
    const preferredWakeAt = input.activeInThisIsolate
      ? new Date(input.nowMs + input.pendingWorkContinuationDelayMs).toISOString()
      : alreadyRunning
      ? resolvePendingWorkDrainContinuationWakeAt({
          activeRecoveryWakeAt: staleRecovery?.nextRecoveryAt ?? null,
          heartbeatStaleMs: input.heartbeatStaleMs,
          nowMs: input.nowMs,
          pendingWorkContinuationDelayMs: input.pendingWorkContinuationDelayMs,
          record: runningRecord,
          runnerReadyTimeoutMs: input.runnerReadyTimeoutMs,
          runnerTimeoutMs: input.runnerTimeoutMs,
        })
      : new Date(input.nowMs + resolvePendingWorkRetryDelayMs({
          defaultRetryDelayMs: input.defaultRetryDelayMs,
          immediateRetryDelayMs: input.immediateRetryDelayMs,
          maxRetryDelayMs: input.maxRetryDelayMs,
          retryBackoffMultiplier: input.retryBackoffMultiplier,
          retryFailureCount,
        })).toISOString();

    const meta = this.requireMetaRowSync();
    this.markPendingWorkMetaSync(meta, {
      preferredWakeAt,
      resetRetryFailureCount,
    });

    if (input.activeInThisIsolate && activeIdleShutdownCheckpoint) {
      this.writeMetaRowSync(meta);
      return {
        activeInvocation: {
          attemptId: activeIdleShutdownCheckpoint.attemptId,
          leaseGeneration: runningRecord.leaseGeneration.toString(),
          userId: runningRecord.userId,
        },
        alreadyRunning: true,
        kind: "preempt_local_idle_checkpoint",
        preemptedPersistedActiveInvocation: false,
        record: this.readStateFromMetaSync(meta),
        resetRetryFailureCount,
        staleRecovery,
      };
    }

    if (!input.activeInThisIsolate && activeIdleShutdownCheckpoint) {
      this.clearActiveInvocationMetaSync(meta);
      meta.in_flight = 0;
      this.writeMetaRowSync(meta);
      return {
        alreadyRunning: true,
        kind: "start",
        preemptedPersistedActiveInvocation: true,
        record: this.readStateFromMetaSync(meta),
        resetRetryFailureCount,
        staleRecovery,
      };
    }

    this.writeMetaRowSync(meta);
    const record = this.readStateFromMetaSync(meta);
    if (!alreadyRunning) {
      return {
        alreadyRunning: false,
        kind: "start",
        preemptedPersistedActiveInvocation: false,
        record,
        resetRetryFailureCount,
        staleRecovery,
      };
    }

    return {
      alreadyRunning: true,
      kind: "wait",
      preemptedPersistedActiveInvocation: false,
      record,
      resetRetryFailureCount,
      staleRecovery,
    };
  }

  async beginInvocation(input: {
    consumePendingNudge?: boolean;
    expiresAt?: string | null;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
    workerVersionId?: string | null;
  }): Promise<RunnerInvocationLease> {
    await this.bindUser(input.userId);

    const meta = this.requireMetaRowSync();
    if (meta.in_flight === 1) {
      throw new RunnerInvocationAlreadyActiveError(this.readStateFromMetaSync(meta));
    }

    const nextLeaseGeneration = normalizeLeaseGeneration(meta.lease_generation) + 1;
    const startedAt = new Date().toISOString();
    const expiresAt = normalizeOptionalIsoDateString(input.expiresAt ?? null)
      ?? new Date(Date.parse(startedAt) + 30 * 60_000).toISOString();
    const attemptId = `workspace-invocation-${nextLeaseGeneration}`;

    meta.in_flight = 1;
    meta.lease_generation = nextLeaseGeneration;
    meta.active_invocation_id = attemptId;
    meta.active_invocation_expires_at = expiresAt;
    meta.active_invocation_container_stopped_at = null;
    meta.active_invocation_last_heartbeat_at = null;
    meta.active_invocation_orphan_observed_at = null;
    meta.active_invocation_reason = input.reason;
    meta.active_invocation_started_at = startedAt;
    meta.active_invocation_worker_version_id = normalizeOptionalString(
      input.workerVersionId ?? null,
    );
    meta.active_workspace_version = null;
    if (input.consumePendingNudge !== false) {
      meta.pending_nudge = 0;
      meta.pending_work = 0;
    }
    this.clearAlarmMetaSync(meta);
    this.clearLastErrorMetaSync(meta);
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      expiresAt,
      leaseGeneration: nextLeaseGeneration.toString(),
      reason: input.reason,
      startedAt,
      userId: input.userId,
      workerVersionId: meta.active_invocation_worker_version_id,
      workspaceVersion: null,
    };
  }

  async bindInvocationWorkspaceVersion(input: {
    lease: RunnerInvocationLease;
    workspaceVersion: string;
  }): Promise<RunnerInvocationLease> {
    const meta = this.requireMetaRowSync();
    if (!this.hasActiveInvocationLeaseSync(meta, input.lease)) {
      throw new Error("Hosted runner invocation lease is stale.");
    }

    meta.active_workspace_version = input.workspaceVersion;
    meta.active_invocation_last_heartbeat_at = null;
    meta.active_invocation_orphan_observed_at = null;
    this.writeMetaRowSync(meta);
    return {
      ...input.lease,
      workspaceVersion: input.workspaceVersion,
    };
  }

  async ageActiveInvocationForTest(input: {
    startedAt: string;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    if (!meta.active_invocation_id) {
      throw new Error("Hosted runner has no active invocation to age for test.");
    }
    meta.active_invocation_started_at = normalizeIsoDateString(input.startedAt);
    meta.active_invocation_expires_at = normalizeIsoDateString(input.startedAt);
    meta.active_invocation_last_heartbeat_at = null;
    meta.active_invocation_orphan_observed_at = null;
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async completeInvocation(input: {
    finishedAt?: string | null;
    lease: RunnerInvocationLease;
  }): Promise<{
    completed: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    if (!this.clearActiveInvocationLeaseSync(meta, input.lease)) {
      return {
        completed: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    this.clearLastErrorMetaSync(meta);
    meta.retry_failure_count = 0;
    meta.last_invocation_at = input.finishedAt ?? new Date().toISOString();
    this.writeMetaRowSync(meta);

    return {
      completed: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async failInvocation(input: {
    error: unknown;
    finishedAt?: string | null;
    lease: RunnerInvocationLease;
  }): Promise<{
    failed: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    if (!this.clearActiveInvocationLeaseSync(meta, input.lease)) {
      return {
        failed: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    meta.last_error_at = input.finishedAt ?? new Date().toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    meta.retry_failure_count = normalizeRetryFailureCount(meta.retry_failure_count) + 1;
    this.writeMetaRowSync(meta);

    return {
      failed: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async recordInvocationStartFailure(input: {
    error: unknown;
    failedAt?: string | null;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.last_error_at = input.failedAt ?? new Date().toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    meta.retry_failure_count = normalizeRetryFailureCount(meta.retry_failure_count) + 1;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async recordActiveInvocationContainerStopped(input: {
    attemptId: string;
    leaseGeneration: string;
    stoppedAt?: string | null;
    userId: string;
  }): Promise<{
    recorded: boolean;
    record: RunnerStateRecord | null;
  }> {
    const meta = this.selectMetaRowSync();
    if (!meta || meta.user_id !== input.userId) {
      return {
        recorded: false,
        record: meta ? this.readStateFromMetaSync(meta) : null,
      };
    }
    if (
      meta.active_invocation_id !== input.attemptId
      || normalizeLeaseGeneration(meta.lease_generation).toString() !== input.leaseGeneration
    ) {
      return {
        recorded: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    preserveConsumedNudgeAfterActiveInvocationClears(meta);
    meta.active_invocation_container_stopped_at = normalizeOptionalIsoDateString(
      input.stoppedAt ?? null,
    ) ?? new Date().toISOString();
    this.writeMetaRowSync(meta);
    return {
      recorded: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async clearActiveInvocationForUserDeletion(userId: string): Promise<{
    attemptId: string | null;
    cleared: boolean;
  }> {
    const meta = this.selectMetaRowSync();
    if (meta && meta.user_id !== userId) {
      throw new Error(
        `Hosted runner Durable Object is bound to ${meta.user_id}, not ${userId}.`,
      );
    }

    if (!meta || (meta.in_flight !== 1 && !meta.active_invocation_id)) {
      return {
        attemptId: null,
        cleared: false,
      };
    }

    const attemptId = meta.active_invocation_id;
    this.clearActiveInvocationMetaSync(meta);
    meta.in_flight = 0;
    meta.pending_nudge = 0;
    meta.pending_work = 0;
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      cleared: true,
    };
  }

  async markPendingInvocationNudge(input: {
    preferredWakeAt?: string | null;
    resetRetryFailureCount?: boolean;
  } = {}): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.markPendingWorkMetaSync(meta, {
      preferredWakeAt: input.preferredWakeAt,
      resetRetryFailureCount: input.resetRetryFailureCount,
    });
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async clearPendingInvocationNudge(input: {
    expectedPendingNudgeGeneration: number;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    if (
      meta.pending_nudge !== 1
      || normalizeRetryFailureCount(meta.pending_nudge_generation)
        !== input.expectedPendingNudgeGeneration
    ) {
      return this.readStateFromMetaSync(meta);
    }

    meta.pending_nudge = 0;
    meta.pending_work = 0;
    if (this.readRunnerAlarmKindFromMetaSync(meta) === "work") {
      this.clearAlarmMetaSync(meta);
    }
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async scheduleAlarm(input: {
    checkpointNextWakeAt?: string | null;
    dueAt: string;
    kind: RunnerAlarmKind;
    workspaceVersion?: string | null;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.setAlarmMetaSync(meta, {
      checkpointNextWakeAt: input.checkpointNextWakeAt ?? null,
      dueAt: input.dueAt,
      kind: input.kind,
      workspaceVersion: input.workspaceVersion ?? null,
    });
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async scheduleIdleShutdownCheckpoint(input: {
    checkpointNextWakeAt?: string | null;
    dueAt: string;
    workspaceVersion: string;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.setAlarmMetaSync(meta, {
      checkpointNextWakeAt: input.checkpointNextWakeAt ?? null,
      dueAt: input.dueAt,
      kind: "idle_checkpoint",
      workspaceVersion: input.workspaceVersion,
    });
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async scheduleIdleShutdownCheckpointIfStillQuiet(input: {
    checkpointNextWakeAt?: string | null;
    dueAt: string;
    workspaceVersion: string;
  }): Promise<
    | {
      record: RunnerStateRecord;
      scheduled: false;
    }
    | {
      record: RunnerStateRecord;
      scheduled: true;
    }
  > {
    const meta = this.requireMetaRowSync();
    const currentRecord = this.readStateFromMetaSync(meta);
    if (currentRecord.pendingNudge || currentRecord.inFlight) {
      return {
        record: currentRecord,
        scheduled: false,
      };
    }

    this.setAlarmMetaSync(meta, {
      checkpointNextWakeAt: input.checkpointNextWakeAt ?? null,
      dueAt: input.dueAt,
      kind: "idle_checkpoint",
      workspaceVersion: input.workspaceVersion,
    });
    this.writeMetaRowSync(meta);

    return {
      record: this.readStateFromMetaSync(meta),
      scheduled: true,
    };
  }

  async clearIdleShutdownCheckpoint(): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.syncLegacyAlarmIntoV2MetaSync(meta);
    if (this.readRunnerAlarmKindFromMetaSync(meta) === "idle_checkpoint") {
      this.clearAlarmMetaSync(meta);
    }
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async markDeferredCheckpointRequired(input: {
    redactedStatus: HostedRuntimeRedactedJson | null;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.deferred_checkpoint_required = 1;
    meta.deferred_checkpoint_mailbox_status_json =
      stringifyRunnerDeferredCheckpointMailboxStatus(input.redactedStatus);
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async clearDeferredCheckpointRequired(): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.deferred_checkpoint_required = 0;
    meta.deferred_checkpoint_mailbox_status_json = null;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async readActiveInvocationLease(): Promise<RunnerInvocationLease | null> {
    return this.readActiveInvocationLeaseSync(this.requireMetaRowSync());
  }

  async ownsActiveInvocationLease(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<RunnerInvocationLeaseOwnershipResult> {
    const meta = this.requireMetaRowSync();
    if (this.clearActiveInvocationIfExpiredSync(meta, Date.now())) {
      return {
        clearedOrphanObservation: false,
        owns: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    const lease = this.readActiveInvocationLeaseSync(meta);
    if (
      !lease
      || lease.attemptId !== input.attemptId
      || lease.leaseGeneration !== input.leaseGeneration
      || lease.userId !== input.userId
    ) {
      return {
        clearedOrphanObservation: false,
        owns: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const ownsLease = (
      input.workspaceVersion === undefined
      || input.workspaceVersion === null
      || lease.workspaceVersion === input.workspaceVersion
    );
    const clearedOrphanObservation = ownsLease
      && meta.active_invocation_orphan_observed_at !== null;
    if (ownsLease) {
      meta.active_invocation_last_heartbeat_at = new Date().toISOString();
      meta.active_invocation_orphan_observed_at = null;
      this.writeMetaRowSync(meta);
    }

    return {
      clearedOrphanObservation,
      owns: ownsLease,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async recordActiveInvocationWorkspaceCheckpoint(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<RunnerInvocationCheckpointResult> {
    const meta = this.requireMetaRowSync();
    if (this.clearActiveInvocationIfExpiredSync(meta, Date.now())) {
      return {
        clearedOrphanObservation: false,
        recorded: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    const lease = this.readActiveInvocationLeaseSync(meta);
    if (
      !lease
      || lease.attemptId !== input.attemptId
      || lease.leaseGeneration !== input.leaseGeneration
      || lease.userId !== input.userId
    ) {
      return {
        clearedOrphanObservation: false,
        recorded: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const clearedOrphanObservation = meta.active_invocation_orphan_observed_at !== null;
    meta.active_workspace_version = input.workspaceVersion;
    meta.active_invocation_last_heartbeat_at = new Date().toISOString();
    meta.active_invocation_orphan_observed_at = null;
    this.writeMetaRowSync(meta);
    return {
      clearedOrphanObservation,
      recorded: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async recordActiveInvocationHeartbeat(input: {
    attemptId: string;
    leaseGeneration: string;
    nowMs?: number | null;
    userId: string;
  }): Promise<RunnerInvocationHeartbeatResult> {
    const meta = this.requireMetaRowSync();
    if (this.clearActiveInvocationIfExpiredSync(meta, input.nowMs ?? Date.now())) {
      return {
        ok: false,
        reason: "no_active_invocation",
        record: this.readStateFromMetaSync(meta),
      };
    }
    const lease = this.readActiveInvocationLeaseSync(meta);
    if (!lease) {
      return {
        ok: false,
        reason: "no_active_invocation",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (lease.attemptId !== input.attemptId) {
      return {
        ok: false,
        reason: "stale_attempt",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (lease.leaseGeneration !== input.leaseGeneration) {
      return {
        ok: false,
        reason: "stale_generation",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (lease.userId !== input.userId) {
      return {
        ok: false,
        reason: "wrong_user",
        record: this.readStateFromMetaSync(meta),
      };
    }
    meta.active_invocation_last_heartbeat_at = new Date(input.nowMs ?? Date.now()).toISOString();
    meta.active_invocation_orphan_observed_at = null;
    this.writeMetaRowSync(meta);
    return {
      ok: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async recordActiveInvocationHeartbeatInstruction(input: {
    attemptId: string;
    heartbeatStaleMs: number;
    leaseGeneration: string;
    nowMs?: number | null;
    runnerReadyTimeoutMs: number;
    runnerTimeoutMs: number;
    userId: string;
  }): Promise<RunnerHeartbeatInstruction> {
    const nowMs = input.nowMs ?? Date.now();
    const meta = this.requireMetaRowSync();
    if (this.clearActiveInvocationIfExpiredSync(meta, nowMs)) {
      return {
        kind: "abort",
        reason: "no_active_invocation",
        record: this.readStateFromMetaSync(meta),
      };
    }
    const lease = this.readActiveInvocationLeaseSync(meta);
    if (!lease) {
      return {
        kind: "abort",
        reason: "no_active_invocation",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (lease.attemptId !== input.attemptId) {
      return {
        kind: "abort",
        reason: "stale_attempt",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (lease.leaseGeneration !== input.leaseGeneration) {
      return {
        kind: "abort",
        reason: "stale_generation",
        record: this.readStateFromMetaSync(meta),
      };
    }
    if (lease.userId !== input.userId) {
      return {
        kind: "abort",
        reason: "wrong_user",
        record: this.readStateFromMetaSync(meta),
      };
    }

    meta.active_invocation_last_heartbeat_at = new Date(nowMs).toISOString();
    meta.active_invocation_orphan_observed_at = null;
    const pendingWorkPresent = meta.pending_work === 1 || meta.pending_nudge === 1;
    if (!pendingWorkPresent) {
      this.writeMetaRowSync(meta);
      return {
        kind: "continue",
        record: this.readStateFromMetaSync(meta),
      };
    }

    const activeReason = isHostedWorkspaceInvocationReasonValue(meta.active_invocation_reason)
      ? meta.active_invocation_reason
      : lease.reason;
    const recordBeforeAlarm = this.readStateFromMetaSync(meta);
    const nextWakeAt = resolvePendingWorkWakeAt({
      heartbeatStaleMs: input.heartbeatStaleMs,
      nowMs,
      record: recordBeforeAlarm,
      runnerReadyTimeoutMs: input.runnerReadyTimeoutMs,
      runnerTimeoutMs: input.runnerTimeoutMs,
    });
    this.setAlarmMetaSync(meta, {
      dueAt: nextWakeAt,
      kind: "work",
      workspaceVersion: null,
    });
    this.writeMetaRowSync(meta);
    return {
      activeInvocation: {
        attemptId: lease.attemptId,
        leaseGeneration: lease.leaseGeneration,
        reason: activeReason,
        userId: lease.userId,
      },
      kind: "yield",
      nextWakeAt,
      record: this.readStateFromMetaSync(meta),
      status: "scheduled",
    };
  }

  async clearStaleInvocationIfExpired(input: {
    currentWorkerVersionId?: string | null;
    heartbeatStaleMs: number;
    nowMs: number;
    readyTimeoutMs: number;
    timeoutMs: number;
  }): Promise<RunnerStaleInvocationRecoveryResult> {
    const meta = this.requireMetaRowSync();
    const attemptId = meta.active_invocation_id;
    const startedAt = meta.active_invocation_started_at;
    if (!attemptId || !startedAt) {
      return {
        attemptId,
        cleared: false,
        nextRecoveryAt: null,
        reason: "none",
        record: this.readStateFromMetaSync(meta),
      };
    }

    const decision = resolveActiveInvocationRecoveryDecision({
      activeWorkerVersionId: meta.active_invocation_worker_version_id,
      containerStopped: meta.active_invocation_container_stopped_at !== null,
      currentWorkerVersionId: input.currentWorkerVersionId ?? null,
      expiresAt: meta.active_invocation_expires_at,
      heartbeatStaleMs: input.heartbeatStaleMs,
      lastHeartbeatAt: meta.active_invocation_last_heartbeat_at,
      nowMs: input.nowMs,
      readyTimeoutMs: input.readyTimeoutMs,
      startedAt,
      timeoutMs: input.timeoutMs,
    });
    if (decision.kind === "live") {
      return {
        attemptId,
        cleared: false,
        nextRecoveryAt: decision.nextRecoveryAt,
        reason: "none",
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (decision.reason === "container_stopped") {
      preserveConsumedNudgeAfterActiveInvocationClears(meta);
      this.clearActiveInvocationMetaSync(meta);
      meta.in_flight = 0;
      meta.last_error_at = new Date(input.nowMs).toISOString();
      meta.last_error_code = deriveHostedExecutionErrorCode(
        new Error("Hosted workspace invocation container stopped during active work."),
      );
      meta.retry_failure_count = normalizeRetryFailureCount(meta.retry_failure_count) + 1;
      this.writeMetaRowSync(meta);

      return {
        attemptId,
        cleared: true,
        nextRecoveryAt: null,
        reason: "container_stopped",
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (decision.reason === "worker_version_mismatch") {
      preserveConsumedNudgeAfterActiveInvocationClears(meta);
      this.clearActiveInvocationMetaSync(meta);
      meta.in_flight = 0;
      meta.last_error_at = new Date(input.nowMs).toISOString();
      meta.last_error_code = deriveHostedExecutionErrorCode(
        new Error("Hosted workspace invocation belonged to a previous worker version."),
      );
      meta.retry_failure_count = normalizeRetryFailureCount(meta.retry_failure_count) + 1;
      this.writeMetaRowSync(meta);

      return {
        attemptId,
        cleared: true,
        nextRecoveryAt: null,
        reason: "worker_version_mismatch",
        record: this.readStateFromMetaSync(meta),
      };
    }

    preserveConsumedNudgeAfterActiveInvocationClears(meta);
    this.clearActiveInvocationMetaSync(meta);
    meta.in_flight = 0;
    meta.last_error_at = new Date(input.nowMs).toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(
      new Error("Hosted workspace invocation timed out."),
    );
    meta.retry_failure_count = normalizeRetryFailureCount(meta.retry_failure_count) + 1;
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      cleared: true,
      nextRecoveryAt: null,
      reason: "expired",
      record: this.readStateFromMetaSync(meta),
    };
  }

  async syncNextWake(input: {
    preferredWakeAt?: string | null;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    const nextWakeAt = resolveRunnerNextWakeAt({
      preferredWakeAt: input.preferredWakeAt ?? null,
    });
    if (nextWakeAt) {
      this.setAlarmMetaSync(meta, {
        dueAt: nextWakeAt,
        kind: "work",
        workspaceVersion: null,
      });
    } else if (this.readRunnerAlarmKindFromMetaSync(meta) === "work") {
      this.clearAlarmMetaSync(meta);
    }
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  private readStateSync(): RunnerStateRecord {
    return this.readStateFromMetaSync(this.requireMetaRowSync());
  }

  private readStateFromMetaSync(meta: RunnerMetaBundleRow): RunnerStateRecord {
    this.syncLegacyAlarmIntoV2MetaSync(meta);
    return projectRunnerStateRecord({
      bundleRef: null,
      meta,
    }).record;
  }

  private requireMetaRowSync(): RunnerMetaBundleRow {
    const row = this.selectMetaRowSync();
    if (row) {
      return row;
    }

    const userId = this.tryResolveUserIdSync();
    if (!userId) {
      throw new Error("Hosted runner user is not initialized.");
    }

    const meta = createDefaultRunnerMetaRow(userId);
    this.insertMetaRowSync(meta);
    return meta;
  }

  private tryResolveUserIdSync(): string | null {
    if (this.userId) {
      return this.userId;
    }

    const row = this.selectMetaRowSync();
    if (!row) {
      return null;
    }

    this.userId = row.user_id;
    return row.user_id;
  }

  private selectMetaRowSync(): RunnerMetaBundleRow | null {
    const row = this.sql.exec<RunnerMetaBundleRow>(
      `SELECT
        user_id,
        active_invocation_id,
        active_invocation_expires_at,
        active_invocation_container_stopped_at,
        active_invocation_last_heartbeat_at,
        active_invocation_orphan_observed_at,
        active_invocation_reason,
        active_invocation_started_at,
        active_invocation_worker_version_id,
        active_workspace_version,
        alarm_kind,
        alarm_due_at,
        alarm_workspace_version,
        alarm_checkpoint_next_wake_at,
        lease_generation,
        in_flight,
        last_error_at,
        last_error_code,
        last_invocation_at,
        deferred_checkpoint_required,
        deferred_checkpoint_mailbox_status_json,
        idle_shutdown_checkpoint_due_at,
        idle_shutdown_checkpoint_workspace_version,
        next_wake_at,
        pending_nudge,
        pending_nudge_generation,
        pending_work,
        retry_failure_count
      FROM runner_meta
      WHERE singleton = 1`,
    ).toArray()[0] ?? null;

    if (row) {
      this.userId = row.user_id;
    }

    return row;
  }

  private insertMetaRowSync(meta: RunnerMetaBundleRow): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO runner_meta (
        singleton,
        user_id,
        active_invocation_id,
        active_invocation_expires_at,
        active_invocation_container_stopped_at,
        active_invocation_last_heartbeat_at,
        active_invocation_orphan_observed_at,
        active_invocation_reason,
        active_invocation_started_at,
        active_invocation_worker_version_id,
        active_workspace_version,
        alarm_kind,
        alarm_due_at,
        alarm_workspace_version,
        alarm_checkpoint_next_wake_at,
        lease_generation,
        in_flight,
        last_error_at,
        last_error_code,
        last_invocation_at,
        deferred_checkpoint_required,
        deferred_checkpoint_mailbox_status_json,
        idle_shutdown_checkpoint_due_at,
        idle_shutdown_checkpoint_workspace_version,
        next_wake_at,
        pending_nudge,
        pending_nudge_generation,
        pending_work,
        retry_failure_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.active_invocation_id,
      meta.active_invocation_expires_at,
      meta.active_invocation_container_stopped_at,
      meta.active_invocation_last_heartbeat_at,
      meta.active_invocation_orphan_observed_at,
      meta.active_invocation_reason,
      meta.active_invocation_started_at,
      meta.active_invocation_worker_version_id,
      meta.active_workspace_version,
      meta.alarm_kind,
      meta.alarm_due_at,
      meta.alarm_workspace_version,
      meta.alarm_checkpoint_next_wake_at,
      meta.lease_generation,
      meta.in_flight,
      meta.last_error_at,
      meta.last_error_code,
      meta.last_invocation_at,
      meta.deferred_checkpoint_required,
      meta.deferred_checkpoint_mailbox_status_json,
      meta.idle_shutdown_checkpoint_due_at,
      meta.idle_shutdown_checkpoint_workspace_version,
      meta.next_wake_at,
      meta.pending_nudge,
      normalizeRetryFailureCount(meta.pending_nudge_generation),
      meta.pending_work,
      normalizeRetryFailureCount(meta.retry_failure_count),
    );
  }

  private writeMetaRowSync(meta: RunnerMetaBundleRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
  }

  private markPendingWorkMetaSync(
    meta: RunnerMetaRow,
    input: {
      preferredWakeAt?: string | null;
      resetRetryFailureCount?: boolean;
    },
  ): void {
    if (input.resetRetryFailureCount === true) {
      this.clearLastErrorMetaSync(meta);
      meta.retry_failure_count = 0;
    }
    meta.pending_nudge = 1;
    meta.pending_work = 1;
    meta.pending_nudge_generation =
      normalizeRetryFailureCount(meta.pending_nudge_generation) + 1;
    this.setAlarmMetaSync(meta, {
      dueAt: resolveRunnerNextWakeAt({
        preferredWakeAt: input.preferredWakeAt ?? new Date().toISOString(),
      }) ?? new Date().toISOString(),
      kind: "work",
      workspaceVersion: null,
    });
  }

  private clearActiveInvocationLeaseSync(
    meta: RunnerMetaRow,
    lease: RunnerInvocationLease,
  ): boolean {
    if (!this.hasActiveInvocationLeaseSync(meta, lease)) {
      return false;
    }

    this.clearActiveInvocationMetaSync(meta);
    meta.in_flight = 0;
    return true;
  }

  private clearActiveInvocationIfExpiredSync(meta: RunnerMetaRow, nowMs: number): boolean {
    const lease = this.readActiveInvocationLeaseSync(meta);
    if (!lease) {
      return false;
    }

    const expiresAtMs = Date.parse(lease.expiresAt);
    if (Number.isFinite(expiresAtMs) && nowMs < expiresAtMs) {
      return false;
    }

    preserveConsumedNudgeAfterActiveInvocationClears(meta);
    this.clearActiveInvocationMetaSync(meta);
    meta.in_flight = 0;
    meta.last_error_at = new Date(nowMs).toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(
      new Error("Hosted workspace invocation timed out."),
    );
    meta.retry_failure_count = normalizeRetryFailureCount(meta.retry_failure_count) + 1;
    this.writeMetaRowSync(meta);
    return true;
  }

  private clearActiveInvocationMetaSync(meta: RunnerMetaRow): void {
    meta.active_invocation_id = null;
    meta.active_invocation_expires_at = null;
    meta.active_invocation_container_stopped_at = null;
    meta.active_invocation_last_heartbeat_at = null;
    meta.active_invocation_orphan_observed_at = null;
    meta.active_invocation_reason = null;
    meta.active_invocation_started_at = null;
    meta.active_invocation_worker_version_id = null;
    meta.active_workspace_version = null;
  }

  private hasActiveInvocationLeaseSync(
    meta: RunnerMetaRow,
    lease: RunnerInvocationLease,
  ): boolean {
    return meta.active_invocation_id === lease.attemptId
      && normalizeLeaseGeneration(meta.lease_generation).toString() === lease.leaseGeneration
      && meta.user_id === lease.userId;
  }

  private clearLastErrorMetaSync(meta: RunnerMetaRow): void {
    meta.last_error_at = null;
    meta.last_error_code = null;
  }

  private clearAlarmMetaSync(meta: RunnerMetaRow): void {
    meta.alarm_kind = null;
    meta.alarm_due_at = null;
    meta.alarm_workspace_version = null;
    meta.alarm_checkpoint_next_wake_at = null;
    meta.next_wake_at = null;
    meta.idle_shutdown_checkpoint_due_at = null;
    meta.idle_shutdown_checkpoint_workspace_version = null;
  }

  private setAlarmMetaSync(
    meta: RunnerMetaRow,
    input: {
      checkpointNextWakeAt?: string | null;
      dueAt: string;
      kind: RunnerAlarmKind;
      workspaceVersion: string | null;
    },
  ): void {
    const dueAt = normalizeIsoDateString(input.dueAt);
    const checkpointNextWakeAt = normalizeOptionalIsoDateString(
      input.checkpointNextWakeAt ?? null,
    );
    meta.alarm_kind = input.kind;
    meta.alarm_due_at = dueAt;
    meta.alarm_workspace_version = input.workspaceVersion;
    meta.alarm_checkpoint_next_wake_at = checkpointNextWakeAt;
    if (input.kind === "work") {
      meta.next_wake_at = dueAt;
      meta.idle_shutdown_checkpoint_due_at = null;
      meta.idle_shutdown_checkpoint_workspace_version = null;
      return;
    }

    meta.next_wake_at = checkpointNextWakeAt;
    meta.idle_shutdown_checkpoint_due_at = dueAt;
    meta.idle_shutdown_checkpoint_workspace_version = input.workspaceVersion;
  }

  private syncLegacyAlarmIntoV2MetaSync(meta: RunnerMetaRow): void {
    if (this.readRunnerAlarmKindFromMetaSync(meta) !== null) {
      return;
    }

    if (meta.idle_shutdown_checkpoint_due_at) {
      this.setAlarmMetaSync(meta, {
        checkpointNextWakeAt: meta.next_wake_at,
        dueAt: meta.idle_shutdown_checkpoint_due_at,
        kind: "idle_checkpoint",
        workspaceVersion: meta.idle_shutdown_checkpoint_workspace_version,
      });
      return;
    }

    if (meta.next_wake_at) {
      this.setAlarmMetaSync(meta, {
        dueAt: meta.next_wake_at,
        kind: "work",
        workspaceVersion: null,
      });
    }
  }

  private readRunnerAlarmKindFromMetaSync(meta: RunnerMetaRow): RunnerAlarmKind | null {
    return meta.alarm_kind === "work" || meta.alarm_kind === "idle_checkpoint"
      ? meta.alarm_kind
      : null;
  }

  private readActiveInvocationLeaseSync(meta: RunnerMetaRow): RunnerInvocationLease | null {
    if (
      !meta.active_invocation_id
      || !meta.active_invocation_started_at
      || !isHostedWorkspaceInvocationReasonValue(meta.active_invocation_reason)
    ) {
      return null;
    }

    return {
      attemptId: meta.active_invocation_id,
      expiresAt: meta.active_invocation_expires_at
        ?? new Date(Date.parse(meta.active_invocation_started_at) + 30 * 60_000).toISOString(),
      leaseGeneration: normalizeLeaseGeneration(meta.lease_generation).toString(),
      reason: meta.active_invocation_reason,
      startedAt: meta.active_invocation_started_at,
      userId: meta.user_id,
      workerVersionId: normalizeOptionalString(meta.active_invocation_worker_version_id),
      workspaceVersion: meta.active_workspace_version,
    };
  }

  private get sql() {
    const sql = this.state.storage.sql;
    if (!sql) {
      throw new Error("Hosted runner Durable Object storage.sql is required.");
    }

    return sql;
  }
}

function normalizeLeaseGeneration(value: number | null): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isHostedWorkspaceInvocationReasonValue(
  value: unknown,
): value is HostedWorkspaceInvocationReason {
  return value === "nudge"
    || value === "alarm"
    || value === "retry"
    || value === "manual"
    || value === "idle_shutdown_checkpoint";
}

function preserveConsumedNudgeAfterActiveInvocationClears(meta: RunnerMetaRow): void {
  if (meta.active_invocation_reason !== "nudge") {
    return;
  }

  meta.pending_nudge = 1;
  meta.pending_nudge_generation =
    normalizeRetryFailureCount(meta.pending_nudge_generation) + 1;
  meta.pending_work = 1;
}

function resolvePendingWorkWakeAt(input: {
  heartbeatStaleMs: number;
  nowMs: number;
  record: RunnerStateRecord;
  runnerReadyTimeoutMs: number;
  runnerTimeoutMs: number;
}): string {
  const decision = resolveRunnerRecordActiveInvocationRecoveryDecision(input);
  if (decision.kind === "live" && decision.nextRecoveryAt) {
    return decision.nextRecoveryAt;
  }
  return new Date(input.nowMs).toISOString();
}

function resolvePendingWorkDrainContinuationWakeAt(input: {
  activeRecoveryWakeAt?: string | null;
  heartbeatStaleMs: number;
  nowMs: number;
  pendingWorkContinuationDelayMs: number;
  record: RunnerStateRecord;
  runnerReadyTimeoutMs: number;
  runnerTimeoutMs: number;
}): string {
  const decision = resolveRunnerRecordActiveInvocationRecoveryDecision(input);
  const recoveryWakeAt = input.activeRecoveryWakeAt
    ?? (decision.kind === "live" && decision.nextRecoveryAt
      ? decision.nextRecoveryAt
      : new Date(input.nowMs).toISOString());
  const invocation = input.record.workspaceInvocation;
  const lastHeartbeatAtMs = invocation?.lastHeartbeatAt
    ? Date.parse(invocation.lastHeartbeatAt)
    : Number.NaN;
  if (input.activeRecoveryWakeAt && invocation && !Number.isFinite(lastHeartbeatAtMs)) {
    return input.activeRecoveryWakeAt;
  }
  if (decision.kind === "live" && decision.reason === "starting") {
    return recoveryWakeAt;
  }

  const continuationWakeAt = new Date(
    input.nowMs + input.pendingWorkContinuationDelayMs,
  ).toISOString();
  return earliestIsoDate(recoveryWakeAt, continuationWakeAt) ?? continuationWakeAt;
}

function resolveRunnerRecordActiveInvocationRecoveryDecision(input: {
  heartbeatStaleMs: number;
  nowMs: number;
  record: RunnerStateRecord;
  runnerReadyTimeoutMs: number;
  runnerTimeoutMs: number;
}): ActiveInvocationRecoveryDecision {
  const invocation = input.record.workspaceInvocation;
  const activeExpiresAt = input.record.active?.expiresAt ?? null;
  const activeStartedAt = input.record.active?.startedAt ?? null;
  return resolveActiveInvocationRecoveryDecision({
    activeWorkerVersionId: null,
    containerStopped: false,
    currentWorkerVersionId: null,
    expiresAt: activeExpiresAt !== activeStartedAt ? activeExpiresAt : null,
    heartbeatStaleMs: input.heartbeatStaleMs,
    lastHeartbeatAt: invocation?.lastHeartbeatAt ?? null,
    nowMs: input.nowMs,
    readyTimeoutMs: input.runnerReadyTimeoutMs,
    startedAt: invocation?.startedAt ?? null,
    timeoutMs: input.runnerTimeoutMs,
  });
}

function resolvePendingWorkRetryDelayMs(input: {
  defaultRetryDelayMs: number;
  immediateRetryDelayMs: number;
  maxRetryDelayMs: number;
  retryBackoffMultiplier: number;
  retryFailureCount: number;
}): number {
  const retryFailureCount = Math.max(0, Math.floor(input.retryFailureCount));
  const backoffStep = Math.max(0, retryFailureCount - 1);
  const exponentialDelay = input.immediateRetryDelayMs
    * (input.retryBackoffMultiplier ** backoffStep);
  return Math.min(
    input.defaultRetryDelayMs,
    exponentialDelay,
    input.maxRetryDelayMs,
  );
}

function earliestIsoDate(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) {
    return right;
  }
  if (!Number.isFinite(rightMs)) {
    return left;
  }
  return rightMs < leftMs ? right : left;
}

function normalizeIsoDateString(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted runner idle checkpoint due time must be an ISO date string.");
  }

  return parsed.toISOString();
}

function normalizeOptionalIsoDateString(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return normalizeIsoDateString(value);
}

function normalizeOptionalString(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
