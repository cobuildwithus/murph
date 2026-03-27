import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchRequest,
} from "@healthybob/runtime-state";

import type { HostedExecutionCommittedResult } from "../execution-journal.js";
import {
  CONSUMED_EVENT_TTL_MS,
  LEGACY_STATE_STORAGE_KEY,
  MAX_BACKPRESSURED_EVENT_IDS,
  MAX_PENDING_EVENTS,
  MAX_POISONED_EVENT_IDS,
  type DurableObjectSqlValue,
  type DurableObjectStateLike,
  type LegacyPendingDispatchRecord,
  type LegacyUserRunnerRecord,
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
  last_event_id: string | null;
  last_run_at: string | null;
  next_wake_at: string | null;
  retrying_event_id: string | null;
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

interface BundleRefSwapInput {
  expectedVersions: RunnerBundleVersions;
  nextBundleRefs: RunnerStateRecord["bundleRefs"];
}

const DEFAULT_USER_ID = "unknown";

export class RunnerQueueStore {
  private hydrated = false;
  private hydrationPromise: Promise<void> | null = null;

  constructor(private readonly state: DurableObjectStateLike) {
    this.ensureSchema();
  }

  async readState(userIdHint: string | null): Promise<RunnerStateRecord> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();
    return this.readStateSync(userIdHint);
  }

  async readEventPresence(
    userIdHint: string | null,
    eventId: string,
  ): Promise<EventPresenceState> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();

    return {
      consumed: this.hasConsumedEventSync(eventId),
      pending: this.hasPendingDispatchSync(eventId),
    };
  }

  async listPendingDispatches(userIdHint: string | null): Promise<PendingDispatchRecord[]> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();
    return this.readPendingDispatchesSync();
  }

  async hasDuePendingDispatch(userIdHint: string | null, nowMs: number): Promise<boolean> {
    await this.ensureHydrated(userIdHint);
    return this.readNextDuePendingDispatchSync(nowMs) !== null;
  }

  async clearNextWakeIfDue(userIdHint: string | null, nowMs: number): Promise<RunnerStateRecord> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.readMetaRowSync(userIdHint);
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
    await this.ensureHydrated(dispatch.event.userId);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.readMetaRowSync(dispatch.event.userId);
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

    meta.activated = meta.activated || dispatch.event.kind === "member.activated" ? 1 : 0;
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

  async claimNextDuePendingDispatch(userIdHint: string | null, nowMs: number): Promise<{
    pendingDispatch: PendingDispatchRecord | null;
    record: RunnerStateRecord;
  }> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.readMetaRowSync(userIdHint);
    if (meta.in_flight) {
      return {
        pendingDispatch: null,
        record: this.readStateFromMetaSync(meta),
      };
    }

    const nextPending = this.readNextDuePendingDispatchSync(nowMs);
    if (!nextPending) {
      meta.retrying_event_id = this.readRetryingEventIdSync();
      this.writeMetaRowSync(meta);
      return {
        pendingDispatch: null,
        record: this.readStateFromMetaSync(meta),
      };
    }

    meta.in_flight = 1;
    meta.last_error = null;
    meta.retrying_event_id = nextPending.attempts > 0 ? nextPending.eventId : null;
    this.writeMetaRowSync(meta);
    return {
      pendingDispatch: nextPending,
      record: this.readStateFromMetaSync(meta),
    };
  }

  async applyCommittedDispatch(
    userIdHint: string | null,
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.readMetaRowSync(userIdHint);
    this.removePendingDispatchSync(committed.eventId);
    this.deletePoisonedEventSync(committed.eventId);
    this.writeConsumedEventSync(committed.eventId, new Date(Date.now() + CONSUMED_EVENT_TTL_MS).toISOString());
    assignBundleRefs(meta, committed.bundleRefs);
    meta.backpressured_event_ids_json = JSON.stringify(
      parseStringArray(meta.backpressured_event_ids_json)
        .filter((eventId) => eventId !== committed.eventId),
    );
    meta.in_flight = 0;
    meta.last_error = null;
    meta.last_event_id = committed.eventId;
    meta.last_run_at = committed.committedAt;
    meta.retrying_event_id = null;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async syncCommittedBundles(
    userIdHint: string | null,
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.readMetaRowSync(userIdHint);
    assignBundleRefs(meta, committed.bundleRefs);
    meta.in_flight = 0;
    meta.last_event_id = committed.eventId;
    meta.last_run_at = committed.committedAt;
    meta.retrying_event_id = this.hasPendingDispatchSync(committed.eventId)
      ? committed.eventId
      : meta.retrying_event_id;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async reschedulePendingFailure(input: {
    errorMessage: string;
    eventId: string;
    maxEventAttempts: number;
    retryDelayMs: number;
    userIdHint: string | null;
  }): Promise<RunnerStateRecord> {
    await this.ensureHydrated(input.userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const pending = this.readPendingDispatchByEventIdSync(input.eventId);
    const meta = this.readMetaRowSync(input.userIdHint);

    if (!pending) {
      meta.in_flight = 0;
      meta.last_error = input.errorMessage;
      meta.retrying_event_id = this.readRetryingEventIdSync();
      this.writeMetaRowSync(meta);
      return this.readStateFromMetaSync(meta);
    }

    const nextAttempts = pending.attempts + 1;
    meta.in_flight = 0;
    meta.last_error = input.errorMessage;
    meta.last_event_id = input.eventId;

    if (nextAttempts >= input.maxEventAttempts) {
      this.removePendingDispatchSync(input.eventId);
      this.writeConsumedEventSync(input.eventId, new Date(Date.now() + CONSUMED_EVENT_TTL_MS).toISOString());
      this.writePoisonedEventSync(input.eventId, input.errorMessage, new Date().toISOString());
      meta.retrying_event_id = this.readRetryingEventIdSync();
      this.writeMetaRowSync(meta);
      return this.readStateFromMetaSync(meta);
    }

    const availableAt = new Date(Date.now() + input.retryDelayMs).toISOString();
    this.sql.exec(
      `UPDATE pending_events
        SET attempts = ?, available_at = ?, last_error = ?
        WHERE event_id = ?`,
      nextAttempts,
      availableAt,
      input.errorMessage,
      input.eventId,
    );
    meta.retrying_event_id = input.eventId;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async deferPendingConfigurationFailure(input: {
    errorMessage: string;
    eventId: string;
    retryDelayMs: number;
    userIdHint: string | null;
  }): Promise<RunnerStateRecord> {
    await this.ensureHydrated(input.userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const pending = this.readPendingDispatchByEventIdSync(input.eventId);
    const meta = this.readMetaRowSync(input.userIdHint);

    meta.in_flight = 0;
    meta.last_error = input.errorMessage;
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
      input.errorMessage,
      input.eventId,
    );
    meta.retrying_event_id = input.eventId;
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async rescheduleCommittedFinalizeRetry(input: {
    attempts: number;
    committed: HostedExecutionCommittedResult;
    errorMessage: string;
    retryDelayMs: number;
    userIdHint: string | null;
  }): Promise<RunnerStateRecord> {
    await this.ensureHydrated(input.userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.readMetaRowSync(input.userIdHint);
    assignBundleRefs(meta, input.committed.bundleRefs);
    meta.in_flight = 0;
    meta.last_error = input.errorMessage;
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
      input.errorMessage,
      input.committed.eventId,
    );

    return this.readStateFromMetaSync(meta);
  }

  async rememberCommittedEvent(userIdHint: string | null, eventId: string): Promise<RunnerStateRecord> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();

    if (!this.hasConsumedEventSync(eventId)) {
      this.writeConsumedEventSync(eventId, new Date(Date.now() + CONSUMED_EVENT_TTL_MS).toISOString());
    }

    return this.readStateSync(userIdHint);
  }

  async readBundleState(userIdHint: string | null): Promise<Pick<
    RunnerStateRecord,
    "bundleRefs" | "bundleVersions" | "inFlight" | "userId"
  >> {
    const record = await this.readState(userIdHint);
    return {
      bundleRefs: record.bundleRefs,
      bundleVersions: record.bundleVersions,
      inFlight: record.inFlight,
      userId: record.userId,
    };
  }

  async compareAndSwapBundleRefs(
    userIdHint: string | null,
    input: BundleRefSwapInput,
  ): Promise<{ applied: boolean; record: RunnerStateRecord }> {
    await this.ensureHydrated(userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.readMetaRowSync(userIdHint);
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
    userIdHint: string | null;
  }): Promise<RunnerStateRecord> {
    await this.ensureHydrated(input.userIdHint);
    this.pruneExpiredConsumedEventsSync();

    const meta = this.readMetaRowSync(input.userIdHint);
    const nextPendingAvailableAt = this.readNextPendingAvailableAtSync();
    const preferredWakeAt = input.preferredWakeAt === undefined
      ? meta.next_wake_at
      : input.preferredWakeAt;
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

  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS runner_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        user_id TEXT NOT NULL,
        activated INTEGER NOT NULL DEFAULT 0,
        in_flight INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_event_id TEXT,
        last_run_at TEXT,
        next_wake_at TEXT,
        retrying_event_id TEXT,
        backpressured_event_ids_json TEXT NOT NULL DEFAULT '[]',
        agent_state_bundle_ref_json TEXT,
        vault_bundle_ref_json TEXT,
        agent_state_bundle_version INTEGER NOT NULL DEFAULT 0,
        vault_bundle_version INTEGER NOT NULL DEFAULT 0
      )
    `);
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
  }

  private async ensureHydrated(userIdHint: string | null): Promise<void> {
    if (this.hydrated) {
      this.ensureKnownUserIdSync(userIdHint);
      return;
    }

    if (!this.hydrationPromise) {
      this.hydrationPromise = this.hydrateFromLegacyState(userIdHint).finally(() => {
        this.hydrated = true;
        this.hydrationPromise = null;
      });
    }

    await this.hydrationPromise;
    this.ensureKnownUserIdSync(userIdHint);
  }

  private async hydrateFromLegacyState(userIdHint: string | null): Promise<void> {
    if (this.selectMetaRowSync(userIdHint)) {
      return;
    }

    const existing = await this.state.storage.get<LegacyUserRunnerRecord>(LEGACY_STATE_STORAGE_KEY);
    const normalized = existing
      ? normalizeLegacyUserRunnerRecord(existing, userIdHint ?? existing.userId ?? DEFAULT_USER_ID)
      : null;
    if (normalized) {
      await this.state.storage.put(LEGACY_STATE_STORAGE_KEY, normalized);
    }
    const meta = legacyRecordToMetaRow(normalized, userIdHint);
    this.insertMetaRowSync(meta);

    if (!normalized) {
      return;
    }

    for (const pending of normalized.pendingEvents) {
      this.sql.exec(
        `INSERT OR REPLACE INTO pending_events (
          event_id,
          dispatch_json,
          attempts,
          available_at,
          enqueued_at,
          last_error
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        pending.dispatch.eventId,
        JSON.stringify(pending.dispatch),
        pending.attempts,
        pending.availableAt,
        pending.enqueuedAt,
        pending.lastError,
      );
    }

    for (const [eventId, expiresAt] of Object.entries(normalized.consumedEventExpirations)) {
      this.writeConsumedEventSync(eventId, expiresAt);
    }

    for (const eventId of normalized.poisonedEventIds) {
      this.writePoisonedEventSync(eventId, normalized.lastError ?? "poisoned", new Date().toISOString());
    }
  }

  private ensureKnownUserIdSync(userIdHint: string | null): void {
    if (!userIdHint) {
      return;
    }

    const meta = this.readMetaRowSync(userIdHint);
    if (meta.user_id !== DEFAULT_USER_ID) {
      return;
    }

    meta.user_id = userIdHint;
    this.writeMetaRowSync(meta);
  }

  private pruneExpiredConsumedEventsSync(): void {
    const nowIso = new Date().toISOString();
    this.sql.exec(
      "DELETE FROM consumed_events WHERE expires_at <= ?",
      nowIso,
    );
    this.sql.exec(
      `DELETE FROM poisoned_events
        WHERE event_id NOT IN (SELECT event_id FROM consumed_events)`,
    );
  }

  private readStateSync(userIdHint: string | null): RunnerStateRecord {
    return this.readStateFromMetaSync(this.readMetaRowSync(userIdHint));
  }

  private readStateFromMetaSync(
    meta: RunnerMetaRow,
    nextPendingAvailableAt = this.readNextPendingAvailableAtSync(),
  ): RunnerStateRecord {
    return {
      activated: meta.activated === 1,
      backpressuredEventIds: parseStringArray(meta.backpressured_event_ids_json),
      bundleRefs: {
        agentState: parseHostedBundleRefJson(meta.agent_state_bundle_ref_json),
        vault: parseHostedBundleRefJson(meta.vault_bundle_ref_json),
      },
      bundleVersions: {
        agentState: meta.agent_state_bundle_version,
        vault: meta.vault_bundle_version,
      },
      inFlight: meta.in_flight === 1,
      lastError: meta.last_error,
      lastEventId: meta.last_event_id,
      lastRunAt: meta.last_run_at,
      nextPendingAvailableAt,
      nextWakeAt: meta.next_wake_at,
      pendingEventCount: this.countPendingEventsSync(),
      poisonedEventIds: this.readPoisonedEventIdsSync(),
      retryingEventId: meta.retrying_event_id,
      userId: meta.user_id,
    };
  }

  private readMetaRowSync(userIdHint: string | null): RunnerMetaRow {
    const row = this.selectMetaRowSync(userIdHint);
    if (row) {
      return row;
    }

    const fallback = defaultMetaRow(userIdHint);
    this.insertMetaRowSync(fallback);
    return fallback;
  }

  private selectMetaRowSync(userIdHint: string | null): RunnerMetaRow | null {
    const row = this.sql.exec<RunnerMetaRow>(
      `SELECT
        user_id,
        activated,
        in_flight,
        last_error,
        last_event_id,
        last_run_at,
        next_wake_at,
        retrying_event_id,
        backpressured_event_ids_json,
        agent_state_bundle_ref_json,
        vault_bundle_ref_json,
        agent_state_bundle_version,
        vault_bundle_version
      FROM runner_meta
      WHERE singleton = 1`,
    ).toArray()[0] ?? null;

    if (!row) {
      return null;
    }

    if (userIdHint && row.user_id === DEFAULT_USER_ID) {
      row.user_id = userIdHint;
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
        last_event_id,
        last_run_at,
        next_wake_at,
        retrying_event_id,
        backpressured_event_ids_json,
        agent_state_bundle_ref_json,
        vault_bundle_ref_json,
        agent_state_bundle_version,
        vault_bundle_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.activated,
      meta.in_flight,
      meta.last_error,
      meta.last_event_id,
      meta.last_run_at,
      meta.next_wake_at,
      meta.retrying_event_id,
      meta.backpressured_event_ids_json,
      meta.agent_state_bundle_ref_json,
      meta.vault_bundle_ref_json,
      meta.agent_state_bundle_version,
      meta.vault_bundle_version,
    );
  }

  private writeMetaRowSync(meta: RunnerMetaRow): void {
    this.insertMetaRowSync(meta);
  }

  private readPendingDispatchesSync(): PendingDispatchRecord[] {
    return this.sql.exec<PendingEventRow>(
      `SELECT
        event_id,
        dispatch_json,
        attempts,
        available_at,
        enqueued_at,
        last_error
      FROM pending_events
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC`,
    ).toArray().map((row) => ({
      attempts: row.attempts,
      availableAt: row.available_at,
      dispatch: JSON.parse(row.dispatch_json) as HostedExecutionDispatchRequest,
      enqueuedAt: row.enqueued_at,
      eventId: row.event_id,
      lastError: row.last_error,
    }));
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

    return row
      ? {
          attempts: row.attempts,
          availableAt: row.available_at,
          dispatch: JSON.parse(row.dispatch_json) as HostedExecutionDispatchRequest,
          enqueuedAt: row.enqueued_at,
          eventId: row.event_id,
          lastError: row.last_error,
        }
      : null;
  }

  private readNextDuePendingDispatchSync(nowMs: number): PendingDispatchRecord | null {
    const nowIso = new Date(nowMs).toISOString();
    const row = this.sql.exec<PendingEventRow>(
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
      LIMIT 1`,
      nowIso,
    ).toArray()[0] ?? null;

    return row
      ? {
          attempts: row.attempts,
          availableAt: row.available_at,
          dispatch: JSON.parse(row.dispatch_json) as HostedExecutionDispatchRequest,
          enqueuedAt: row.enqueued_at,
          eventId: row.event_id,
          lastError: row.last_error,
        }
      : null;
  }

  private readNextPendingAvailableAtSync(): string | null {
    return this.sql.exec<{ available_at: DurableObjectSqlValue }>(
      `SELECT available_at
      FROM pending_events
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC
      LIMIT 1`,
    ).toArray()[0]?.available_at as string | null | undefined ?? null;
  }

  private readRetryingEventIdSync(): string | null {
    return this.sql.exec<{ event_id: DurableObjectSqlValue }>(
      `SELECT event_id
      FROM pending_events
      WHERE attempts > 0
      ORDER BY available_at ASC, enqueued_at ASC, event_id ASC
      LIMIT 1`,
    ).toArray()[0]?.event_id as string | null | undefined ?? null;
  }

  private countPendingEventsSync(): number {
    return Number(
      this.sql.exec<{ count: DurableObjectSqlValue }>(
        "SELECT COUNT(*) AS count FROM pending_events",
      ).toArray()[0]?.count ?? 0,
    );
  }

  private hasPendingDispatchSync(eventId: string): boolean {
    return this.sql.exec<{ count: DurableObjectSqlValue }>(
      "SELECT COUNT(*) AS count FROM pending_events WHERE event_id = ?",
      eventId,
    ).toArray()[0]?.count === 1;
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

  private removePendingDispatchSync(eventId: string): void {
    this.sql.exec("DELETE FROM pending_events WHERE event_id = ?", eventId);
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
}

function appendBoundedEventId(eventIds: readonly string[], eventId: string, limit: number): string[] {
  return [...eventIds.filter((entry) => entry !== eventId), eventId].slice(-limit);
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

function defaultMetaRow(userIdHint: string | null): RunnerMetaRow {
  return {
    activated: 0,
    agent_state_bundle_ref_json: null,
    agent_state_bundle_version: 0,
    backpressured_event_ids_json: "[]",
    in_flight: 0,
    last_error: null,
    last_event_id: null,
    last_run_at: null,
    next_wake_at: null,
    retrying_event_id: null,
    user_id: userIdHint ?? DEFAULT_USER_ID,
    vault_bundle_ref_json: null,
    vault_bundle_version: 0,
  };
}

function legacyRecordToMetaRow(
  record: LegacyUserRunnerRecord | null,
  userIdHint: string | null,
): RunnerMetaRow {
  if (!record) {
    return defaultMetaRow(userIdHint);
  }

  return {
    activated: record.activated ? 1 : 0,
    agent_state_bundle_ref_json: stringifyHostedBundleRef(record.bundleRefs.agentState),
    agent_state_bundle_version: record.bundleRefs.agentState ? 1 : 0,
    backpressured_event_ids_json: JSON.stringify(record.backpressuredEventIds),
    in_flight: record.inFlight ? 1 : 0,
    last_error: record.lastError,
    last_event_id: record.lastEventId,
    last_run_at: record.lastRunAt,
    next_wake_at: record.nextWakeAt,
    retrying_event_id: record.retryingEventId,
    user_id: record.userId || userIdHint || DEFAULT_USER_ID,
    vault_bundle_ref_json: stringifyHostedBundleRef(record.bundleRefs.vault),
    vault_bundle_version: record.bundleRefs.vault ? 1 : 0,
  };
}

function normalizeLegacyUserRunnerRecord(
  record: Partial<LegacyUserRunnerRecord>,
  fallbackUserId: string,
): LegacyUserRunnerRecord {
  const existingConsumedEventExpirations = record.consumedEventExpirations ?? Object.fromEntries(
    [...(record.recentEventIds ?? []), ...(record.poisonedEventIds ?? [])]
      .map((eventId) => [eventId, new Date(Date.now() + CONSUMED_EVENT_TTL_MS).toISOString()]),
  );
  const consumedEventExpirations = pruneConsumedEventExpirations(existingConsumedEventExpirations);
  const backpressuredEventIds = (record.backpressuredEventIds ?? []).slice(-MAX_BACKPRESSURED_EVENT_IDS);
  const poisonedEventIds = (record.poisonedEventIds ?? [])
    .filter((eventId) => consumedEventExpirations[eventId] !== undefined)
    .slice(-MAX_POISONED_EVENT_IDS);

  return {
    activated: record.activated ?? false,
    backpressuredEventIds,
    bundleRefs: record.bundleRefs ?? {
      agentState: null,
      vault: null,
    },
    consumedEventExpirations,
    inFlight: record.inFlight ?? false,
    lastError: record.lastError ?? null,
    lastEventId: record.lastEventId ?? null,
    lastRunAt: record.lastRunAt ?? null,
    nextWakeAt: record.nextWakeAt ?? null,
    pendingEvents: (record.pendingEvents ?? []).map((pending) => normalizeLegacyPendingDispatchRecord(pending)),
    poisonedEventIds,
    recentEventIds: (record.recentEventIds ?? []).slice(-MAX_PENDING_EVENTS),
    retryingEventId: record.retryingEventId ?? null,
    userId: record.userId ?? fallbackUserId,
  };
}

function normalizeLegacyPendingDispatchRecord(
  record: Partial<LegacyPendingDispatchRecord>,
): LegacyPendingDispatchRecord {
  if (!record.dispatch?.eventId) {
    throw new Error("Legacy hosted runner state is missing pending dispatch event ids.");
  }

  return {
    attempts: record.attempts ?? 0,
    availableAt: record.availableAt ?? new Date().toISOString(),
    dispatch: record.dispatch,
    enqueuedAt: record.enqueuedAt ?? new Date().toISOString(),
    lastError: record.lastError ?? null,
  };
}

function parseHostedBundleRefJson(value: string | null): HostedExecutionBundleRef | null {
  if (!value) {
    return null;
  }

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

function pruneConsumedEventExpirations(
  consumedEventExpirations: Record<string, string>,
): Record<string, string> {
  const nowMs = Date.now();
  return Object.fromEntries(
    Object.entries(consumedEventExpirations).filter(([, expiresAt]) => {
      const parsedMs = Date.parse(expiresAt);
      return Number.isFinite(parsedMs) && parsedMs > nowMs;
    }),
  );
}

function stringifyHostedBundleRef(value: HostedExecutionBundleRef | null): string | null {
  return value ? JSON.stringify(value) : null;
}
