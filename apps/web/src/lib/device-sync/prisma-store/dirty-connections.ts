import { Buffer } from "node:buffer";

import { Prisma, PrismaClient } from "@prisma/client";
import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import {
  serializeHostedExecutionDeviceSyncDirtyPayloadIdentity,
  type HostedExecutionDeviceSyncStagedDirtyAck,
} from "@murphai/device-syncd/hosted-runtime";

import {
  normalizeNullableString,
  sha256Hex,
  toIsoTimestamp,
} from "../shared";
import { toNullablePrismaJsonValue } from "./prisma-json";
import {
  openHostedDeviceSyncDirtyPayloadJson,
  sealHostedDeviceSyncDirtyPayloadJson,
} from "./dirty-payloads";
import type {
  HostedDeviceSyncDirtyConnectionAckRecord,
  HostedDeviceSyncDirtyConnectionRecord,
  HostedDeviceSyncDirtyResource,
  HostedPrismaTransactionClient,
  UpsertHostedDeviceSyncDirtyConnectionInput,
  UpsertHostedDeviceSyncDirtyConnectionResult,
} from "./types";

type DeviceSyncDirtyConnectionPrismaRecord =
  Prisma.DeviceSyncDirtyConnectionGetPayload<Prisma.DeviceSyncDirtyConnectionDefaultArgs>;

type DeviceSyncDirtyPayloadPrismaRecord = {
  connectionId: string;
  dirtyRevision: bigint;
  id: string;
  provider: string;
  resourceEncrypted: string;
};

interface DirtyResourceBatch {
  allResources: Record<string, HostedDeviceSyncDirtyResource>;
  compactResources: Record<string, HostedDeviceSyncDirtyResource>;
  payloadResources: HostedDeviceSyncDirtyResource[];
}

interface DirtyPayloadCreateResult {
  resources: HostedDeviceSyncDirtyResource[];
}

type DirtyPayloadCreateRow = {
  connectionId: string;
  dirtyRevision: bigint;
  id: string;
  provider: string;
  resourceEncrypted: string;
  userId: string;
};

interface PreparedDirtyPayloadRows extends DirtyPayloadCreateResult {
  dirtyRevision: bigint;
  rows: DirtyPayloadCreateRow[];
}

const DIRTY_COUNTER_KEY_MAX_LENGTH = 96;
const DIRTY_RESOURCE_KEY_MAX_LENGTH = 256;
const DIRTY_RESOURCE_PAYLOAD_STRING_MAX_LENGTH = 512;
const DIRTY_RESOURCE_PAYLOAD_WEBHOOK_DATA_JSON_MAX_BYTES = 64_000;
const DIRTY_RESOURCE_PAYLOAD_BLOCKED_KEY_PATTERN =
  /(?:authorization|authheader|bearer|clientsecret|cookie|credential|password|secret|token|apikey)/iu;
const DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS = 12;
const DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_CONNECTION = 500;
const DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_RESPONSE = 1_000;
const DIRTY_PAYLOAD_HYDRATE_RESPONSE_MAX_ESTIMATED_BYTES = 8 * 1024 * 1024;
const DIRTY_PAYLOAD_PRESEAL_CONCURRENCY = 16;
const HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE = "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION";

interface DirtyPayloadHydrationBudget {
  exhausted: boolean;
  maxEstimatedBytes: number;
  maxResources: number;
  usedEstimatedBytes: number;
  usedResources: number;
}

interface StagedDirtyAckOverlayEntry {
  processedDirtyPayloadIds: Set<string>;
  processedRevision: bigint | null;
}

type StagedDirtyAckOverlay = Map<string, StagedDirtyAckOverlayEntry>;

interface DirtyConnectionHydrationResult {
  hasMorePayloads: boolean;
  items: HostedDeviceSyncDirtyConnectionRecord[];
}

export class PrismaHostedDirtyConnectionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async upsertDirtyConnection(
    input: UpsertHostedDeviceSyncDirtyConnectionInput,
  ): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    const resourceBatch = buildDirtyResourceBatch(input.resources ?? []);
    if (input.tx) {
      return this.upsertDirtyConnectionOnce({
        ...input,
        resourceBatch,
        tx: input.tx,
      });
    }

    for (let attempt = 0; attempt < DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS; attempt += 1) {
      try {
        const precomputedDirtyPayloadRows =
          await this.prepareDirtyPayloadRowsForStoreOwnedUpsert({
            connectionId: input.connectionId,
            provider: input.provider,
            resourceBatch,
            traceId: input.traceId,
            userId: input.userId,
          });

        return await this.prisma.$transaction((tx) =>
          this.upsertDirtyConnectionOnce({
            ...input,
            precomputedDirtyPayloadRows,
            resourceBatch,
            tx,
          }),
        );
      } catch (error) {
        if (
          !isDirtyStateContentionError(error)
          || attempt === DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS - 1
        ) {
          throw error;
        }

        await waitForDirtyStateRetry(attempt);
      }
    }

    throw createDirtyStateContentionError("update");
  }

  private async upsertDirtyConnectionOnce(
    input: UpsertHostedDeviceSyncDirtyConnectionInput & {
      precomputedDirtyPayloadRows?: PreparedDirtyPayloadRows;
      resourceBatch: DirtyResourceBatch;
      tx: HostedPrismaTransactionClient;
    },
  ): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    const prisma = input.tx;
    const dirtyAt = new Date(input.dirtyAt);

    const existing = await prisma.deviceSyncDirtyConnection.findUnique({
      where: {
        connectionId: input.connectionId,
      },
    });

    if (!existing) {
      const resourceBatch = input.resourceBatch;
      const counters = buildDirtyCounters(resourceBatch.allResources);
      const created = await prisma.deviceSyncDirtyConnection.createMany({
        data: {
          connectionId: input.connectionId,
          userId: input.userId,
          provider: input.provider,
          dirtyRevision: 1n,
          processedRevision: 0n,
          firstDirtyAt: dirtyAt,
          latestDirtyAt: dirtyAt,
          windowStart: resolveDirtyWindowStart(resourceBatch.allResources),
          windowEnd: resolveDirtyWindowEnd(resourceBatch.allResources),
          eventCount: 1n,
          latestTraceId: normalizeNullableString(input.traceId),
          latestEventType: normalizeNullableString(input.eventType),
          latestResourceCategory: normalizeNullableString(input.resourceCategory),
          sourceProviderCountsJson: toNullablePrismaJsonValue(counters.sourceProviderCounts),
          resourceCategoryCountsJson: toNullablePrismaJsonValue(counters.resourceCategoryCounts),
          dirtyResourcesJson: toNullablePrismaJsonValue(resourceBatch.compactResources),
        },
        skipDuplicates: true,
      });

      if (created.count === 0) {
        throw createDirtyStateContentionError("update");
      }

      const payloadCreateResult = await createDirtyPayloadRows({
        connectionId: input.connectionId,
        dirtyRevision: 1n,
        provider: input.provider,
        precomputed: input.precomputedDirtyPayloadRows,
        resources: resourceBatch.payloadResources,
        traceId: input.traceId,
        tx: prisma,
        userId: input.userId,
      });

      const record = await prisma.deviceSyncDirtyConnection.findUnique({
        where: {
          connectionId: input.connectionId,
        },
      });
      if (!record) {
        throw createDirtyStateContentionError("update");
      }

      return {
        dirty: withDirtyPayloadResources(
          mapDirtyConnectionRecord(record),
          payloadCreateResult.resources,
        ),
        shouldRequestWake: true,
      };
    }

    const resourceBatch = input.resourceBatch;
    const becameDirty = existing.processedRevision >= existing.dirtyRevision;
    if (
      !becameDirty
      && isPayloadOnlyDirtyAppend(resourceBatch)
    ) {
      const payloadCreateResult = await createDirtyPayloadRows({
        connectionId: input.connectionId,
        dirtyRevision: existing.dirtyRevision,
        provider: input.provider,
        precomputed: input.precomputedDirtyPayloadRows,
        resources: resourceBatch.payloadResources,
        traceId: input.traceId,
        tx: prisma,
        userId: input.userId,
      });

      return {
        dirty: withDirtyPayloadResources(
          mapDirtyConnectionRecord(existing),
          payloadCreateResult.resources,
        ),
        shouldRequestWake: false,
      };
    }

    const priorResources = becameDirty ? {} : readDirtyResourcesJson(existing.dirtyResourcesJson);
    const resources = mergeDirtyResources(
      priorResources,
      Object.values(resourceBatch.compactResources),
    );
    const currentCounters = buildDirtyCounters(resourceBatch.allResources);
    const counters = becameDirty
      ? currentCounters
      : addDirtyCounters(
          {
            resourceCategoryCounts: readCounterJson(existing.resourceCategoryCountsJson),
            sourceProviderCounts: readCounterJson(existing.sourceProviderCountsJson),
          },
          currentCounters,
        );
    const dirtyWindowStart = resolveDirtyWindowStart(resourceBatch.allResources);
    const dirtyWindowEnd = resolveDirtyWindowEnd(resourceBatch.allResources);
    const nextDirtyRevision = existing.dirtyRevision + 1n;
    const updated = await prisma.deviceSyncDirtyConnection.updateMany({
      where: {
        connectionId: input.connectionId,
        dirtyRevision: existing.dirtyRevision,
        processedRevision: existing.processedRevision,
      },
      data: {
        userId: input.userId,
        provider: input.provider,
        dirtyRevision: nextDirtyRevision,
        firstDirtyAt: becameDirty ? dirtyAt : existing.firstDirtyAt,
        latestDirtyAt: dirtyAt,
        windowStart: becameDirty ? dirtyWindowStart : minDate(existing.windowStart, dirtyWindowStart),
        windowEnd: becameDirty ? dirtyWindowEnd : maxDate(existing.windowEnd, dirtyWindowEnd),
        eventCount: existing.eventCount + 1n,
        latestTraceId: normalizeNullableString(input.traceId),
        latestEventType: normalizeNullableString(input.eventType),
        latestResourceCategory: normalizeNullableString(input.resourceCategory),
        sourceProviderCountsJson: toNullablePrismaJsonValue(counters.sourceProviderCounts),
        resourceCategoryCountsJson: toNullablePrismaJsonValue(counters.resourceCategoryCounts),
        dirtyResourcesJson: toNullablePrismaJsonValue(resources),
      },
    });

    if (updated.count === 0) {
      throw createDirtyStateContentionError("update");
    }

    const payloadCreateResult = await createDirtyPayloadRows({
      connectionId: input.connectionId,
      dirtyRevision: nextDirtyRevision,
      provider: input.provider,
      precomputed: input.precomputedDirtyPayloadRows,
      resources: resourceBatch.payloadResources,
      traceId: input.traceId,
      tx: prisma,
      userId: input.userId,
    });

    const record = await prisma.deviceSyncDirtyConnection.findUnique({
      where: {
        connectionId: input.connectionId,
      },
    });
    if (!record) {
      throw createDirtyStateContentionError("update");
    }

    return {
      dirty: withDirtyPayloadResources(
        mapDirtyConnectionRecord(record),
        payloadCreateResult.resources,
      ),
      shouldRequestWake: becameDirty,
    };
  }

  private async prepareDirtyPayloadRowsForStoreOwnedUpsert(input: {
    connectionId: string;
    provider: string;
    resourceBatch: DirtyResourceBatch;
    traceId?: string | null;
    userId: string;
  }): Promise<PreparedDirtyPayloadRows | undefined> {
    if (input.resourceBatch.payloadResources.length === 0) {
      return undefined;
    }

    const existing = await this.prisma.deviceSyncDirtyConnection.findUnique({
      where: {
        connectionId: input.connectionId,
      },
    });
    return prepareDirtyPayloadRows({
      connectionId: input.connectionId,
      dirtyRevision: resolveDirtyPayloadRevision({
        existing,
        resourceBatch: input.resourceBatch,
      }),
      provider: input.provider,
      resources: input.resourceBatch.payloadResources,
      traceId: input.traceId,
      userId: input.userId,
      prisma: this.prisma,
    });
  }

  async getDirtyConnection(input: {
    connectionId: string;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionRecord | null> {
    const prisma = input.tx ?? this.prisma;
    const record = await prisma.deviceSyncDirtyConnection.findFirst({
      where: {
        connectionId: input.connectionId,
        userId: input.userId,
      },
    });

    return record
      ? hydrateDirtyConnectionRecord({
          prisma,
          record,
          userId: input.userId,
        })
      : null;
  }

  async hasPendingDirtyConnection(
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<boolean> {
    const prisma = tx ?? this.prisma;
    const rows = await prisma.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
      select exists(
        select 1
        from "device_sync_dirty_connection" as "dirty"
        where "dirty"."connection_id" = ${connectionId}
          and (
            "dirty"."dirty_revision" > "dirty"."processed_revision"
            or exists(
              select 1
              from "device_sync_dirty_payload" as "payload"
              where "payload"."connection_id" = "dirty"."connection_id"
                and "payload"."user_id" = "dirty"."user_id"
            )
          )
      ) as "pending"
    `);

    return rows.some((row) => row.pending === true);
  }

  async hasPendingDirtyConnectionForUser(
    userId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<boolean> {
    const prisma = tx ?? this.prisma;
    const rows = await prisma.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
      select exists(
        select 1
        from "device_sync_dirty_connection" as "dirty"
        where "dirty"."user_id" = ${userId}
          and (
            "dirty"."dirty_revision" > "dirty"."processed_revision"
            or exists(
              select 1
              from "device_sync_dirty_payload" as "payload"
              where "payload"."connection_id" = "dirty"."connection_id"
                and "payload"."user_id" = "dirty"."user_id"
            )
          )
      ) as "pending"
    `);

    return rows.some((row) => row.pending === true);
  }

  async listPendingDirtyConnectionsForUser(input: {
    limit: number;
    stagedDirtyAcks?: readonly HostedExecutionDeviceSyncStagedDirtyAck[];
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<{
    hasMore: boolean;
    items: HostedDeviceSyncDirtyConnectionRecord[];
  }> {
    const prisma = input.tx ?? this.prisma;
    const limit = Math.max(1, Math.min(input.limit, 50));
    const stagedOverlay = buildStagedDirtyAckOverlay(input.stagedDirtyAcks ?? []);
    const candidateLimit = Math.max(
      limit,
      Math.min(limit + stagedOverlay.size, 250),
    );
    const rows = await prisma.$queryRaw<Array<{ connection_id: string }>>(Prisma.sql`
      select "connection_id"
      from "device_sync_dirty_connection"
      where "user_id" = ${input.userId}
        and (
          "dirty_revision" > "processed_revision"
          or exists(
            select 1
            from "device_sync_dirty_payload" as "payload"
            where "payload"."connection_id" = "device_sync_dirty_connection"."connection_id"
              and "payload"."user_id" = "device_sync_dirty_connection"."user_id"
          )
        )
      order by "first_dirty_at" asc, "connection_id" asc
      limit ${candidateLimit + 1}
    `);
    const selectedIds = rows.slice(0, candidateLimit).map((row) => row.connection_id);
    if (selectedIds.length === 0) {
      return {
        hasMore: false,
        items: [],
      };
    }

    const records = await prisma.deviceSyncDirtyConnection.findMany({
      where: {
        connectionId: {
          in: selectedIds,
        },
        userId: input.userId,
      },
    });
    const recordById = new Map(records.map((record) => [record.connectionId, record]));

    const selectedRecords = selectedIds
      .map((id) => recordById.get(id) ?? null)
      .filter((record): record is DeviceSyncDirtyConnectionPrismaRecord => record !== null);

    const hydrated = await hydrateDirtyConnectionRecords({
      budget: createDirtyPayloadHydrationBudget(),
      prisma,
      records: selectedRecords,
      stagedOverlay,
      userId: input.userId,
    });
    const items = hydrated.items.slice(0, limit);

    return {
      hasMore: rows.length > candidateLimit
        || hydrated.hasMorePayloads
        || hydrated.items.length > limit,
      items,
    };
  }

  async markDirtyConnectionProcessed(input: {
    connectionId: string;
    processedDirtyPayloadIds?: readonly string[];
    processedRevision: bigint;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionAckRecord | null> {
    if (input.tx) {
      return this.markDirtyConnectionProcessedOnce({
        ...input,
        tx: input.tx,
      });
    }

    for (let attempt = 0; attempt < DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) =>
          this.markDirtyConnectionProcessedOnce({
            ...input,
            tx,
          }),
        );
      } catch (error) {
        if (
          !isDirtyStateContentionError(error)
          || attempt === DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS - 1
        ) {
          throw error;
        }

        await waitForDirtyStateRetry(attempt);
      }
    }

    throw createDirtyStateContentionError("ack");
  }

  private async markDirtyConnectionProcessedOnce(input: {
    connectionId: string;
    processedDirtyPayloadIds?: readonly string[];
    processedRevision: bigint;
    userId: string;
    tx: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionAckRecord | null> {
    const prisma = input.tx;
    const existing = await prisma.deviceSyncDirtyConnection.findFirst({
      where: {
        connectionId: input.connectionId,
        userId: input.userId,
      },
    });

    if (!existing) {
      return null;
    }

    const requestedProcessedRevision =
      input.processedRevision > existing.processedRevision
        ? input.processedRevision
        : existing.processedRevision;
    const nextProcessedRevision =
      requestedProcessedRevision > existing.dirtyRevision
        ? existing.dirtyRevision
        : requestedProcessedRevision;
    const fullyProcessed = nextProcessedRevision >= existing.dirtyRevision;
    const updated = await prisma.deviceSyncDirtyConnection.updateMany({
      where: {
        connectionId: input.connectionId,
        dirtyRevision: existing.dirtyRevision,
        processedRevision: existing.processedRevision,
        userId: input.userId,
      },
      data: {
        processedRevision: nextProcessedRevision,
        ...(fullyProcessed
          ? {
              dirtyResourcesJson: toNullablePrismaJsonValue({}),
              firstDirtyAt: existing.latestDirtyAt,
              resourceCategoryCountsJson: toNullablePrismaJsonValue({}),
              sourceProviderCountsJson: toNullablePrismaJsonValue({}),
              windowEnd: null,
              windowStart: null,
            }
          : {}),
      },
    });

    if (updated.count === 0) {
      throw createDirtyStateContentionError("ack");
    }

    if (input.processedDirtyPayloadIds !== undefined) {
      const processedDirtyPayloadIds = [...new Set(input.processedDirtyPayloadIds)]
        .filter((id) => normalizeNullableString(id));
      if (processedDirtyPayloadIds.length > 0) {
        await prisma.deviceSyncDirtyPayload.deleteMany({
          where: {
            connectionId: input.connectionId,
            id: {
              in: processedDirtyPayloadIds,
            },
            userId: input.userId,
          },
        });
      }
    }

    const stillDirty = nextProcessedRevision < existing.dirtyRevision
      || await hasPendingDirtyPayloadForConnection({
        connectionId: input.connectionId,
        tx: prisma,
        userId: input.userId,
      });

    return {
      connectionId: input.connectionId,
      dirtyRevision: existing.dirtyRevision,
      processedRevision: nextProcessedRevision,
      stillDirty,
      userId: input.userId,
    };
  }
}

function createDirtyStateContentionError(operation: "ack" | "update"): Error {
  return deviceSyncError({
    code: HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE,
    httpStatus: 503,
    message:
      operation === "ack"
        ? "Hosted device-sync dirty state was updated concurrently while marking work processed. Retry the request."
        : "Hosted device-sync dirty state was updated concurrently. Retry the request.",
    retryable: true,
  });
}

function isDirtyStateContentionError(error: unknown): boolean {
  return Boolean(
    typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE,
  );
}

async function waitForDirtyStateRetry(attempt: number): Promise<void> {
  const delayMs = Math.min(25, 2 + attempt * 2 + Math.floor(Math.random() * 3));
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function hasPendingDirtyPayloadForConnection(input: {
  connectionId: string;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<boolean> {
  const rows = await input.tx.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
    select exists(
      select 1
      from "device_sync_dirty_payload" as "payload"
      where "payload"."connection_id" = ${input.connectionId}
        and "payload"."user_id" = ${input.userId}
    ) as "pending"
  `);

  return rows.some((row) => row.pending === true);
}

async function createDirtyPayloadRows(input: {
  connectionId: string;
  dirtyRevision: bigint;
  precomputed?: PreparedDirtyPayloadRows;
  provider: string;
  resources: readonly HostedDeviceSyncDirtyResource[];
  traceId?: string | null;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<DirtyPayloadCreateResult> {
  if (input.resources.length === 0) {
    return {
      resources: [],
    };
  }

  const prepared = input.precomputed ?? (await prepareDirtyPayloadRows({
    connectionId: input.connectionId,
    dirtyRevision: input.dirtyRevision,
    provider: input.provider,
    resources: input.resources,
    traceId: input.traceId,
    userId: input.userId,
    prisma: input.tx,
  }));
  if (prepared.dirtyRevision !== input.dirtyRevision) {
    throw createDirtyStateContentionError("update");
  }

  await input.tx.deviceSyncDirtyPayload.createMany({
    data: prepared.rows,
    skipDuplicates: true,
  });

  return {
    resources: prepared.resources,
  };
}

async function prepareDirtyPayloadRows(input: {
  connectionId: string;
  dirtyRevision: bigint;
  prisma: HostedPrismaTransactionClient | PrismaClient;
  provider: string;
  resources: readonly HostedDeviceSyncDirtyResource[];
  traceId?: string | null;
  userId: string;
}): Promise<PreparedDirtyPayloadRows> {
  const prepared = await mapLimit(input.resources, DIRTY_PAYLOAD_PRESEAL_CONCURRENCY, async (resource, index) => {
    const payloadId = createDirtyPayloadId({
      connectionId: input.connectionId,
      dirtyRevision: input.dirtyRevision,
      index,
      resource,
      traceId: input.traceId,
    });
    const resourceWithPayloadId = {
      ...resource,
      dirtyPayloadId: payloadId,
    };

    return {
      resource: resourceWithPayloadId,
      row: {
        connectionId: input.connectionId,
        dirtyRevision: input.dirtyRevision,
        id: payloadId,
        provider: input.provider,
        resourceEncrypted: await sealHostedDeviceSyncDirtyPayloadJson({
          connectionId: input.connectionId,
          dirtyRevision: input.dirtyRevision,
          payloadId,
          prisma: input.prisma,
          provider: input.provider,
          userId: input.userId,
          value: resourceWithPayloadId,
        }),
        userId: input.userId,
      },
    };
  });

  return {
    dirtyRevision: input.dirtyRevision,
    resources: prepared.map((entry) => entry.resource),
    rows: prepared.map((entry) => entry.row),
  };
}

async function mapLimit<TInput, TOutput>(
  values: readonly TInput[],
  limit: number,
  mapValue: (value: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const results = new Array<TOutput>(values.length);
  let failed = false;
  let firstError: unknown = null;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (!failed && nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapValue(values[index]!, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  }

  const workerCount = Math.min(normalizedLimit, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failed) {
    throw firstError;
  }
  return results;
}

function resolveDirtyPayloadRevision(input: {
  existing: DeviceSyncDirtyConnectionPrismaRecord | null;
  resourceBatch: DirtyResourceBatch;
}): bigint {
  if (!input.existing) {
    return 1n;
  }

  if (
    input.existing.processedRevision < input.existing.dirtyRevision
    && isPayloadOnlyDirtyAppend(input.resourceBatch)
  ) {
    return input.existing.dirtyRevision;
  }

  return input.existing.dirtyRevision + 1n;
}

function isPayloadOnlyDirtyAppend(resourceBatch: DirtyResourceBatch): boolean {
  return Object.keys(resourceBatch.compactResources).length === 0
    && resourceBatch.payloadResources.length > 0;
}

function createDirtyPayloadId(input: {
  connectionId: string;
  dirtyRevision: bigint;
  index: number;
  resource: HostedDeviceSyncDirtyResource;
  traceId?: string | null;
}): string {
  const identity = [
    input.connectionId,
    input.dirtyRevision.toString(),
    normalizeNullableString(input.traceId) ?? "trace",
    String(input.index),
    buildDirtyResourceKey(input.resource),
    serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(input.resource.payload),
  ].join("\0");

  return `dsp_${sha256Hex(identity).slice(0, 40)}`;
}

async function hydrateDirtyConnectionRecord(input: {
  prisma: HostedPrismaTransactionClient | PrismaClient;
  record: DeviceSyncDirtyConnectionPrismaRecord;
  userId: string;
}): Promise<HostedDeviceSyncDirtyConnectionRecord> {
  const hydrated = await hydrateDirtyConnectionRecords({
    prisma: input.prisma,
    records: [input.record],
    userId: input.userId,
  });

  return hydrated.items[0] ?? mapDirtyConnectionRecord(input.record);
}

async function hydrateDirtyConnectionRecords(input: {
  budget?: DirtyPayloadHydrationBudget;
  prisma: HostedPrismaTransactionClient | PrismaClient;
  records: readonly DeviceSyncDirtyConnectionPrismaRecord[];
  stagedOverlay?: StagedDirtyAckOverlay;
  userId: string;
}): Promise<DirtyConnectionHydrationResult> {
  if (input.records.length === 0) {
    return {
      hasMorePayloads: false,
      items: [],
    };
  }

  let hasMorePayloads = false;
  const hydratedRecords: DeviceSyncDirtyConnectionPrismaRecord[] = [];
  const payloadsByConnectionId = new Map<string, HostedDeviceSyncDirtyResource[]>();

  for (const dirty of input.records) {
    const overlayEntry = input.stagedOverlay?.get(dirty.connectionId) ?? null;
    const effectiveProcessedRevision = resolveStagedDirtyAckProcessedRevision({
      dirty,
      overlayEntry,
    });
    const markerPending = dirty.dirtyRevision > effectiveProcessedRevision;
    if (input.budget?.exhausted) {
      hasMorePayloads = true;
      break;
    }
    const remainingPayloadSlots = resolveDirtyPayloadHydrationRemainingSlots(input.budget);
    if (remainingPayloadSlots <= 0) {
      hasMorePayloads = true;
      break;
    }
    const payloadRowLimit = Math.min(
      DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_CONNECTION,
      remainingPayloadSlots,
    );
    const excludedPayloadIds = overlayEntry
      ? [...overlayEntry.processedDirtyPayloadIds]
      : [];
    const payloadRows = await input.prisma.deviceSyncDirtyPayload.findMany({
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        connectionId: true,
        dirtyRevision: true,
        id: true,
        provider: true,
        resourceEncrypted: true,
      },
      take: payloadRowLimit + 1,
      where: {
        connectionId: dirty.connectionId,
        ...(excludedPayloadIds.length > 0
          ? {
              id: {
                notIn: excludedPayloadIds,
              },
            }
          : {}),
        userId: input.userId,
      },
    });

    if (payloadRows.length > payloadRowLimit) {
      hasMorePayloads = true;
    }

    const payloads: HostedDeviceSyncDirtyResource[] = [];
    for (const row of payloadRows.slice(0, payloadRowLimit)) {
      const resource = await readDirtyPayloadResourceJson({
        row,
        tx: input.prisma,
        userId: input.userId,
      });
      if (!resource) {
        continue;
      }
      if (
        input.budget
        && !tryReserveDirtyPayloadHydrationBudget(input.budget, resource)
      ) {
        hasMorePayloads = true;
        break;
      }

      payloads.push(resource);
    }

    if (payloadRows.length > 0 && payloads.length === 0 && !markerPending) {
      hasMorePayloads = true;
      break;
    }

    if (payloads.length > 0) {
      payloadsByConnectionId.set(dirty.connectionId, payloads);
    }
    if (markerPending || payloads.length > 0) {
      hydratedRecords.push(
        applyStagedDirtyAckMarkerOverlay({
          dirty,
          effectiveProcessedRevision,
          markerPending,
        }),
      );
    }
  }

  const items = hydratedRecords
    .map((record) =>
      withDirtyPayloadResources(
        mapDirtyConnectionRecord(record),
        payloadsByConnectionId.get(record.connectionId) ?? [],
      )
    );

  return {
    hasMorePayloads,
    items,
  };
}

function buildStagedDirtyAckOverlay(
  stagedDirtyAcks: readonly HostedExecutionDeviceSyncStagedDirtyAck[],
): StagedDirtyAckOverlay {
  const overlay: StagedDirtyAckOverlay = new Map();

  for (const ack of stagedDirtyAcks) {
    const connectionId = normalizeNullableString(ack.connectionId);
    if (!connectionId) {
      continue;
    }
    const entry = overlay.get(connectionId) ?? {
      processedDirtyPayloadIds: new Set<string>(),
      processedRevision: null,
    };
    const processedRevision = BigInt(ack.processedRevision);
    if (entry.processedRevision === null || processedRevision > entry.processedRevision) {
      entry.processedRevision = processedRevision;
    }
    for (const id of ack.processedDirtyPayloadIds ?? []) {
      const normalizedId = normalizeNullableString(id);
      if (normalizedId) {
        entry.processedDirtyPayloadIds.add(normalizedId);
      }
    }
    overlay.set(connectionId, entry);
  }

  return overlay;
}

function resolveStagedDirtyAckProcessedRevision(input: {
  dirty: DeviceSyncDirtyConnectionPrismaRecord;
  overlayEntry: StagedDirtyAckOverlayEntry | null;
}): bigint {
  const stagedRevision = input.overlayEntry?.processedRevision ?? null;
  if (stagedRevision === null || stagedRevision <= input.dirty.processedRevision) {
    return input.dirty.processedRevision;
  }
  return stagedRevision > input.dirty.dirtyRevision
    ? input.dirty.dirtyRevision
    : stagedRevision;
}

function applyStagedDirtyAckMarkerOverlay(input: {
  dirty: DeviceSyncDirtyConnectionPrismaRecord;
  effectiveProcessedRevision: bigint;
  markerPending: boolean;
}): DeviceSyncDirtyConnectionPrismaRecord {
  if (
    input.effectiveProcessedRevision === input.dirty.processedRevision
    && input.markerPending
  ) {
    return input.dirty;
  }

  return {
    ...input.dirty,
    processedRevision: input.effectiveProcessedRevision,
    ...(input.markerPending
      ? {}
      : {
          dirtyResourcesJson: {},
          resourceCategoryCountsJson: {},
          sourceProviderCountsJson: {},
          windowEnd: null,
          windowStart: null,
        }),
  };
}

function createDirtyPayloadHydrationBudget(): DirtyPayloadHydrationBudget {
  return {
    exhausted: false,
    maxEstimatedBytes: DIRTY_PAYLOAD_HYDRATE_RESPONSE_MAX_ESTIMATED_BYTES,
    maxResources: DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_RESPONSE,
    usedEstimatedBytes: 0,
    usedResources: 0,
  };
}

function resolveDirtyPayloadHydrationRemainingSlots(
  budget: DirtyPayloadHydrationBudget | undefined,
): number {
  if (!budget) {
    return DIRTY_PAYLOAD_HYDRATE_LIMIT_PER_CONNECTION;
  }
  return Math.max(0, budget.maxResources - budget.usedResources);
}

function tryReserveDirtyPayloadHydrationBudget(
  budget: DirtyPayloadHydrationBudget,
  resource: HostedDeviceSyncDirtyResource,
): boolean {
  if (budget.usedResources >= budget.maxResources) {
    budget.exhausted = true;
    return false;
  }

  const estimatedBytes = estimateDirtyPayloadResourceResponseBytes(resource);
  if (
    budget.usedResources > 0
    && budget.usedEstimatedBytes + estimatedBytes > budget.maxEstimatedBytes
  ) {
    budget.exhausted = true;
    return false;
  }

  budget.usedResources += 1;
  budget.usedEstimatedBytes += estimatedBytes;
  return true;
}

function estimateDirtyPayloadResourceResponseBytes(
  resource: HostedDeviceSyncDirtyResource,
): number {
  return Buffer.byteLength(JSON.stringify(resource), "utf8");
}

export function mapDirtyConnectionRecord(
  record: DeviceSyncDirtyConnectionPrismaRecord,
): HostedDeviceSyncDirtyConnectionRecord {
  return {
    connectionId: record.connectionId,
    userId: record.userId,
    provider: record.provider,
    dirtyRevision: record.dirtyRevision,
    processedRevision: record.processedRevision,
    firstDirtyAt: record.firstDirtyAt.toISOString(),
    latestDirtyAt: record.latestDirtyAt.toISOString(),
    windowStart: record.windowStart?.toISOString() ?? null,
    windowEnd: record.windowEnd?.toISOString() ?? null,
    eventCount: record.eventCount,
    latestTraceId: record.latestTraceId,
    latestEventType: record.latestEventType,
    latestResourceCategory: record.latestResourceCategory,
    sourceProviderCounts: readCounterJson(record.sourceProviderCountsJson),
    resourceCategoryCounts: readCounterJson(record.resourceCategoryCountsJson),
    dirtyResources: readDirtyResourcesJson(record.dirtyResourcesJson),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  } satisfies HostedDeviceSyncDirtyConnectionRecord;
}

function withDirtyPayloadResources(
  record: HostedDeviceSyncDirtyConnectionRecord,
  payloadResources: readonly HostedDeviceSyncDirtyResource[],
): HostedDeviceSyncDirtyConnectionRecord {
  if (payloadResources.length === 0) {
    return record;
  }

  return {
    ...record,
    dirtyResources: mergeDirtyResources(record.dirtyResources, payloadResources),
  };
}

function buildDirtyResourceBatch(
  resources: readonly HostedDeviceSyncDirtyResource[],
): DirtyResourceBatch {
  const allResources: Record<string, HostedDeviceSyncDirtyResource> = {};
  const compactResources: Record<string, HostedDeviceSyncDirtyResource> = {};
  const payloadResources: HostedDeviceSyncDirtyResource[] = [];

  for (const resource of resources) {
    const normalized = withDirtyResourceWindowPayload(normalizeDirtyResource(resource));
    mergeDirtyResourceInto(allResources, normalized);

    if (hasDirtyResourceInputPayload(resource.payload)) {
      payloadResources.push(normalized);
    } else {
      mergeDirtyResourceInto(compactResources, normalized);
    }
  }

  return {
    allResources,
    compactResources,
    payloadResources,
  };
}

function hasDirtyResourceInputPayload(value: unknown): boolean {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length > 0;
}

function mergeDirtyResources(
  existing: Record<string, HostedDeviceSyncDirtyResource>,
  updates: readonly HostedDeviceSyncDirtyResource[],
): Record<string, HostedDeviceSyncDirtyResource> {
  const merged: Record<string, HostedDeviceSyncDirtyResource> = {};

  for (const resource of Object.values(existing)) {
    mergeDirtyResourceInto(merged, resource);
  }
  for (const update of updates) {
    mergeDirtyResourceInto(merged, update);
  }

  return merged;
}

function mergeDirtyResourceInto(
  merged: Record<string, HostedDeviceSyncDirtyResource>,
  resource: HostedDeviceSyncDirtyResource,
): void {
  const normalized = normalizeDirtyResource(resource);
  const key = buildDirtyResourceKey(normalized);
  const previous = merged[key] ?? null;
  merged[key] = withDirtyResourceWindowPayload(previous
    ? {
        ...normalized,
        count: previous.count + normalized.count,
        windowStart: minIso(previous.windowStart, normalized.windowStart),
        windowEnd: maxIso(previous.windowEnd, normalized.windowEnd),
      }
    : normalized);
}

function normalizeDirtyResource(
  resource: HostedDeviceSyncDirtyResource,
): HostedDeviceSyncDirtyResource {
  return {
    count: Math.max(1, Math.min(1_000_000, Math.trunc(resource.count))),
    ...(resource.dirtyPayloadId
      ? { dirtyPayloadId: truncateDirtyKey(normalizeNullableString(resource.dirtyPayloadId)) ?? resource.dirtyPayloadId }
      : {}),
    jobKind: truncateDirtyKey(normalizeNullableString(resource.jobKind) ?? "reconcile") ?? "reconcile",
    payload: readDirtyResourcePayload(resource.payload),
    resource: truncateDirtyKey(normalizeNullableString(resource.resource)),
    resourceCategory: truncateDirtyKey(normalizeNullableString(resource.resourceCategory)),
    sourceProviderSlug: truncateDirtyKey(normalizeNullableString(resource.sourceProviderSlug)),
    windowEnd: normalizeIso(resource.windowEnd),
    windowStart: normalizeIso(resource.windowStart),
  };
}

function buildDirtyResourceKey(resource: HostedDeviceSyncDirtyResource): string {
  return [
    resource.dirtyPayloadId ?? "marker",
    buildDirtyResourcePayloadKey(resource.payload),
    resource.sourceProviderSlug ?? "provider",
    resource.resourceCategory ?? "category",
    resource.resource ?? resource.jobKind,
  ].join(":").slice(0, DIRTY_RESOURCE_KEY_MAX_LENGTH);
}

function buildDirtyCounters(resources: Record<string, HostedDeviceSyncDirtyResource>): {
  resourceCategoryCounts: Record<string, number>;
  sourceProviderCounts: Record<string, number>;
} {
  const resourceCategoryCounts: Record<string, number> = {};
  const sourceProviderCounts: Record<string, number> = {};

  for (const resource of Object.values(resources)) {
    incrementCounter(sourceProviderCounts, resource.sourceProviderSlug ?? "unknown", resource.count);
    incrementCounter(resourceCategoryCounts, resource.resourceCategory ?? resource.jobKind, resource.count);
  }

  return {
    resourceCategoryCounts,
    sourceProviderCounts,
  };
}

function addDirtyCounters(
  existing: ReturnType<typeof buildDirtyCounters>,
  updates: ReturnType<typeof buildDirtyCounters>,
): ReturnType<typeof buildDirtyCounters> {
  const sourceProviderCounts = { ...existing.sourceProviderCounts };
  const resourceCategoryCounts = { ...existing.resourceCategoryCounts };

  for (const [key, value] of Object.entries(updates.sourceProviderCounts)) {
    incrementCounter(sourceProviderCounts, key, value);
  }
  for (const [key, value] of Object.entries(updates.resourceCategoryCounts)) {
    incrementCounter(resourceCategoryCounts, key, value);
  }

  return {
    resourceCategoryCounts,
    sourceProviderCounts,
  };
}

function incrementCounter(
  counters: Record<string, number>,
  rawKey: string,
  increment: number,
): void {
  const key = truncateDirtyKey(rawKey) ?? "unknown";
  counters[key] = (counters[key] ?? 0) + increment;
}

function readDirtyResourcesJson(value: Prisma.JsonValue): Record<string, HostedDeviceSyncDirtyResource> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, HostedDeviceSyncDirtyResource> = {};
  for (const entry of Object.values(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    mergeDirtyResourceInto(next, {
      count: typeof record.count === "number" ? record.count : 1,
      ...(typeof record.dirtyPayloadId === "string" ? { dirtyPayloadId: record.dirtyPayloadId } : {}),
      jobKind: typeof record.jobKind === "string" ? record.jobKind : "reconcile",
      payload: readDirtyResourcePayload(record.payload),
      resource: typeof record.resource === "string" ? record.resource : null,
      resourceCategory: typeof record.resourceCategory === "string" ? record.resourceCategory : null,
      sourceProviderSlug: typeof record.sourceProviderSlug === "string" ? record.sourceProviderSlug : null,
      windowEnd: typeof record.windowEnd === "string" ? record.windowEnd : null,
      windowStart: typeof record.windowStart === "string" ? record.windowStart : null,
    });
  }

  return next;
}

async function readDirtyPayloadResourceJson(input: {
  row: DeviceSyncDirtyPayloadPrismaRecord;
  tx: HostedPrismaTransactionClient | PrismaClient;
  userId: string;
}): Promise<HostedDeviceSyncDirtyResource | null> {
  const value = await openHostedDeviceSyncDirtyPayloadJson({
    connectionId: input.row.connectionId,
    dirtyRevision: input.row.dirtyRevision,
    payloadId: input.row.id,
    prisma: input.tx,
    provider: input.row.provider,
    userId: input.userId,
    value: input.row.resourceEncrypted,
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const merged: Record<string, HostedDeviceSyncDirtyResource> = {};
  mergeDirtyResourceInto(merged, {
    count: typeof record.count === "number" ? record.count : 1,
    dirtyPayloadId: input.row.id,
    jobKind: typeof record.jobKind === "string" ? record.jobKind : "reconcile",
    payload: readDirtyResourcePayload(record.payload),
    resource: typeof record.resource === "string" ? record.resource : null,
    resourceCategory: typeof record.resourceCategory === "string" ? record.resourceCategory : null,
    sourceProviderSlug: typeof record.sourceProviderSlug === "string" ? record.sourceProviderSlug : null,
    windowEnd: typeof record.windowEnd === "string" ? record.windowEnd : null,
    windowStart: typeof record.windowStart === "string" ? record.windowStart : null,
  });

  return Object.values(merged)[0] ?? null;
}

function withDirtyResourceWindowPayload(
  resource: HostedDeviceSyncDirtyResource,
): HostedDeviceSyncDirtyResource {
  const payload = resource.payload;
  if (!payload) {
    return resource;
  }

  return {
    ...resource,
    payload: readDirtyResourcePayload({
      ...payload,
      ...(resource.windowEnd ? { windowEnd: resource.windowEnd } : {}),
      ...(resource.windowStart ? { windowStart: resource.windowStart } : {}),
    }),
  };
}

function readDirtyResourcePayload(value: unknown): HostedDeviceSyncDirtyResource["payload"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const payload: Record<string, boolean | number | string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = truncateDirtyKey(normalizeNullableString(key));
    if (!normalizedKey) {
      continue;
    }
    if (DIRTY_RESOURCE_PAYLOAD_BLOCKED_KEY_PATTERN.test(normalizedKey.replace(/[^a-z0-9]/giu, ""))) {
      continue;
    }
    if (typeof entry === "string") {
      const normalizedEntry = normalizeDirtyResourcePayloadString(normalizedKey, entry);
      if (normalizedEntry === null) {
        continue;
      }
      payload[normalizedKey] = normalizedEntry;
    } else if (typeof entry === "boolean") {
      payload[normalizedKey] = entry;
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      payload[normalizedKey] = entry;
    }
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function normalizeDirtyResourcePayloadString(key: string, value: string): string | null {
  if (key.toLowerCase() !== "webhookdatajson") {
    return value.slice(0, DIRTY_RESOURCE_PAYLOAD_STRING_MAX_LENGTH);
  }

  return Buffer.byteLength(value, "utf8") <= DIRTY_RESOURCE_PAYLOAD_WEBHOOK_DATA_JSON_MAX_BYTES
    ? value
    : null;
}

function buildDirtyResourcePayloadKey(
  payload: HostedDeviceSyncDirtyResource["payload"],
): string {
  const identity = serializeHostedExecutionDeviceSyncDirtyPayloadIdentity(payload);
  return identity ? sha256Hex(identity).slice(0, 24) : "payload";
}

function readCounterJson(value: Prisma.JsonValue): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      next[key.slice(0, DIRTY_COUNTER_KEY_MAX_LENGTH)] = Math.max(0, Math.trunc(rawValue));
    }
  }
  return next;
}

function normalizeIso(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }
  try {
    return toIsoTimestamp(normalized);
  } catch {
    return null;
  }
}

function resolveDirtyWindowStart(resources: Record<string, HostedDeviceSyncDirtyResource>): Date | null {
  const value = Object.values(resources).reduce<string | null>(
    (earliest, resource) => minIso(earliest, resource.windowStart),
    null,
  );
  return value ? new Date(value) : null;
}

function resolveDirtyWindowEnd(resources: Record<string, HostedDeviceSyncDirtyResource>): Date | null {
  const value = Object.values(resources).reduce<string | null>(
    (latest, resource) => maxIso(latest, resource.windowEnd),
    null,
  );
  return value ? new Date(value) : null;
}

function minDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() <= right.getTime() ? left : right;
}

function maxDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() >= right.getTime() ? left : right;
}

function minIso(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function maxIso(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function truncateDirtyKey(value: string | null): string | null {
  const normalized = normalizeNullableString(value ?? undefined);
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, DIRTY_COUNTER_KEY_MAX_LENGTH);
}
