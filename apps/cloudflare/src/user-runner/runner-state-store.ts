import {
  type HostedExecutionRunContext,
  deriveHostedExecutionErrorCode,
  normalizeHostedExecutionOperatorMessage,
  type HostedExecutionRunLevel,
  type HostedExecutionRunPhase,
  type HostedExecutionRunStatus,
  type HostedExecutionTimelineEntry,
} from "@murphai/hosted-execution";
import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import { ensureRunnerStateSchema } from "./runner-state-schema.js";
import {
  appendBoundedRunnerTimelineEntry,
  assignRunnerBundleRefs,
  createDefaultRunnerBundleState,
  createDefaultRunnerMetaRow,
  projectRunnerStateRecord,
  resolveRunnerNextWakeAt,
  type RunnerBundleSlotRow,
  type RunnerMetaRow,
  type RunnerStoredBundleState,
} from "./runner-state-helpers.js";
import {
  MAX_RUN_TIMELINE_ENTRIES,
  type DurableObjectStateLike,
  type RunnerBundleVersion,
  type RunnerStateRecord,
} from "./types.js";

interface BundleRefSwapInput {
  expectedVersion: RunnerBundleVersion;
  nextBundleRef: RunnerStateRecord["bundleRef"];
}

export interface RunnerLeaseOwnerInput {
  eventId: string;
  policy?: "matching-run" | "same-event";
  run: HostedExecutionRunContext | null;
}

export class RunnerStateStore {
  private readonly ready: Promise<void>;
  private volatileRun: HostedExecutionRunStatus | null = null;
  private volatileTimeline: HostedExecutionTimelineEntry[] = [];
  private userId: string | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
  ) {
    ensureRunnerStateSchema(this.sql);
    this.ensureCanonicalBundleSlotRowsSync();
    this.ready = Promise.resolve();
  }

  async bootstrapUser(userId: string): Promise<string> {
    await this.ready;
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
    await this.ready;
    return this.readStateSync();
  }

  async clearNextWakeIfDue(nowMs: number): Promise<RunnerStateRecord> {
    await this.ready;

    const meta = this.requireMetaRowSync();
    const parsedMs = meta.next_wake_at ? Date.parse(meta.next_wake_at) : Number.NaN;

    if (Number.isFinite(parsedMs) && parsedMs <= nowMs) {
      meta.next_wake_at = null;
      this.writeMetaRowSync(meta);
    }

    return this.readStateFromMetaSync(meta);
  }

  async syncCommittedBundles(
    committed: HostedExecutionCommittedResult,
    leaseOwner: RunnerLeaseOwnerInput | null = null,
  ): Promise<RunnerStateRecord> {
    await this.ready;
    await this.bootstrapUser(committed.userId);

    const meta = this.requireMetaRowSync();
    const bundleState = this.selectBundleStateSync();
    assignRunnerBundleRefs(bundleState, committed.bundleRef);
    this.rememberLastEventMetaSync(meta, committed.eventId);
    this.clearRetryingEventMetaSync(meta);
    if (leaseOwner?.policy === "same-event") {
      this.clearActiveRunLeaseSync(meta, {
        eventId: committed.eventId,
        policy: "same-event",
        run: leaseOwner.run ?? null,
      });
    }
    this.clearLastErrorMetaSync(meta);
    meta.last_run_at = committed.committedAt;
    this.writeMetaRowSync(meta);
    this.writeBundleStateSync(bundleState);

    return this.readStateFromMetaSync(meta);
  }

  async beginWakeRun(input: {
    eventId: string;
    run: HostedExecutionRunContext;
    userId: string;
  }): Promise<RunnerStateRecord> {
    await this.ready;
    await this.bootstrapUser(input.userId);

    const meta = this.requireMetaRowSync();
    meta.in_flight = 1;
    this.assignActiveRunMetaSync(meta, input.eventId, input.run);
    this.rememberLastEventMetaSync(meta, input.eventId);
    this.setRetryingEventMetaSync(meta, input.eventId);
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

  async completeWakeRun(input: {
    eventId: string;
    finishedAt?: string | null;
    leaseOwner: RunnerLeaseOwnerInput;
  }): Promise<RunnerStateRecord> {
    await this.ready;

    const meta = this.requireMetaRowSync();
    this.clearActiveRunLeaseSync(meta, input.leaseOwner);
    this.rememberLastEventMetaSync(meta, input.eventId);
    this.clearRetryingEventMetaSync(meta);
    this.clearLastErrorMetaSync(meta);
    meta.last_run_at = input.finishedAt ?? new Date().toISOString();
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async failWakeRun(input: {
    error: unknown;
    eventId: string;
    finishedAt?: string | null;
    leaseOwner: RunnerLeaseOwnerInput;
  }): Promise<RunnerStateRecord> {
    await this.ready;

    const meta = this.requireMetaRowSync();
    this.clearActiveRunLeaseSync(meta, input.leaseOwner);
    this.rememberLastEventMetaSync(meta, input.eventId);
    this.setRetryingEventMetaSync(meta, input.eventId);
    meta.last_error_at = input.finishedAt ?? new Date().toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async syncBundleRefCache(
    nextBundleRef: RunnerStateRecord["bundleRef"],
  ): Promise<RunnerStateRecord> {
    await this.ready;

    const meta = this.requireMetaRowSync();
    const bundleState = this.selectBundleStateSync();
    assignRunnerBundleRefs(bundleState, nextBundleRef);
    this.writeBundleStateSync(bundleState);

    return this.readStateFromMetaSync(meta);
  }

  async markRuntimeBootstrapped(): Promise<RunnerStateRecord> {
    await this.ready;

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
    await this.ready;

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
    if (input.phase === "completed") {
      this.clearRetryingEventMetaSync(meta);
    } else {
      this.setRetryingEventMetaSync(meta, input.eventId);
    }

    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async readBundleMetaState(): Promise<Pick<
    RunnerStateRecord,
    "bundleRef" | "bundleVersion" | "inFlight" | "userId"
  >> {
    await this.ready;
    const record = this.readStateSync();
    return {
      bundleRef: record.bundleRef,
      bundleVersion: record.bundleVersion,
      inFlight: record.inFlight,
      userId: record.userId,
    };
  }

  async compareAndSwapBundleRefs(
    input: BundleRefSwapInput,
  ): Promise<{ applied: boolean; record: RunnerStateRecord }> {
    await this.ready;

    const meta = this.requireMetaRowSync();
    const bundleState = this.selectBundleStateSync();
    if (bundleState.bundleVersion !== input.expectedVersion) {
      return {
        applied: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    assignRunnerBundleRefs(bundleState, input.nextBundleRef);
    this.writeBundleStateSync(bundleState);
    return {
      applied: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async hasActiveRunLease(owner: RunnerLeaseOwnerInput): Promise<boolean> {
    await this.ready;

    return this.hasActiveRunLeaseSync(this.requireMetaRowSync(), owner);
  }

  async readActiveRunLease(): Promise<{
    eventId: string;
    run: HostedExecutionRunContext;
  } | null> {
    await this.ready;

    const meta = this.selectMetaRowSync();
    if (!meta?.active_run_event_id) {
      return null;
    }

    const run = this.readActiveRunContextSync(meta);
    if (!run) {
      return null;
    }

    return {
      eventId: meta.active_run_event_id,
      run,
    };
  }

  async syncNextWake(input: {
    preferredWakeAt?: string | null;
  }): Promise<RunnerStateRecord> {
    await this.ready;

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

  private readStateFromMetaSync(meta: RunnerMetaRow): RunnerStateRecord {
    const projected = projectRunnerStateRecord({
      bundleState: this.selectBundleStateSync(),
      meta,
      run: this.volatileRun ?? this.readPersistedRunStatusSync(meta),
      timeline: this.volatileTimeline,
    });

    if (projected.changed) {
      this.writeBundleStateSync(projected.sanitizedBundleState);
    }

    return projected.record;
  }

  private requireMetaRowSync(): RunnerMetaRow {
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

  private selectMetaRowSync(): RunnerMetaRow | null {
    const row = this.sql.exec<RunnerMetaRow>(
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
        next_wake_at,
        retrying_event_id
      FROM runner_meta
      WHERE singleton = 1`,
    ).toArray()[0] ?? null;

    if (row) {
      this.userId = row.user_id;
    }

    return row;
  }

  private insertMetaRowSync(meta: RunnerMetaRow): void {
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
        next_wake_at,
        retrying_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      meta.retrying_event_id,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaRow): void {
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

  private ensureCanonicalBundleSlotRowsSync(): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO runner_bundle_slots (
        slot,
        bundle_ref_json,
        bundle_version
      ) VALUES (?, ?, ?)`,
      "vault",
      null,
      0,
    );
  }

  private selectBundleStateSync(): RunnerStoredBundleState {
    const bundleState = createDefaultRunnerBundleState();

    for (const row of this.sql.exec<RunnerBundleSlotRow>(
      `SELECT
        slot,
        bundle_ref_json,
        bundle_version
      FROM runner_bundle_slots`,
    ).toArray()) {
      if (row.slot !== "vault") {
        continue;
      }

      bundleState.bundleRefJson = row.bundle_ref_json;
      bundleState.bundleVersion = row.bundle_version;
    }

    return bundleState;
  }

  private writeBundleStateSync(bundleState: RunnerStoredBundleState): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO runner_bundle_slots (
        slot,
        bundle_ref_json,
        bundle_version
      ) VALUES (?, ?, ?)`,
      "vault",
      bundleState.bundleRefJson,
      bundleState.bundleVersion,
    );
  }

  private clearLastErrorMetaSync(meta: RunnerMetaRow): void {
    meta.last_error_at = null;
    meta.last_error_code = null;
  }

  private rememberLastEventMetaSync(meta: RunnerMetaRow, eventId: string): void {
    meta.last_event_id = eventId;
  }

  private setRetryingEventMetaSync(meta: RunnerMetaRow, eventId: string): void {
    meta.retrying_event_id = eventId;
  }

  private clearRetryingEventMetaSync(meta: RunnerMetaRow): void {
    meta.retrying_event_id = null;
  }

  private readPersistedRunStatusSync(meta: RunnerMetaRow): HostedExecutionRunStatus | null {
    const run = this.readActiveRunContextSync(meta);
    if (!run || !meta.active_run_event_id) {
      return null;
    }

    return {
      ...run,
      eventId: meta.active_run_event_id,
      phase: "dispatch.running",
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
