import type {
  HostedExecutionCursorState,
  HostedConversationMessageWakeRecord,
  HostedExecutionWake,
  HostedSystemWakeRecord,
  HostedWakeAppendResponse,
  HostedWakeCommitRequest,
  HostedWakeCommitResponse,
  HostedWakeFetchRequest,
  HostedWakeLifecycleState,
  HostedWakeFetchResponse,
  HostedWakeQuarantineRequest,
  HostedWakeQuarantineResponse,
  HostedWakeRecord,
  HostedWakeStatusRequest,
  HostedWakeStatusResponse,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
  isHostedConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  encryptTestHostedWakePayload,
} from "../hosted-execution-fixtures.js";

import type { R2BucketLike } from "../../src/bundle-store.js";

type StoredHostedWakeRecord = HostedWakeRecord & {
  wakeState: HostedWakeLifecycleState;
  eventId: string;
  payloadBytes?: number | null;
  payloadCiphertext?: string | null;
};

type StoredHostedWakeControlState = {
  cursor: HostedExecutionCursorState;
  nextSeq: number;
  wakes: StoredHostedWakeRecord[];
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
  const storedWake: StoredHostedWakeRecord = isHostedConversationMessageWake(wake)
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
        value: {
          eventId: wake.eventId,
          ...wake.message,
        },
      }),
      payloadSchema: HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
      seq,
      updatedAt: now,
      userId: wake.userId,
    } satisfies HostedConversationMessageWakeRecord & {
      wakeState: HostedWakeLifecycleState;
      eventId: string;
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
      payloadSchema: HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA,
      seq,
      updatedAt: now,
      userId: wake.userId,
    } satisfies HostedSystemWakeRecord & {
      wakeState: HostedWakeLifecycleState;
      eventId: string;
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
  afterSeq?: string | null;
  body: HostedWakeFetchRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeFetchResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const afterSeq = parseSeq(input.afterSeq ?? input.body.afterSeq ?? state.cursor.committedSeq);
  const limit = normalizeLimit(input.body.limit);
  const wakes = state.wakes
    .filter((wake) => parseSeq(wake.seq) > afterSeq)
    .sort((left, right) => compareSeq(left.seq, right.seq))
    .slice(0, limit)
    .map(toHostedWakeRecord);

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
  const hasSnapshotRef = "snapshotRef" in input.body;
  const nextSnapshotRef = hasSnapshotRef
    ? input.body.snapshotRef ?? null
    : state.cursor.snapshotRef ?? null;
  const snapshotRefChanged = JSON.stringify(state.cursor.snapshotRef ?? null)
    !== JSON.stringify(nextSnapshotRef);

  if (
    (shouldAdvanceCommittedSeq
      && (
        committedSeq !== currentCommittedSeq + 1n
        || committedSeq >= state.nextSeq
      ))
    || (!shouldAdvanceCommittedSeq && committedSeq !== currentCommittedSeq)
    || (!shouldAdvanceCommittedSeq && (!hasSnapshotRef || !snapshotRefChanged))
  ) {
    return {
      committed: false,
      cursor: state.cursor,
    };
  }

  const nextCommittedSeq = shouldAdvanceCommittedSeq ? committedSeq : currentCommittedSeq;
  const nextVersion = String(parseSeq(state.cursor.version) + 1n);

  for (const wake of state.wakes) {
    if (wake.wakeState === "poisoned") {
      continue;
    }

    if (parseSeq(wake.seq) <= nextCommittedSeq) {
      wake.wakeState = "completed";
      wake.updatedAt = new Date().toISOString();
    }
  }

  const now = new Date().toISOString();
  state.cursor = {
    committedSeq: String(nextCommittedSeq),
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
  };
}

export async function quarantineTestHostedWake(input: {
  body: HostedWakeQuarantineRequest;
  bucket: R2BucketLike;
  userId: string;
}): Promise<HostedWakeQuarantineResponse> {
  const state = await readStoredHostedWakeControlState(input.bucket, input.userId);
  const wake = state.wakes.find((candidate) => candidate.id === input.body.wakeId);

  if (!wake) {
    return { quarantined: false };
  }

  wake.wakeState = "poisoned";
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
    wake.wakeState !== "poisoned" && parseSeq(wake.seq) > committedSeq
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
