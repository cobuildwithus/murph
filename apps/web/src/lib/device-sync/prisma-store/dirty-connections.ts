import { Prisma, PrismaClient } from "@prisma/client";

import {
  normalizeNullableString,
  toIsoTimestamp,
} from "../shared";
import { toNullablePrismaJsonValue } from "./prisma-json";
import type {
  HostedDeviceSyncDirtyConnectionRecord,
  HostedDeviceSyncDirtyResource,
  HostedPrismaTransactionClient,
  UpsertHostedDeviceSyncDirtyConnectionInput,
  UpsertHostedDeviceSyncDirtyConnectionResult,
} from "./types";

type DeviceSyncDirtyConnectionPrismaRecord =
  Prisma.DeviceSyncDirtyConnectionGetPayload<Prisma.DeviceSyncDirtyConnectionDefaultArgs>;
type DirtyConnectionPrismaClient = PrismaClient | HostedPrismaTransactionClient;

const DIRTY_COUNTER_KEY_MAX_LENGTH = 96;
const DIRTY_RESOURCE_KEY_MAX_LENGTH = 256;

export class PrismaHostedDirtyConnectionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async upsertDirtyConnection(
    input: UpsertHostedDeviceSyncDirtyConnectionInput,
  ): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    const prisma = input.tx ?? this.prisma;
    const dirtyAt = new Date(input.dirtyAt);
    await lockDeviceConnectionForDirtyUpdate(prisma, input.connectionId);
    const existing = await prisma.deviceSyncDirtyConnection.findUnique({
      where: {
        connectionId: input.connectionId,
      },
    });
    const becameDirty =
      !existing || existing.processedRevision >= existing.dirtyRevision;
    const shouldRequestWake = becameDirty;

    if (!existing) {
      const dirtyRevision = 1n;
      const resources = mergeDirtyResources({}, input.resources ?? []);
      const counters = buildDirtyCounters(resources);
      const record = await prisma.deviceSyncDirtyConnection.create({
        data: {
          connectionId: input.connectionId,
          userId: input.userId,
          provider: input.provider,
          dirtyRevision,
          processedRevision: 0n,
          firstDirtyAt: dirtyAt,
          latestDirtyAt: dirtyAt,
          windowStart: resolveDirtyWindowStart(resources),
          windowEnd: resolveDirtyWindowEnd(resources),
          eventCount: 1n,
          latestTraceId: normalizeNullableString(input.traceId),
          latestEventType: normalizeNullableString(input.eventType),
          latestResourceCategory: normalizeNullableString(input.resourceCategory),
          sourceProviderCountsJson: toNullablePrismaJsonValue(counters.sourceProviderCounts),
          resourceCategoryCountsJson: toNullablePrismaJsonValue(counters.resourceCategoryCounts),
          dirtyResourcesJson: toNullablePrismaJsonValue(resources),
        },
      });

      return {
        dirty: mapDirtyConnectionRecord(record),
        shouldRequestWake,
      };
    }

    const priorResources = becameDirty ? {} : readDirtyResourcesJson(existing.dirtyResourcesJson);
    const resources = mergeDirtyResources(priorResources, input.resources ?? []);
    const counters = buildDirtyCounters(resources);
    const dirtyWindowStart = resolveDirtyWindowStart(resources);
    const dirtyWindowEnd = resolveDirtyWindowEnd(resources);
    const nextDirtyRevision = existing.dirtyRevision + 1n;
    const record = await prisma.deviceSyncDirtyConnection.update({
      where: {
        connectionId: input.connectionId,
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

    return {
      dirty: mapDirtyConnectionRecord(record),
      shouldRequestWake,
    };
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

    return record ? mapDirtyConnectionRecord(record) : null;
  }

  async listPendingDirtyConnectionsForUser(input: {
    limit: number;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<{
    hasMore: boolean;
    items: HostedDeviceSyncDirtyConnectionRecord[];
  }> {
    const prisma = input.tx ?? this.prisma;
    const limit = Math.max(1, Math.min(input.limit, 50));
    const rows = await prisma.$queryRaw<Array<{ connection_id: string }>>(Prisma.sql`
      select "connection_id"
      from "device_sync_dirty_connection"
      where "user_id" = ${input.userId}
        and "dirty_revision" > "processed_revision"
      order by "first_dirty_at" asc, "connection_id" asc
      limit ${limit + 1}
    `);
    const selectedIds = rows.slice(0, limit).map((row) => row.connection_id);
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

    return {
      hasMore: rows.length > limit,
      items: selectedIds
        .map((id) => recordById.get(id) ?? null)
        .filter((record): record is DeviceSyncDirtyConnectionPrismaRecord => record !== null)
        .map(mapDirtyConnectionRecord),
    };
  }

  async listDirtyUsersForSweep(input: {
    limit: number;
    staleBefore: Date;
  }): Promise<Array<{
    dirtyConnectionCount: bigint;
    latestDirtyAt: string;
    userId: string;
  }>> {
    const limit = Math.max(1, Math.min(input.limit, 251));
    const rows = await this.prisma.$queryRaw<Array<{
      dirty_connection_count: bigint;
      latest_dirty_at: Date;
      user_id: string;
    }>>(Prisma.sql`
      select
        "user_id",
        count(*)::bigint as "dirty_connection_count",
        max("latest_dirty_at") as "latest_dirty_at"
      from "device_sync_dirty_connection"
      where "dirty_revision" > "processed_revision"
        and "latest_dirty_at" <= ${input.staleBefore}
      group by "user_id"
      order by max("latest_dirty_at") asc, "user_id" asc
      limit ${limit}
    `);

    return rows.map((row) => ({
      dirtyConnectionCount: row.dirty_connection_count,
      latestDirtyAt: toIsoTimestamp(row.latest_dirty_at),
      userId: row.user_id,
    }));
  }

  async markDirtyConnectionProcessed(input: {
    connectionId: string;
    processedRevision: bigint;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionRecord | null> {
    const prisma = input.tx ?? this.prisma;
    await lockDeviceConnectionForDirtyUpdate(prisma, input.connectionId);
    const existing = await prisma.deviceSyncDirtyConnection.findFirst({
      where: {
        connectionId: input.connectionId,
        userId: input.userId,
      },
    });

    if (!existing) {
      return null;
    }

    const nextProcessedRevision =
      input.processedRevision > existing.processedRevision
        ? input.processedRevision
        : existing.processedRevision;
    const fullyProcessed = nextProcessedRevision >= existing.dirtyRevision;
    const record = await prisma.deviceSyncDirtyConnection.update({
      where: {
        connectionId: input.connectionId,
      },
      data: {
        processedRevision: nextProcessedRevision,
        ...(fullyProcessed
          ? {
              firstDirtyAt: existing.latestDirtyAt,
            }
          : {}),
      },
    });

    return mapDirtyConnectionRecord(record);
  }
}

async function lockDeviceConnectionForDirtyUpdate(
  prisma: DirtyConnectionPrismaClient,
  connectionId: string,
): Promise<void> {
  await prisma.$queryRaw(Prisma.sql`
    select "id"
    from "device_connection"
    where "id" = ${connectionId}
    for update
  `);
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

function mergeDirtyResources(
  existing: Record<string, HostedDeviceSyncDirtyResource>,
  updates: readonly HostedDeviceSyncDirtyResource[],
): Record<string, HostedDeviceSyncDirtyResource> {
  const merged: Record<string, HostedDeviceSyncDirtyResource> = { ...existing };

  for (const update of updates) {
    const normalized = normalizeDirtyResource(update);
    const key = buildDirtyResourceKey(normalized);
    const previous = merged[key] ?? null;
    merged[key] = previous
      ? {
          ...normalized,
          count: previous.count + normalized.count,
          windowStart: minIso(previous.windowStart, normalized.windowStart),
          windowEnd: maxIso(previous.windowEnd, normalized.windowEnd),
        }
      : normalized;
  }

  return merged;
}

function normalizeDirtyResource(
  resource: HostedDeviceSyncDirtyResource,
): HostedDeviceSyncDirtyResource {
  return {
    count: Math.max(1, Math.min(1_000_000, Math.trunc(resource.count))),
    jobKind: truncateDirtyKey(normalizeNullableString(resource.jobKind) ?? "reconcile") ?? "reconcile",
    resource: truncateDirtyKey(normalizeNullableString(resource.resource)),
    resourceCategory: truncateDirtyKey(normalizeNullableString(resource.resourceCategory)),
    sourceProviderSlug: truncateDirtyKey(normalizeNullableString(resource.sourceProviderSlug)),
    windowEnd: normalizeIso(resource.windowEnd),
    windowStart: normalizeIso(resource.windowStart),
  };
}

function buildDirtyResourceKey(resource: HostedDeviceSyncDirtyResource): string {
  return [
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
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    next[key.slice(0, DIRTY_RESOURCE_KEY_MAX_LENGTH)] = normalizeDirtyResource({
      count: typeof record.count === "number" ? record.count : 1,
      jobKind: typeof record.jobKind === "string" ? record.jobKind : "reconcile",
      resource: typeof record.resource === "string" ? record.resource : null,
      resourceCategory: typeof record.resourceCategory === "string" ? record.resourceCategory : null,
      sourceProviderSlug: typeof record.sourceProviderSlug === "string" ? record.sourceProviderSlug : null,
      windowEnd: typeof record.windowEnd === "string" ? record.windowEnd : null,
      windowStart: typeof record.windowStart === "string" ? record.windowStart : null,
    });
  }

  return next;
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
