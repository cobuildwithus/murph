import {
  deriveHostedExecutionErrorCode,
  normalizeHostedExecutionOperatorMessage,
  parseHostedExecutionDispatchRequest,
  parseHostedExecutionRunStatus,
  parseHostedExecutionTimelineEntries,
  summarizeHostedExecutionError,
  type HostedExecutionBundleRef,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunLevel,
  type HostedExecutionRunPhase,
  type HostedExecutionRunStatus,
  type HostedExecutionTimelineEntry,
} from "@murph/hosted-execution";

import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import {
  CONSUMED_EVENT_EXACT_TTL_MS,
  MAX_BACKPRESSURED_EVENT_IDS,
  MAX_PENDING_EVENTS,
  MAX_POISONED_EVENT_IDS,
  MAX_RUN_TIMELINE_ENTRIES,
  type DurableObjectSqlValue,
  type DurableObjectStateLike,
  type PendingDispatchRecord,
  type RunnerBundleVersions,
  type RunnerStateRecord,
  earliestIsoTimestamp,
  sameBundleRef,
} from "./types.js";

interface RunnerMetaRow {
  [key: string]: DurableObjectSqlValue;
  activated: number;
  agent_state_bundle_ref_json: string | null;
  agent_state_bundle_version: number;
  backpressured_event_ids_json: string;
  in_flight: number;
  last_error: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  last_event_id: string | null;
  last_run_at: string | null;
  next_wake_at: string | null;
  retrying_event_id: string | null;
  run_json: string | null;
  timeline_json: string;
  user_id: string;
  vault_bundle_ref_json: string | null;
  vault_bundle_version: number;
}

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
    this.ensureSchema();
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

    this.insertMetaRowSync(defaultMetaRow(userId));
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
      backpressured: parseStringArray(meta.backpressured_event_ids_json).includes(eventId),
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
        appendBoundedEventId(
          parseStringArray(meta.backpressured_event_ids_json),
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
      parseStringArray(meta.backpressured_event_ids_json)
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
    meta.last_error = null;
    meta.last_error_at = null;
    meta.last_error_code = null;
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
    this.removePendingDispatchSync(committed.eventId);
    this.deletePoisonedEventSync(committed.eventId);
    this.writeConsumedEventSync(committed.eventId, nextConsumedEventExactExpiryIso());
    assignBundleRefs(meta, committed.bundleRefs);
    meta.backpressured_event_ids_json = JSON.stringify(
      parseStringArray(meta.backpressured_event_ids_json)
        .filter((eventId) => eventId !== committed.eventId),
    );
    meta.in_flight = 0;
    meta.last_error = null;
    meta.last_error_at = null;
    meta.last_error_code = null;
    meta.last_event_id = committed.eventId;
    meta.last_run_at = committed.committedAt;
    meta.retrying_event_id = null;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async syncCommittedBundles(
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.bootstrapUserFromCommittedResult(committed);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.requireMetaRowSync();
    assignBundleRefs(meta, committed.bundleRefs);
    meta.in_flight = 0;
    meta.last_error_at = null;
    meta.last_error_code = null;
    meta.last_event_id = committed.eventId;
    meta.last_run_at = committed.committedAt;
    meta.retrying_event_id = this.hasPendingDispatchSync(committed.eventId)
      ? committed.eventId
      : meta.retrying_event_id;
    this.writeMetaRowSync(meta);

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
    const errorMessage = summarizeHostedExecutionError(input.error);
    assignBundleRefs(meta, input.committed.bundleRefs);
    meta.in_flight = 0;
    meta.last_error = errorMessage;
    meta.last_error_at = new Date().toISOString();
    meta.last_error_code = deriveHostedExecutionErrorCode(input.error);
    meta.last_event_id = input.committed.eventId;
    meta.last_run_at = input.committed.committedAt;
    meta.retrying_event_id = input.committed.eventId;
    this.writeMetaRowSync(meta);

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
      appendBoundedTimelineEntry(
        parseHostedExecutionTimelineEntriesJson(meta.timeline_json),
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
      meta.last_error_at = null;
      meta.last_error_code = null;
    }

    if (errorCode) {
      meta.last_error_at = nowIso;
      meta.last_error_code = errorCode;
    }

    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async readBundleState(): Promise<Pick<
    RunnerStateRecord,
    "bundleRefs" | "bundleVersions" | "inFlight" | "userId"
  >> {
    const record = await this.readState();
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
    if (
      meta.agent_state_bundle_version !== input.expectedVersions.agentState
      || meta.vault_bundle_version !== input.expectedVersions.vault
    ) {
      return {
        applied: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    assignBundleRefs(meta, input.nextBundleRefs);
    this.writeMetaRowSync(meta);
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
    const preferredWakeAt = normalizePreferredWakeAt(input.preferredWakeAt ?? null);
    const scheduledWakeAt = earliestIsoTimestamp(
      nextPendingAvailableAt,
      preferredWakeAt,
    );
    const fallbackWakeAt = meta.activated
      ? new Date(Date.now() + input.defaultAlarmDelayMs).toISOString()
      : null;
    meta.next_wake_at = scheduledWakeAt ?? fallbackWakeAt;
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

  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS runner_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        user_id TEXT NOT NULL,
        activated INTEGER NOT NULL DEFAULT 0,
        in_flight INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_error_at TEXT,
        last_error_code TEXT,
        last_event_id TEXT,
        last_run_at TEXT,
        next_wake_at TEXT,
        retrying_event_id TEXT,
        backpressured_event_ids_json TEXT NOT NULL DEFAULT '[]',
        agent_state_bundle_ref_json TEXT,
        vault_bundle_ref_json TEXT,
        run_json TEXT,
        timeline_json TEXT NOT NULL DEFAULT '[]',
        agent_state_bundle_version INTEGER NOT NULL DEFAULT 0,
        vault_bundle_version INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.ensureMetaColumnSync("last_error_at", "TEXT");
    this.ensureMetaColumnSync("last_error_code", "TEXT");
    this.ensureMetaColumnSync("run_json", "TEXT");
    this.ensureMetaColumnSync("timeline_json", "TEXT NOT NULL DEFAULT '[]'");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_events (
        event_id TEXT PRIMARY KEY,
        dispatch_json TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        available_at TEXT NOT NULL,
        enqueued_at TEXT NOT NULL,
        last_error TEXT
      )
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS pending_events_available_at_idx
      ON pending_events (available_at, enqueued_at, event_id)
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS consumed_events (
        event_id TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS consumed_events_expires_at_idx
      ON consumed_events (expires_at)
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS poisoned_events (
        event_id TEXT PRIMARY KEY,
        poisoned_at TEXT NOT NULL,
        last_error TEXT NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS poisoned_events_poisoned_at_idx
      ON poisoned_events (poisoned_at, event_id)
    `);
    this.sql.exec("DROP TABLE IF EXISTS consumed_event_replay_filter");
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
    const pendingDispatches = this.readPendingDispatchesSync();
    const bundleRefState = sanitizeStoredBundleRefs(meta);
    const runTraceState = sanitizeStoredRunTrace(meta);

    if (bundleRefState.changed || runTraceState.changed) {
      meta.agent_state_bundle_ref_json = stringifyHostedBundleRef(bundleRefState.agentState);
      meta.vault_bundle_ref_json = stringifyHostedBundleRef(bundleRefState.vault);
      meta.run_json = stringifyRunStatus(runTraceState.run);
      meta.timeline_json = JSON.stringify(runTraceState.timeline);
      meta.last_error = mergeRunnerLastError(
        mergeRunnerLastError(meta.last_error, bundleRefState.warning),
        runTraceState.warning,
      );
      this.writeMetaRowSync(meta);
    }

    return {
      activated: meta.activated === 1,
      backpressuredEventIds: parseStringArray(meta.backpressured_event_ids_json),
      bundleRefs: {
        agentState: bundleRefState.agentState,
        vault: bundleRefState.vault,
      },
      bundleVersions: {
        agentState: meta.agent_state_bundle_version,
        vault: meta.vault_bundle_version,
      },
      inFlight: meta.in_flight === 1,
      lastError: meta.last_error,
      lastErrorAt: meta.last_error_at,
      lastErrorCode: meta.last_error_code,
      lastEventId: meta.last_event_id,
      lastRunAt: meta.last_run_at,
      nextPendingAvailableAt: nextPendingAvailableAtOverride ?? pendingDispatches[0]?.availableAt ?? null,
      nextWakeAt: meta.next_wake_at,
      pendingEventCount: pendingDispatches.length,
      poisonedEventIds: this.readPoisonedEventIdsSync(),
      run: runTraceState.run,
      retryingEventId: meta.retrying_event_id,
      timeline: runTraceState.timeline,
      userId: meta.user_id,
    };
  }

  private ensureMetaColumnSync(columnName: string, columnDefinition: string): void {
    const hasColumn = this.sql.exec<{ name: DurableObjectSqlValue }>(
      "PRAGMA table_info(runner_meta)",
    ).toArray().some((row) => row.name === columnName);

    if (!hasColumn) {
      this.sql.exec(`ALTER TABLE runner_meta ADD COLUMN ${columnName} ${columnDefinition}`);
    }
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

    const meta = defaultMetaRow(userId);
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
        agent_state_bundle_ref_json,
        vault_bundle_ref_json,
        run_json,
        timeline_json,
        agent_state_bundle_version,
        vault_bundle_version
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
        agent_state_bundle_ref_json,
        vault_bundle_ref_json,
        run_json,
        timeline_json,
        agent_state_bundle_version,
        vault_bundle_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      meta.agent_state_bundle_ref_json,
      meta.vault_bundle_ref_json,
      meta.run_json,
      meta.timeline_json,
      meta.agent_state_bundle_version,
      meta.vault_bundle_version,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaRow): void {
    this.insertMetaRowSync(meta);
    this.userId = meta.user_id;
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

function appendBoundedEventId(eventIds: readonly string[], eventId: string, limit: number): string[] {
  return [...eventIds.filter((entry) => entry !== eventId), eventId].slice(-limit);
}

function normalizePreferredWakeAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs) || parsedMs <= Date.now()) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function nextConsumedEventExactExpiryIso(): string {
  return new Date(Date.now() + CONSUMED_EVENT_EXACT_TTL_MS).toISOString();
}

function assignBundleRefs(
  meta: RunnerMetaRow,
  nextBundleRefs: RunnerStateRecord["bundleRefs"],
): void {
  const currentAgentStateRef = parseHostedBundleRefJson(meta.agent_state_bundle_ref_json);
  const currentVaultRef = parseHostedBundleRefJson(meta.vault_bundle_ref_json);

  if (!sameBundleRef(currentAgentStateRef, nextBundleRefs.agentState)) {
    meta.agent_state_bundle_ref_json = stringifyHostedBundleRef(nextBundleRefs.agentState);
    meta.agent_state_bundle_version += 1;
  }

  if (!sameBundleRef(currentVaultRef, nextBundleRefs.vault)) {
    meta.vault_bundle_ref_json = stringifyHostedBundleRef(nextBundleRefs.vault);
    meta.vault_bundle_version += 1;
  }
}

function defaultMetaRow(userId: string): RunnerMetaRow {
  return {
    activated: 0,
    agent_state_bundle_ref_json: null,
    agent_state_bundle_version: 0,
    backpressured_event_ids_json: "[]",
    in_flight: 0,
    last_error: null,
    last_error_at: null,
    last_error_code: null,
    last_event_id: null,
    last_run_at: null,
    next_wake_at: null,
    retrying_event_id: null,
    run_json: null,
    timeline_json: "[]",
    user_id: userId,
    vault_bundle_ref_json: null,
    vault_bundle_version: 0,
  };
}

function parseHostedBundleRefJson(value: string | null): HostedExecutionBundleRef | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as HostedExecutionBundleRef;
    return (
      parsed
      && typeof parsed.hash === "string"
      && typeof parsed.key === "string"
      && typeof parsed.size === "number"
      && typeof parsed.updatedAt === "string"
    )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function appendBoundedTimelineEntry(
  entries: readonly HostedExecutionTimelineEntry[],
  entry: HostedExecutionTimelineEntry,
  limit: number,
): HostedExecutionTimelineEntry[] {
  return [...entries, entry].slice(-limit);
}

function parseHostedExecutionRunStatusJson(value: string | null): HostedExecutionRunStatus | null {
  if (!value) {
    return null;
  }

  try {
    return parseHostedExecutionRunStatus(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function parseHostedExecutionTimelineEntriesJson(value: string): HostedExecutionTimelineEntry[] {
  try {
    return parseHostedExecutionTimelineEntries(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

function stringifyRunStatus(value: HostedExecutionRunStatus | null): string | null {
  return value ? JSON.stringify(value) : null;
}

function stringifyHostedBundleRef(value: HostedExecutionBundleRef | null): string | null {
  return value ? JSON.stringify(value) : null;
}

function sanitizeStoredBundleRefs(meta: RunnerMetaRow): {
  agentState: HostedExecutionBundleRef | null;
  changed: boolean;
  vault: HostedExecutionBundleRef | null;
  warning: string | null;
} {
  let changed = false;
  const clearedKinds: string[] = [];

  const agentState = parseHostedBundleRefJson(meta.agent_state_bundle_ref_json);
  if (meta.agent_state_bundle_ref_json && !agentState) {
    changed = true;
    clearedKinds.push("agent-state");
  }

  const vault = parseHostedBundleRefJson(meta.vault_bundle_ref_json);
  if (meta.vault_bundle_ref_json && !vault) {
    changed = true;
    clearedKinds.push("vault");
  }

  return {
    agentState,
    changed,
    vault,
    warning: clearedKinds.length > 0
      ? `Hosted runner cleared malformed bundle ref(s): ${clearedKinds.join(", ")}.`
      : null,
  };
}

function sanitizeStoredRunTrace(meta: RunnerMetaRow): {
  changed: boolean;
  run: HostedExecutionRunStatus | null;
  timeline: HostedExecutionTimelineEntry[];
  warning: string | null;
} {
  let changed = false;
  const clearedKinds: string[] = [];

  const run = parseHostedExecutionRunStatusJson(meta.run_json);
  if (meta.run_json && !run) {
    changed = true;
    clearedKinds.push("run");
  }

  const timeline = parseHostedExecutionTimelineEntriesJson(meta.timeline_json);
  if (meta.timeline_json && meta.timeline_json !== "[]" && timeline.length === 0) {
    changed = true;
    clearedKinds.push("timeline");
  }

  const boundedTimeline = timeline.slice(-MAX_RUN_TIMELINE_ENTRIES);
  if (boundedTimeline.length !== timeline.length) {
    changed = true;
    clearedKinds.push("timeline-pruned");
  }

  return {
    changed,
    run,
    timeline: boundedTimeline,
    warning: clearedKinds.length > 0
      ? `Hosted runner normalized run trace field(s): ${clearedKinds.join(", ")}.`
      : null,
  };
}

function classifyMalformedPendingDispatchError(error: unknown): {
  errorCode: string;
  message: string;
} {
  const errorCode = deriveHostedExecutionErrorCode(error);
  if (isInvalidRequestFamilyErrorCode(errorCode)) {
    return {
      errorCode: "invalid_request",
      message: "Hosted runner poisoned a malformed pending dispatch.",
    };
  }

  return {
    errorCode,
    message: `Hosted runner poisoned a malformed pending dispatch. ${summarizeHostedExecutionError(error)}`,
  };
}

function isInvalidRequestFamilyErrorCode(errorCode: string): boolean {
  return errorCode === "invalid_request"
    || errorCode === "range_error"
    || errorCode === "reference_error"
    || errorCode === "syntax_error"
    || errorCode === "type_error"
    || errorCode === "uri_error";
}

function mergeRunnerLastError(
  current: string | null,
  warning: string | null,
): string | null {
  if (!warning) {
    return current;
  }

  if (!current) {
    return warning;
  }

  return current.includes(warning) ? current : `${current} ${warning}`;
}
