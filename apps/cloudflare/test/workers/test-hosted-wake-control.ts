import type {
  HostedExecutionCursorState,
  HostedConversationMessageWakeRecord,
  HostedExecutionRuntimeTimerWake,
  HostedRunAcquireRequest,
  HostedRunAcquireResponse,
  HostedRunCommitRequest,
  HostedRunCommitResponse,
  HostedRunFinalizeRequest,
  HostedRunFinalizeResponse,
  HostedRunLogRequest,
  HostedRunLogResponse,
  HostedRunLogRecord,
  HostedRunRecord,
  HostedRunReleaseFinalizeRequest,
  HostedRunReleaseFinalizeResponse,
  HostedRunStatusRequest,
  HostedRunStatusResponse,
  HostedRunTriggerKind,
  HostedIngressAppendResponse,
  HostedIngressEvent,
  HostedIngressLifecycleState,
  HostedExecutionWake,
  HostedSystemWakeRecord,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
  buildHostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import { parseHostedExecutionBundleRef } from "@murphai/hosted-execution/parsers";
import {
  encryptTestHostedIngressPayload,
  issueTestHostedWakeFetchProof,
  verifyTestHostedWakeFetchProof,
} from "../hosted-execution-fixtures.js";

import type { R2BucketLike } from "../../src/bundle-store.js";

interface HostedRuntimeTimerWakeRecord {
  behavior: "ordered";
  createdAt: string;
  dedupeKey?: string | null;
  id: string;
  kind: "runtime.timer";
  occurredAt: string;
  payloadBytes?: number | null;
  payloadCiphertext?: string | null;
  payloadSchema: typeof HOSTED_INGRESS_PAYLOAD_SCHEMA;
  quarantineCode?: string | null;
  quarantinedAt?: string | null;
  seq: string;
  updatedAt: string;
  userId: string;
}

type TestHostedWakeRecord = HostedIngressEvent | HostedRuntimeTimerWakeRecord;

type HostedFetchedWakeRecord = TestHostedWakeRecord & {
  fetchProof: string;
};

interface HostedWakeAppendResponse {
  duplicate: boolean;
  inserted: boolean;
  updatedExisting: boolean;
  wake: TestHostedWakeRecord;
}

interface HostedWakeFetchRequest {
  afterSeq?: string | null;
  limit?: number | null;
}

interface HostedWakeFetchResponse {
  cursor: HostedExecutionCursorState;
  wakes: HostedFetchedWakeRecord[];
}

interface HostedWakeCommitRequest {
  assistantNextWakeAt?: string | null;
  committedSeq: string;
  expectedVersion: string;
  snapshotRef?: HostedExecutionCursorState["snapshotRef"];
}

interface HostedWakeCommitResponse {
  committed: boolean;
  cursor: HostedExecutionCursorState;
  finalizeToken?: string;
}

interface HostedWakeFinalizeRequest {
  assistantNextWakeAt?: string | null;
  finalizeToken: string;
  snapshotRef: HostedExecutionCursorState["snapshotRef"];
}

interface HostedWakeFinalizeResponse {
  cursor: HostedExecutionCursorState;
  finalized: boolean;
}

interface HostedWakeMaterializeRequest {}

interface HostedWakeMaterializeResponse {
  targetSeqHint: string | null;
  wakeMaterializationHints: {
    assistantWakeAt: string;
  } | null;
}

interface HostedWakeTerminalRequest {
  fetchProof: string;
  state: "completed" | "quarantined" | "replaced";
  wakeId: string;
  wakeSeq: string;
}

interface HostedWakeTerminalResponse {
  recorded: boolean;
}

interface HostedWakeQuarantineRequest {
  fetchProof: string;
  quarantineCode: string | null;
  wakeId: string;
  wakeSeq: string;
}

interface HostedWakeQuarantineResponse {
  quarantined: boolean;
}

interface HostedWakeStatusRequest {
  eventId?: string | null;
}

interface HostedWakeStatusResponse {
  cursor: HostedExecutionCursorState;
  pendingWakeCount: number;
  wakeState?: HostedIngressLifecycleState;
}

type HostedWakeLifecycleState = HostedIngressLifecycleState;

type StoredHostedWakeRecord = TestHostedWakeRecord & {
  wakeState: HostedWakeLifecycleState;
  eventId: string;
  terminalState?: HostedWakeTerminalRequest["state"] | null;
  payloadBytes?: number | null;
  payloadCiphertext?: string | null;
};

type StoredHostedRunRecord = HostedRunRecord & {
  runToken: string;
};

type StoredHostedWakeControlState = {
  activeRun: StoredHostedRunRecord | null;
  assistantNextWakeAt: string | null;
  cursor: HostedExecutionCursorState;
  logs: HostedRunLogRecord[];
  nextRunId: number;
  nextSeq: number;
  wakes: StoredHostedWakeRecord[];
};

type TestHostedWakeFinalizeTokenClaims = {
  committedCursorVersion: string;
  committedSeq: string;
  previousSnapshotRef: HostedExecutionCursorState["snapshotRef"];
  userId: string;
  wakeId: string;
  wakeSeq: string;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function appendTestHostedWake(input: {
  bucket: R2BucketLike;
  wake: HostedExecutionWake | HostedExecutionRuntimeTimerWake;
}): Promise<HostedWakeAppendResponse> {
  const wake = input.wake;

  const state = await readStoredHostedWakeControlState(input.bucket, wake.userId);
  const existing = state.wakes.find((storedWake) => storedWake.eventId === wake.eventId);

  if (existing) {
    return {
      duplicate: true,
      inserted: false,
      updatedExisting: false,
      wake: toHostedWakeRecord(existing),
    };
  }

  const seq = String(state.nextSeq + 1);
  const now = new Date().toISOString();
  const storedWake: StoredHostedWakeRecord = wake.kind === "conversation.message"
    ? {
      behavior: "ordered",
      createdAt: now,
      dedupeKey: `${wake.eventId}`,
      wakeState: "queued",
      eventId: wake.eventId,
      id: `wake_${seq}`,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      ...encryptTestHostedIngressPayload({
        field: "hosted-ingress-inline-payload",
        userId: wake.userId,
        value: wake,
      }),
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      seq,
      terminalState: null,
      updatedAt: now,
      userId: wake.userId,
    } satisfies HostedConversationMessageWakeRecord & {
      wakeState: HostedWakeLifecycleState;
      eventId: string;
      terminalState?: HostedWakeTerminalRequest["state"] | null;
    }
    : wake.kind === "runtime.timer"
      ? {
        behavior: "ordered",
        createdAt: now,
        dedupeKey: `${wake.eventId}`,
        wakeState: "queued",
        eventId: wake.eventId,
        id: `wake_${seq}`,
        kind: wake.kind,
        occurredAt: wake.occurredAt,
        ...encryptTestHostedIngressPayload({
          field: "hosted-ingress-ref-payload",
          userId: wake.userId,
          value: wake,
        }),
        payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
        seq,
        terminalState: null,
        updatedAt: now,
        userId: wake.userId,
      } satisfies HostedRuntimeTimerWakeRecord & {
        wakeState: HostedWakeLifecycleState;
        eventId: string;
        terminalState?: HostedWakeTerminalRequest["state"] | null;
      }
      : {
      behavior: "ordered",
      createdAt: now,
      dedupeKey: `${wake.eventId}`,
      wakeState: "queued",
      eventId: wake.eventId,
      id: `wake_${seq}`,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      ...encryptTestHostedIngressPayload({
        field: "hosted-ingress-ref-payload",
        userId: wake.userId,
        value: wake,
      }),
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      seq,
      terminalState: null,
      updatedAt: now,
      userId: wake.userId,
      } satisfies HostedSystemWakeRecord & {
        wakeState: HostedWakeLifecycleState;
        eventId: string;
        terminalState?: HostedWakeTerminalRequest["state"] | null;
      };

  state.nextSeq += 1;
  state.cursor = {
    ...state.cursor,
    nextSeq: String(state.nextSeq + 1),
    updatedAt: now,
  };
  state.wakes.push(storedWake);
  await writeStoredHostedWakeControlState(input.bucket, wake.userId, state);

  return {
    duplicate: false,
    inserted: true,
    updatedExisting: false,
    wake: toHostedWakeRecord(storedWake),
  };
}

export async function fetchTestHostedWakeBatch(input: {
  body: HostedWakeFetchRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeFetchResponse> {
  if (Object.prototype.hasOwnProperty.call(input.body as object, "afterSeq")) {
    throw new TypeError("afterSeq is not supported for executable hosted wake fetches.");
  }

  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const committedSeq = parseSeq(state.cursor.committedSeq);
  const limit = normalizeLimit(input.body.limit);
  const wakes = state.wakes
    .filter((wake) => parseSeq(wake.seq) > committedSeq)
    .sort((left, right) => compareSeq(left.seq, right.seq))
    .slice(0, limit)
    .map((wake) => toHostedFetchedWakeRecord(wake, state.cursor));

  return {
    cursor: state.cursor,
    wakes,
  };
}

export async function commitTestHostedWakeCursor(input: {
  body: HostedWakeCommitRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeCommitResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);

  if (state.cursor.version !== input.body.expectedVersion) {
    return {
      committed: false,
      cursor: state.cursor,
    };
  }

  const committedSeq = parseSeq(input.body.committedSeq);
  const currentCommittedSeq = parseSeq(state.cursor.committedSeq);
  const shouldAdvanceCommittedSeq = committedSeq > currentCommittedSeq;
  const targetWake = state.wakes.find((candidate) => parseSeq(candidate.seq) === committedSeq);
  const targetWakeState = targetWake?.terminalState
    ? toStoredWakeLifecycleState(targetWake.terminalState)
    : null;
  const hasSnapshotRef = "snapshotRef" in input.body;
  const nextSnapshotRef = hasSnapshotRef
    ? input.body.snapshotRef ?? null
    : state.cursor.snapshotRef ?? null;
  const hasAssistantNextWakeAt = "assistantNextWakeAt" in input.body;
  const nextAssistantNextWakeAt = hasAssistantNextWakeAt
    ? normalizeStoredWakeTimestamp(input.body.assistantNextWakeAt ?? null)
    : state.assistantNextWakeAt;

  if (
    (shouldAdvanceCommittedSeq
      && (
        committedSeq !== currentCommittedSeq + 1n
        || committedSeq >= parseSeq(state.cursor.nextSeq)
        || !targetWake
        || !isCommitEligibleStoredWakeState(targetWakeState)
      ))
    || (committedSeq <= currentCommittedSeq)
  ) {
    return {
      committed: false,
      cursor: state.cursor,
    };
  }

  if (!targetWake) {
    throw new Error(`Expected committed wake ${committedSeq.toString()} to exist.`);
  }

  const nextVersion = String(parseSeq(state.cursor.version) + 1n);

  const now = new Date().toISOString();
  state.assistantNextWakeAt = nextAssistantNextWakeAt;
  state.cursor = {
    committedSeq: String(committedSeq),
    createdAt: state.cursor.createdAt,
    nextSeq: String(state.nextSeq),
    snapshotRef: nextSnapshotRef,
    updatedAt: now,
    userId: input.userId,
    version: nextVersion,
  };
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);

  return {
    committed: true,
    cursor: state.cursor,
    finalizeToken: issueTestHostedWakeFinalizeToken({
      committedCursorVersion: state.cursor.version,
      committedSeq: state.cursor.committedSeq,
      previousSnapshotRef: state.cursor.snapshotRef,
      userId: input.userId,
      wakeId: targetWake.id,
      wakeSeq: targetWake.seq,
    }),
  };
}

export async function finalizeTestHostedWakeCursor(input: {
  body: HostedWakeFinalizeRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeFinalizeResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const claims = parseTestHostedWakeFinalizeToken(input.body.finalizeToken);

  if (
    !claims
    || claims.userId !== input.userId
    || claims.committedSeq !== state.cursor.committedSeq
    || claims.committedCursorVersion !== state.cursor.version
    || JSON.stringify(claims.previousSnapshotRef ?? null) !== JSON.stringify(state.cursor.snapshotRef ?? null)
  ) {
    return {
      cursor: state.cursor,
      finalized: false,
    };
  }

  const nextAssistantNextWakeAt = input.body.assistantNextWakeAt === undefined
    ? state.assistantNextWakeAt
    : normalizeStoredWakeTimestamp(input.body.assistantNextWakeAt ?? null);
  const snapshotRefChanged = JSON.stringify(state.cursor.snapshotRef ?? null)
    !== JSON.stringify(input.body.snapshotRef ?? null);

  if (!snapshotRefChanged) {
    return {
      cursor: state.cursor,
      finalized: false,
    };
  }

  const wake = state.wakes.find((candidate) =>
    candidate.id === claims.wakeId
    && candidate.seq === claims.wakeSeq
    && candidate.userId === input.userId
  );

  if (!wake) {
    return {
      cursor: state.cursor,
      finalized: false,
    };
  }

  const now = new Date().toISOString();
  state.assistantNextWakeAt = nextAssistantNextWakeAt;
  state.cursor = {
    ...state.cursor,
    snapshotRef: input.body.snapshotRef,
    updatedAt: now,
    version: String(parseSeq(state.cursor.version) + 1n),
  };
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);

  return {
    cursor: state.cursor,
    finalized: true,
  };
}

function issueTestHostedWakeFinalizeToken(
  claims: TestHostedWakeFinalizeTokenClaims,
): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

function parseTestHostedWakeFinalizeToken(
  value: string,
): TestHostedWakeFinalizeTokenClaims | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (!isRecord(parsed)) {
      return null;
    }
    if (
      typeof parsed.userId !== "string"
      || typeof parsed.wakeId !== "string"
      || typeof parsed.wakeSeq !== "string"
      || typeof parsed.committedSeq !== "string"
      || typeof parsed.committedCursorVersion !== "string"
    ) {
      return null;
    }

    return {
      committedCursorVersion: parsed.committedCursorVersion,
      committedSeq: parsed.committedSeq,
      previousSnapshotRef: parseHostedExecutionBundleRef(
        parsed.previousSnapshotRef ?? null,
        "Test hosted wake finalize token previousSnapshotRef",
      ),
      userId: parsed.userId,
      wakeId: parsed.wakeId,
      wakeSeq: parsed.wakeSeq,
    };
  } catch {
    return null;
  }
}

export async function materializeTestHostedWakes(input: {
  body: HostedWakeMaterializeRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeMaterializeResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  let targetSeqHint: string | null = null;
  const nowIso = new Date(Date.now()).toISOString();

  if (isStoredWakeHintDue(state.assistantNextWakeAt)) {
    const appended = await appendTestHostedWake({
      bucket: input.bucket,
      wake: buildHostedExecutionRuntimeTimerWake({
        eventId: `runtime.timer:${input.userId}:alarm:${nowIso}`,
        occurredAt: nowIso,
        triggerKind: "runtime_timer",
        userId: input.userId,
      }),
    });
    targetSeqHint = appended.wake.seq;
  }

  return {
    targetSeqHint,
    wakeMaterializationHints: state.assistantNextWakeAt === null || isStoredWakeHintDue(state.assistantNextWakeAt)
      ? null
      : {
          assistantWakeAt: state.assistantNextWakeAt,
        },
  };
}

export async function recordTestHostedWakeTerminal(input: {
  body: HostedWakeTerminalRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeTerminalResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const wake = state.wakes.find((candidate) =>
    candidate.id === input.body.wakeId
    && candidate.seq === input.body.wakeSeq);

  if (
    !wake
    || !verifyTestHostedWakeFetchProof({
      cursor: state.cursor,
      proof: input.body.fetchProof,
      wake: {
        eventId: wake.eventId,
        id: wake.id,
        seq: wake.seq,
        userId: wake.userId,
      },
    })
  ) {
    return {
      recorded: false,
    };
  }

  wake.terminalState = input.body.state;
  wake.wakeState = toStoredWakeLifecycleState(input.body.state);
  wake.updatedAt = new Date().toISOString();
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);
  return {
    recorded: true,
  };
}

function toStoredWakeLifecycleState(
  state: HostedWakeTerminalRequest["state"],
): HostedWakeLifecycleState {
  return state;
}

function isCommitEligibleStoredWakeState(
  state: HostedWakeLifecycleState | null,
): boolean {
  return state === "completed"
    || state === "quarantined";
}

export async function quarantineTestHostedWake(input: {
  body: HostedWakeQuarantineRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeQuarantineResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const wake = state.wakes.find((candidate) =>
    candidate.id === input.body.wakeId
    && candidate.seq === input.body.wakeSeq
  );

  if (
    !wake
    || !verifyTestHostedWakeFetchProof({
      cursor: state.cursor,
      proof: input.body.fetchProof,
      wake: {
        eventId: wake.eventId,
        id: wake.id,
        seq: wake.seq,
        userId: wake.userId,
      },
    })
  ) {
    return { quarantined: false };
  }

  wake.terminalState = "quarantined";
  wake.wakeState = toStoredWakeLifecycleState("quarantined");
  wake.quarantineCode = input.body.quarantineCode;
  wake.quarantinedAt = new Date().toISOString();
  wake.updatedAt = wake.quarantinedAt;
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);

  return { quarantined: true };
}

export async function readTestHostedWakeStatus(input: {
  body: HostedWakeStatusRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeStatusResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const committedSeq = parseSeq(state.cursor.committedSeq);
  const pendingWakeCount = state.wakes.filter((wake) =>
    wake.wakeState !== "quarantined"
    && wake.wakeState !== "completed"
    && wake.wakeState !== "replaced"
    && parseSeq(wake.seq) > committedSeq
  ).length;

  const wake = input.body.eventId
    ? state.wakes.find((candidate) => candidate.eventId === input.body.eventId)
    : null;

  return {
    cursor: state.cursor,
    ...(wake
      ? { wakeState: wake.wakeState }
      : {}),
    pendingWakeCount,
  };
}

export async function acquireTestHostedRun(input: {
  body: HostedRunAcquireRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunAcquireResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const pendingIngressEventCount = countPendingWakes(state);
  const activeRun = state.activeRun;

  if (input.body.triggerKind === "retry_finalize" && activeRun?.status === "finalizing") {
    return {
      acquired: true,
      cursor: state.cursor,
      events: [],
      pendingIngressEventCount,
      resumeFinalize: true,
      run: toHostedRunRecord(activeRun),
      runToken: activeRun.runToken,
    };
  }

  if (activeRun) {
    return {
      acquired: false,
      cursor: state.cursor,
      events: [],
      pendingIngressEventCount,
      resumeFinalize: activeRun.status === "finalizing",
      run: toHostedRunRecord(activeRun),
      runToken: activeRun.runToken,
    };
  }

  const limit = normalizeLimit(input.body.limit);
  const wakes = listPendingWakes(state).slice(0, limit);
  const dueRuntimeWake = wakes.length === 0 && isStoredWakeHintDue(state.cursor.nextRuntimeWakeAt ?? null);

  if (!dueRuntimeWake && wakes.length === 0) {
    return {
      acquired: false,
      cursor: state.cursor,
      events: [],
      pendingIngressEventCount,
      resumeFinalize: false,
      run: null,
      runToken: null,
    };
  }

  const now = new Date().toISOString();
  const runId = `run_${state.nextRunId}`;
  const runToken = `token_${runId}`;
  const triggerKind = dueRuntimeWake
    ? "runtime_timer"
    : readHostedRunTriggerKind({
        requestedTriggerKind: input.body.triggerKind,
        wakes,
      });
  const run: StoredHostedRunRecord = {
    acquiredAt: now,
    attempt: 1,
    createdAt: now,
    eventCount: wakes.length,
    eventKinds: wakes.map((wake) => wake.kind),
    eventSeqs: wakes.map((wake) => wake.seq),
    executorKind: input.body.executorKind ?? "cloudflare-container",
    id: runId,
    inputCommittedSeq: state.cursor.committedSeq,
    inputCursorVersion: state.cursor.version,
    inputSnapshotRef: state.cursor.snapshotRef,
    runToken,
    startedAt: now,
    status: "acquired",
    triggerKind,
    updatedAt: now,
    userId: input.userId,
    ingressEventIds: wakes.map((wake) => wake.id),
  };

  if (dueRuntimeWake) {
    state.cursor = {
      ...state.cursor,
      nextRuntimeWakeAt: null,
      nextRuntimeWakeReason: null,
      updatedAt: now,
    };
  }

  state.activeRun = run;
  state.nextRunId += 1;
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);

    return {
      acquired: true,
      cursor: state.cursor,
      events: wakes
        .filter((wake): wake is StoredHostedWakeRecord & HostedIngressEvent => wake.kind !== "runtime.timer")
        .map((wake) => toHostedIngressWakeRecord(wake)),
      pendingIngressEventCount,
      resumeFinalize: false,
      run: toHostedRunRecord(run),
      runToken,
    };
}

export async function commitTestHostedRun(input: {
  body: HostedRunCommitRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunCommitResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const activeRun = state.activeRun;

  if (!activeRun || !matchesActiveRun(activeRun, input.body) || state.cursor.version !== input.body.expectedCursorVersion) {
    return {
      committed: false,
      cursor: state.cursor,
      needsFinalize: false,
      run: activeRun ? toHostedRunRecord(activeRun) : null,
    };
  }

  const now = new Date().toISOString();
  const nextCursorVersion = String(parseSeq(state.cursor.version) + 1n);
  const nextRuntimeWakeAt = normalizeStoredWakeTimestamp(input.body.nextRuntimeWakeAt ?? null);
  const nextRuntimeWakeReason = nextRuntimeWakeAt ? input.body.nextRuntimeWakeReason ?? null : null;

  state.cursor = {
    ...state.cursor,
    committedSeq: input.body.outputCommittedSeq,
    nextRuntimeWakeAt,
    nextRuntimeWakeReason,
    snapshotRef: input.body.preparedSnapshotRef ?? state.cursor.snapshotRef,
    updatedAt: now,
    version: nextCursorVersion,
  };

  const nextRun: StoredHostedRunRecord = {
    ...activeRun,
    committedAt: now,
    ...(input.body.failureClass === undefined ? {} : { errorClass: input.body.failureClass ?? null }),
    ...(input.body.failureCode === undefined ? {} : { errorCode: input.body.failureCode ?? null }),
    ...(input.body.finalizeRequired ? {} : { finalSnapshotRef: input.body.preparedSnapshotRef ?? state.cursor.snapshotRef }),
    ...(input.body.finalizeRequired ? {} : { finalizedAt: now }),
    ...(input.body.failureCode === undefined && input.body.failureClass === undefined
      ? {}
      : { failedAt: now }),
    nextRuntimeWakeAt,
    nextRuntimeWakeReason,
    outputCommittedSeq: input.body.outputCommittedSeq,
    outputCursorVersion: nextCursorVersion,
    preparedAt: now,
    preparedSnapshotRef: input.body.preparedSnapshotRef ?? null,
    ...(input.body.redactedSummary === undefined ? {} : { redactedSummary: input.body.redactedSummary ?? null }),
    status: input.body.finalizeRequired
      ? "finalizing"
      : (input.body.failureCode === undefined && input.body.failureClass === undefined ? "finalized" : "failed"),
    updatedAt: now,
  };

  await applyCommitEventResults({
    eventResults: input.body.eventResults ?? [],
    state,
  });

  const responseRun = toHostedRunRecord(nextRun);
  state.activeRun = input.body.finalizeRequired ? nextRun : null;
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);

  return {
    committed: true,
    cursor: state.cursor,
    needsFinalize: Boolean(input.body.finalizeRequired),
    run: responseRun,
  };
}

export async function finalizeTestHostedRun(input: {
  body: HostedRunFinalizeRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunFinalizeResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const activeRun = state.activeRun;

  if (!activeRun || !matchesActiveRun(activeRun, input.body) || activeRun.status !== "finalizing") {
    return {
      cursor: state.cursor,
      finalized: false,
      run: activeRun ? toHostedRunRecord(activeRun) : null,
    };
  }

  const now = new Date().toISOString();
  const nextCursorVersion = String(parseSeq(state.cursor.version) + 1n);
  const nextRuntimeWakeAt = normalizeStoredWakeTimestamp(input.body.nextRuntimeWakeAt ?? null);
  const nextRuntimeWakeReason = nextRuntimeWakeAt ? input.body.nextRuntimeWakeReason ?? null : null;
  state.cursor = {
    ...state.cursor,
    nextRuntimeWakeAt,
    nextRuntimeWakeReason,
    snapshotRef: input.body.finalSnapshotRef,
    updatedAt: now,
    version: nextCursorVersion,
  };

  const finalizedRun: StoredHostedRunRecord = {
    ...activeRun,
    finalSnapshotRef: input.body.finalSnapshotRef,
    finalizedAt: now,
    nextRuntimeWakeAt,
    nextRuntimeWakeReason,
    outputCursorVersion: nextCursorVersion,
    ...(input.body.redactedSummary === undefined ? {} : { redactedSummary: input.body.redactedSummary ?? null }),
    status: "finalized",
    updatedAt: now,
  };

  state.activeRun = null;
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);

  return {
    cursor: state.cursor,
    finalized: true,
    run: toHostedRunRecord(finalizedRun),
  };
}

export async function releaseTestHostedRunFinalize(input: {
  body: HostedRunReleaseFinalizeRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunReleaseFinalizeResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const activeRun = state.activeRun;

  if (!activeRun || !matchesActiveRun(activeRun, input.body) || activeRun.status !== "finalizing") {
    return {
      cursor: state.cursor,
      released: false,
      run: activeRun ? toHostedRunRecord(activeRun) : null,
    };
  }

  const now = new Date().toISOString();
  const releasedRun: StoredHostedRunRecord = {
    ...activeRun,
    ...(input.body.failureClass === undefined ? {} : { errorClass: input.body.failureClass ?? null }),
    ...(input.body.failureCode === undefined ? {} : { errorCode: input.body.failureCode ?? null }),
    failedAt: now,
    status: "failed",
    updatedAt: now,
  };

  state.activeRun = null;
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);

  return {
    cursor: state.cursor,
    released: true,
    run: toHostedRunRecord(releasedRun),
  };
}

export async function readTestHostedRunStatus(input: {
  body: HostedRunStatusRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunStatusResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const filteredLogs = state.logs.filter((log) =>
    input.body.runId ? log.runId === input.body.runId : true
  );
  const limit = typeof input.body.limit === "number" && Number.isFinite(input.body.limit)
    ? Math.max(0, Math.trunc(input.body.limit))
    : filteredLogs.length;

  return {
    cursor: state.cursor,
    ...(input.body.includeLogs
      ? { logs: filteredLogs.slice(-limit) }
      : {}),
    pendingIngressEventCount: countPendingWakes(state),
    run: state.activeRun ? toHostedRunRecord(state.activeRun) : null,
  };
}

export async function armTestHostedRuntimeWake(input: {
  bucket: R2BucketLike;
  userId: string;
  wakeAt: string;
}): Promise<{ armed: true; nextRuntimeWakeAt: string }> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const now = new Date().toISOString();
  const nextRuntimeWakeAt = normalizeStoredWakeTimestamp(input.wakeAt) ?? now;
  state.cursor = {
    ...state.cursor,
    nextRuntimeWakeAt,
    nextRuntimeWakeReason: "runtime",
    updatedAt: now,
  };
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);
  return {
    armed: true,
    nextRuntimeWakeAt,
  };
}

export async function recordTestHostedRunLog(input: {
  body: HostedRunLogRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedRunLogResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const now = new Date().toISOString();
  const log: HostedRunLogRecord = {
    at: normalizeStoredWakeTimestamp(input.body.at ?? null) ?? now,
    component: input.body.component,
    createdAt: now,
    id: `log_${state.logs.length + 1}`,
    level: input.body.level,
    message: input.body.message,
    phase: input.body.phase,
    ...(input.body.redacted === undefined ? {} : { redacted: input.body.redacted }),
    runId: input.body.runId,
    userId: input.userId,
  };
  state.logs.push(log);
  await writeStoredHostedWakeControlState(input.bucket, input.userId, state);
  return {
    log,
    logged: true,
  };
}

async function readStoredHostedWakeControlState(
  bucket: R2BucketLike,
  userId: string,
): Promise<StoredHostedWakeControlState> {
  const object = await bucket.get(hostedWakeControlObjectKey(userId));

  if (!object) {
    return {
      activeRun: null,
      assistantNextWakeAt: null,
      cursor: {
        committedSeq: "0",
        createdAt: new Date(0).toISOString(),
        nextSeq: "1",
        nextRuntimeWakeAt: null,
        nextRuntimeWakeReason: null,
        snapshotRef: null,
        updatedAt: new Date(0).toISOString(),
        userId,
        version: "0",
      },
      logs: [],
      nextRunId: 1,
      nextSeq: 0,
      wakes: [],
    };
  }

  const parsed = JSON.parse(textDecoder.decode(await object.arrayBuffer())) as Partial<StoredHostedWakeControlState>;
  return {
    activeRun: parsed.activeRun ?? null,
    assistantNextWakeAt: parsed.assistantNextWakeAt ?? null,
    cursor: {
      committedSeq: parsed.cursor?.committedSeq ?? "0",
      createdAt: parsed.cursor?.createdAt ?? new Date(0).toISOString(),
      nextSeq: parsed.cursor?.nextSeq ?? "1",
      nextRuntimeWakeAt: parsed.cursor?.nextRuntimeWakeAt ?? null,
      nextRuntimeWakeReason: parsed.cursor?.nextRuntimeWakeReason ?? null,
      snapshotRef: parsed.cursor?.snapshotRef ?? null,
      updatedAt: parsed.cursor?.updatedAt ?? new Date(0).toISOString(),
      userId: parsed.cursor?.userId ?? userId,
      version: parsed.cursor?.version ?? "0",
    },
    logs: parsed.logs ?? [],
    nextRunId: parsed.nextRunId ?? 1,
    nextSeq: parsed.nextSeq ?? 0,
    wakes: parsed.wakes ?? [],
  };
}

async function writeStoredHostedWakeControlState(
  bucket: R2BucketLike,
  userId: string,
  state: StoredHostedWakeControlState,
): Promise<void> {
  await bucket.put(
    hostedWakeControlObjectKey(userId),
    JSON.stringify(state),
  );
}

function hostedWakeControlObjectKey(userId: string): string {
  return `test/hosted-wakes/${encodeURIComponent(userId)}.json`;
}

function isStoredWakeHintDue(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) && parsedMs <= Date.now();
}

function normalizeStoredWakeTimestamp(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function toHostedWakeRecord(wake: StoredHostedWakeRecord): TestHostedWakeRecord {
  if (wake.kind === "conversation.message") {
    return {
      behavior: wake.behavior,
      createdAt: wake.createdAt,
      ...(wake.dedupeKey === undefined ? {} : { dedupeKey: wake.dedupeKey }),
      id: wake.id,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      ...(wake.payloadBytes === undefined ? {} : { payloadBytes: wake.payloadBytes }),
      ...(wake.payloadCiphertext === undefined ? {} : { payloadCiphertext: wake.payloadCiphertext }),
      payloadSchema: wake.payloadSchema,
      ...(wake.quarantineCode === undefined ? {} : { quarantineCode: wake.quarantineCode }),
      ...(wake.quarantinedAt === undefined ? {} : { quarantinedAt: wake.quarantinedAt }),
      seq: wake.seq,
      updatedAt: wake.updatedAt,
      userId: wake.userId,
    };
  }

  if (wake.kind === "runtime.timer") {
    return {
      behavior: wake.behavior,
      createdAt: wake.createdAt,
      ...(wake.dedupeKey === undefined ? {} : { dedupeKey: wake.dedupeKey }),
      id: wake.id,
      kind: wake.kind,
      occurredAt: wake.occurredAt,
      ...(wake.payloadBytes === undefined ? {} : { payloadBytes: wake.payloadBytes }),
      ...(wake.payloadCiphertext === undefined ? {} : { payloadCiphertext: wake.payloadCiphertext }),
      payloadSchema: wake.payloadSchema,
      ...(wake.quarantineCode === undefined ? {} : { quarantineCode: wake.quarantineCode }),
      ...(wake.quarantinedAt === undefined ? {} : { quarantinedAt: wake.quarantinedAt }),
      seq: wake.seq,
      updatedAt: wake.updatedAt,
      userId: wake.userId,
    };
  }

  return {
    behavior: wake.behavior,
    createdAt: wake.createdAt,
    ...(wake.dedupeKey === undefined ? {} : { dedupeKey: wake.dedupeKey }),
    id: wake.id,
    kind: wake.kind,
    occurredAt: wake.occurredAt,
    ...(wake.payloadBytes === undefined ? {} : { payloadBytes: wake.payloadBytes }),
    ...(wake.payloadCiphertext === undefined ? {} : { payloadCiphertext: wake.payloadCiphertext }),
    payloadSchema: wake.payloadSchema,
    ...(wake.quarantineCode === undefined ? {} : { quarantineCode: wake.quarantineCode }),
    ...(wake.quarantinedAt === undefined ? {} : { quarantinedAt: wake.quarantinedAt }),
    seq: wake.seq,
    updatedAt: wake.updatedAt,
    userId: wake.userId,
  };
}

function toHostedIngressWakeRecord(
  wake: StoredHostedWakeRecord & HostedIngressEvent,
): HostedIngressEvent {
  return toHostedWakeRecord(wake) as HostedIngressEvent;
}

function toHostedFetchedWakeRecord(
  wake: StoredHostedWakeRecord,
  cursor: Pick<HostedExecutionCursorState, "committedSeq" | "version">,
): HostedFetchedWakeRecord {
  return {
    ...toHostedWakeRecord(wake),
    fetchProof: issueTestHostedWakeFetchProof({
      cursor,
      wake: {
        eventId: wake.eventId,
        id: wake.id,
        seq: wake.seq,
        userId: wake.userId,
      },
    }),
  };
}

function toHostedRunRecord(run: StoredHostedRunRecord): HostedRunRecord {
  const { runToken: _runToken, ...record } = run;
  return record;
}

function countPendingWakes(state: StoredHostedWakeControlState): number {
  const committedSeq = parseSeq(state.cursor.committedSeq);
  return state.wakes.filter((wake) =>
    wake.wakeState !== "quarantined"
    && wake.wakeState !== "completed"
    && wake.wakeState !== "replaced"
    && parseSeq(wake.seq) > committedSeq
  ).length;
}

function listPendingWakes(state: StoredHostedWakeControlState): StoredHostedWakeRecord[] {
  const committedSeq = parseSeq(state.cursor.committedSeq);
  return state.wakes
    .filter((wake) =>
      wake.wakeState !== "quarantined"
      && wake.wakeState !== "completed"
      && wake.wakeState !== "replaced"
      && parseSeq(wake.seq) > committedSeq
    )
    .sort((left, right) => compareSeq(left.seq, right.seq));
}

function readHostedRunTriggerKind(input: {
  requestedTriggerKind: HostedRunAcquireRequest["triggerKind"];
  wakes: StoredHostedWakeRecord[];
}): HostedRunTriggerKind {
  if (input.requestedTriggerKind) {
    return input.requestedTriggerKind;
  }

  return input.wakes[0]?.kind === "runtime.timer" ? "runtime_timer" : "external_ingress";
}

function matchesActiveRun(
  run: StoredHostedRunRecord,
  request:
    | Pick<HostedRunCommitRequest, "runId" | "runToken">
    | Pick<HostedRunFinalizeRequest, "runId" | "runToken">
    | Pick<HostedRunReleaseFinalizeRequest, "runId" | "runToken">,
): boolean {
  return run.id === request.runId && run.runToken === request.runToken;
}

async function applyCommitEventResults(input: {
  eventResults: HostedRunCommitRequest["eventResults"];
  state: StoredHostedWakeControlState;
}): Promise<void> {
  for (const eventResult of input.eventResults ?? []) {
    const wake = input.state.wakes.find((candidate) => candidate.id === eventResult.ingressEventId);
    if (!wake) {
      continue;
    }

    wake.terminalState = eventResult.state;
    wake.wakeState = toStoredWakeLifecycleState(eventResult.state);
    wake.updatedAt = new Date().toISOString();
    if (eventResult.state === "quarantined") {
      wake.quarantineCode = eventResult.quarantineCode ?? null;
      wake.quarantinedAt = wake.updatedAt;
    }
  }
}

function parseSeq(value: string): bigint {
  return BigInt(value);
}

function compareSeq(left: string, right: string): number {
  const delta = parseSeq(left) - parseSeq(right);
  return delta === 0n ? 0 : delta > 0n ? 1 : -1;
}

function normalizeLimit(value: number | null | undefined): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    return 100;
  }

  return value;
}
