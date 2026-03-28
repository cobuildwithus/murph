import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  ExecutionOutboxStatus,
  Prisma,
  type ExecutionOutbox,
  type PrismaClient,
} from "@prisma/client";
import {
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchResult,
  resolveHostedExecutionDispatchLifecycle,
} from "@murph/hosted-execution";

import { finalizeHostedShareAcceptance } from "../hosted-share/shared";
import { getPrisma } from "../prisma";
import { dispatchHostedExecutionStatus } from "./dispatch";
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
  tx: HostedExecutionOutboxClient;
}

export async function enqueueHostedExecutionOutbox(
  input: EnqueueHostedExecutionOutboxInput,
): Promise<ExecutionOutbox> {
  const now = new Date(input.now ?? new Date().toISOString());
  const payloadJson = serializeHostedExecutionOutboxPayload(input.dispatch);

  const record = await input.tx.executionOutbox.upsert({
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
  let dispatch: HostedExecutionDispatchRequest | null = null;

  try {
    dispatch = await readHostedExecutionDispatch(record, prisma);
    const dispatchResult = await dispatchHostedExecutionStatus(dispatch);
    const lifecycle = resolveHostedExecutionLifecycle({
      dispatchResult,
    });
    await finalizeHostedExecutionSourceIfNeeded({
      dispatch,
      lifecycle,
      prisma,
      record,
    });

    return finalizeHostedExecutionOutboxAttempt(prisma, record, {
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
      payloadJson: serializeHostedExecutionOutboxPayload(dispatch),
      status: lifecycle.status,
    });
  } catch (error) {
    const permanentHydrationFailure = isPermanentHostedExecutionHydrationError(error);
    return finalizeHostedExecutionOutboxAttempt(prisma, record, {
      acceptedAt: record.acceptedAt,
      completedAt: null,
      failedAt: permanentHydrationFailure ? new Date(nowIso) : null,
      lastError: error instanceof Error ? error.message : String(error),
      lastStatusJson: record.lastStatusJson as Prisma.InputJsonValue | null,
      nextAttemptAt: permanentHydrationFailure
        ? null
        : new Date(Date.parse(nowIso) + computeRetryDelayMs(record.attemptCount)),
      payloadJson: dispatch
        ? serializeHostedExecutionOutboxPayload(dispatch)
        : (record.payloadJson as Prisma.InputJsonValue),
      status: permanentHydrationFailure
        ? ExecutionOutboxStatus.failed
        : (record.acceptedAt ? ExecutionOutboxStatus.accepted : ExecutionOutboxStatus.pending),
    });
  }
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

function readHostedExecutionDispatch(
  record: ExecutionOutbox,
  prisma: PrismaClient,
): Promise<HostedExecutionDispatchRequest> {
  return hydrateHostedExecutionDispatch(record, prisma);
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
    || !isDeepStrictEqual(
      readHostedExecutionOutboxPayload(record.payloadJson, {
        eventId: record.eventId,
        eventKind: record.eventKind,
        occurredAt: null,
        userId: record.userId,
      }),
      readHostedExecutionOutboxPayload(expected.payloadJson, {
        eventId: expected.eventId,
        eventKind: expected.eventKind,
        occurredAt: null,
        userId: expected.userId,
      }),
    )
  ) {
    throw new Error(
      `Hosted execution outbox event ${expected.eventId} already exists with conflicting metadata.`,
    );
  }
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
  dispatch: HostedExecutionDispatchRequest;
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
    || input.dispatch.event.kind !== "vault.share.accepted"
  ) {
    return;
  }

  await finalizeHostedShareAcceptance({
    eventId: input.record.eventId,
    memberId: input.record.userId,
    prisma: input.prisma,
    shareCode: input.dispatch.event.share.shareCode,
  });
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

function generateExecutionOutboxId(): string {
  return `execout_${randomBytes(10).toString("hex")}`;
}
