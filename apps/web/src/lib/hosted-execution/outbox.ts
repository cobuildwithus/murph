import { randomBytes } from "node:crypto";

import {
  ExecutionOutboxStatus,
  Prisma,
  type ExecutionOutbox,
  type PrismaClient,
} from "@prisma/client";
import {
  type HostedExecutionDispatchRequest,
  type HostedExecutionUserStatus,
} from "@healthybob/hosted-execution";

import { getPrisma } from "../prisma";
import { dispatchHostedExecutionStatus } from "./dispatch";
import { hydrateHostedExecutionDispatch } from "./hydration";
import {
  readLegacyHostedExecutionDispatch,
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

  return input.tx.executionOutbox.upsert({
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
      payloadJson: serializeHostedExecutionOutboxPayload(input.dispatch),
      status: ExecutionOutboxStatus.pending,
      nextAttemptAt: now,
    },
  });
}

export async function findHostedExecutionOutboxByEventId(
  eventId: string,
  prisma: HostedExecutionOutboxClient = getPrisma(),
): Promise<ExecutionOutbox | null> {
  return prisma.executionOutbox.findUnique({
    where: {
      eventId,
    },
  });
}

export function readHostedExecutionOutboxOutcome(
  record: ExecutionOutbox | null,
): "completed" | "failed" | "pending" {
  switch (record?.status) {
    case ExecutionOutboxStatus.completed:
      return "completed";
    case ExecutionOutboxStatus.failed:
      return "failed";
    default:
      return "pending";
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
  context?: string;
  eventIds?: readonly string[];
  limit?: number;
  now?: string;
  prisma?: PrismaClient;
} = {}): Promise<void> {
  try {
    await drainHostedExecutionOutbox(input);
  } catch (error) {
    console.error(
      input.context
        ? `Hosted execution outbox drain failed (${input.context}).`
        : "Hosted execution outbox drain failed.",
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
  let dispatch: HostedExecutionDispatchRequest | null = null;

  try {
    dispatch = await readHostedExecutionDispatch(record, prisma);
    const status = await dispatchHostedExecutionStatus(dispatch);
    const lifecycle = resolveHostedExecutionLifecycle({
      eventId: record.eventId,
      status,
    });

    return finalizeHostedExecutionOutboxAttempt(prisma, record, {
      acceptedAt:
        lifecycle.status === ExecutionOutboxStatus.pending
          ? record.acceptedAt
          : (record.acceptedAt ?? new Date(nowIso)),
      completedAt: lifecycle.status === ExecutionOutboxStatus.completed ? new Date(nowIso) : null,
      failedAt: lifecycle.status === ExecutionOutboxStatus.failed ? new Date(nowIso) : null,
      lastError: lifecycle.lastError,
      lastStatusJson: status as unknown as Prisma.InputJsonValue,
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
    return finalizeHostedExecutionOutboxAttempt(prisma, record, {
      acceptedAt: record.acceptedAt,
      completedAt: null,
      failedAt: null,
      lastError: error instanceof Error ? error.message : String(error),
      lastStatusJson: record.lastStatusJson as Prisma.InputJsonValue | null,
      nextAttemptAt: new Date(Date.parse(nowIso) + computeRetryDelayMs(record.attemptCount)),
      payloadJson: dispatch
        ? serializeHostedExecutionOutboxPayload(dispatch)
        : (record.payloadJson as Prisma.InputJsonValue),
      status: record.acceptedAt ? ExecutionOutboxStatus.accepted : ExecutionOutboxStatus.pending,
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
  const legacyDispatch = readLegacyHostedExecutionDispatch(record.payloadJson);

  if (legacyDispatch) {
    return Promise.resolve(legacyDispatch);
  }

  return hydrateHostedExecutionDispatch(record, prisma);
}

function resolveHostedExecutionLifecycle(input: {
  eventId: string;
  status: HostedExecutionUserStatus;
}): {
  lastError: string | null;
  status: ExecutionOutboxStatus;
} {
  if (input.status.poisonedEventIds.includes(input.eventId)) {
    return {
      lastError: input.status.lastError ?? "Hosted execution event was poisoned.",
      status: ExecutionOutboxStatus.failed,
    };
  }

  if (
    input.status.lastEventId === input.eventId
    && !input.status.lastError
    && !input.status.inFlight
    && input.status.pendingEventCount === 0
    && input.status.retryingEventId !== input.eventId
  ) {
    return {
      lastError: null,
      status: ExecutionOutboxStatus.completed,
    };
  }

  if (
    input.status.lastEventId === input.eventId
    || input.status.retryingEventId === input.eventId
    || input.status.backpressuredEventIds?.includes(input.eventId)
  ) {
    return {
      lastError: input.status.lastError,
      status: ExecutionOutboxStatus.accepted,
    };
  }

  if (input.status.lastError === "Hosted execution dispatch is not configured.") {
    return {
      lastError: input.status.lastError,
      status: ExecutionOutboxStatus.pending,
    };
  }

  return {
    lastError: input.status.lastError,
    status: ExecutionOutboxStatus.accepted,
  };
}

function computeRetryDelayMs(attemptCount: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attemptCount - 1)));
}

function generateExecutionOutboxId(): string {
  return `execout_${randomBytes(10).toString("hex")}`;
}
