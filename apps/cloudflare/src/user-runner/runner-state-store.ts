import {
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
import type {
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";
import { ensureRunnerStateSchema } from "./runner-state-schema.js";
import {
  createDefaultRunnerMetaRow,
  projectRunnerStateRecord,
  resolveRunnerNextWakeAt,
  type RunnerMetaRow,
} from "./runner-state-helpers.js";
import {
  type DurableObjectStateLike,
  type RunnerStateRecord,
} from "./types.js";

type RunnerMetaBundleRow = RunnerMetaRow;

export interface RunnerInvocationLease {
  attemptId: string;
  leaseGeneration: string;
  reason: HostedWorkspaceInvocationReason;
  startedAt: string;
  userId: string;
  workspaceVersion: string | null;
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

  async clearNextWakeIfDue(nowMs: number): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    const parsedMs = meta.next_wake_at ? Date.parse(meta.next_wake_at) : Number.NaN;

    if (Number.isFinite(parsedMs) && parsedMs <= nowMs) {
      meta.next_wake_at = null;
      this.writeMetaRowSync(meta);
    }

    return this.readStateFromMetaSync(meta);
  }

  async beginInvocation(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<RunnerInvocationLease> {
    await this.bindUser(input.userId);

    const meta = this.requireMetaRowSync();
    const nextLeaseGeneration = normalizeLeaseGeneration(meta.lease_generation) + 1;
    const startedAt = new Date().toISOString();
    const attemptId = `workspace-invocation-${nextLeaseGeneration}`;

    meta.in_flight = 1;
    meta.lease_generation = nextLeaseGeneration;
    meta.active_invocation_id = attemptId;
    meta.active_invocation_reason = input.reason;
    meta.active_invocation_started_at = startedAt;
    meta.active_workspace_version = null;
    meta.pending_nudge = 0;
    this.clearLastErrorMetaSync(meta);
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      leaseGeneration: nextLeaseGeneration.toString(),
      reason: input.reason,
      startedAt,
      userId: input.userId,
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
    this.writeMetaRowSync(meta);
    return {
      ...input.lease,
      workspaceVersion: input.workspaceVersion,
    };
  }

  async completeInvocation(input: {
    finishedAt?: string | null;
    lease: RunnerInvocationLease;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.clearActiveInvocationLeaseSync(meta, input.lease);
    this.clearLastErrorMetaSync(meta);
    meta.last_invocation_at = input.finishedAt ?? new Date().toISOString();
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async failInvocation(input: {
    error: unknown;
    finishedAt?: string | null;
    lease: RunnerInvocationLease;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.clearActiveInvocationLeaseSync(meta, input.lease);
    meta.last_error_at = input.finishedAt ?? new Date().toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async markPendingInvocationNudge(): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.pending_nudge = 1;
    meta.next_wake_at = resolveRunnerNextWakeAt({
      preferredWakeAt: new Date().toISOString(),
    });
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
  }): Promise<boolean> {
    const lease = await this.readActiveInvocationLease();
    if (
      !lease
      || lease.attemptId !== input.attemptId
      || lease.leaseGeneration !== input.leaseGeneration
      || lease.userId !== input.userId
    ) {
      return false;
    }

    return input.workspaceVersion === undefined
      || input.workspaceVersion === null
      || lease.workspaceVersion === input.workspaceVersion;
  }

  async recordActiveInvocationWorkspaceCheckpoint(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }> {
    const meta = this.requireMetaRowSync();
    const lease = this.readActiveInvocationLeaseSync(meta);
    if (
      !lease
      || lease.attemptId !== input.attemptId
      || lease.leaseGeneration !== input.leaseGeneration
      || lease.userId !== input.userId
    ) {
      return { recorded: false };
    }

    meta.active_workspace_version = input.workspaceVersion;
    this.writeMetaRowSync(meta);
    return { recorded: true };
  }

  async clearStaleInvocationIfExpired(input: {
    nowMs: number;
    timeoutMs: number;
  }): Promise<{
    attemptId: string | null;
    cleared: boolean;
    record: RunnerStateRecord;
  }> {
    const meta = this.requireMetaRowSync();
    const attemptId = meta.active_invocation_id;
    const startedAt = meta.active_invocation_started_at;
    if (!attemptId || !startedAt) {
      return {
        attemptId,
        cleared: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const startedAtMs = Date.parse(startedAt);
    const isExpired = !Number.isFinite(startedAtMs)
      || input.nowMs - startedAtMs >= input.timeoutMs;
    if (!isExpired) {
      return {
        attemptId,
        cleared: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    this.clearActiveInvocationMetaSync(meta);
    meta.in_flight = 0;
    meta.last_error_at = new Date(input.nowMs).toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(
      new Error("Hosted workspace invocation timed out."),
    );
    this.writeMetaRowSync(meta);

    return {
      attemptId,
      cleared: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async syncNextWake(input: {
    preferredWakeAt?: string | null;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.next_wake_at = resolveRunnerNextWakeAt({
      preferredWakeAt: input.preferredWakeAt ?? null,
    });
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  private readStateSync(): RunnerStateRecord {
    return this.readStateFromMetaSync(this.requireMetaRowSync());
  }

  private readStateFromMetaSync(meta: RunnerMetaBundleRow): RunnerStateRecord {
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
        active_invocation_reason,
        active_invocation_started_at,
        active_workspace_version,
        lease_generation,
        in_flight,
        last_error_at,
        last_error_code,
        last_invocation_at,
        next_wake_at,
        pending_nudge
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
        active_invocation_reason,
        active_invocation_started_at,
        active_workspace_version,
        lease_generation,
        in_flight,
        last_error_at,
        last_error_code,
        last_invocation_at,
        next_wake_at,
        pending_nudge
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.active_invocation_id,
      meta.active_invocation_reason,
      meta.active_invocation_started_at,
      meta.active_workspace_version,
      meta.lease_generation,
      meta.in_flight,
      meta.last_error_at,
      meta.last_error_code,
      meta.last_invocation_at,
      meta.next_wake_at,
      meta.pending_nudge,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaBundleRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
  }

  private clearActiveInvocationLeaseSync(
    meta: RunnerMetaRow,
    lease: RunnerInvocationLease,
  ): void {
    if (!this.hasActiveInvocationLeaseSync(meta, lease)) {
      return;
    }

    this.clearActiveInvocationMetaSync(meta);
    meta.in_flight = 0;
  }

  private clearActiveInvocationMetaSync(meta: RunnerMetaRow): void {
    meta.active_invocation_id = null;
    meta.active_invocation_reason = null;
    meta.active_invocation_started_at = null;
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
      leaseGeneration: normalizeLeaseGeneration(meta.lease_generation).toString(),
      reason: meta.active_invocation_reason,
      startedAt: meta.active_invocation_started_at,
      userId: meta.user_id,
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
  return value === "nudge" || value === "alarm" || value === "retry" || value === "manual";
}
