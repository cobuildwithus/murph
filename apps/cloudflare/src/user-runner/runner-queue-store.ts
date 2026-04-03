import {
  HOSTED_EXECUTION_BUNDLE_SLOTS,
  deriveHostedExecutionErrorCode,
  normalizeHostedExecutionOperatorMessage,
  parseHostedExecutionDispatchRequest,
  summarizeHostedExecutionError,
  type HostedExecutionBundleSlot,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunLevel,
  type HostedExecutionRunPhase,
  type HostedExecutionRunStatus,
} from "@murphai/hosted-execution";

import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import { ensureRunnerQueueSchema } from "./runner-queue-schema.js";
import {
  appendBoundedRunnerEventId,
  appendBoundedRunnerTimelineEntry,
  assignRunnerBundleRefs,
  classifyMalformedPendingDispatchError,
  createDefaultRunnerBundleSlots,
  createDefaultRunnerMetaRow,
  mergeRunnerLastError,
  nextConsumedEventExactExpiryIso,
  parseRunnerStringArray,
  parseStoredRunnerTimelineEntries,
  projectRunnerStateRecord,
  resolveRunnerNextWakeAt,
  type RunnerBundleSlotRow,
  type RunnerMetaRow,
  type RunnerStoredBundleSlots,
} from "./runner-queue-state.js";
import {
  MAX_BACKPRESSURED_EVENT_IDS,
  MAX_PENDING_EVENTS,
  MAX_POISONED_EVENT_IDS,
  MAX_RUN_TIMELINE_ENTRIES,
  type DurableObjectSqlValue,
  type DurableObjectStateLike,
  type PendingDispatchRecord,
  type RunnerBundleVersions,
  type RunnerStateRecord,
} from "./types.js";

interface PendingEventRow {
  [key: string]: DurableObjectSqlValue;
  attempts: number;
  available_at: string;
  dispatch_json: string;
  enqueued_at: string;
  event_id: string;
  last_error: string | null;
}

interface EventPresenceState {
  consumed: boolean;
  pending: boolean;
}

interface PoisonedEventRow {
  [key: string]: DurableObjectSqlValue;
  event_id: string;
  last_error: string;
  poisoned_at: string;
}

interface BundleRefSwapInput {
  expectedVersions: RunnerBundleVersions;
  nextBundleRefs: RunnerStateRecord["bundleRefs"];
}

export class RunnerQueueStore {
  private userId: string | null = null;

  constructor(private readonly state: DurableObjectStateLike) {
    ensureRunnerQueueSchema(this.sql);
    this.ensureCanonicalBundleSlotRowsSync();
    this.repairStoredMetaStateSync();
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
    this.pruneExpiredConsumedEventsSync();
    return this.readStateSync();
  }

  async readEventPresence(eventId: string): Promise<EventPresenceState> {
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
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const pending = this.readPendingDispatchByEventIdSync(eventId);
    const poisoned = this.readPoisonedEventByIdSync(eventId);

    return {
      backpressured: parseRunnerStringArray(meta.backpressured_event_ids_json).includes(eventId),
      consumed: this.hasConsumedEventSync(eventId),
      lastError: pending?.lastError ?? poisoned?.last_error ?? null,
      pending: pending !== null,
      poisoned: poisoned !== null,
    };
  }

  async listPendingDispatches(): Promise<PendingDispatchRecord[]> {
    this.pruneExpiredConsumedEventsSync();
    return this.readPendingDispatchesSync();
  }

  async hasDuePendingDispatch(nowMs: number): Promise<boolean> {
    return this.readNextDuePendingDispatchSync(nowMs) !== null;
  }

  async clearNextWakeIfDue(nowMs: number): Promise<RunnerStateRecord> {
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
    await this.bootstrapUser(dispatch.event.userId);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    if (this.hasPendingDispatchSync(dispatch.eventId) || this.hasConsumedEventSync(dispatch.eventId)) {
      return {
        accepted: false,
        alreadySeen: true,
        record: this.readStateFromMetaSync(meta),
      };
    }

    if (this.countPendingEventsSync() >= MAX_PENDING_EVENTS) {
      meta.backpressured_event_ids_json = JSON.stringify(
        appendBoundedRunnerEventId(
          parseRunnerStringArray(meta.backpressured_event_ids_json),
          dispatch.eventId,
          MAX_BACKPRESSURED_EVENT_IDS,
        ),
      );
      this.writeMetaRowSync(meta);
      return {
        accepted: false,
        alreadySeen: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const nowIso = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO pending_events (
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      dispatch.eventId,
      JSON.stringify(dispatch),
      0,
      nowIso,
      nowIso,
      null,
    );

    meta.activated = meta.activated === 1 || dispatch.event.kind === "member.activated" ? 1 : 0;
    meta.backpressured_event_ids_json = JSON.stringify(
      parseRunnerStringArray(meta.backpressured_event_ids_json)
        .filter((eventId) => eventId !== dispatch.eventId),
    );
    meta.last_event_id = dispatch.eventId;
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
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    if (meta.in_flight) {
      return {
        pendingDispatch: null,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const nextPending = this.readNextDuePendingDispatchSync(nowMs);
    if (!nextPending) {
      const refreshedMeta = this.requireMetaRowSync();
      refreshedMeta.retrying_event_id = this.readRetryingEventIdSync();
      this.writeMetaRowSync(refreshedMeta);
      return {
        pendingDispatch: null,
        record: this.readStateFromMetaSync(refreshedMeta),
      };
    }

    meta.in_flight = 1;
    this.clearLastErrorMetaSync(meta);
    meta.retrying_event_id = nextPending.attempts > 0 ? nextPending.eventId : null;
    this.writeMetaRowSync(meta);
    return {
      pendingDispatch: nextPending,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async applyCommittedDispatch(
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.bootstrapUserFromCommittedResult(committed);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const bundleSlots = this.selectBundleSlotStateSync();
    this.removePendingDispatchSync(committed.eventId);
    this.deletePoisonedEventSync(committed.eventId);
    this.writeConsumedEventSync(committed.eventId, nextConsumedEventExactExpiryIso());
    assignRunnerBundleRefs(bundleSlots, committed.bundleRefs);
    meta.backpressured_event_ids_json = JSON.stringify(
      parseRunnerStringArray(meta.backpressured_event_ids_json)
        .filter((eventId) => eventId !== committed.eventId),
    );
    meta.in_flight = 0;
    this.clearLastErrorMetaSync(meta);
    meta.last_event_id = committed.eventId;
    meta.last_run_at = committed.committedAt;
    meta.retrying_event_id = null;
    this.writeMetaRowSync(meta);
    this.writeBundleSlotStateSync(bundleSlots);

    return this.readStateFromMetaSync(meta);
  }

  async syncCommittedBundles(
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.bootstrapUserFromCommittedResult(committed);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const bundleSlots = this.selectBundleSlotStateSync();
    assignRunnerBundleRefs(bundleSlots, committed.bundleRefs);
    meta.in_flight = 0;
    this.clearLastErrorMetaSync(meta);
    meta.last_event_id = committed.eventId;
    meta.last_run_at = committed.committedAt;
    meta.retrying_event_id = this.hasPendingDispatchSync(committed.eventId)
      ? committed.eventId
      : meta.retrying_event_id;
    this.writeMetaRowSync(meta);
    this.writeBundleSlotStateSync(bundleSlots);

    return this.readStateFromMetaSync(meta);
  }

  async reschedulePendingFailure(input: {
    error: unknown;
    eventId: string;
    maxEventAttempts: number;
    retryDelayMs: number;
  }): Promise<{ poisoned: boolean; record: RunnerStateRecord }> {
    this.pruneExpiredConsumedEventsSync();

    const pending = this.readPendingDispatchByEventIdSync(input.eventId);
    const meta = this.requireMetaRowSync();
    const errorAt = new Date().toISOString();
    const errorCode = deriveHostedExecutionErrorCode(input.error);
    const errorMessage = summarizeHostedExecutionError(input.error);

    if (!pending) {
      meta.in_flight = 0;
      meta.last_error = errorMessage;
      meta.last_error_at = errorAt;
      meta.last_error_code = errorCode;
      meta.retrying_event_id = this.readRetryingEventIdSync();
      this.writeMetaRowSync(meta);
      return {
        poisoned: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const nextAttempts = pending.attempts + 1;
    meta.in_flight = 0;
    meta.last_error = errorMessage;
    meta.last_error_at = errorAt;
    meta.last_error_code = errorCode;
    meta.last_event_id = input.eventId;

    if (nextAttempts >= input.maxEventAttempts) {
      this.removePendingDispatchSync(input.eventId);
      this.writeConsumedEventSync(input.eventId, nextConsumedEventExactExpiryIso());
      this.writePoisonedEventSync(input.eventId, errorMessage, errorAt);
      meta.retrying_event_id = this.readRetryingEventIdSync();
      this.writeMetaRowSync(meta);
      return {
        poisoned: true,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const availableAt = new Date(Date.now() + input.retryDelayMs).toISOString();
    this.sql.exec(
      `UPDATE pending_events
        SET attempts = ?, available_at = ?, last_error = ?
        WHERE event_id = ?`,
      nextAttempts,
      availableAt,
      errorMessage,
      input.eventId,
    );
    meta.retrying_event_id = input.eventId;
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
    this.pruneExpiredConsumedEventsSync();

    const pending = this.readPendingDispatchByEventIdSync(input.eventId);
    const meta = this.requireMetaRowSync();
    const errorAt = new Date().toISOString();
    const errorMessage = summarizeHostedExecutionError(input.error);

    meta.in_flight = 0;
    meta.last_error = errorMessage;
    meta.last_error_at = errorAt;
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    meta.last_event_id = input.eventId;

    if (!pending) {
      meta.retrying_event_id = this.readRetryingEventIdSync();
      this.writeMetaRowSync(meta);
      return this.readStateFromMetaSync(meta);
    }

    this.sql.exec(
      `UPDATE pending_events
        SET available_at = ?, last_error = ?
        WHERE event_id = ?`,
      new Date(Date.now() + input.retryDelayMs).toISOString(),
      errorMessage,
      input.eventId,
    );
    meta.retrying_event_id = input.eventId;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async rescheduleCommittedFinalizeRetry(input: {
    attempts: number;
    committed: HostedExecutionCommittedResult;
    error: unknown;
    retryDelayMs: number;
  }): Promise<RunnerStateRecord> {
    await this.bootstrapUserFromCommittedResult(input.committed);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const bundleSlots = this.selectBundleSlotStateSync();
    const errorMessage = summarizeHostedExecutionError(input.error);
    assignRunnerBundleRefs(bundleSlots, input.committed.bundleRefs);
    meta.in_flight = 0;
    meta.last_error = errorMessage;
    meta.last_error_at = new Date().toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    meta.last_event_id = input.committed.eventId;
    meta.last_run_at = input.committed.committedAt;
    meta.retrying_event_id = input.committed.eventId;
    this.writeMetaRowSync(meta);
    this.writeBundleSlotStateSync(bundleSlots);

    this.sql.exec(
      `UPDATE pending_events
        SET attempts = ?, available_at = ?, last_error = ?
        WHERE event_id = ?`,
      input.attempts,
      new Date(Date.now() + input.retryDelayMs).toISOString(),
      errorMessage,
      input.committed.eventId,
    );

    return this.readStateFromMetaSync(meta);
  }

  async rememberCommittedEvent(eventId: string): Promise<RunnerStateRecord> {
    this.pruneExpiredConsumedEventsSync();

    if (!this.hasConsumedEventSync(eventId)) {
      this.writeConsumedEventSync(eventId, nextConsumedEventExactExpiryIso());
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
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const nowIso = new Date().toISOString();
    const errorCode = input.error === undefined ? null : deriveHostedExecutionErrorCode(input.error);
    meta.last_event_id = input.eventId;
    meta.run_json = JSON.stringify({
      attempt: input.attempt,
      eventId: input.eventId,
      phase: input.phase,
      runId: input.runId,
      startedAt: input.startedAt,
      updatedAt: nowIso,
    } satisfies HostedExecutionRunStatus);
    meta.timeline_json = JSON.stringify(
      appendBoundedRunnerTimelineEntry(
        parseStoredRunnerTimelineEntries(meta.timeline_json),
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
      ),
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
    "bundleRefs" | "bundleVersions" | "inFlight" | "userId"
  >> {
    this.pruneExpiredConsumedEventsSync();
    const record = this.readStateSync();
    return {
      bundleRefs: record.bundleRefs,
      bundleVersions: record.bundleVersions,
      inFlight: record.inFlight,
      userId: record.userId,
    };
  }

  async compareAndSwapBundleRefs(
    input: BundleRefSwapInput,
  ): Promise<{ applied: boolean; record: RunnerStateRecord }> {
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const bundleSlots = this.selectBundleSlotStateSync();
    if (HOSTED_EXECUTION_BUNDLE_SLOTS.some(
      (slot) => bundleSlots.bundleVersions[slot] !== input.expectedVersions[slot],
    )) {
      return {
        applied: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    assignRunnerBundleRefs(bundleSlots, input.nextBundleRefs);
    this.writeBundleSlotStateSync(bundleSlots);
    return {
      applied: true,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async syncNextWake(input: {
    defaultAlarmDelayMs: number;
    preferredWakeAt?: string | null;
  }): Promise<RunnerStateRecord> {
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    const nextPendingAvailableAt = this.readNextPendingAvailableAtSync();
    meta.next_wake_at = resolveRunnerNextWakeAt({
      activated: meta.activated === 1,
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

    const pendingDispatch = this.readPendingDispatchByEventIdSync(committed.eventId);
    if (pendingDispatch) {
      await this.bootstrapUser(pendingDispatch.dispatch.event.userId);
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
      bundleSlots: this.selectBundleSlotStateSync(),
      meta,
      nextPendingAvailableAtOverride,
      pendingDispatches: this.readPendingDispatchesSync(),
      poisonedEventIds: this.readPoisonedEventIdsSync(),
    });

    if (projected.changed) {
      Object.assign(meta, projected.sanitizedMeta);
      this.writeMetaRowSync(meta);
      this.writeBundleSlotStateSync(projected.sanitizedBundleSlots);
    }

    return projected.record;
  }

  private repairStoredMetaStateSync(): void {
    const meta = this.selectMetaRowSync();
    if (!meta) {
      return;
    }

    const projected = projectRunnerStateRecord({
      bundleSlots: this.selectBundleSlotStateSync(),
      meta,
      pendingDispatches: [],
      poisonedEventIds: [],
    });
    if (!projected.changed) {
      return;
    }

    Object.assign(meta, projected.sanitizedMeta);
    this.writeMetaRowSync(meta);
    this.writeBundleSlotStateSync(projected.sanitizedBundleSlots);
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
        activated,
        in_flight,
        last_error,
        last_error_at,
        last_error_code,
        last_event_id,
        last_run_at,
        next_wake_at,
        retrying_event_id,
        backpressured_event_ids_json,
        run_json,
        timeline_json
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
        activated,
        in_flight,
        last_error,
        last_error_at,
        last_error_code,
        last_event_id,
        last_run_at,
        next_wake_at,
        retrying_event_id,
        backpressured_event_ids_json,
        run_json,
        timeline_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.activated,
      meta.in_flight,
      meta.last_error,
      meta.last_error_at,
      meta.last_error_code,
      meta.last_event_id,
      meta.last_run_at,
      meta.next_wake_at,
      meta.retrying_event_id,
      meta.backpressured_event_ids_json,
      meta.run_json,
      meta.timeline_json,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
  }

  private ensureCanonicalBundleSlotRowsSync(): void {
    for (const slot of HOSTED_EXECUTION_BUNDLE_SLOTS) {
      this.sql.exec(
        `INSERT OR IGNORE INTO runner_bundle_slots (
          slot,
          bundle_ref_json,
          bundle_version
        ) VALUES (?, ?, ?)`,
        slot,
        null,
        0,
      );
    }
  }

  private selectBundleSlotStateSync(): RunnerStoredBundleSlots {
    const bundleSlots = createDefaultRunnerBundleSlots();

    for (const row of this.sql.exec<RunnerBundleSlotRow>(
      `SELECT
        slot,
        bundle_ref_json,
        bundle_version
      FROM runner_bundle_slots`,
    ).toArray()) {
      if (!HOSTED_EXECUTION_BUNDLE_SLOTS.includes(row.slot as HostedExecutionBundleSlot)) {
        continue;
      }

      const slot = row.slot as HostedExecutionBundleSlot;
      bundleSlots.bundleRefJsonBySlot[slot] = row.bundle_ref_json;
      bundleSlots.bundleVersions[slot] = row.bundle_version;
    }

    return bundleSlots;
  }

  private writeBundleSlotStateSync(bundleSlots: RunnerStoredBundleSlots): void {
    for (const slot of HOSTED_EXECUTION_BUNDLE_SLOTS) {
      this.sql.exec(
        `INSERT OR REPLACE INTO runner_bundle_slots (
          slot,
          bundle_ref_json,
          bundle_version
        ) VALUES (?, ?, ?)`,
        slot,
        bundleSlots.bundleRefJsonBySlot[slot],
        bundleSlots.bundleVersions[slot],
      );
    }
  }

  private readPendingDispatchesSync(): PendingDispatchRecord[] {
    const records: PendingDispatchRecord[] = [];

    for (const row of this.sql.exec<PendingEventRow>(
      `SELECT
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      FROM pending_events
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC`,
    ).toArray()) {
      const parsed = this.parsePendingDispatchRowSync(row);
      if (parsed) {
        records.push(parsed);
      }
    }

    return records;
  }

  private readPendingDispatchByEventIdSync(eventId: string): PendingDispatchRecord | null {
    const row = this.sql.exec<PendingEventRow>(
      `SELECT
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      FROM pending_events
      WHERE event_id = ?`,
      eventId,
    ).toArray()[0] ?? null;

    return row ? this.parsePendingDispatchRowSync(row) : null;
  }

  private readNextDuePendingDispatchSync(nowMs: number): PendingDispatchRecord | null {
    const nowIso = new Date(nowMs).toISOString();
    for (const row of this.sql.exec<PendingEventRow>(
      `SELECT
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      FROM pending_events
      WHERE available_at <= ?
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC
      `,
      nowIso,
    ).toArray()) {
      const parsed = this.parsePendingDispatchRowSync(row);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  private readNextPendingAvailableAtSync(): string | null {
    return this.readPendingDispatchesSync()[0]?.availableAt ?? null;
  }

  private readRetryingEventIdSync(): string | null {
    return this.readPendingDispatchesSync().find((pending) => pending.attempts > 0)?.eventId ?? null;
  }

  private countPendingEventsSync(): number {
    return this.readPendingDispatchesSync().length;
  }

  private hasPendingDispatchSync(eventId: string): boolean {
    return this.readPendingDispatchByEventIdSync(eventId) !== null;
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
        last_error
      FROM poisoned_events
      WHERE event_id = ?`,
      eventId,
    ).toArray()[0] ?? null;
  }

  private removePendingDispatchSync(eventId: string): void {
    this.sql.exec("DELETE FROM pending_events WHERE event_id = ?", eventId);
  }

  private parsePendingDispatchRowSync(row: PendingEventRow): PendingDispatchRecord | null {
    try {
      return {
        attempts: row.attempts,
        availableAt: row.available_at,
        dispatch: parseHostedExecutionDispatchRequest(JSON.parse(row.dispatch_json) as unknown),
        enqueuedAt: row.enqueued_at,
        eventId: row.event_id,
        lastError: row.last_error,
      };
    } catch (error) {
      this.poisonMalformedPendingDispatchRowSync(row, error);
      return null;
    }
  }

  private poisonMalformedPendingDispatchRowSync(row: PendingEventRow, error: unknown): void {
    const malformedError = classifyMalformedPendingDispatchError(error);
    const errorAt = new Date().toISOString();
    this.removePendingDispatchSync(row.event_id);
    this.writeConsumedEventSync(row.event_id, nextConsumedEventExactExpiryIso());
    this.writePoisonedEventSync(row.event_id, malformedError.message, errorAt);

    const meta = this.selectMetaRowSync();
    if (!meta) {
      return;
    }

    meta.last_error = mergeRunnerLastError(meta.last_error, malformedError.message);
    meta.last_error_at = errorAt;
    meta.last_error_code = malformedError.errorCode;
    meta.last_event_id = row.event_id;
    if (meta.retrying_event_id === row.event_id) {
      meta.retrying_event_id = null;
    }
    this.writeMetaRowSync(meta);
  }

  private writeConsumedEventSync(eventId: string, expiresAt: string): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO consumed_events (event_id, expires_at) VALUES (?, ?)",
      eventId,
      expiresAt,
    );
  }

  private writePoisonedEventSync(eventId: string, lastError: string, poisonedAt: string): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO poisoned_events (
        event_id,
        poisoned_at,
        last_error
      ) VALUES (?, ?, ?)`,
      eventId,
      poisonedAt,
      lastError,
    );
    this.prunePoisonedEventsSync();
  }

  private deletePoisonedEventSync(eventId: string): void {
    this.sql.exec("DELETE FROM poisoned_events WHERE event_id = ?", eventId);
  }

  private clearLastErrorMetaSync(meta: RunnerMetaRow): void {
    meta.last_error = null;
    meta.last_error_at = null;
    meta.last_error_code = null;
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
