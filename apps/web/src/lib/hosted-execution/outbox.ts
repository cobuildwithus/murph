import { randomBytes } from "node:crypto";

import {
  ExecutionOutboxStatus,
  Prisma,
  type ExecutionOutbox,
  type PrismaClient,
} from "@prisma/client";
import {
  HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
  HOSTED_EXECUTION_EVENT_DISPATCH_STATES,
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchResult,
  type HostedExecutionEventDispatchState,
} from "@murphai/hosted-execution/contracts";
import {
  resolveHostedExecutionOutboxPayloadStorage,
  type HostedExecutionOutboxPayloadStorage,
} from "@murphai/hosted-execution/outbox-payload";

import {
  deleteHostedStoredDispatchPayloadBestEffort,
  maybeStageHostedExecutionDispatchPayload,
} from "./control";
import {
  dispatchHostedExecutionStatus,
  dispatchStoredHostedExecutionStatus,
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
const DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE: HostedExecutionEventDispatchState = "queued";
const HOSTED_EXECUTION_EVENT_DISPATCH_STATE_SET = new Set<HostedExecutionEventDispatchState>(
  HOSTED_EXECUTION_EVENT_DISPATCH_STATES,
);

type HostedExecutionOutboxClient = PrismaClient | Prisma.TransactionClient;

export interface EnqueueHostedExecutionOutboxInput {
  dispatch: HostedExecutionDispatchRequest;
  now?: string;
  sourceId?: string | null;
  sourceType: string;
  storage?: HostedExecutionOutboxPayloadStorage | "auto";
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
  const payloadJson = await prepareHostedExecutionOutboxPayloadJson(input.dispatch, {
    storage: input.storage ?? "auto",
  });
  let record: ExecutionOutbox | null = null;

  try {
    record = await upsertHostedExecutionOutboxRecord({
      dispatchRef: buildHostedExecutionDispatchRef(input.dispatch),
      now,
      payloadJson,
      sourceId: input.sourceId ?? null,
      sourceType: input.sourceType,
      tx: input.tx,
    });

    return record;
  } finally {
    await cleanupHostedExecutionUnpersistedStagedPayloadIfNeeded(record?.payloadJson ?? null, payloadJson);
  }
}

export async function enqueueHostedExecutionOutboxPayload(
  input: EnqueueHostedExecutionOutboxPayloadInput,
): Promise<ExecutionOutbox> {
  const now = new Date(input.now ?? new Date().toISOString());
  const payload = input.payload;
  const payloadJson = serializeExistingHostedExecutionOutboxPayload(payload);

  const dispatchRef = payload.storage === "inline"
    ? buildHostedExecutionDispatchRef(payload.dispatch)
    : payload.dispatchRef;

  return upsertHostedExecutionOutboxRecord({
    dispatchRef,
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
  if (payload.storage === "inline") {
    return serializeHostedExecutionOutboxPayload(payload.dispatch, {
      storage: "inline",
    });
  }

  return clonePrismaInputJsonObject(payload);
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

    const preparedDispatch = await prepareHostedExecutionDispatchAttempt(record, payload);
    payload = preparedDispatch.payload;
    cleanupPayload = preparedDispatch.payload;
    persistedPayloadJson = preparedDispatch.payloadJson;

    const dispatchResult = preparedDispatch.dispatchMode === "stored"
      ? await dispatchStoredHostedExecutionStatus(preparedDispatch.payload)
      : await dispatchHostedExecutionStatus(preparedDispatch.dispatch);
    const delivery = resolveHostedExecutionDeliveryOutcome(dispatchResult);
    const nextAttemptAt = delivery.retryable
      ? new Date(Date.parse(nowIso) + computeRetryDelayMs(record.attemptCount))
      : null;
    const nextRecord = await finalizeHostedExecutionOutboxAttempt(prisma, record, {
      dispatchState: delivery.dispatchState,
      lastError: delivery.lastError,
      nextAttemptAt,
      payloadJson: resolveHostedExecutionPersistedPayloadJson({
        nextAttemptAt,
        payload: cleanupPayload,
        payloadJson: persistedPayloadJson,
        status: delivery.status,
      }),
      status: delivery.status,
    });
    await cleanupHostedExecutionOutboxPayloadIfSettled(
      nextRecord,
      cleanupPayload,
      delivery.deleteStoredPayload,
    );
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
        payload: cleanupPayload,
        payloadJson: persistedPayloadJson,
        status: ExecutionOutboxStatus.delivery_failed,
      }),
      status: ExecutionOutboxStatus.delivery_failed,
    });
    await cleanupHostedExecutionOutboxPayloadIfSettled(
      nextRecord,
      cleanupPayload,
      permanentPayloadFailure,
    );
    return nextRecord;
  }
}

async function prepareHostedExecutionDispatchAttempt(
  record: ExecutionOutbox,
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

  return {
    dispatchMode: "stored",
    payload,
    payloadJson: record.payloadJson as Prisma.InputJsonValue,
  };
}

async function cleanupHostedExecutionOutboxPayloadIfSettled(
  record: ExecutionOutbox,
  payload: HostedExecutionOutboxPayload | null,
  shouldDeleteStoredPayload: boolean,
): Promise<void> {
  if (!payload || !isHostedExecutionOutboxPayloadSettled(record) || !shouldDeleteStoredPayload) {
    return;
  }

  if (payload.storage !== "reference") {
    return;
  }

  await deleteHostedStoredDispatchPayloadBestEffort(payload);
}

async function cleanupHostedExecutionUnpersistedStagedPayloadIfNeeded(
  persistedPayloadJson: Prisma.JsonValue | null,
  requestedPayloadJson: Prisma.InputJsonValue,
): Promise<void> {
  const requestedPayload = readHostedExecutionOutboxPayload(requestedPayloadJson);

  if (!requestedPayload || requestedPayload.storage !== "reference") {
    return;
  }

  const persistedPayload = readHostedExecutionOutboxPayload(persistedPayloadJson);

  if (
    persistedPayload?.storage === "reference"
    && persistedPayload.stagedPayloadId === requestedPayload.stagedPayloadId
  ) {
    return;
  }

  await deleteHostedStoredDispatchPayloadBestEffort(requestedPayload);
}

async function finalizeHostedExecutionOutboxAttempt(
  prisma: PrismaClient,
  record: ExecutionOutbox & { claimToken: string },
  input: {
    dispatchState: HostedExecutionEventDispatchState;
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

  if (stagedPayload?.storage === "reference") {
    return serializeExistingHostedExecutionOutboxPayload(stagedPayload);
  }

  throw createHostedExecutionOutboxPayloadRefError(dispatch.eventId);
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

function resolveHostedExecutionDeliveryOutcome(
  dispatchResult: HostedExecutionDispatchResult,
): {
  dispatchState: HostedExecutionEventDispatchState;
  deleteStoredPayload: boolean;
  lastError: string | null;
  retryable: boolean;
  status: ExecutionOutboxStatus;
} {
  if (dispatchResult.status.lastError === HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR) {
    return {
      dispatchState: DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE,
      deleteStoredPayload: false,
      lastError: normalizeHostedExecutionOutboxLastError(dispatchResult.status.lastError),
      retryable: true,
      status: ExecutionOutboxStatus.delivery_failed,
    };
  }

  switch (dispatchResult.event.state) {
    case "backpressured":
      return {
        dispatchState: dispatchResult.event.state,
        deleteStoredPayload: false,
        lastError: normalizeHostedExecutionOutboxLastError(
          dispatchResult.event.lastError
          ?? dispatchResult.status.lastError
          ?? "Hosted execution user queue is backpressured.",
        ),
        retryable: true,
        status: ExecutionOutboxStatus.delivery_failed,
      };
    case "queued":
    case "duplicate_pending":
      return {
        dispatchState: dispatchResult.event.state,
        deleteStoredPayload: false,
        lastError: null,
        retryable: false,
        status: ExecutionOutboxStatus.dispatched,
      };
    case "duplicate_consumed":
    case "completed":
    case "poisoned":
      return {
        dispatchState: dispatchResult.event.state,
        deleteStoredPayload: true,
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

function isHostedExecutionOutboxPayloadSettled(
  record: Pick<ExecutionOutbox, "dispatchState" | "nextAttemptAt" | "status">,
): boolean {
  return isHostedExecutionEventDispatchTerminal(
    readHostedExecutionEventDispatchState(record.dispatchState),
  )
    || (record.status === ExecutionOutboxStatus.delivery_failed && record.nextAttemptAt === null);
}

function readHostedExecutionEventDispatchState(
  value: string | null | undefined,
): HostedExecutionEventDispatchState {
  if (
    value
    && HOSTED_EXECUTION_EVENT_DISPATCH_STATE_SET.has(value as HostedExecutionEventDispatchState)
  ) {
    return value as HostedExecutionEventDispatchState;
  }

  return DEFAULT_HOSTED_EXECUTION_EVENT_DISPATCH_STATE;
}

function isHostedExecutionEventDispatchTerminal(
  state: HostedExecutionEventDispatchState,
): boolean {
  return state === "duplicate_consumed"
    || state === "completed"
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

function createHostedExecutionOutboxPayloadRefError(eventId: string): Error & {
  code: string;
  permanent: true;
  retryable: false;
} {
  const error = new Error(
    `Hosted execution outbox record ${eventId} is missing a staged payload id for reference dispatch.`,
  ) as Error & {
    code: string;
    permanent: true;
    retryable: false;
  };
  error.code = "HOSTED_EXECUTION_OUTBOX_PAYLOAD_REF_MISSING";
  error.permanent = true;
  error.retryable = false;
  return error;
}

function generateExecutionOutboxId(): string {
  return `execout_${randomBytes(10).toString("hex")}`;
}

function clonePrismaInputJsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
