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
  normalizeRetryFailureCount,
  resolveRunnerNextWakeAt,
  type RunnerMetaRow,
} from "./runner-state-helpers.js";
import {
  type DurableObjectStateLike,
  type RunnerStateRecord,
} from "./types.js";

type RunnerMetaBundleRow = RunnerMetaRow;

const PENDING_BROWSER_VAULT_REFRESH_STORAGE_KEY =
  "runner:pending-browser-vault-refresh:v1";
const PENDING_BROWSER_VAULT_REFRESH_SCHEMA =
  "murph.hosted-runner.pending-browser-vault-refresh.v1";

interface PendingBrowserVaultRefreshRecord {
  schema: typeof PENDING_BROWSER_VAULT_REFRESH_SCHEMA;
  sourceStateHash: string;
  updatedAt: string;
}

export interface RunnerInvocationLease {
  attemptId: string;
  leaseGeneration: string;
  reason: HostedWorkspaceInvocationReason;
  startedAt: string;
  userId: string;
  workspaceVersion: string | null;
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
    kind: "drain";
    record: RunnerStateRecord;
  }
  | {
    idleWorkspaceVersion: string;
    kind: "idle_shutdown_checkpoint";
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
      await this.state.storage.delete(PENDING_BROWSER_VAULT_REFRESH_STORAGE_KEY);
      this.userId = null;
      return { deleted: false };
    }

    this.sql.exec("DELETE FROM runner_meta WHERE singleton = 1");
    await this.state.storage.delete(PENDING_BROWSER_VAULT_REFRESH_STORAGE_KEY);
    this.userId = null;
    return { deleted: true };
  }

  async scheduleBrowserVaultRefresh(input: {
    sourceStateHash: string;
  }): Promise<{
    deduped: boolean;
    sourceStateHash: string;
  }> {
    return this.scheduleDashboardReplicaRefresh(input);
  }

  async scheduleDashboardReplicaRefresh(input: {
    sourceStateHash: string;
  }): Promise<{
    deduped: boolean;
    sourceStateHash: string;
  }> {
    const sourceStateHash = requireRunnerStateNonEmptyString(
      input.sourceStateHash,
      "Hosted dashboard replica refresh sourceStateHash",
    );
    const current = await this.readPendingDashboardReplicaRefresh();
    if (current?.sourceStateHash === sourceStateHash) {
      return {
        deduped: true,
        sourceStateHash,
      };
    }

    await this.state.storage.put<PendingBrowserVaultRefreshRecord>(
      PENDING_BROWSER_VAULT_REFRESH_STORAGE_KEY,
      {
        schema: PENDING_BROWSER_VAULT_REFRESH_SCHEMA,
        sourceStateHash,
        updatedAt: new Date().toISOString(),
      },
    );

    return {
      deduped: false,
      sourceStateHash,
    };
  }

  async readPendingBrowserVaultRefresh(): Promise<{
    sourceStateHash: string;
  } | null> {
    return this.readPendingDashboardReplicaRefresh();
  }

  async readPendingDashboardReplicaRefresh(): Promise<{
    sourceStateHash: string;
  } | null> {
    const value = await this.state.storage.get<unknown>(
      PENDING_BROWSER_VAULT_REFRESH_STORAGE_KEY,
    );

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as Partial<PendingBrowserVaultRefreshRecord>;
    return record.schema === PENDING_BROWSER_VAULT_REFRESH_SCHEMA
      && typeof record.sourceStateHash === "string"
      && record.sourceStateHash.length > 0
      ? { sourceStateHash: record.sourceStateHash }
      : null;
  }

  async clearPendingBrowserVaultRefresh(input: {
    sourceStateHash: string;
  }): Promise<boolean> {
    return this.clearPendingDashboardReplicaRefresh(input);
  }

  async clearPendingDashboardReplicaRefresh(input: {
    sourceStateHash: string;
  }): Promise<boolean> {
    const current = await this.readPendingDashboardReplicaRefresh();
    if (!current || current.sourceStateHash !== input.sourceStateHash) {
      return false;
    }

    return await this.state.storage.delete(PENDING_BROWSER_VAULT_REFRESH_STORAGE_KEY);
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
    const nextWakeAtMs = meta.next_wake_at ? Date.parse(meta.next_wake_at) : Number.NaN;
    const idleCheckpointDueAtMs = meta.idle_shutdown_checkpoint_due_at
      ? Date.parse(meta.idle_shutdown_checkpoint_due_at)
      : Number.NaN;

    if (Number.isFinite(nextWakeAtMs) && nextWakeAtMs <= nowMs) {
      meta.next_wake_at = null;
      this.writeMetaRowSync(meta);
      return {
        kind: "drain",
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (
      Number.isFinite(idleCheckpointDueAtMs)
      && idleCheckpointDueAtMs <= nowMs
    ) {
      if (!meta.idle_shutdown_checkpoint_workspace_version) {
        this.clearIdleShutdownCheckpointMetaSync(meta);
        this.writeMetaRowSync(meta);
        return {
          kind: "none",
          record: this.readStateFromMetaSync(meta),
        };
      }

      const idleWorkspaceVersion = meta.idle_shutdown_checkpoint_workspace_version;
      return {
        idleWorkspaceVersion,
        kind: "idle_shutdown_checkpoint",
        record: this.readStateFromMetaSync(meta),
      };
    }

    return {
      kind: "none",
      record: this.readStateFromMetaSync(meta),
    };
  }

  async beginInvocation(input: {
    consumePendingNudge?: boolean;
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
    meta.active_invocation_last_heartbeat_at = null;
    meta.active_invocation_orphan_observed_at = null;
    meta.active_invocation_reason = input.reason;
    meta.active_invocation_started_at = startedAt;
    meta.active_workspace_version = null;
    if (input.consumePendingNudge !== false) {
      meta.pending_nudge = 0;
    }
    if (input.reason === "idle_shutdown_checkpoint") {
      this.clearIdleShutdownCheckpointMetaSync(meta);
    }
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
    meta.active_invocation_last_heartbeat_at = null;
    meta.active_invocation_orphan_observed_at = null;
    this.writeMetaRowSync(meta);
    return {
      ...input.lease,
      workspaceVersion: input.workspaceVersion,
    };
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

  async markPendingInvocationNudge(input: {
    preferredWakeAt?: string | null;
  } = {}): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.pending_nudge = 1;
    this.clearIdleShutdownCheckpointMetaSync(meta);
    meta.next_wake_at = resolveRunnerNextWakeAt({
      preferredWakeAt: input.preferredWakeAt ?? new Date().toISOString(),
    });
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async scheduleIdleShutdownCheckpoint(input: {
    dueAt: string;
    workspaceVersion: string;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    meta.idle_shutdown_checkpoint_due_at = normalizeIsoDateString(input.dueAt);
    meta.idle_shutdown_checkpoint_workspace_version = input.workspaceVersion;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async scheduleIdleShutdownCheckpointIfStillQuiet(input: {
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

    meta.idle_shutdown_checkpoint_due_at = normalizeIsoDateString(input.dueAt);
    meta.idle_shutdown_checkpoint_workspace_version = input.workspaceVersion;
    this.writeMetaRowSync(meta);

    return {
      record: this.readStateFromMetaSync(meta),
      scheduled: true,
    };
  }

  async clearIdleShutdownCheckpoint(): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.clearIdleShutdownCheckpointMetaSync(meta);
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
    ) && !isIdleShutdownCheckpointBlockedByPendingNudge(meta);
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

    if (isIdleShutdownCheckpointBlockedByPendingNudge(meta)) {
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

  async clearStaleInvocationIfExpired(input: {
    nowMs: number;
    orphanGraceMs?: number | null;
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
    const isHardExpired = !Number.isFinite(startedAtMs)
      || input.nowMs - startedAtMs >= input.timeoutMs;
    const orphanGraceMs = input.orphanGraceMs ?? null;
    let isOrphanExpired = false;
    if (!isHardExpired && orphanGraceMs !== null) {
      const lastHeartbeatAtMs = meta.active_invocation_last_heartbeat_at
        ? Date.parse(meta.active_invocation_last_heartbeat_at)
        : Number.NaN;
      const observedAtMs = meta.active_invocation_orphan_observed_at
        ? Date.parse(meta.active_invocation_orphan_observed_at)
        : Number.NaN;
      if (Number.isFinite(lastHeartbeatAtMs)) {
        isOrphanExpired = input.nowMs - lastHeartbeatAtMs >= orphanGraceMs;
      } else if (Number.isFinite(observedAtMs)) {
        isOrphanExpired = input.nowMs - observedAtMs >= orphanGraceMs;
      } else {
        meta.active_invocation_orphan_observed_at = new Date(input.nowMs).toISOString();
        this.writeMetaRowSync(meta);
      }
    }

    if (!isHardExpired && !isOrphanExpired) {
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
    meta.retry_failure_count = normalizeRetryFailureCount(meta.retry_failure_count) + 1;
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
        active_invocation_last_heartbeat_at,
        active_invocation_orphan_observed_at,
        active_invocation_reason,
        active_invocation_started_at,
        active_workspace_version,
        lease_generation,
        in_flight,
        last_error_at,
        last_error_code,
        last_invocation_at,
        idle_shutdown_checkpoint_due_at,
        idle_shutdown_checkpoint_workspace_version,
        next_wake_at,
        pending_nudge,
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
        active_invocation_last_heartbeat_at,
        active_invocation_orphan_observed_at,
        active_invocation_reason,
        active_invocation_started_at,
        active_workspace_version,
        lease_generation,
        in_flight,
        last_error_at,
        last_error_code,
        last_invocation_at,
        idle_shutdown_checkpoint_due_at,
        idle_shutdown_checkpoint_workspace_version,
        next_wake_at,
        pending_nudge,
        retry_failure_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.active_invocation_id,
      meta.active_invocation_last_heartbeat_at,
      meta.active_invocation_orphan_observed_at,
      meta.active_invocation_reason,
      meta.active_invocation_started_at,
      meta.active_workspace_version,
      meta.lease_generation,
      meta.in_flight,
      meta.last_error_at,
      meta.last_error_code,
      meta.last_invocation_at,
      meta.idle_shutdown_checkpoint_due_at,
      meta.idle_shutdown_checkpoint_workspace_version,
      meta.next_wake_at,
      meta.pending_nudge,
      normalizeRetryFailureCount(meta.retry_failure_count),
    );
  }

  private writeMetaRowSync(meta: RunnerMetaBundleRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
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

  private clearActiveInvocationMetaSync(meta: RunnerMetaRow): void {
    meta.active_invocation_id = null;
    meta.active_invocation_last_heartbeat_at = null;
    meta.active_invocation_orphan_observed_at = null;
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

  private clearIdleShutdownCheckpointMetaSync(meta: RunnerMetaRow): void {
    meta.idle_shutdown_checkpoint_due_at = null;
    meta.idle_shutdown_checkpoint_workspace_version = null;
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

function requireRunnerStateNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function isIdleShutdownCheckpointBlockedByPendingNudge(meta: RunnerMetaBundleRow): boolean {
  return meta.active_invocation_reason === "idle_shutdown_checkpoint"
    && meta.pending_nudge === 1;
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

function normalizeIsoDateString(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted runner idle checkpoint due time must be an ISO date string.");
  }

  return parsed.toISOString();
}
