import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  ExecutionOutboxStatus,
  Prisma,
  type ExecutionOutbox,
  type PrismaClient,
} from "@prisma/client";
import {
  type HostedExecutionOutboxPayload,
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchResult,
  type HostedExecutionOutboxPayloadStorage,
  resolveHostedExecutionOutboxPayloadStorage,
  resolveHostedExecutionDispatchLifecycle,
} from "@murphai/hosted-execution";

import { finalizeHostedShareAcceptance } from "../hosted-share/shared";
import { getPrisma } from "../prisma";
import {
  deleteHostedSharePackFromHostedExecution,
  deleteHostedStoredDispatchPayloadBestEffort,
  maybeStageHostedExecutionDispatchPayload,
} from "./control";
import {
  dispatchHostedExecutionStatus,
  dispatchStoredHostedExecutionStatus,
} from "./dispatch";
import {
  hydrateHostedExecutionDispatch,
  isPermanentHostedExecutionHydrationError,
} from "./hydration";
import {
  readHostedExecutionOutboxPayload,
  serializeHostedExecutionOutboxPayload,
} from "./outbox-payload";

const CLAIM_LEASE_MS = 30_000;
const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 5 * 60_000;
const STATUS_REFRESH_DELAY_MS = 5_000;
const DEFAULT_DRAIN_LIMIT = 8;

type HostedExecutionOutboxClient = PrismaClient | Prisma.TransactionClient;

export interface EnqueueHostedExecutionOutboxInput {
  dispatch: HostedExecutionDispatchRequest;
  now?: string;
  sourceId?: string | null;
  sourceType: string;
  storage?: HostedExecutionOutboxPayloadStorage | "auto";
  tx: HostedExecutionOutboxClient;
}

export async function enqueueHostedExecutionOutbox(
  input: EnqueueHostedExecutionOutboxInput,
): Promise<ExecutionOutbox> {
  const now = new Date(input.now ?? new Date().toISOString());
  const payloadJson = await prepareHostedExecutionOutboxPayloadJson(input.dispatch, {
    storage: input.storage ?? "auto",
  });
  let record: ExecutionOutbox | null = null;

  try {
    record = await input.tx.executionOutbox.upsert({
      where: {
        eventId: input.dispatch.eventId,
      },
      update: {},
      create: {
        id: generateExecutionOutboxId(),
        userId: input.dispatch.event.userId,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        eventId: input.dispatch.eventId,
        eventKind: input.dispatch.event.kind,
        payloadJson,
        status: ExecutionOutboxStatus.pending,
        nextAttemptAt: now,
      },
    });

    assertHostedExecutionOutboxRecordMatches(record, {
      eventId: input.dispatch.eventId,
      eventKind: input.dispatch.event.kind,
      payloadJson,
      sourceId: input.sourceId ?? null,
      sourceType: input.sourceType,
      userId: input.dispatch.event.userId,
    });

    return record;
  } finally {
    await cleanupHostedExecutionUnpersistedStagedPayloadIfNeeded(record?.payloadJson ?? null, payloadJson);
  }
}

export async function drainHostedExecutionOutbox(input: {
  eventIds?: readonly string[];
  limit?: number;
  now?: string;
  prisma?: PrismaClient;
} = {}): Promise<ExecutionOutbox[]> {
  const prisma = input.prisma ?? getPrisma();
  const nowIso = input.now ?? new Date().toISOString();
  const now = new Date(nowIso);
  const candidates = await prisma.executionOutbox.findMany({
    where: buildDueOutboxWhere(now, input.eventIds ?? null),
    orderBy: [
      {
        nextAttemptAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    take: Math.max(1, input.limit ?? (input.eventIds?.length ?? DEFAULT_DRAIN_LIMIT)),
  });
  const drained: ExecutionOutbox[] = [];

  for (const candidate of candidates) {
    const claimed = await claimHostedExecutionOutboxRecord(prisma, candidate, nowIso);

    if (!claimed) {
      continue;
    }

    const nextRecord = await processHostedExecutionOutboxRecord(prisma, claimed, nowIso);
    drained.push(nextRecord);
  }

  return drained;
}

export async function drainHostedExecutionOutboxBestEffort(input: {
  eventIds?: readonly string[];
  limit?: number;
  now?: string;
  prisma?: PrismaClient;
} = {}): Promise<void> {
  try {
    await drainHostedExecutionOutbox(input);
  } catch (error) {
    console.error(
      "Hosted execution outbox best-effort drain failed.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function buildDueOutboxWhere(
  now: Date,
  eventIds: readonly string[] | null,
): Prisma.ExecutionOutboxWhereInput {
  return {
    ...(eventIds && eventIds.length > 0
      ? {
          eventId: {
            in: [...eventIds],
          },
        }
      : {}),
    OR: [
      {
        status: {
          in: [ExecutionOutboxStatus.pending, ExecutionOutboxStatus.accepted],
        },
        nextAttemptAt: {
          lte: now,
        },
        claimExpiresAt: null,
      },
      {
        status: {
          in: [ExecutionOutboxStatus.pending, ExecutionOutboxStatus.accepted],
        },
        nextAttemptAt: {
          lte: now,
        },
        claimExpiresAt: {
          lt: now,
        },
      },
      {
        status: ExecutionOutboxStatus.dispatching,
        claimExpiresAt: {
          lt: now,
        },
      },
    ],
  };
}

async function claimHostedExecutionOutboxRecord(
  prisma: PrismaClient,
  record: ExecutionOutbox,
  nowIso: string,
): Promise<(ExecutionOutbox & { claimToken: string }) | null> {
  const now = new Date(nowIso);
  const claimToken = randomBytes(16).toString("hex");
  const claimExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
  const claimed = await prisma.executionOutbox.updateMany({
    where: {
      id: record.id,
      status: record.status,
      ...(record.status === ExecutionOutboxStatus.dispatching
        ? {
            claimExpiresAt: {
              lt: now,
            },
          }
        : {
            nextAttemptAt: {
              lte: now,
            },
            OR: [
              {
                claimExpiresAt: null,
              },
              {
                claimExpiresAt: {
                  lt: now,
                },
              },
            ],
          }),
    },
    data: {
      status: ExecutionOutboxStatus.dispatching,
      attemptCount: {
        increment: 1,
      },
      lastAttemptAt: now,
      claimToken,
      claimExpiresAt,
      lastError: null,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return {
    ...record,
    status: ExecutionOutboxStatus.dispatching,
    attemptCount: record.attemptCount + 1,
    lastAttemptAt: now,
    claimToken,
    claimExpiresAt,
    lastError: null,
  };
}

async function processHostedExecutionOutboxRecord(
  prisma: PrismaClient,
  record: ExecutionOutbox & { claimToken: string },
  nowIso: string,
): Promise<ExecutionOutbox> {
  let payload = readHostedExecutionOutboxPayload(record.payloadJson);
  let persistedPayloadJson = record.payloadJson as Prisma.InputJsonValue;
  let cleanupPayload: HostedExecutionOutboxPayload | null = payload;

  try {
    if (!payload) {
      throw createHostedExecutionOutboxPayloadError(record.eventId);
    }

    const preparedDispatch = await prepareHostedExecutionDispatchAttempt(record, prisma, payload);
    payload = preparedDispatch.payload;
    cleanupPayload = preparedDispatch.payload;
    persistedPayloadJson = preparedDispatch.payloadJson;

    const dispatchResult = preparedDispatch.dispatchMode === "stored"
      ? await dispatchStoredHostedExecutionStatus(preparedDispatch.payload)
      : await dispatchHostedExecutionStatus(preparedDispatch.dispatch);
    const lifecycle = resolveHostedExecutionLifecycle({
      dispatchResult,
    });
    await finalizeHostedExecutionSourceIfNeeded({
      lifecycle,
      prisma,
      record,
    });
    const updatedRecord = await finalizeHostedExecutionOutboxAttempt(prisma, record, {
      acceptedAt:
        lifecycle.status === ExecutionOutboxStatus.pending
          ? record.acceptedAt
          : (record.acceptedAt ?? new Date(nowIso)),
      completedAt: lifecycle.status === ExecutionOutboxStatus.completed ? new Date(nowIso) : null,
      failedAt: lifecycle.status === ExecutionOutboxStatus.failed ? new Date(nowIso) : null,
      lastError: lifecycle.lastError,
      lastStatusJson: dispatchResult as unknown as Prisma.InputJsonValue,
      nextAttemptAt:
        lifecycle.status === ExecutionOutboxStatus.completed || lifecycle.status === ExecutionOutboxStatus.failed
          ? null
          : new Date(
              Date.parse(nowIso)
                + (lifecycle.status === ExecutionOutboxStatus.accepted
                  ? STATUS_REFRESH_DELAY_MS
                  : computeRetryDelayMs(record.attemptCount)),
            ),
      payloadJson: persistedPayloadJson,
      status: lifecycle.status,
    });
    await cleanupHostedExecutionSourceIfNeeded({
      lifecycle,
      record: updatedRecord,
    });
    await cleanupHostedExecutionOutboxPayloadIfTerminal(updatedRecord, cleanupPayload);

    return updatedRecord;
  } catch (error) {
    const permanentHydrationFailure = isPermanentHostedExecutionHydrationError(error);
    const nextRecord = await finalizeHostedExecutionOutboxAttempt(prisma, record, {
      acceptedAt: record.acceptedAt,
      completedAt: null,
      failedAt: permanentHydrationFailure ? new Date(nowIso) : null,
      lastError: error instanceof Error ? error.message : String(error),
      lastStatusJson: record.lastStatusJson as Prisma.InputJsonValue | null,
      nextAttemptAt: permanentHydrationFailure
        ? null
        : new Date(Date.parse(nowIso) + computeRetryDelayMs(record.attemptCount)),
      payloadJson: persistedPayloadJson,
      status: permanentHydrationFailure
        ? ExecutionOutboxStatus.failed
        : (record.acceptedAt ? ExecutionOutboxStatus.accepted : ExecutionOutboxStatus.pending),
    });
    await cleanupHostedExecutionOutboxPayloadIfTerminal(nextRecord, cleanupPayload);
    return nextRecord;
  }
}

async function prepareHostedExecutionDispatchAttempt(
  record: ExecutionOutbox,
  prisma: PrismaClient,
  payload: HostedExecutionOutboxPayload,
): Promise<
  | {
      dispatch: HostedExecutionDispatchRequest;
      dispatchMode: "direct";
      payload: HostedExecutionOutboxPayload;
      payloadJson: Prisma.InputJsonValue;
    }
  | {
      dispatchMode: "stored";
      payload: HostedExecutionOutboxPayload;
      payloadJson: Prisma.InputJsonValue;
    }
> {
  if (payload.storage === "inline") {
    return {
      dispatch: payload.dispatch,
      dispatchMode: "direct",
      payload,
      payloadJson: record.payloadJson as Prisma.InputJsonValue,
    };
  }

  if (payload.payloadRef) {
    return {
      dispatchMode: "stored",
      payload,
      payloadJson: record.payloadJson as Prisma.InputJsonValue,
    };
  }

  const hydratedDispatch = await hydrateHostedExecutionDispatch(record, prisma);
  const stagedPayload = await maybeStageHostedExecutionDispatchPayload(hydratedDispatch);

  if (stagedPayload && stagedPayload.storage === "reference" && stagedPayload.payloadRef) {
    return {
      dispatchMode: "stored",
      payload: stagedPayload,
      payloadJson: stagedPayload as unknown as Prisma.InputJsonObject,
    };
  }

  return {
    dispatch: hydratedDispatch,
    dispatchMode: "direct",
    payload,
    payloadJson: record.payloadJson as Prisma.InputJsonValue,
  };
}

async function cleanupHostedExecutionOutboxPayloadIfTerminal(
  record: ExecutionOutbox,
  payload: HostedExecutionOutboxPayload | null,
): Promise<void> {
  if (!payload || !isHostedExecutionTerminalStatus(record.status)) {
    return;
  }

  if (payload.storage !== "reference" || !payload.payloadRef) {
    return;
  }

  await deleteHostedStoredDispatchPayloadBestEffort(payload);
}

async function cleanupHostedExecutionUnpersistedStagedPayloadIfNeeded(
  persistedPayloadJson: Prisma.JsonValue | null,
  requestedPayloadJson: Prisma.InputJsonValue,
): Promise<void> {
  const requestedPayload = readHostedExecutionOutboxPayload(requestedPayloadJson);

  if (
    !requestedPayload
    || requestedPayload.storage !== "reference"
    || !requestedPayload.payloadRef
  ) {
    return;
  }

  const persistedPayload = readHostedExecutionOutboxPayload(persistedPayloadJson);

  if (
    persistedPayload?.storage === "reference"
    && persistedPayload.payloadRef?.key === requestedPayload.payloadRef.key
  ) {
    return;
  }

  await deleteHostedStoredDispatchPayloadBestEffort(requestedPayload);
}

async function finalizeHostedExecutionOutboxAttempt(
  prisma: PrismaClient,
  record: ExecutionOutbox & { claimToken: string },
  input: {
    acceptedAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    lastError: string | null;
    lastStatusJson: Prisma.InputJsonValue | null;
    nextAttemptAt: Date | null;
    payloadJson: Prisma.InputJsonValue;
    status: ExecutionOutboxStatus;
  },
): Promise<ExecutionOutbox> {
  const updated = await prisma.executionOutbox.updateMany({
    where: {
      id: record.id,
      claimToken: record.claimToken,
    },
    data: {
      status: input.status,
      acceptedAt: input.acceptedAt,
      completedAt: input.completedAt,
      failedAt: input.failedAt,
      lastError: input.lastError,
      lastStatusJson: input.lastStatusJson ?? Prisma.JsonNull,
      nextAttemptAt: input.nextAttemptAt ?? record.nextAttemptAt,
      payloadJson: input.payloadJson,
      claimToken: null,
      claimExpiresAt: null,
    },
  });

  if (updated.count !== 1) {
    const latest = await prisma.executionOutbox.findUnique({
      where: {
        eventId: record.eventId,
      },
    });

    if (latest) {
      return latest;
    }

    throw new Error(`Hosted execution outbox record disappeared: ${record.eventId}`);
  }

  const latest = await prisma.executionOutbox.findUnique({
    where: {
      eventId: record.eventId,
    },
  });

  if (!latest) {
    throw new Error(`Hosted execution outbox record disappeared: ${record.eventId}`);
  }

  return latest;
}

async function prepareHostedExecutionOutboxPayloadJson(
  dispatch: HostedExecutionDispatchRequest,
  options: {
    storage: HostedExecutionOutboxPayloadStorage | "auto";
  },
): Promise<Prisma.InputJsonObject> {
  const storage = resolveHostedExecutionOutboxPayloadStorage(dispatch, options.storage);

  if (storage === "inline") {
    return serializeHostedExecutionOutboxPayload(dispatch, { storage });
  }

  const stagedPayload = await maybeStageHostedExecutionDispatchPayload(dispatch);

  if (stagedPayload) {
    return stagedPayload as unknown as Prisma.InputJsonObject;
  }

  return serializeHostedExecutionOutboxPayload(dispatch, { storage });
}

function assertHostedExecutionOutboxRecordMatches(
  record: Pick<
    ExecutionOutbox,
    "eventId" | "eventKind" | "payloadJson" | "sourceId" | "sourceType" | "userId"
  >,
  expected: {
    eventId: string;
    eventKind: string;
    payloadJson: Prisma.InputJsonValue;
    sourceId: string | null;
    sourceType: string;
    userId: string;
  },
): void {
  if (
    record.eventId !== expected.eventId
    || record.eventKind !== expected.eventKind
    || record.sourceId !== expected.sourceId
    || record.sourceType !== expected.sourceType
    || record.userId !== expected.userId
    || !areHostedExecutionOutboxPayloadsEquivalent(
      readHostedExecutionOutboxPayload(record.payloadJson),
      readHostedExecutionOutboxPayload(expected.payloadJson),
    )
  ) {
    throw new Error(
      `Hosted execution outbox event ${expected.eventId} already exists with conflicting metadata.`,
    );
  }
}

function areHostedExecutionOutboxPayloadsEquivalent(
  left: HostedExecutionOutboxPayload | null,
  right: HostedExecutionOutboxPayload | null,
): boolean {
  if (!left || !right || left.storage !== right.storage) {
    return false;
  }

  if (left.storage === "inline" && right.storage === "inline") {
    return isDeepStrictEqual(left.dispatch, right.dispatch);
  }

  if (left.storage === "reference" && right.storage === "reference") {
    if (!isDeepStrictEqual(left.dispatchRef, right.dispatchRef)) {
      return false;
    }

    return areHostedExecutionDispatchPayloadRefsEquivalent(left.payloadRef ?? null, right.payloadRef ?? null);
  }

  return false;
}

function areHostedExecutionDispatchPayloadRefsEquivalent(
  left: { key: string } | null,
  right: { key: string } | null,
): boolean {
  if (!left || !right) {
    return true;
  }

  return left.key === right.key;
}

function resolveHostedExecutionLifecycle(input: {
  dispatchResult: HostedExecutionDispatchResult;
}): {
  lastError: string | null;
  status: ExecutionOutboxStatus;
} {
  const lifecycle = resolveHostedExecutionDispatchLifecycle(input.dispatchResult);

  return {
    lastError: lifecycle.lastError,
    status: mapHostedExecutionLifecycleStatus(lifecycle.status),
  };
}

async function finalizeHostedExecutionSourceIfNeeded(input: {
  lifecycle: {
    lastError: string | null;
    status: ExecutionOutboxStatus;
  };
  prisma: PrismaClient;
  record: ExecutionOutbox;
}): Promise<void> {
  if (
    input.record.sourceType !== "hosted_share_link"
    || input.lifecycle.status !== ExecutionOutboxStatus.completed
    || !input.record.sourceId
  ) {
    return;
  }

  await finalizeHostedShareAcceptance({
    eventId: input.record.eventId,
    memberId: input.record.userId,
    prisma: input.prisma,
    shareId: input.record.sourceId,
  });
}

async function cleanupHostedExecutionSourceIfNeeded(input: {
  lifecycle: {
    lastError: string | null;
    status: ExecutionOutboxStatus;
  };
  record: ExecutionOutbox;
}): Promise<void> {
  if (
    input.record.sourceType !== "hosted_share_link"
    || input.lifecycle.status !== ExecutionOutboxStatus.completed
    || !input.record.sourceId
  ) {
    return;
  }

  try {
    await deleteHostedSharePackFromHostedExecution(input.record.sourceId);
  } catch (error) {
    console.error(
      `Hosted share ${input.record.sourceId} completed but its Cloudflare pack could not be deleted.`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function computeRetryDelayMs(attemptCount: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attemptCount - 1)));
}

function mapHostedExecutionLifecycleStatus(
  status: "accepted" | "completed" | "failed" | "pending",
): ExecutionOutboxStatus {
  switch (status) {
    case "accepted":
      return ExecutionOutboxStatus.accepted;
    case "completed":
      return ExecutionOutboxStatus.completed;
    case "failed":
      return ExecutionOutboxStatus.failed;
    case "pending":
      return ExecutionOutboxStatus.pending;
    default:
      return status satisfies never;
  }
}

function isHostedExecutionTerminalStatus(status: ExecutionOutboxStatus): boolean {
  return status === ExecutionOutboxStatus.completed || status === ExecutionOutboxStatus.failed;
}

function createHostedExecutionOutboxPayloadError(eventId: string): Error & {
  code: string;
  permanent: true;
  retryable: false;
} {
  const error = new Error(
    `Hosted execution outbox record ${eventId} is missing a dispatch payload.`,
  ) as Error & {
    code: string;
    permanent: true;
    retryable: false;
  };
  error.code = "HOSTED_EXECUTION_HYDRATION_PAYLOAD_MISSING";
  error.permanent = true;
  error.retryable = false;
  return error;
}

function generateExecutionOutboxId(): string {
  return `execout_${randomBytes(10).toString("hex")}`;
}
