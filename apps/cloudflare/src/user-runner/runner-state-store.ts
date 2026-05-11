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
  normalizeIsoDate,
  normalizeIsoDateOrNull,
  normalizeNonNegativeInteger,
  normalizePreferredWakeAt,
  projectRunnerStateRecord,
  stringifyRunnerDeferredCheckpointMailboxStatus,
  type RunnerMetaRow,
} from "./runner-state-helpers.js";
import {
  type DurableObjectStateLike,
  type RunnerWriteFenceKind,
  type RunnerStateRecord,
} from "./types.js";

type RunnerMetaBundleRow = RunnerMetaRow;

export interface RunnerWriteFenceToken {
  attemptId: string;
  expiresAt: string;
  generation: string;
  leaseGeneration: string;
  reason: HostedWorkspaceInvocationReason;
  startedAt: string;
  userId: string;
  workerVersionId: string | null;
  workspaceVersion: string | null;
}

export type RunnerInvocationLease = RunnerWriteFenceToken;

export class RunnerWriteFenceAlreadyActiveError extends Error {
  readonly record: RunnerStateRecord;

  constructor(record: RunnerStateRecord) {
    super("Hosted runner write fence is already active.");
    this.name = "RunnerWriteFenceAlreadyActiveError";
    this.record = record;
  }
}

export interface RunnerWriteFenceValidationResult {
  owns: boolean;
  record: RunnerStateRecord;
}

export type RunnerDueWork =
  | {
      kind: "idle";
      record: RunnerStateRecord;
    }
  | {
      kind: "runtime";
      reason: "next_wake" | "retry" | "wake_pending";
      record: RunnerStateRecord;
    }
  | {
      checkpointNextWakeAt: string | null;
      kind: "idle_checkpoint";
      record: RunnerStateRecord;
      workspaceVersion: string;
    };

export type RunnerExpiredActiveRunResult =
  | {
      cleared: false;
      record: RunnerStateRecord;
    }
  | {
      cleared: true;
      record: RunnerStateRecord;
    };

export function resolveActiveInvocationRecoveryDecision(_input?: unknown): { action: "none" } {
  return { action: "none" };
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
        throw new Error("Hosted runner Durable Object is already bound to a different user.");
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
      throw new Error("Hosted runner Durable Object is bound to a different user.");
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
      throw new Error("Hosted runner Durable Object is bound to a different user.");
    }
  }

  async markWakePending(input: {
    clearIdleCheckpoint?: boolean;
    preferredWakeAt?: string | null;
    resetRetry?: boolean;
  } = {}): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.wake_pending = 1;
    if (input.resetRetry === true) {
      meta.retry_at = null;
      meta.retry_count = 0;
      meta.retry_last_error_code = null;
      meta.last_error_at = null;
      meta.last_error_code = null;
    }
    if (input.clearIdleCheckpoint !== false) {
      this.clearIdleCheckpointMetaSync(meta);
    }
    const nextWakeAt = normalizePreferredWakeAt(input.preferredWakeAt ?? new Date().toISOString())
      ?? new Date().toISOString();
    meta.next_wake_at = nextWakeAt;
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async clearWakePending(): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.wake_pending = 0;
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async readDueWork(nowMs: number): Promise<RunnerDueWork> {
    let meta = this.requireMetaRowSync();
    const expired = this.clearExpiredActiveRunSync(meta, nowMs);
    if (expired) {
      this.writeMetaRowSync(meta);
      meta = this.requireMetaRowSync();
    }

    const record = this.readStateFromMetaSync(meta);
    if (record.writeFence) {
      return { kind: "idle", record };
    }
    if (record.wakePending) {
      return { kind: "runtime", reason: "wake_pending", record };
    }
    if (record.retry.at && Date.parse(record.retry.at) <= nowMs) {
      return { kind: "runtime", reason: "retry", record };
    }
    if (record.nextWakeAt && Date.parse(record.nextWakeAt) <= nowMs) {
      return { kind: "runtime", reason: "next_wake", record };
    }
    if (record.idleCheckpoint && Date.parse(record.idleCheckpoint.dueAt) <= nowMs) {
      return {
        checkpointNextWakeAt: record.idleCheckpoint.checkpointNextWakeAt,
        kind: "idle_checkpoint",
        record,
        workspaceVersion: record.idleCheckpoint.workspaceVersion,
      };
    }
    return { kind: "idle", record };
  }

  async clearExpiredWriteFence(nowMs: number): Promise<RunnerExpiredActiveRunResult> {
    const meta = this.requireMetaRowSync();
    const cleared = this.clearExpiredActiveRunSync(meta, nowMs);
    if (cleared) {
      this.writeMetaRowSync(meta);
    }
    return {
      cleared,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async beginWriteFence(input: {
    consumePendingNudge?: boolean;
    kind?: RunnerWriteFenceKind;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
    expiresAt?: string | null;
    workerVersionId?: string | null;
  }): Promise<RunnerWriteFenceToken> {
    await this.bindUser(input.userId);

    const meta = this.requireMetaRowSync();
    if (this.readWriteFenceTokenSync(meta)) {
      throw new RunnerWriteFenceAlreadyActiveError(this.readStateFromMetaSync(meta));
    }

    const nextGeneration = normalizeNonNegativeInteger(meta.active_generation) + 1;
    const startedAt = new Date().toISOString();
    const expiresAt = normalizeIsoDateOrNull(input.expiresAt ?? null)
      ?? new Date(Date.parse(startedAt) + 30 * 60_000).toISOString();
    const attemptId = createRuntimeWriteAttemptId();

    meta.active_attempt_id = attemptId;
    meta.active_expires_at = expiresAt;
    meta.active_generation = nextGeneration;
    meta.active_kind = input.kind ?? (
      input.reason === "idle_shutdown_checkpoint" ? "idle_checkpoint" : "runtime"
    );
    meta.active_started_at = startedAt;
    meta.active_workspace_version = null;
    if (meta.active_kind === "runtime") {
      meta.wake_pending = 0;
      meta.retry_at = null;
      meta.next_wake_at = null;
    }
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      expiresAt,
      generation: nextGeneration.toString(),
      leaseGeneration: nextGeneration.toString(),
      reason: input.reason,
      startedAt,
      userId: input.userId,
      workerVersionId: null,
      workspaceVersion: null,
    };
  }

  async bindWriteFenceWorkspaceVersion(input: {
    token: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken> {
    const meta = this.requireMetaRowSync();
    if (!this.hasWriteFenceTokenSync(meta, input.token)) {
      throw new Error("Hosted runner write fence is stale.");
    }

    meta.active_workspace_version = input.workspaceVersion;
    this.writeMetaRowSync(meta);
    return {
      ...input.token,
      workspaceVersion: input.workspaceVersion,
    };
  }

  async beginInvocation(input: Parameters<RunnerStateStore["beginWriteFence"]>[0]): Promise<RunnerWriteFenceToken> {
    return await this.beginWriteFence(input);
  }

  async bindInvocationWorkspaceVersion(input: {
    lease: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken> {
    return await this.bindWriteFenceWorkspaceVersion({
      token: input.lease,
      workspaceVersion: input.workspaceVersion,
    });
  }

  async ageActiveInvocationForTest(input: {
    startedAt: string;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    if (!meta.active_attempt_id) {
      throw new Error("Hosted runner has no write fence to age for test.");
    }
    meta.active_started_at = normalizeIsoDate(input.startedAt);
    meta.active_expires_at = normalizeIsoDate(input.startedAt);
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async clearWriteFenceAfterCompletion(input: {
    finishedAt?: string | null;
    token: RunnerWriteFenceToken;
  }): Promise<{
    completed: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    if (!this.clearWriteFenceTokenSync(meta, input.token)) {
      return {
        completed: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    meta.retry_count = 0;
    meta.retry_at = null;
    meta.retry_last_error_code = null;
    meta.last_error_at = null;
    meta.last_error_code = null;
    meta.last_invocation_at = input.finishedAt ?? new Date().toISOString();
    this.writeMetaRowSync(meta);

    return {
      completed: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async completeInvocation(input: {
    finishedAt?: string | null;
    lease: RunnerWriteFenceToken;
  }): Promise<{
    completed: boolean;
    record: RunnerStateRecord;
  }> {
    return await this.clearWriteFenceAfterCompletion({
      finishedAt: input.finishedAt,
      token: input.lease,
    });
  }

  async clearWriteFenceAfterFailure(input: {
    error: unknown;
    finishedAt?: string | null;
    token: RunnerWriteFenceToken;
    retryAt?: string | null;
  }): Promise<{
    failed: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    if (!this.clearWriteFenceTokenSync(meta, input.token)) {
      return {
        failed: false,
        record: this.readStateFromMetaSync(meta),
      };
    }
    const errorCode = deriveHostedExecutionErrorCode(input.error);
    meta.last_error_at = input.finishedAt ?? new Date().toISOString();
    meta.last_error_code = errorCode;
    meta.retry_count = normalizeNonNegativeInteger(meta.retry_count) + 1;
    meta.retry_at = normalizeIsoDate(input.retryAt ?? new Date(Date.now() + 1_000).toISOString());
    meta.retry_last_error_code = errorCode;
    meta.wake_pending = 1;
    this.writeMetaRowSync(meta);

    return {
      failed: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async failInvocation(input: {
    error: unknown;
    finishedAt?: string | null;
    lease: RunnerWriteFenceToken;
    retryAt?: string | null;
  }): Promise<{
    failed: boolean;
    record: RunnerStateRecord;
  }> {
    return await this.clearWriteFenceAfterFailure({
      error: input.error,
      finishedAt: input.finishedAt,
      retryAt: input.retryAt,
      token: input.lease,
    });
  }

  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; this path is intentionally inert.
   */
  async recordActiveInvocationContainerStopped(_input?: unknown): Promise<{ recorded: false; record: RunnerStateRecord }> {
    return {
      recorded: false,
      record: this.readStateFromMetaSync(this.requireMetaRowSync()),
    };
  }

  async clearStaleInvocationIfExpired(_input?: unknown): Promise<RunnerExpiredActiveRunResult> {
    return await this.clearExpiredWriteFence(Date.now());
  }

  async markPendingInvocationNudge(_input?: unknown): Promise<RunnerStateRecord> {
    return await this.markWakePending();
  }

  async clearPendingInvocationNudge(_input?: unknown): Promise<RunnerStateRecord> {
    return await this.clearWakePending();
  }

  async consumeDueRunnerAlarmAndDecide(_input?: unknown): Promise<RunnerDueWork> {
    return await this.readDueWork(Date.now());
  }

  async scheduleIdleShutdownCheckpointIfStillQuiet(input: {
    checkpointNextWakeAt?: string | null;
    dueAt: string;
    workspaceVersion: string;
  }): Promise<RunnerStateRecord> {
    return await this.scheduleIdleCheckpoint(input);
  }

  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; this path is intentionally inert.
   */
  async recordActiveInvocationHeartbeatInstruction(_input?: unknown): Promise<{
    ok: false;
    reason: "no_active_invocation";
  }> {
    return {
      ok: false,
      reason: "no_active_invocation",
    };
  }

  async clearWriteFenceForUserDeletion(userId: string): Promise<{
    attemptId: string | null;
    cleared: boolean;
  }> {
    const meta = this.selectMetaRowSync();
    if (meta && meta.user_id !== userId) {
      throw new Error("Hosted runner Durable Object is bound to a different user.");
    }

    if (!meta || !meta.active_attempt_id) {
      return {
        attemptId: null,
        cleared: false,
      };
    }

    const attemptId = meta.active_attempt_id;
    this.clearActiveRunMetaSync(meta);
    meta.wake_pending = 0;
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      cleared: true,
    };
  }

  async scheduleNextWake(input: {
    nextWakeAt?: string | null;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.next_wake_at = normalizePreferredWakeAt(input.nextWakeAt ?? null);
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async scheduleRetry(input: {
    error?: unknown;
    retryAt: string;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    const errorCode = deriveHostedExecutionErrorCode(input.error);
    meta.retry_at = normalizeIsoDate(input.retryAt);
    meta.retry_count = normalizeNonNegativeInteger(meta.retry_count) + 1;
    meta.retry_last_error_code = errorCode;
    meta.last_error_at = new Date().toISOString();
    meta.last_error_code = errorCode;
    meta.wake_pending = 1;
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async scheduleIdleCheckpoint(input: {
    checkpointNextWakeAt?: string | null;
    dueAt: string;
    workspaceVersion: string;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.idle_checkpoint_due_at = normalizeIsoDate(input.dueAt);
    meta.idle_checkpoint_workspace_version = input.workspaceVersion;
    meta.idle_checkpoint_next_wake_at = normalizeIsoDateOrNull(input.checkpointNextWakeAt ?? null);
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async clearIdleCheckpoint(): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.clearIdleCheckpointMetaSync(meta);
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

  async readWriteFenceToken(): Promise<RunnerWriteFenceToken | null> {
    return this.readWriteFenceTokenSync(this.requireMetaRowSync());
  }

  async validateWriteFenceToken(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<RunnerWriteFenceValidationResult> {
    const meta = this.requireMetaRowSync();
    const token = this.readWriteFenceTokenSync(meta);
    if (
      !token
      || token.attemptId !== input.attemptId
      || token.generation !== input.generation
      || token.userId !== input.userId
    ) {
      return {
        owns: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const ownsWriteFence = (
      input.workspaceVersion === undefined
      || input.workspaceVersion === null
      || token.workspaceVersion === input.workspaceVersion
    );

    return {
      owns: ownsWriteFence,
      record: this.readStateFromMetaSync(meta),
    };
  }

  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; live code must use `validateWriteFenceToken`.
   */
  async ownsActiveInvocationLease(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<RunnerWriteFenceValidationResult & { clearedOrphanObservation: false }> {
    const result = await this.validateWriteFenceToken({
      attemptId: input.attemptId,
      generation: input.leaseGeneration,
      userId: input.userId,
      workspaceVersion: input.workspaceVersion,
    });
    return {
      ...result,
      clearedOrphanObservation: false,
    };
  }

  async recordWriteFenceWorkspaceCheckpoint(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean; record: RunnerStateRecord }> {
    const meta = this.requireMetaRowSync();
    const token = this.readWriteFenceTokenSync(meta);
    if (
      !token
      || token.attemptId !== input.attemptId
      || token.generation !== input.generation
      || token.userId !== input.userId
    ) {
      return {
        recorded: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    meta.active_workspace_version = input.workspaceVersion;
    this.writeMetaRowSync(meta);
    return {
      recorded: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; live code must use
   * `recordWriteFenceWorkspaceCheckpoint`.
   */
  async recordActiveInvocationWorkspaceCheckpoint(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean; record: RunnerStateRecord }> {
    return await this.recordWriteFenceWorkspaceCheckpoint({
      attemptId: input.attemptId,
      generation: input.leaseGeneration,
      userId: input.userId,
      workspaceVersion: input.workspaceVersion,
    });
  }

  private clearExpiredActiveRunSync(meta: RunnerMetaBundleRow, nowMs: number): boolean {
    const writeFence = this.readWriteFenceTokenSync(meta);
    if (!writeFence) {
      return false;
    }

    const expiresAtMs = Date.parse(writeFence.expiresAt);
    if (Number.isFinite(expiresAtMs) && nowMs < expiresAtMs) {
      return false;
    }

    const error = new Error("Hosted runtime write fence timed out.");
    const errorCode = deriveHostedExecutionErrorCode(error);
    this.clearActiveRunMetaSync(meta);
    meta.wake_pending = 1;
    meta.retry_at = new Date(nowMs).toISOString();
    meta.retry_count = normalizeNonNegativeInteger(meta.retry_count) + 1;
    meta.retry_last_error_code = errorCode;
    meta.last_error_at = new Date(nowMs).toISOString();
    meta.last_error_code = errorCode;
    return true;
  }

  private readStateSync(): RunnerStateRecord {
    return this.readStateFromMetaSync(this.requireMetaRowSync());
  }

  private readStateFromMetaSync(meta: RunnerMetaBundleRow): RunnerStateRecord {
    return projectRunnerStateRecord({
      bundleRef: null,
      meta,
    });
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
        wake_pending,
        next_wake_at,
        active_attempt_id,
        active_generation,
        active_kind,
        active_started_at,
        active_expires_at,
        active_workspace_version,
        idle_checkpoint_due_at,
        idle_checkpoint_workspace_version,
        idle_checkpoint_next_wake_at,
        retry_at,
        retry_count,
        retry_last_error_code,
        last_error_at,
        last_error_code,
        last_invocation_at,
        deferred_checkpoint_required,
        deferred_checkpoint_mailbox_status_json
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
        wake_pending,
        next_wake_at,
        active_attempt_id,
        active_generation,
        active_kind,
        active_started_at,
        active_expires_at,
        active_workspace_version,
        idle_checkpoint_due_at,
        idle_checkpoint_workspace_version,
        idle_checkpoint_next_wake_at,
        retry_at,
        retry_count,
        retry_last_error_code,
        last_error_at,
        last_error_code,
        last_invocation_at,
        deferred_checkpoint_required,
        deferred_checkpoint_mailbox_status_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.wake_pending === 1 ? 1 : 0,
      meta.next_wake_at,
      meta.active_attempt_id,
      normalizeNonNegativeInteger(meta.active_generation),
      meta.active_kind,
      meta.active_started_at,
      meta.active_expires_at,
      meta.active_workspace_version,
      meta.idle_checkpoint_due_at,
      meta.idle_checkpoint_workspace_version,
      meta.idle_checkpoint_next_wake_at,
      meta.retry_at,
      normalizeNonNegativeInteger(meta.retry_count),
      meta.retry_last_error_code,
      meta.last_error_at,
      meta.last_error_code,
      meta.last_invocation_at,
      meta.deferred_checkpoint_required === 1 ? 1 : 0,
      meta.deferred_checkpoint_mailbox_status_json,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaBundleRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
  }

  private clearWriteFenceTokenSync(
    meta: RunnerMetaRow,
    token: RunnerWriteFenceToken,
  ): boolean {
    if (!this.hasWriteFenceTokenSync(meta, token)) {
      return false;
    }

    this.clearActiveRunMetaSync(meta);
    return true;
  }

  private clearActiveRunMetaSync(meta: RunnerMetaRow): void {
    meta.active_attempt_id = null;
    meta.active_expires_at = null;
    meta.active_kind = null;
    meta.active_started_at = null;
    meta.active_workspace_version = null;
  }

  private clearIdleCheckpointMetaSync(meta: RunnerMetaRow): void {
    meta.idle_checkpoint_due_at = null;
    meta.idle_checkpoint_workspace_version = null;
    meta.idle_checkpoint_next_wake_at = null;
  }

  private hasWriteFenceTokenSync(
    meta: RunnerMetaRow,
    token: RunnerWriteFenceToken,
  ): boolean {
    return meta.active_attempt_id === token.attemptId
      && normalizeNonNegativeInteger(meta.active_generation).toString() === token.generation
      && meta.user_id === token.userId;
  }

  private readWriteFenceTokenSync(meta: RunnerMetaRow): RunnerWriteFenceToken | null {
    if (
      !meta.active_attempt_id
      || !meta.active_started_at
      || (meta.active_kind !== "runtime" && meta.active_kind !== "idle_checkpoint")
    ) {
      return null;
    }

    const reason: HostedWorkspaceInvocationReason =
      meta.active_kind === "idle_checkpoint" ? "idle_shutdown_checkpoint" : "nudge";

    return {
      attemptId: meta.active_attempt_id,
      expiresAt: meta.active_expires_at
        ?? new Date(Date.parse(meta.active_started_at) + 30 * 60_000).toISOString(),
      generation: normalizeNonNegativeInteger(meta.active_generation).toString(),
      leaseGeneration: normalizeNonNegativeInteger(meta.active_generation).toString(),
      reason,
      startedAt: meta.active_started_at,
      userId: meta.user_id,
      workerVersionId: null,
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

function createRuntimeWriteAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `runtime-write-${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2);
  return `runtime-write-${Date.now().toString(36)}-${random}`;
}
