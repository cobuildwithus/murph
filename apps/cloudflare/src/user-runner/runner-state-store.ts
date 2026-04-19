import {
  HOSTED_WAKE_PAYLOAD_SCHEMAS,
  isHostedExecutionWakeKind,
  type HostedWakeMaterializationHints,
  type HostedExecutionRunContext,
  type HostedExecutionRunnerResult,
  deriveHostedExecutionErrorCode,
  normalizeHostedExecutionOperatorMessage,
  type HostedExecutionRunLevel,
  type HostedExecutionRunPhase,
  type HostedExecutionRunStatus,
  type HostedExecutionTimelineEntry,
} from "@murphai/hosted-execution";
import { parseHostedExecutionBundleRef } from "@murphai/hosted-execution/parsers";
import { parseHostedAssistantDeliveryEffects } from "@murphai/hosted-execution/side-effects";
import { ensureRunnerStateSchema } from "./runner-state-schema.js";
import {
  appendBoundedRunnerTimelineEntry,
  assignRunnerBundleRefs,
  createDefaultRunnerBundleState,
  createDefaultRunnerMetaRow,
  projectRunnerStateRecord,
  resolveRunnerNextWakeAt,
  type RunnerMetaRow,
  type RunnerStoredBundleState,
} from "./runner-state-helpers.js";
import {
  MAX_RUN_TIMELINE_ENTRIES,
  type DurableObjectStateLike,
  type RunnerPendingCommitRecord,
  type RunnerBundleVersion,
  type RunnerStateRecord,
} from "./types.js";

interface BundleRefSwapInput {
  expectedVersion: RunnerBundleVersion;
  nextBundleRef: RunnerStateRecord["bundleRef"];
}

interface RunnerMetaBundleRow extends RunnerMetaRow {
  bundle_ref_json: string | null;
  bundle_version: number;
  pending_commit_json: string | null;
  wake_materialization_hints_json: string | null;
}

export class RunnerPendingCommitCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerPendingCommitCorruptionError";
  }
}

export interface RunnerLeaseOwnerInput {
  eventId: string;
  policy?: "matching-run" | "same-event";
  run: HostedExecutionRunContext | null;
}

export class RunnerStateStore {
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

    this.insertMetaRowSync(createDefaultRunnerMetaBundleRow(userId));
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

  async beginWakeRun(input: {
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

  async completeWakeRun(input: {
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

  async failWakeRun(input: {
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
    const meta = this.requireMetaRowSync();
    const bundleState = readBundleStateFromMeta(meta);
    assignRunnerBundleRefs(bundleState, nextBundleRef);
    writeBundleStateToMeta(meta, bundleState);
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
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

  async readBundleMetaState(): Promise<Pick<
    RunnerStateRecord,
    "bundleRef" | "bundleVersion" | "inFlight" | "userId"
  >> {
    // This is DO-local coordination state for bundle restore and local CAS.
    // Canonical wake ordering and the committed snapshot fence remain web-owned.
    const record = this.readStateSync();
    return {
      bundleRef: record.bundleRef,
      bundleVersion: record.bundleVersion,
      inFlight: record.inFlight,
      userId: record.userId,
    };
  }

  async readBundleMetaStateForMutation(): Promise<Pick<
    RunnerStateRecord,
    "bundleRef" | "bundleVersion" | "userId"
  >> {
    const meta = this.requireMetaRowSync();
    return {
      bundleRef: parseStoredBundleRefJson(meta.bundle_ref_json),
      bundleVersion: meta.bundle_version ?? 0,
      userId: meta.user_id,
    };
  }

  async compareAndSwapBundleRefs(
    input: BundleRefSwapInput,
  ): Promise<{ applied: boolean; record: RunnerStateRecord }> {
    const meta = this.requireMetaRowSync();
    const bundleState = readBundleStateFromMeta(meta);
    if (bundleState.bundleVersion !== input.expectedVersion) {
      return {
        applied: false,
        record: this.readStateFromMetaSync(meta),
      };
    }

    assignRunnerBundleRefs(bundleState, input.nextBundleRef);
    writeBundleStateToMeta(meta, bundleState);
    this.writeMetaRowSync(meta);
    return {
      applied: true,
      record: this.readStateFromMetaSync(meta),
    };
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

    return {
      eventId: meta.active_run_event_id,
      run,
    };
  }

  async syncNextWake(input: {
    preferredWakeAt?: string | null;
    wakeMaterializationHints?: HostedWakeMaterializationHints | null;
  }): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    const wakeMaterializationHints = input.wakeMaterializationHints === undefined
      ? parseWakeMaterializationHints(meta.wake_materialization_hints_json)
      : normalizeWakeMaterializationHints(input.wakeMaterializationHints);
    meta.next_wake_at = resolveRunnerNextWakeAt({
      preferredWakeAt: input.preferredWakeAt ?? null,
      wakeMaterializationHints,
    });
    meta.wake_materialization_hints_json = serializeWakeMaterializationHints(
      wakeMaterializationHints,
    );
    this.writeMetaRowSync(meta);

    return this.readStateFromMetaSync(meta);
  }

  async readWakeMaterializationHints(): Promise<HostedWakeMaterializationHints | null> {
    return parseWakeMaterializationHints(this.requireMetaRowSync().wake_materialization_hints_json);
  }

  async readPendingCommit(eventId?: string): Promise<RunnerPendingCommitRecord | null> {
    const pendingCommit = parsePendingCommitRecord(
      this.requireMetaRowSync(),
      this.tryResolveUserIdSync(),
    );
    if (!pendingCommit) {
      return null;
    }

    if (eventId && pendingCommit.eventId !== eventId) {
      return null;
    }

    return pendingCommit;
  }

  async writePendingCommit(input: RunnerPendingCommitRecord): Promise<RunnerStateRecord> {
    await this.bootstrapUser(input.userId);

    const meta = this.requireMetaRowSync();
    const existing = parsePendingCommitRecord(meta, input.userId);
    if (existing && existing.eventId !== input.eventId) {
      throw new Error(
        `Hosted runner pending commit ${existing.eventId} must be cleared before ${input.eventId}.`,
      );
    }

    // This JSON is only valid for the exact fetched wake/cursor fence captured in `input.wake`.
    // Once that fence is stale, recovery must clear it and rebuild from the canonical web cursor.
    meta.pending_commit_json = JSON.stringify(input);
    this.rememberLastEventMetaSync(meta, input.eventId);
    this.writeMetaRowSync(meta);
    return this.readStateFromMetaSync(meta);
  }

  async clearPendingCommit(eventId?: string): Promise<RunnerStateRecord> {
    const meta = this.requireMetaRowSync();
    if (!meta.pending_commit_json) {
      return this.readStateFromMetaSync(meta);
    }

    if (!eventId) {
      meta.pending_commit_json = null;
      this.writeMetaRowSync(meta);
      return this.readStateFromMetaSync(meta);
    }

    const existing = parsePendingCommitRecord(meta, meta.user_id);
    if (existing?.eventId === eventId) {
      meta.pending_commit_json = null;
      this.writeMetaRowSync(meta);
    }

    return this.readStateFromMetaSync(meta);
  }

  private readStateSync(): RunnerStateRecord {
    return this.readStateFromMetaSync(this.requireMetaRowSync());
  }

  private readStateFromMetaSync(meta: RunnerMetaBundleRow): RunnerStateRecord {
    return projectRunnerStateRecord({
      bundleState: readBundleStateFromMeta(meta),
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

    const meta = createDefaultRunnerMetaBundleRow(userId);
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
        bundle_ref_json,
        bundle_version,
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
        pending_commit_json,
        wake_materialization_hints_json
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
        bundle_ref_json,
        bundle_version,
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
        pending_commit_json,
        wake_materialization_hints_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      meta.user_id,
      meta.bundle_ref_json ?? null,
      meta.bundle_version ?? 0,
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
      meta.pending_commit_json,
      meta.wake_materialization_hints_json,
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

function createDefaultRunnerMetaBundleRow(userId: string): RunnerMetaBundleRow {
  return {
    ...createDefaultRunnerMetaRow(userId),
    bundle_ref_json: null,
    bundle_version: 0,
    pending_commit_json: null,
    wake_materialization_hints_json: null,
  };
}

function readBundleStateFromMeta(meta: RunnerMetaBundleRow): RunnerStoredBundleState {
  const bundleState = createDefaultRunnerBundleState();
  bundleState.bundleRefJson = meta.bundle_ref_json ?? null;
  bundleState.bundleVersion = meta.bundle_version ?? 0;
  return bundleState;
}

function writeBundleStateToMeta(
  meta: RunnerMetaBundleRow,
  bundleState: RunnerStoredBundleState,
): void {
  meta.bundle_ref_json = bundleState.bundleRefJson;
  meta.bundle_version = bundleState.bundleVersion;
}

function parseStoredBundleRefJson(value: string | null): RunnerStateRecord["bundleRef"] {
  if (!value) {
    return null;
  }

  try {
    return parseHostedExecutionBundleRef(
      JSON.parse(value) as unknown,
      "Hosted runner bundle ref",
    );
  } catch {
    throw new Error("Hosted runner state is corrupt: runner_meta.bundle_ref_json is malformed.");
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

function parsePendingCommitRecord(
  meta: Pick<RunnerMetaBundleRow, "pending_commit_json">,
  userId: string | null,
): RunnerPendingCommitRecord | null {
  if (!meta.pending_commit_json) {
    return null;
  }

  if (!userId) {
    throw createPendingCommitCorruptionError(
      null,
      "record exists before the runner is bound to a user",
    );
  }

  let value: {
    assistantDeliveryEffects?: unknown;
    bundleRef?: unknown;
    committedAt?: unknown;
    eventId?: unknown;
    finalizeToken?: unknown;
    finalizedAt?: unknown;
    result?: unknown;
    schemaVersion?: unknown;
    userId?: unknown;
    wake?: unknown;
  };

  try {
    value = JSON.parse(meta.pending_commit_json) as typeof value;
  } catch {
    throw createPendingCommitCorruptionError(userId, "record is not valid JSON");
  }

  if (value.schemaVersion !== 1) {
    throw createPendingCommitCorruptionError(userId, "schemaVersion must be 1");
  }

  if (typeof value.userId !== "string") {
    throw createPendingCommitCorruptionError(userId, "record is missing userId");
  }

  if (value.userId !== userId) {
    throw createPendingCommitCorruptionError(
      userId,
      `record is bound to ${value.userId}, not ${userId}`,
    );
  }

  if (typeof value.eventId !== "string" || value.eventId.length === 0) {
    throw createPendingCommitCorruptionError(userId, "record is missing eventId");
  }

  if (typeof value.committedAt !== "string" || value.committedAt.length === 0) {
    throw createPendingCommitCorruptionError(userId, "record is missing committedAt");
  }

  if (
    value.finalizeToken !== undefined
    && value.finalizeToken !== null
    && typeof value.finalizeToken !== "string"
  ) {
    throw createPendingCommitCorruptionError(userId, "finalizeToken must be a string or null");
  }

  if (
    value.finalizedAt !== undefined
    && value.finalizedAt !== null
    && typeof value.finalizedAt !== "string"
  ) {
    throw createPendingCommitCorruptionError(userId, "finalizedAt must be a string or null");
  }

  const result = parsePendingCommitResult(value.result);
  if (!result) {
    throw createPendingCommitCorruptionError(userId, "result payload is invalid");
  }

  const wake = parsePendingCommitWake(value.wake, userId);
  if (!wake) {
    throw createPendingCommitCorruptionError(userId, "wake payload is invalid");
  }

  try {
    return {
      assistantDeliveryEffects: parseHostedAssistantDeliveryEffects(
        value.assistantDeliveryEffects ?? [],
      ),
      bundleRef: parseHostedExecutionBundleRef(
        value.bundleRef === undefined ? null : value.bundleRef,
        "Hosted runner pending commit bundleRef",
      ),
      committedAt: value.committedAt,
      eventId: value.eventId,
      finalizeToken: value.finalizeToken === undefined ? null : value.finalizeToken,
      finalizedAt: value.finalizedAt === undefined ? null : value.finalizedAt,
      result,
      schemaVersion: 1,
      userId,
      wake,
    };
  } catch (error) {
    throw createPendingCommitCorruptionError(
      userId,
      error instanceof Error && error.message
        ? error.message
        : "record has an invalid nested payload",
    );
  }
}

function createPendingCommitCorruptionError(
  userId: string | null,
  reason: string,
): RunnerPendingCommitCorruptionError {
  return new RunnerPendingCommitCorruptionError(
    `Hosted runner pending_commit_json is corrupted${userId ? ` for ${userId}` : ""}: ${reason}.`,
  );
}

function parsePendingCommitWake(
  value: unknown,
  userId: string,
): RunnerPendingCommitRecord["wake"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.userId !== userId
    || typeof record.eventId !== "string"
    || typeof record.kind !== "string"
    || !isHostedExecutionWakeKind(record.kind)
    || typeof record.occurredAt !== "string"
    || typeof record.payloadCiphertext !== "string"
    || typeof record.payloadSchema !== "string"
    || !HOSTED_WAKE_PAYLOAD_SCHEMAS.includes(
      record.payloadSchema as RunnerPendingCommitRecord["wake"]["payloadSchema"],
    )
    || typeof record.seq !== "string"
  ) {
    return null;
  }

  return {
    eventId: record.eventId,
    kind: record.kind,
    occurredAt: record.occurredAt,
    payloadCiphertext: record.payloadCiphertext,
    payloadSchema: record.payloadSchema as RunnerPendingCommitRecord["wake"]["payloadSchema"],
    seq: record.seq,
    userId,
  };
}

function parsePendingCommitResult(
  value: unknown,
): HostedExecutionRunnerResult["result"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as {
    eventsHandled?: unknown;
    nextWakeAt?: unknown;
    summary?: unknown;
    wakeMaterializationHints?: unknown;
  };
  if (
    typeof record.summary !== "string"
    || typeof record.eventsHandled !== "number"
    || !Number.isSafeInteger(record.eventsHandled)
    || record.eventsHandled < 0
    || (
      record.nextWakeAt !== undefined
      && record.nextWakeAt !== null
      && typeof record.nextWakeAt !== "string"
    )
    || (
      record.wakeMaterializationHints !== undefined
      && record.wakeMaterializationHints !== null
      && (
        typeof record.wakeMaterializationHints !== "object"
        || Array.isArray(record.wakeMaterializationHints)
      )
    )
  ) {
    return null;
  }

  const wakeMaterializationHints = record.wakeMaterializationHints === undefined
    ? undefined
    : normalizeWakeMaterializationHints(record.wakeMaterializationHints as HostedWakeMaterializationHints | null);

  return {
    eventsHandled: record.eventsHandled,
    ...(record.nextWakeAt !== undefined ? { nextWakeAt: record.nextWakeAt ?? null } : {}),
    ...(wakeMaterializationHints !== undefined ? { wakeMaterializationHints } : {}),
    summary: record.summary,
  };
}

function normalizeWakeMaterializationHints(
  value: HostedWakeMaterializationHints | null,
): HostedWakeMaterializationHints | null {
  if (!value) {
    return null;
  }

  const hints: HostedWakeMaterializationHints = {
    ...(value.assistantWakeAt === undefined
      ? {}
      : { assistantWakeAt: normalizeWakeHintTimestamp(value.assistantWakeAt) }),
    ...(value.deviceSyncWakeAt === undefined
      ? {}
      : { deviceSyncWakeAt: normalizeWakeHintTimestamp(value.deviceSyncWakeAt) }),
  };

  return Object.keys(hints).length > 0 ? hints : null;
}

function normalizeWakeHintTimestamp(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return value ?? null;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function parseWakeMaterializationHints(
  value: string | null,
): HostedWakeMaterializationHints | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as HostedWakeMaterializationHints | null;
    return normalizeWakeMaterializationHints(parsed);
  } catch {
    return null;
  }
}

function serializeWakeMaterializationHints(
  value: HostedWakeMaterializationHints | null,
): string | null {
  const normalized = normalizeWakeMaterializationHints(value);
  return normalized ? JSON.stringify(normalized) : null;
}
