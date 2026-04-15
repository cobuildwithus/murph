import { randomBytes } from "node:crypto";

import {
  ExecutionOutboxStatus,
  Prisma,
  type ExecutionOutbox,
  type PrismaClient,
} from "@prisma/client";
import {
  HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
  HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATES,
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchResult,
  type HostedExecutionDispatchLifecycleState,
} from "@murphai/hosted-execution/contracts";
import {
  dispatchHostedExecutionStatus,
} from "./dispatch";
import { formatHostedExecutionSafeLogError } from "./logging";
import {
  areHostedExecutionOutboxPayloadsEquivalent,
  buildHostedExecutionDispatchRef,
  type HostedExecutionOutboxPayload,
  readHostedExecutionOutboxPayload,
  serializeHostedExecutionOutboxPayload,
  summarizeHostedExecutionOutboxPayload,
} from "./outbox-payload";
import { getPrisma } from "../prisma";

const CLAIM_LEASE_MS = 30_000;
const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 5 * 60_000;
const DEFAULT_DRAIN_LIMIT = 8;
const TERMINAL_OUTBOX_RETENTION_DAYS = 30;
const DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE: HostedExecutionDispatchLifecycleState = "queued";
const HOSTED_EXECUTION_EVENT_DISPATCH_STATE_SET = new Set<HostedExecutionDispatchLifecycleState>(
  HOSTED_EXECUTION_DISPATCH_LIFECYCLE_STATES,
);

type HostedExecutionOutboxClient = PrismaClient | Prisma.TransactionClient;

export interface EnqueueHostedExecutionOutboxInput {
  dispatch: HostedExecutionDispatchRequest;
  now?: string;
  sourceId?: string | null;
  sourceType: string;
  tx: HostedExecutionOutboxClient;
}

export interface EnqueueHostedExecutionOutboxPayloadInput {
  now?: string;
  payload: HostedExecutionOutboxPayload;
  sourceId?: string | null;
  sourceType: string;
  tx: HostedExecutionOutboxClient;
}

export async function enqueueHostedExecutionOutbox(
  input: EnqueueHostedExecutionOutboxInput,
): Promise<ExecutionOutbox> {
  const now = new Date(input.now ?? new Date().toISOString());
  const payloadJson = prepareHostedExecutionOutboxPayloadJson(input.dispatch);

  return upsertHostedExecutionOutboxRecord({
    dispatchRef: buildHostedExecutionDispatchRef(input.dispatch),
    now,
    payloadJson,
    sourceId: input.sourceId ?? null,
    sourceType: input.sourceType,
    tx: input.tx,
  });
}

export async function enqueueHostedExecutionOutboxPayload(
  input: EnqueueHostedExecutionOutboxPayloadInput,
): Promise<ExecutionOutbox> {
  const now = new Date(input.now ?? new Date().toISOString());
  const payload = input.payload;
  const payloadJson = serializeExistingHostedExecutionOutboxPayload(payload);

  return upsertHostedExecutionOutboxRecord({
    dispatchRef: buildHostedExecutionDispatchRef(payload.dispatch),
    now,
    payloadJson,
    sourceId: input.sourceId ?? null,
    sourceType: input.sourceType,
    tx: input.tx,
  });
}

function serializeExistingHostedExecutionOutboxPayload(
  payload: HostedExecutionOutboxPayload,
): Prisma.InputJsonObject {
  return serializeHostedExecutionOutboxPayload(payload.dispatch, {
    storage: "inline",
  });
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

    drained.push(await processHostedExecutionOutboxRecord(prisma, claimed, nowIso));
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
      formatHostedExecutionSafeLogError(error),
    );
  }
}

export async function pruneHostedExecutionOutbox(input: {
  now?: string;
  prisma?: PrismaClient;
} = {}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const now = new Date(input.now ?? new Date().toISOString());
  const cutoff = new Date(
    now.getTime() - (TERMINAL_OUTBOX_RETENTION_DAYS * 24 * 60 * 60_000),
  );
  const deleted = await prisma.executionOutbox.deleteMany({
    where: buildPrunableOutboxWhere(cutoff),
  });

  return deleted.count;
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
          in: [ExecutionOutboxStatus.queued, ExecutionOutboxStatus.delivery_failed],
        },
        nextAttemptAt: {
          lte: now,
        },
        claimExpiresAt: null,
      },
      {
        status: {
          in: [ExecutionOutboxStatus.queued, ExecutionOutboxStatus.delivery_failed],
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

function buildPrunableOutboxWhere(
  cutoff: Date,
): Prisma.ExecutionOutboxWhereInput {
  return {
    updatedAt: {
      lt: cutoff,
    },
    OR: [
      {
        status: ExecutionOutboxStatus.dispatched,
        dispatchState: {
          in: ["completed", "poisoned"],
        },
      },
      {
        status: ExecutionOutboxStatus.delivery_failed,
        nextAttemptAt: null,
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

  try {
    if (!payload) {
      throw createHostedExecutionOutboxPayloadError(record.eventId);
    }

    if (payload.storage !== "inline") {
      throw createHostedExecutionReferencePayloadUnsupportedError(record.eventId);
    }

    persistedPayloadJson = record.payloadJson as Prisma.InputJsonValue;
    const dispatchResult = await dispatchHostedExecutionStatus(payload.dispatch);
    const delivery = resolveHostedExecutionOutboxLifecycleOutcome(dispatchResult);
    const nextAttemptAt = delivery.retryable
      ? new Date(Date.parse(nowIso) + computeRetryDelayMs(record.attemptCount))
      : null;
    const nextRecord = await finalizeHostedExecutionOutboxAttempt(prisma, record, {
      dispatchState: delivery.dispatchState,
      lastError: delivery.lastError,
      nextAttemptAt,
      payloadJson: resolveHostedExecutionPersistedPayloadJson({
        nextAttemptAt,
        payload,
        payloadJson: persistedPayloadJson,
        status: delivery.status,
      }),
      status: delivery.status,
    });
    return nextRecord;
  } catch (error) {
    const permanentPayloadFailure = isPermanentHostedExecutionOutboxError(error);
    const nextAttemptAt = permanentPayloadFailure
      ? null
      : new Date(Date.parse(nowIso) + computeRetryDelayMs(record.attemptCount));
    const nextRecord = await finalizeHostedExecutionOutboxAttempt(prisma, record, {
      dispatchState: readHostedExecutionEventDispatchState(record.dispatchState),
      lastError: formatHostedExecutionSafeLogError(error),
      nextAttemptAt,
      payloadJson: resolveHostedExecutionPersistedPayloadJson({
        nextAttemptAt,
        payload,
        payloadJson: persistedPayloadJson,
        status: ExecutionOutboxStatus.delivery_failed,
      }),
      status: ExecutionOutboxStatus.delivery_failed,
    });
    return nextRecord;
  }
}

async function finalizeHostedExecutionOutboxAttempt(
  prisma: PrismaClient,
  record: ExecutionOutbox & { claimToken: string },
  input: {
    dispatchState: HostedExecutionDispatchLifecycleState;
    lastError: string | null;
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
      dispatchState: input.dispatchState,
      status: input.status,
      lastError: input.lastError,
      nextAttemptAt: input.nextAttemptAt,
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

async function upsertHostedExecutionOutboxRecord(input: {
  dispatchRef: {
    eventId: string;
    eventKind: string;
    userId: string;
  };
  now: Date;
  payloadJson: Prisma.InputJsonObject;
  sourceId: string | null;
  sourceType: string;
  tx: HostedExecutionOutboxClient;
}): Promise<ExecutionOutbox> {
  const record = await input.tx.executionOutbox.upsert({
    where: {
      eventId: input.dispatchRef.eventId,
    },
    update: {},
    create: {
      id: generateExecutionOutboxId(),
      userId: input.dispatchRef.userId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventId: input.dispatchRef.eventId,
      eventKind: input.dispatchRef.eventKind,
      payloadJson: input.payloadJson,
      dispatchState: DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE,
      status: ExecutionOutboxStatus.queued,
      nextAttemptAt: input.now,
    },
  });

  assertHostedExecutionOutboxRecordMatches(record, {
    eventId: input.dispatchRef.eventId,
    eventKind: input.dispatchRef.eventKind,
    payloadJson: input.payloadJson,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    userId: input.dispatchRef.userId,
  });

  return record;
}

function prepareHostedExecutionOutboxPayloadJson(
  dispatch: HostedExecutionDispatchRequest,
): Prisma.InputJsonObject {
  // The web-owned outbox row is the canonical dispatch owner for direct enqueue paths.
  // Direct enqueue stays inline here so the web tier no longer stages payload bodies in
  // Cloudflare-controlled storage before dispatch.
  return serializeHostedExecutionOutboxPayload(dispatch, { storage: "inline" });
}

function resolveHostedExecutionPersistedPayloadJson(input: {
  nextAttemptAt: Date | null;
  payload: HostedExecutionOutboxPayload | null;
  payloadJson: Prisma.InputJsonValue;
  status: ExecutionOutboxStatus;
}): Prisma.InputJsonValue {
  if (!input.payload || !shouldPruneHostedExecutionOutboxPayload(input)) {
    return input.payloadJson;
  }

  return summarizeHostedExecutionOutboxPayload(input.payload) ?? input.payloadJson;
}

function shouldPruneHostedExecutionOutboxPayload(input: {
  nextAttemptAt: Date | null;
  status: ExecutionOutboxStatus;
}): boolean {
  return input.status === ExecutionOutboxStatus.dispatched
    || (input.status === ExecutionOutboxStatus.delivery_failed && input.nextAttemptAt === null);
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
      record.payloadJson,
      expected.payloadJson,
    )
  ) {
    throw new Error(
      `Hosted execution outbox event ${expected.eventId} already exists with conflicting metadata.`,
    );
  }
}

function normalizeHostedExecutionOutboxLastError(lastError: string | null): string | null {
  return lastError === null ? null : formatHostedExecutionSafeLogError(lastError);
}

function resolveHostedExecutionOutboxLifecycleOutcome(
  dispatchResult: HostedExecutionDispatchResult,
): {
  dispatchState: HostedExecutionDispatchLifecycleState;
  lastError: string | null;
  retryable: boolean;
  status: ExecutionOutboxStatus;
} {
  if (dispatchResult.status.lastError === HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR) {
    return {
      dispatchState: DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE,
      lastError: normalizeHostedExecutionOutboxLastError(dispatchResult.status.lastError),
      retryable: true,
      status: ExecutionOutboxStatus.delivery_failed,
    };
  }

  switch (dispatchResult.event.state) {
    case "backpressured":
      return {
        dispatchState: dispatchResult.event.state,
        lastError: normalizeHostedExecutionOutboxLastError(
          dispatchResult.event.lastError
          ?? dispatchResult.status.lastError
          ?? "Hosted execution user queue is backpressured.",
        ),
        retryable: true,
        status: ExecutionOutboxStatus.delivery_failed,
      };
    case "queued":
      return {
        dispatchState: dispatchResult.event.state,
        lastError: null,
        retryable: false,
        status: ExecutionOutboxStatus.dispatched,
      };
    case "completed":
    case "poisoned":
      return {
        dispatchState: dispatchResult.event.state,
        lastError: null,
        retryable: false,
        status: ExecutionOutboxStatus.dispatched,
      };
    default:
      return dispatchResult.event.state satisfies never;
  }
}

function computeRetryDelayMs(attemptCount: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attemptCount - 1)));
}

function readHostedExecutionEventDispatchState(
  value: string | null | undefined,
): HostedExecutionDispatchLifecycleState {
  if (
    value
    && HOSTED_EXECUTION_EVENT_DISPATCH_STATE_SET.has(value as HostedExecutionDispatchLifecycleState)
  ) {
    return value as HostedExecutionDispatchLifecycleState;
  }

  return DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE;
}

function isHostedExecutionEventDispatchTerminal(
  state: HostedExecutionDispatchLifecycleState,
): boolean {
  return state === "completed"
    || state === "poisoned";
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
  error.code = "HOSTED_EXECUTION_OUTBOX_PAYLOAD_MISSING";
  error.permanent = true;
  error.retryable = false;
  return error;
}

function createHostedExecutionReferencePayloadUnsupportedError(eventId: string): Error & {
  code: string;
  permanent: true;
  retryable: false;
} {
  const error = new Error(
    `Hosted execution outbox record ${eventId} still references staged payload storage, which is no longer supported.`,
  ) as Error & {
    code: string;
    permanent: true;
    retryable: false;
  };
  error.code = "HOSTED_EXECUTION_OUTBOX_REFERENCE_PAYLOAD_UNSUPPORTED";
  error.permanent = true;
  error.retryable = false;
  return error;
}

function isPermanentHostedExecutionOutboxError(
  error: unknown,
): error is Error & { permanent: true; retryable: false } {
  return Boolean(
    error
      && typeof error === "object"
      && "permanent" in error
      && (error as { permanent?: unknown }).permanent === true,
  );
}

function generateExecutionOutboxId(): string {
  return `execout_${randomBytes(10).toString("hex")}`;
}

function clonePrismaInputJsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
