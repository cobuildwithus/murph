import {
  deriveHostedExecutionErrorCode,
  normalizeHostedExecutionOperatorMessage,
  summarizeHostedExecutionErrorCode,
  summarizeHostedExecutionError,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunLevel,
  type HostedExecutionRunPhase,
  type HostedExecutionRunStatus,
  type HostedExecutionTimelineEntry,
} from "@murphai/hosted-execution";

import type {
  HostedDispatchPayloadStore,
} from "../dispatch-payload-store.js";
import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import { ensureRunnerQueueSchema } from "./runner-queue-schema.js";
import {
  appendBoundedRunnerTimelineEntry,
  assignRunnerBundleRefs,
  classifyMalformedPendingDispatchError,
  createDefaultRunnerBundleState,
  createDefaultRunnerMetaRow,
  nextConsumedEventExactExpiryIso,
  projectRunnerStateRecord,
  resolveRunnerNextWakeAt,
  type RunnerBundleSlotRow,
  type RunnerMetaRow,
  type RunnerStoredBundleState,
} from "./runner-queue-state.js";
import {
  MAX_BACKPRESSURED_EVENT_IDS,
  MAX_PENDING_EVENTS,
  MAX_POISONED_EVENT_IDS,
  MAX_RUN_TIMELINE_ENTRIES,
  type DurableObjectSqlValue,
  type DurableObjectStateLike,
  type PendingDispatchMetaRecord,
  type PendingDispatchRecord,
  type RunnerBundleVersion,
  type RunnerStateRecord,
} from "./types.js";

interface PendingEventRow {
  [key: string]: DurableObjectSqlValue;
  attempts: number;
  available_at: string;
  enqueued_at: string;
  event_id: string;
  last_error_code: string | null;
  payload_key: string;
}

interface PendingDispatchRowMeta extends PendingDispatchMetaRecord {
  payloadKey: string;
}

interface EventPresenceState {
  consumed: boolean;
  pending: boolean;
}

interface PoisonedEventRow {
  [key: string]: DurableObjectSqlValue;
  event_id: string;
  last_error_code: string;
  poisoned_at: string;
}

interface BackpressuredEventRow {
  [key: string]: DurableObjectSqlValue;
  event_id: string;
  rejected_at: string;
}

interface ConsumedEventRow {
  [key: string]: DurableObjectSqlValue;
  event_id: string;
  recorded_at: string;
}

interface BundleRefSwapInput {
  expectedVersion: RunnerBundleVersion;
  nextBundleRef: RunnerStateRecord["bundleRef"];
}

export class RunnerQueueStore {
  private readonly ready: Promise<void>;
  private volatileRun: HostedExecutionRunStatus | null = null;
  private volatileTimeline: HostedExecutionTimelineEntry[] = [];
  private userId: string | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly dispatchPayloadStore: HostedDispatchPayloadStore,
  ) {
    ensureRunnerQueueSchema(this.sql);
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
    this.pruneExpiredConsumedEventsSync();
    return this.readStateSync();
  }

  async readEventPresence(eventId: string): Promise<EventPresenceState> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();

    return {
      consumed: this.hasConsumedEventSync(eventId),
      pending: this.hasPendingDispatchSync(eventId),
    };
  }

  async readEventState(eventId: string): Promise<{
    backpressured: boolean;
    consumed: boolean;
    lastError: string | null;
    pending: boolean;
    poisoned: boolean;
  }> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();

    const pending = this.readPendingDispatchMetaByEventIdSync(eventId);
    const poisoned = this.readPoisonedEventByIdSync(eventId);

    return {
      backpressured: this.hasBackpressuredEventSync(eventId),
      consumed: this.hasConsumedEventSync(eventId),
      lastError: pending?.lastError ?? summarizeHostedExecutionErrorCode(poisoned?.last_error_code),
      pending: pending !== null,
      poisoned: poisoned !== null,
    };
  }

  async listPendingDispatches(): Promise<PendingDispatchRecord[]> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();
    return this.hydratePendingDispatchRows(this.readPendingDispatchRowsSync());
  }

  async hasDuePendingDispatch(nowMs: number): Promise<boolean> {
    await this.ready;
    return this.readNextDuePendingDispatchRowSync(nowMs) !== null;
  }

  async clearNextWakeIfDue(nowMs: number): Promise<RunnerStateRecord> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const parsedMs = meta.next_wake_at ? Date.parse(meta.next_wake_at) : Number.NaN;

    if (Number.isFinite(parsedMs) && parsedMs <= nowMs) {
      meta.next_wake_at = null;
      this.writeMetaRowSync(meta);
    }

    return this.readStateFromMetaSync(meta);
  }

  async enqueueDispatch(
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<{ accepted: boolean; alreadySeen: boolean; record: RunnerStateRecord }> {
    await this.ready;
    await this.bootstrapUser(dispatch.event.userId);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const nowIso = new Date().toISOString();
    if (this.hasPendingDispatchSync(dispatch.eventId) || this.hasConsumedEventSync(dispatch.eventId)) {
      return {
        accepted: false,
        alreadySeen: true,
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (this.countPendingEventsSync() >= MAX_PENDING_EVENTS) {
      this.writeBackpressuredEventSync(dispatch.eventId, nowIso);
      this.writeMetaRowSync(meta);
      return {
        accepted: false,
        alreadySeen: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const payloadKey = await this.writePendingDispatchPayload(dispatch);
    try {
      this.sql.exec(
        `INSERT INTO pending_events (
          event_id,
          payload_key,
          attempts,
          available_at,
          enqueued_at,
          last_error_code
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        dispatch.eventId,
        payloadKey,
        0,
        nowIso,
        nowIso,
        null,
      );
    } catch (error) {
      await this.deletePendingDispatchPayloadBestEffort(payloadKey);
      throw error;
    }

    meta.runtime_bootstrapped =
      meta.runtime_bootstrapped === 1 || dispatch.event.kind === "member.activated" ? 1 : 0;
    this.deleteBackpressuredEventSync(dispatch.eventId);
    meta.user_id = dispatch.event.userId;
    this.writeMetaRowSync(meta);

    return {
      accepted: true,
      alreadySeen: false,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async claimNextDuePendingDispatch(nowMs: number): Promise<{
    pendingDispatch: PendingDispatchRecord | null;
    record: RunnerStateRecord;
  }> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    if (meta.in_flight) {
      return {
        pendingDispatch: null,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const nextPending = await this.readNextDuePendingDispatch(nowMs);
    if (!nextPending) {
      const refreshedMeta = this.requireMetaRowSync();
      return {
        pendingDispatch: null,
        record: this.readStateFromMetaSync(refreshedMeta),
      };
    }

    meta.in_flight = 1;
    this.clearLastErrorMetaSync(meta);
    this.writeMetaRowSync(meta);
    return {
      pendingDispatch: nextPending,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async applyCommittedDispatch(
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.ready;
    await this.bootstrapUserFromCommittedResult(committed);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const bundleState = this.selectBundleStateSync();
    const pending = this.readPendingDispatchRowByEventIdSync(committed.eventId);
    if (pending) {
      await this.deletePendingDispatchPayloadBestEffort(pending.payload_key);
    }
    this.removePendingDispatchSync(committed.eventId);
    this.deletePoisonedEventSync(committed.eventId);
    this.deleteBackpressuredEventSync(committed.eventId);
    this.writeConsumedEventSync(
      committed.eventId,
      committed.committedAt,
      nextConsumedEventExactExpiryIso(),
    );
    assignRunnerBundleRefs(bundleState, committed.bundleRef);
    meta.in_flight = 0;
    this.clearLastErrorMetaSync(meta);
    meta.last_run_at = committed.committedAt;
    this.writeMetaRowSync(meta);
    this.writeBundleStateSync(bundleState);

    return this.readStateFromMetaSync(meta);
  }

  async syncCommittedBundles(
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.ready;
    await this.bootstrapUserFromCommittedResult(committed);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const bundleState = this.selectBundleStateSync();
    assignRunnerBundleRefs(bundleState, committed.bundleRef);
    this.deleteBackpressuredEventSync(committed.eventId);
    meta.in_flight = 0;
    this.clearLastErrorMetaSync(meta);
    meta.last_run_at = committed.committedAt;
    this.writeMetaRowSync(meta);
    this.writeBundleStateSync(bundleState);

    return this.readStateFromMetaSync(meta);
  }

  async reschedulePendingFailure(input: {
    error: unknown;
    eventId: string;
    maxEventAttempts: number;
    retryDelayMs: number;
  }): Promise<{ poisoned: boolean; record: RunnerStateRecord }> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();

    const pending = this.readPendingDispatchRowByEventIdSync(input.eventId);
    const meta = this.requireMetaRowSync();
    const errorAt = new Date().toISOString();
    const errorCode = deriveHostedExecutionErrorCode(input.error);
    const errorMessage = summarizeHostedExecutionError(input.error);

    if (!pending) {
      meta.in_flight = 0;
      meta.last_error_at = errorAt;
      meta.last_error_code = errorCode;
      this.writeMetaRowSync(meta);
      return {
        poisoned: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const nextAttempts = pending.attempts + 1;
    meta.in_flight = 0;
    meta.last_error_at = errorAt;
    meta.last_error_code = errorCode;

    if (nextAttempts >= input.maxEventAttempts) {
      this.removePendingDispatchSync(input.eventId);
      await this.deletePendingDispatchPayloadBestEffort(pending.payload_key);
      this.writeConsumedEventSync(input.eventId, errorAt, nextConsumedEventExactExpiryIso());
      this.writePoisonedEventSync(input.eventId, errorCode, errorAt);
      this.writeMetaRowSync(meta);
      return {
        poisoned: true,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const availableAt = new Date(Date.now() + input.retryDelayMs).toISOString();
    this.sql.exec(
      `UPDATE pending_events
        SET attempts = ?, available_at = ?, last_error_code = ?
        WHERE event_id = ?`,
      nextAttempts,
      availableAt,
      errorCode,
      input.eventId,
    );
    this.writeMetaRowSync(meta);

    return {
      poisoned: false,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async deferPendingConfigurationFailure(input: {
    error: unknown;
    eventId: string;
    retryDelayMs: number;
  }): Promise<RunnerStateRecord> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();

    const pending = this.readPendingDispatchRowByEventIdSync(input.eventId);
    const meta = this.requireMetaRowSync();
    const errorAt = new Date().toISOString();
    const errorCode = deriveHostedExecutionErrorCode(input.error);

    meta.in_flight = 0;
    meta.last_error_at = errorAt;
    meta.last_error_code = errorCode;

    if (!pending) {
      this.writeMetaRowSync(meta);
      return this.readStateFromMetaSync(meta);
    }

    this.sql.exec(
      `UPDATE pending_events
        SET available_at = ?, last_error_code = ?
        WHERE event_id = ?`,
      new Date(Date.now() + input.retryDelayMs).toISOString(),
      errorCode,
      input.eventId,
    );
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async rescheduleCommittedFinalizeRetry(input: {
    attempts: number;
    committed: HostedExecutionCommittedResult;
    error: unknown;
    retryDelayMs: number;
  }): Promise<RunnerStateRecord> {
    await this.ready;
    await this.bootstrapUserFromCommittedResult(input.committed);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const bundleState = this.selectBundleStateSync();
    const errorCode = deriveHostedExecutionErrorCode(input.error);
    assignRunnerBundleRefs(bundleState, input.committed.bundleRef);
    meta.in_flight = 0;
    meta.last_error_at = new Date().toISOString();
    meta.last_error_code = errorCode;
    meta.last_run_at = input.committed.committedAt;
    this.writeMetaRowSync(meta);
    this.writeBundleStateSync(bundleState);

    this.sql.exec(
      `UPDATE pending_events
        SET attempts = ?, available_at = ?, last_error_code = ?
        WHERE event_id = ?`,
      input.attempts,
      new Date(Date.now() + input.retryDelayMs).toISOString(),
      errorCode,
      input.committed.eventId,
    );

    return this.readStateFromMetaSync(meta);
  }

  async rememberCommittedEvent(eventId: string): Promise<RunnerStateRecord> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();
    this.deleteBackpressuredEventSync(eventId);

    if (!this.hasConsumedEventSync(eventId)) {
      this.writeConsumedEventSync(eventId, new Date().toISOString(), nextConsumedEventExactExpiryIso());
    }

    return this.readStateSync();
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
    this.pruneExpiredConsumedEventsSync();

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

    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async readBundleMetaState(): Promise<Pick<
    RunnerStateRecord,
    "bundleRef" | "bundleVersion" | "inFlight" | "userId"
  >> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();
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
    this.pruneExpiredConsumedEventsSync();

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

  async syncNextWake(input: {
    defaultAlarmDelayMs: number;
    preferredWakeAt?: string | null;
  }): Promise<RunnerStateRecord> {
    await this.ready;
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const nextPendingAvailableAt = this.readNextPendingAvailableAtSync();
    meta.next_wake_at = resolveRunnerNextWakeAt({
      runtimeBootstrapped: meta.runtime_bootstrapped === 1,
      defaultAlarmDelayMs: input.defaultAlarmDelayMs,
      nextPendingAvailableAt,
      preferredWakeAt: input.preferredWakeAt ?? null,
    });
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta, nextPendingAvailableAt);
  }

  private async bootstrapUserFromCommittedResult(committed: HostedExecutionCommittedResult): Promise<void> {
    const existingUserId = this.tryResolveUserIdSync();
    if (existingUserId) {
      return;
    }

    if (committed.userId) {
      await this.bootstrapUser(committed.userId);
      return;
    }

    const pendingUserId = await this.readPendingDispatchUserIdByEventId(committed.eventId);
    if (pendingUserId) {
      await this.bootstrapUser(pendingUserId);
      return;
    }

    throw new Error(`Hosted runner user is not initialized for committed event ${committed.eventId}.`);
  }

  private pruneExpiredConsumedEventsSync(): void {
    const nowIso = new Date().toISOString();
    this.sql.exec(
      "DELETE FROM consumed_events WHERE expires_at <= ?",
      nowIso,
    );
    this.prunePoisonedEventsSync();
  }

  private readStateSync(): RunnerStateRecord {
    return this.readStateFromMetaSync(this.requireMetaRowSync());
  }

  private readStateFromMetaSync(
    meta: RunnerMetaRow,
    nextPendingAvailableAtOverride: string | null = null,
  ): RunnerStateRecord {
    const projected = projectRunnerStateRecord({
      backpressuredEventIds: this.readBackpressuredEventIdsSync(),
      bundleState: this.selectBundleStateSync(),
      lastEventId: this.readLatestEventIdSync(),
      meta,
      nextPendingAvailableAt: nextPendingAvailableAtOverride ?? this.readNextPendingAvailableAtSync(),
      pendingDispatches: this.readPendingDispatchMetasSync(),
      poisonedEventIds: this.readPoisonedEventIdsSync(),
      retryingEventId: this.readRetryingEventIdSync(),
      run: this.volatileRun,
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
        runtime_bootstrapped,
        in_flight,
        last_error_at,
        last_error_code,
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

  private insertMetaRowSync(meta: RunnerMetaRow): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO runner_meta (
        singleton,
        user_id,
        runtime_bootstrapped,
        in_flight,
        last_error_at,
        last_error_code,
        last_run_at,
        next_wake_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.runtime_bootstrapped,
      meta.in_flight,
      meta.last_error_at,
      meta.last_error_code,
      meta.last_run_at,
      meta.next_wake_at,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
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

  private readPendingDispatchRowsSync(): PendingEventRow[] {
    return this.sql.exec<PendingEventRow>(
      `SELECT
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      FROM pending_events
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC`,
    ).toArray();
  }

  private readPendingDispatchMetasSync(): PendingDispatchMetaRecord[] {
    return this.readPendingDispatchRowsSync().map((row) => this.toPendingDispatchRowMeta(row));
  }

  private readPendingDispatchRowByEventIdSync(eventId: string): PendingEventRow | null {
    return this.sql.exec<PendingEventRow>(
      `SELECT
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      FROM pending_events
      WHERE event_id = ?`,
      eventId,
    ).toArray()[0] ?? null;
  }

  private readPendingDispatchMetaByEventIdSync(eventId: string): PendingDispatchMetaRecord | null {
    const row = this.readPendingDispatchRowByEventIdSync(eventId);
    return row ? this.toPendingDispatchRowMeta(row) : null;
  }

  private readNextDuePendingDispatchRowSync(nowMs: number): PendingEventRow | null {
    return this.sql.exec<PendingEventRow>(
      `SELECT
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      FROM pending_events
      WHERE available_at <= ?
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC
      LIMIT 1`,
      new Date(nowMs).toISOString(),
    ).toArray()[0] ?? null;
  }

  private async readNextDuePendingDispatch(nowMs: number): Promise<PendingDispatchRecord | null> {
    for (const row of this.sql.exec<PendingEventRow>(
      `SELECT
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      FROM pending_events
      WHERE available_at <= ?
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC`,
      new Date(nowMs).toISOString(),
    ).toArray()) {
      const parsed = await this.hydratePendingDispatchRow(row);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private readNextPendingAvailableAtSync(): string | null {
    const value = this.sql.exec<{ available_at: DurableObjectSqlValue }>(
      `SELECT available_at
      FROM pending_events
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC
      LIMIT 1`,
    ).toArray()[0]?.available_at;

    return typeof value === "string" ? value : null;
  }

  private readRetryingEventIdSync(): string | null {
    return this.readPendingDispatchMetasSync().find((pending) => pending.attempts > 0)?.eventId ?? null;
  }

  private countPendingEventsSync(): number {
    return this.readPendingDispatchMetasSync().length;
  }

  private hasPendingDispatchSync(eventId: string): boolean {
    return this.readPendingDispatchMetaByEventIdSync(eventId) !== null;
  }

  private hasConsumedEventSync(eventId: string): boolean {
    return this.sql.exec<{ count: DurableObjectSqlValue }>(
      "SELECT COUNT(*) AS count FROM consumed_events WHERE event_id = ?",
      eventId,
    ).toArray()[0]?.count === 1;
  }

  private readPoisonedEventIdsSync(): string[] {
    return this.sql.exec<{ event_id: DurableObjectSqlValue }>(
      `SELECT event_id
      FROM poisoned_events
      ORDER BY poisoned_at ASC, event_id ASC`,
    ).toArray()
      .map((row) => row.event_id)
      .filter((eventId): eventId is string => typeof eventId === "string")
      .slice(-MAX_POISONED_EVENT_IDS);
  }

  private readPoisonedEventByIdSync(eventId: string): PoisonedEventRow | null {
    return this.sql.exec<PoisonedEventRow>(
      `SELECT
        event_id,
        poisoned_at,
        last_error_code
      FROM poisoned_events
      WHERE event_id = ?`,
      eventId,
    ).toArray()[0] ?? null;
  }

  private removePendingDispatchSync(eventId: string): void {
    this.sql.exec("DELETE FROM pending_events WHERE event_id = ?", eventId);
  }

  private async readPendingDispatchUserIdByEventId(eventId: string): Promise<string | null> {
    const row = this.readPendingDispatchRowByEventIdSync(eventId);

    if (!row) {
      return null;
    }

    const userId = await this.readPendingDispatchUserId(row);

    if (userId) {
      return userId;
    }

    await this.poisonMalformedPendingDispatchRow(
      row,
      new TypeError(`Hosted runner pending dispatch ${eventId} does not encode a valid userId.`),
    );
    return null;
  }

  private async readPendingDispatchUserId(row: PendingEventRow): Promise<string | null> {
    try {
      return (await this.requirePendingDispatchPayload(row)).event.userId;
    } catch {
      return null;
    }
  }

  private async hydratePendingDispatchRows(rows: readonly PendingEventRow[]): Promise<PendingDispatchRecord[]> {
    const records: PendingDispatchRecord[] = [];

    for (const row of rows) {
      const parsed = await this.hydratePendingDispatchRow(row);
      if (parsed) {
        records.push(parsed);
      }
    }

    return records;
  }

  private async hydratePendingDispatchRow(row: PendingEventRow): Promise<PendingDispatchRecord | null> {
    try {
      const dispatch = await this.requirePendingDispatchPayload(row);
      const expectedUserId = this.tryResolveUserIdSync();

      if (dispatch.eventId !== row.event_id) {
        throw new Error(
          `Hosted runner pending payload ${row.payload_key} belongs to ${dispatch.eventId}, not ${row.event_id}.`,
        );
      }

      if (expectedUserId && dispatch.event.userId !== expectedUserId) {
        throw new Error(
          `Hosted runner pending payload ${row.payload_key} belongs to ${dispatch.event.userId}, not ${expectedUserId}.`,
        );
      }

      return {
        ...this.toPendingDispatchRowMeta(row),
        dispatch,
      };
    } catch (error) {
      await this.poisonMalformedPendingDispatchRow(row, error);
      return null;
    }
  }

  private toPendingDispatchRowMeta(row: PendingEventRow): PendingDispatchRowMeta {
    return {
      attempts: row.attempts,
      availableAt: row.available_at,
      enqueuedAt: row.enqueued_at,
      eventId: row.event_id,
      lastError: summarizeHostedExecutionErrorCode(row.last_error_code),
      payloadKey: row.payload_key,
    };
  }

  private async requirePendingDispatchPayload(row: PendingEventRow): Promise<HostedExecutionDispatchRequest> {
    const dispatch = await this.dispatchPayloadStore.readDispatchPayload({
      key: row.payload_key,
    });

    if (!dispatch) {
      throw new TypeError(`Hosted runner pending dispatch payload ${row.payload_key} is missing.`);
    }

    return dispatch;
  }

  private async writePendingDispatchPayload(dispatch: HostedExecutionDispatchRequest): Promise<string> {
    return (await this.dispatchPayloadStore.writeDispatchPayload(dispatch)).key;
  }

  private async deletePendingDispatchPayloadBestEffort(payloadKey: string | null): Promise<void> {
    if (!payloadKey) {
      return;
    }

    try {
      await this.dispatchPayloadStore.deleteDispatchPayload({ key: payloadKey });
    } catch {
      // Best-effort cleanup only; TTL backstops any failed transient blob deletion.
    }
  }

  private async poisonMalformedPendingDispatchRow(row: PendingEventRow, error: unknown): Promise<void> {
    const malformedError = classifyMalformedPendingDispatchError(error);
    const errorAt = new Date().toISOString();
    await this.deletePendingDispatchPayloadBestEffort(row.payload_key);
    this.removePendingDispatchSync(row.event_id);
    this.writeConsumedEventSync(row.event_id, errorAt, nextConsumedEventExactExpiryIso());
    this.writePoisonedEventSync(row.event_id, malformedError.errorCode, errorAt);

    const meta = this.selectMetaRowSync();
    if (!meta) {
      return;
    }

    meta.last_error_at = errorAt;
    meta.last_error_code = malformedError.errorCode;
    this.writeMetaRowSync(meta);
  }

  private writeConsumedEventSync(eventId: string, recordedAt: string, expiresAt: string): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO consumed_events (event_id, recorded_at, expires_at) VALUES (?, ?, ?)",
      eventId,
      recordedAt,
      expiresAt,
    );
  }

  private writePoisonedEventSync(eventId: string, lastErrorCode: string, poisonedAt: string): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO poisoned_events (
        event_id,
        poisoned_at,
        last_error_code
      ) VALUES (?, ?, ?)`,
      eventId,
      poisonedAt,
      lastErrorCode,
    );
    this.prunePoisonedEventsSync();
  }

  private deletePoisonedEventSync(eventId: string): void {
    this.sql.exec("DELETE FROM poisoned_events WHERE event_id = ?", eventId);
  }

  private clearLastErrorMetaSync(meta: RunnerMetaRow): void {
    meta.last_error_at = null;
    meta.last_error_code = null;
  }

  private hasBackpressuredEventSync(eventId: string): boolean {
    return this.sql.exec<{ count: DurableObjectSqlValue }>(
      "SELECT COUNT(*) AS count FROM backpressured_events WHERE event_id = ?",
      eventId,
    ).toArray()[0]?.count === 1;
  }

  private readBackpressuredEventIdsSync(): string[] {
    return this.sql.exec<{ event_id: DurableObjectSqlValue }>(
      `SELECT event_id
      FROM backpressured_events
      ORDER BY rejected_at ASC, event_id ASC`,
    ).toArray()
      .map((row) => row.event_id)
      .filter((eventId): eventId is string => typeof eventId === "string")
      .slice(-MAX_BACKPRESSURED_EVENT_IDS);
  }

  private writeBackpressuredEventSync(eventId: string, rejectedAt: string): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO backpressured_events (
        event_id,
        rejected_at
      ) VALUES (?, ?)`,
      eventId,
      rejectedAt,
    );
    this.pruneBackpressuredEventsSync();
  }

  private deleteBackpressuredEventSync(eventId: string): void {
    this.sql.exec("DELETE FROM backpressured_events WHERE event_id = ?", eventId);
  }

  private pruneBackpressuredEventsSync(): void {
    this.sql.exec(
      `DELETE FROM backpressured_events
        WHERE event_id NOT IN (
          SELECT event_id
          FROM backpressured_events
          ORDER BY rejected_at DESC, event_id DESC
          LIMIT ?
        )`,
      MAX_BACKPRESSURED_EVENT_IDS,
    );
  }

  private readLatestEventIdSync(): string | null {
    if (this.volatileRun) {
      return this.volatileRun.eventId;
    }

    const rows = [
      ...this.sql.exec<ConsumedEventRow>(
        `SELECT event_id, recorded_at
        FROM consumed_events
        ORDER BY recorded_at DESC, event_id DESC
        LIMIT 1`,
      ).toArray().map((row) => ({ eventId: row.event_id, at: row.recorded_at })),
      ...this.sql.exec<PendingEventRow>(
        `SELECT event_id, enqueued_at, payload_key, attempts, available_at, last_error_code
        FROM pending_events
        ORDER BY enqueued_at DESC, event_id DESC
        LIMIT 1`,
      ).toArray().map((row) => ({ eventId: row.event_id, at: row.enqueued_at })),
      ...this.sql.exec<PoisonedEventRow>(
        `SELECT event_id, poisoned_at, last_error_code
        FROM poisoned_events
        ORDER BY poisoned_at DESC, event_id DESC
        LIMIT 1`,
      ).toArray().map((row) => ({ eventId: row.event_id, at: row.poisoned_at })),
      ...this.sql.exec<BackpressuredEventRow>(
        `SELECT event_id, rejected_at
        FROM backpressured_events
        ORDER BY rejected_at DESC, event_id DESC
        LIMIT 1`,
      ).toArray().map((row) => ({ eventId: row.event_id, at: row.rejected_at })),
    ].filter((row) => row.eventId && row.at);

    rows.sort((left, right) => {
      const timeDelta = Date.parse(right.at) - Date.parse(left.at);
      return Number.isNaN(timeDelta) || timeDelta === 0
        ? right.eventId.localeCompare(left.eventId)
        : timeDelta;
    });

    return rows[0]?.eventId ?? null;
  }

  private get sql() {
    const sql = this.state.storage.sql;
    if (!sql) {
      throw new Error("Hosted runner Durable Object storage.sql is required.");
    }

    return sql;
  }

  private prunePoisonedEventsSync(): void {
    this.sql.exec(
      `DELETE FROM poisoned_events
        WHERE event_id NOT IN (
          SELECT event_id
          FROM poisoned_events
          ORDER BY poisoned_at DESC, event_id DESC
          LIMIT ?
        )`,
      MAX_POISONED_EVENT_IDS,
    );
  }
}
