import {
  emitHostedExecutionStructuredLog,
  type HostedExecutionRunContext,
  deriveHostedExecutionErrorCode,
  normalizeHostedExecutionOperatorMessage,
  type HostedExecutionRunLevel,
  type HostedExecutionRunPhase,
  type HostedExecutionRunStatus,
  type HostedExecutionTimelineEntry,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionCursorSnapshotRef,
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import type { HostedExecutionBundleRef } from "@murphai/runtime-state";

import { ensureRunnerStateSchema } from "./runner-state-schema.js";
import {
  appendBoundedRunnerTimelineEntry,
  createDefaultRunnerMetaRow,
  projectRunnerStateRecord,
  resolveRunnerNextWakeAt,
  type RunnerMetaRow,
} from "./runner-state-helpers.js";
import {
  MAX_RUN_TIMELINE_ENTRIES,
  type DurableObjectStateLike,
  type RunnerStateRecord,
} from "./types.js";

type RunnerMetaBundleRow = RunnerMetaRow;
type HostedExecutionRunTrackedCursor = {
  browserVaultReplicaRef: null | ReturnType<typeof parseHostedBrowserVaultReplicaRef>;
  snapshotRef: ReturnType<typeof parseHostedExecutionCursorSnapshotRef>;
};

export interface RunnerLeaseOwnerInput {
  eventId: string;
  policy?: "matching-run" | "same-event";
  run: HostedExecutionRunContext | null;
}

export class RunnerStateStore {
  private cachedBundleRef: HostedExecutionBundleRef | null = null;
  private volatileRun: HostedExecutionRunStatus | null = null;
  private volatileTimeline: HostedExecutionTimelineEntry[] = [];
  private userId: string | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
  ) {
    ensureRunnerStateSchema(this.sql);
  }

  async bootstrapUser(userId: string): Promise<string> {
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

  async beginRun(input: {
    eventId: string;
    run: HostedExecutionRunContext;
    userId: string;
  }): Promise<RunnerStateRecord> {
    await this.bootstrapUser(input.userId);

    const meta = this.requireMetaRowSync();
    meta.in_flight = 1;
    this.assignActiveRunMetaSync(meta, input.eventId, input.run);
    this.rememberLastEventMetaSync(meta, input.eventId);
    this.volatileRun = {
      attempt: input.run.attempt,
      eventId: input.eventId,
      phase: "claimed",
      runId: input.run.runId,
      startedAt: input.run.startedAt,
      updatedAt: input.run.startedAt,
    };
    this.clearLastErrorMetaSync(meta);
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async completeRun(input: {
    eventId: string;
    finishedAt?: string | null;
    leaseOwner: RunnerLeaseOwnerInput;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.clearActiveRunLeaseSync(meta, input.leaseOwner);
    this.rememberLastEventMetaSync(meta, input.eventId);
    this.clearLastErrorMetaSync(meta);
    meta.last_run_at = input.finishedAt ?? new Date().toISOString();
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async failRun(input: {
    error: unknown;
    eventId: string;
    finishedAt?: string | null;
    leaseOwner: RunnerLeaseOwnerInput;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    this.clearActiveRunLeaseSync(meta, input.leaseOwner);
    this.rememberLastEventMetaSync(meta, input.eventId);
    meta.last_error_at = input.finishedAt ?? new Date().toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async syncBundleRefCache(
    nextBundleRef: RunnerStateRecord["bundleRef"],
  ): Promise<RunnerStateRecord> {
    this.cachedBundleRef = nextBundleRef;
    return this.readStateSync();
  }

  async readCachedBundleRef(): Promise<RunnerStateRecord["bundleRef"]> {
    return this.cachedBundleRef;
  }

  async markRuntimeBootstrapped(): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    if (meta.runtime_bootstrapped !== 1) {
      meta.runtime_bootstrapped = 1;
      this.writeMetaRowSync(meta);
    }

    return this.readStateFromMetaSync(meta);
  }

  async recordRunPhase(input: {
    attempt: number;
    clearError?: boolean;
    component: string;
    error?: unknown;
    eventId: string;
    level?: HostedExecutionRunLevel;
    message: string;
    phase: HostedExecutionRunPhase;
    runId: string;
    startedAt: string;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    const nowIso = new Date().toISOString();
    const errorCode = input.error === undefined ? null : deriveHostedExecutionErrorCode(input.error);
    this.volatileRun = {
      attempt: input.attempt,
      eventId: input.eventId,
      phase: input.phase,
      runId: input.runId,
      startedAt: input.startedAt,
      updatedAt: nowIso,
    } satisfies HostedExecutionRunStatus;
    this.volatileTimeline = appendBoundedRunnerTimelineEntry(
      this.volatileTimeline,
      {
        at: nowIso,
        attempt: input.attempt,
        component: input.component,
        ...(errorCode ? { errorCode } : {}),
        eventId: input.eventId,
        level: input.level ?? (input.error === undefined ? "info" : "error"),
        message: normalizeHostedExecutionOperatorMessage(input.message),
        phase: input.phase,
        runId: input.runId,
      },
      MAX_RUN_TIMELINE_ENTRIES,
    );

    if (input.clearError) {
      this.clearLastErrorMetaSync(meta);
    }

    if (errorCode) {
      meta.last_error_at = nowIso;
      meta.last_error_code = errorCode;
    }

    this.rememberLastEventMetaSync(meta, input.eventId);
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async hasActiveRunLease(owner: RunnerLeaseOwnerInput): Promise<boolean> {
    return this.hasActiveRunLeaseSync(this.requireMetaRowSync(), owner);
  }

  async readActiveRunLease(): Promise<{
    eventId: string;
    run: HostedExecutionRunContext;
  } | null> {
    const meta = this.selectMetaRowSync();
    if (!meta?.active_run_event_id) {
      return null;
    }

    const run = this.readActiveRunContextSync(meta);
    if (!run) {
      return null;
    }

    if (Number.isNaN(Date.parse(run.startedAt))) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          activeRunAttempt: run.attempt,
          activeRunEventId: meta.active_run_event_id,
          activeRunId: run.runId,
          activeRunStartedAt: run.startedAt,
        },
        level: "warn",
        message: "Hosted runner active-run lease timestamp was malformed but the persisted lease will remain readable.",
        phase: "wake.running",
        userId: meta.user_id,
      });
    }

    return {
      eventId: meta.active_run_event_id,
      run,
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

  async readTrackedAuthoritativeCursor(): Promise<{
    browserVaultReplicaRef: HostedExecutionRunTrackedCursor["browserVaultReplicaRef"];
    snapshotRef: HostedExecutionRunTrackedCursor["snapshotRef"];
  } | null> {
    const value = await this.state.storage.get<unknown>(trackedAuthoritativeCursorStorageKey());

    if (value === undefined || value === null) {
      return null;
    }

    try {
      return normalizeTrackedAuthoritativeCursorState(value);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {},
        error,
        level: "warn",
        message:
          "Hosted runner tracked authoritative cursor cleanup state was malformed; clearing it so later authoritative cursor reads can reseed recovery state.",
        phase: "wake.running",
        userId: this.tryResolveUserIdSync() ?? "unknown",
      });
      await this.state.storage.delete(trackedAuthoritativeCursorStorageKey());
      return null;
    }
  }

  async writeTrackedAuthoritativeCursor(
    cursor: HostedExecutionRunTrackedCursor | null,
  ): Promise<void> {
    if (cursor === null) {
      await this.state.storage.delete(trackedAuthoritativeCursorStorageKey());
      return;
    }

    await this.state.storage.put(trackedAuthoritativeCursorStorageKey(), cursor);
  }

  private readStateSync(): RunnerStateRecord {
    return this.readStateFromMetaSync(this.requireMetaRowSync());
  }

  private readStateFromMetaSync(meta: RunnerMetaBundleRow): RunnerStateRecord {
    return projectRunnerStateRecord({
      bundleRef: this.cachedBundleRef,
      meta,
      run: this.volatileRun ?? this.readPersistedRunStatusSync(meta),
      timeline: this.volatileTimeline,
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
        active_run_event_id,
        active_run_id,
        active_run_attempt,
        active_run_started_at,
        runtime_bootstrapped,
        in_flight,
        last_error_at,
        last_error_code,
        last_event_id,
        last_run_at,
        next_wake_at
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
        active_run_event_id,
        active_run_id,
        active_run_attempt,
        active_run_started_at,
        runtime_bootstrapped,
        in_flight,
        last_error_at,
        last_error_code,
        last_event_id,
        last_run_at,
        next_wake_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.active_run_event_id,
      meta.active_run_id,
      meta.active_run_attempt,
      meta.active_run_started_at,
      meta.runtime_bootstrapped,
      meta.in_flight,
      meta.last_error_at,
      meta.last_error_code,
      meta.last_event_id,
      meta.last_run_at,
      meta.next_wake_at,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaBundleRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
  }

  private assignActiveRunMetaSync(
    meta: RunnerMetaRow,
    eventId: string,
    run: HostedExecutionRunContext,
  ): void {
    meta.active_run_event_id = eventId;
    meta.active_run_id = run.runId;
    meta.active_run_attempt = run.attempt;
    meta.active_run_started_at = run.startedAt;
  }

  private clearActiveRunMetaSync(meta: RunnerMetaRow): void {
    meta.active_run_event_id = null;
    meta.active_run_id = null;
    meta.active_run_attempt = null;
    meta.active_run_started_at = null;
    this.volatileRun = null;
  }

  private clearActiveRunLeaseSync(meta: RunnerMetaRow, owner: RunnerLeaseOwnerInput): void {
    if (!meta.active_run_event_id) {
      meta.in_flight = 0;
      this.clearActiveRunMetaSync(meta);
      return;
    }

    if (meta.active_run_event_id !== owner.eventId) {
      return;
    }

    if (owner.policy === "same-event") {
      meta.in_flight = 0;
      this.clearActiveRunMetaSync(meta);
      return;
    }

    if (!owner.run) {
      return;
    }

    if (!sameHostedExecutionRun(this.readActiveRunContextSync(meta), owner.run)) {
      return;
    }

    meta.in_flight = 0;
    this.clearActiveRunMetaSync(meta);
  }

  private hasActiveRunLeaseSync(meta: RunnerMetaRow, owner: RunnerLeaseOwnerInput): boolean {
    if (!meta.active_run_event_id) {
      return false;
    }

    if (meta.active_run_event_id !== owner.eventId) {
      return false;
    }

    if (owner.policy === "same-event") {
      return true;
    }

    if (!owner.run) {
      return false;
    }

    return sameHostedExecutionRun(this.readActiveRunContextSync(meta), owner.run);
  }

  private clearLastErrorMetaSync(meta: RunnerMetaRow): void {
    meta.last_error_at = null;
    meta.last_error_code = null;
  }

  private rememberLastEventMetaSync(meta: RunnerMetaRow, eventId: string): void {
    meta.last_event_id = eventId;
  }

  private readPersistedRunStatusSync(meta: RunnerMetaRow): HostedExecutionRunStatus | null {
    const run = this.readActiveRunContextSync(meta);
    if (!run || !meta.active_run_event_id) {
      return null;
    }

    return {
      ...run,
      eventId: meta.active_run_event_id,
      phase: "wake.running",
      updatedAt: meta.active_run_started_at ?? run.startedAt,
    };
  }

  private readActiveRunContextSync(meta: RunnerMetaRow): HostedExecutionRunContext | null {
    if (
      !meta.active_run_event_id
      || !meta.active_run_id
      || typeof meta.active_run_attempt !== "number"
      || !Number.isSafeInteger(meta.active_run_attempt)
      || meta.active_run_attempt < 1
      || !meta.active_run_started_at
    ) {
      return null;
    }

    return {
      attempt: meta.active_run_attempt,
      runId: meta.active_run_id,
      startedAt: meta.active_run_started_at,
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

function sameHostedExecutionRun(
  left: HostedExecutionRunContext | null,
  right: HostedExecutionRunContext,
): boolean {
  if (!left) {
    return false;
  }

  return left.attempt === right.attempt
    && left.runId === right.runId
    && left.startedAt === right.startedAt;
}

function trackedAuthoritativeCursorStorageKey(): string {
  return "runner:tracked-authoritative-cursor";
}

function normalizeTrackedAuthoritativeCursorState(
  value: unknown,
): HostedExecutionRunTrackedCursor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    browserVaultReplicaRef?: unknown;
    snapshotRef?: unknown;
  };

  return {
    browserVaultReplicaRef: parseHostedBrowserVaultReplicaRef(
      record.browserVaultReplicaRef ?? null,
      "Hosted runner tracked authoritative cursor browserVaultReplicaRef",
    ),
    snapshotRef: parseHostedExecutionCursorSnapshotRef(
      record.snapshotRef,
      "Hosted runner tracked authoritative cursor snapshotRef",
    ),
  };
}
