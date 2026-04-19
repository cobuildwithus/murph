import type {
  HostedExecutionCursorState,
  HostedConversationMessageWakeRecord,
  HostedExecutionWake,
  HostedFetchedWakeRecord,
  HostedSystemWakeRecord,
  HostedWakeAppendResponse,
  HostedWakeCommitRequest,
  HostedWakeCommitResponse,
  HostedWakeFetchRequest,
  HostedWakeLifecycleState,
  HostedWakeFetchResponse,
  HostedWakeFinalizeRequest,
  HostedWakeFinalizeResponse,
  HostedWakeMaterializeRequest,
  HostedWakeMaterializeResponse,
  HostedWakeTerminalRequest,
  HostedWakeTerminalResponse,
  HostedWakeQuarantineRequest,
  HostedWakeQuarantineResponse,
  HostedWakeRecord,
  HostedWakeStatusRequest,
  HostedWakeStatusResponse,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution";
import {
  encryptTestHostedWakePayload,
  issueTestHostedWakeFetchProof,
  verifyTestHostedWakeFetchProof,
} from "../hosted-execution-fixtures.js";

import type { R2BucketLike } from "../../src/bundle-store.js";

type StoredHostedWakeRecord = HostedWakeRecord & {
  wakeState: HostedWakeLifecycleState;
  eventId: string;
  terminalState?: HostedWakeTerminalRequest["state"] | null;
  payloadBytes?: number | null;
  payloadCiphertext?: string | null;
};

type StoredHostedWakeControlState = {
  assistantNextWakeAt: string | null;
  cursor: HostedExecutionCursorState;
  nextSeq: number;
  wakes: StoredHostedWakeRecord[];
};

type TestHostedWakeFinalizeTokenClaims = {
  committedCursorVersion: string;
  committedSeq: string;
  previousSnapshotRef: HostedWakeFinalizeRequest["snapshotRef"];
  userId: string;
  wakeId: string;
  wakeSeq: string;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function appendTestHostedWake(input: {
  bucket: R2BucketLike;
  wake: HostedExecutionWake;
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
      ...encryptTestHostedWakePayload({
        field: "hosted-wake-inline-payload",
        userId: wake.userId,
        value: wake,
      }),
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      seq,
      terminalState: null,
      updatedAt: now,
      userId: wake.userId,
    } satisfies HostedConversationMessageWakeRecord & {
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
      ...encryptTestHostedWakePayload({
        field: "hosted-wake-ref-payload",
        userId: wake.userId,
        value: wake,
      }),
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
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
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const claims = parsed as Partial<TestHostedWakeFinalizeTokenClaims>;
    if (
      typeof claims.userId !== "string"
      || typeof claims.wakeId !== "string"
      || typeof claims.wakeSeq !== "string"
      || typeof claims.committedSeq !== "string"
      || typeof claims.committedCursorVersion !== "string"
    ) {
      return null;
    }

    return {
      committedCursorVersion: claims.committedCursorVersion,
      committedSeq: claims.committedSeq,
      previousSnapshotRef: claims.previousSnapshotRef ?? null,
      userId: claims.userId,
      wakeId: claims.wakeId,
      wakeSeq: claims.wakeSeq,
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
      wake: {
        eventId: `assistant.cron.tick:${input.userId}:alarm:${nowIso}`,
        kind: "assistant.cron.tick",
        occurredAt: nowIso,
        reason: "alarm",
        userId: input.userId,
      },
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

async function readStoredHostedWakeControlState(
  bucket: R2BucketLike,
  userId: string,
): Promise<StoredHostedWakeControlState> {
  const object = await bucket.get(hostedWakeControlObjectKey(userId));

  if (!object) {
    return {
      assistantNextWakeAt: null,
      cursor: {
        committedSeq: "0",
        createdAt: new Date(0).toISOString(),
        nextSeq: "1",
        snapshotRef: null,
        updatedAt: new Date(0).toISOString(),
        userId,
        version: "0",
      },
      nextSeq: 0,
      wakes: [],
    };
  }

  return JSON.parse(textDecoder.decode(await object.arrayBuffer())) as StoredHostedWakeControlState;
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

function toHostedWakeRecord(wake: StoredHostedWakeRecord): HostedWakeRecord {
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
