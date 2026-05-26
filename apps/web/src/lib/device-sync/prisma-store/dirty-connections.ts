import { Prisma, PrismaClient } from "@prisma/client";
import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import { serializeHostedExecutionDeviceSyncDirtyPayloadIdentity } from "@murphai/device-syncd/hosted-runtime";

import {
  normalizeNullableString,
  sha256Hex,
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

const DIRTY_COUNTER_KEY_MAX_LENGTH = 96;
const DIRTY_RESOURCE_KEY_MAX_LENGTH = 256;
const DIRTY_RESOURCE_PAYLOAD_STRING_MAX_LENGTH = 512;
const DIRTY_RESOURCE_PAYLOAD_WEBHOOK_DATA_JSON_MAX_LENGTH = 64_000;
const DIRTY_RESOURCE_PAYLOAD_BLOCKED_KEY_PATTERN =
  /(?:authorization|authheader|bearer|clientsecret|cookie|credential|password|secret|token|apikey)/iu;
const DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS = 12;
const HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE = "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION";

export class PrismaHostedDirtyConnectionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async upsertDirtyConnection(
    input: UpsertHostedDeviceSyncDirtyConnectionInput,
  ): Promise<UpsertHostedDeviceSyncDirtyConnectionResult> {
    if (!input.tx) {
      return this.prisma.$transaction((tx) =>
        this.upsertDirtyConnection({
          ...input,
          tx,
        }),
      );
    }

    const prisma = input.tx;
    const dirtyAt = new Date(input.dirtyAt);

    for (let attempt = 0; attempt < DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS; attempt += 1) {
      const existing = await prisma.deviceSyncDirtyConnection.findUnique({
        where: {
          connectionId: input.connectionId,
        },
      });

      if (!existing) {
        const resources = mergeDirtyResources({}, input.resources ?? []);
        const counters = buildDirtyCounters(resources);
        const created = await prisma.deviceSyncDirtyConnection.createMany({
          data: {
            connectionId: input.connectionId,
            userId: input.userId,
            provider: input.provider,
            dirtyRevision: 1n,
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
          skipDuplicates: true,
        });

        if (created.count === 0) {
          await waitForDirtyStateRetry(attempt);
          continue;
        }

        const record = await prisma.deviceSyncDirtyConnection.findUnique({
          where: {
            connectionId: input.connectionId,
          },
        });
        if (!record) {
          await waitForDirtyStateRetry(attempt);
          continue;
        }

        return {
          dirty: mapDirtyConnectionRecord(record),
          shouldRequestWake: true,
        };
      }

      const becameDirty = existing.processedRevision >= existing.dirtyRevision;
      const priorResources = becameDirty ? {} : readDirtyResourcesJson(existing.dirtyResourcesJson);
      const resources = mergeDirtyResources(priorResources, input.resources ?? []);
      const counters = buildDirtyCounters(resources);
      const dirtyWindowStart = resolveDirtyWindowStart(resources);
      const dirtyWindowEnd = resolveDirtyWindowEnd(resources);
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
        await waitForDirtyStateRetry(attempt);
        continue;
      }

      const record = await prisma.deviceSyncDirtyConnection.findUnique({
        where: {
          connectionId: input.connectionId,
        },
      });
      if (!record) {
        await waitForDirtyStateRetry(attempt);
        continue;
      }

      return {
        dirty: mapDirtyConnectionRecord(record),
        shouldRequestWake: becameDirty,
      };
    }

    throw createDirtyStateContentionError("update");
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
        "dirty"."user_id",
        count(*)::bigint as "dirty_connection_count",
        max("dirty"."latest_dirty_at") as "latest_dirty_at"
      from "device_sync_dirty_connection" as "dirty"
      join "device_connection" as "connection"
        on "connection"."id" = "dirty"."connection_id"
        and "connection"."user_id" = "dirty"."user_id"
      join "hosted_member" as "member"
        on "member"."id" = "dirty"."user_id"
      where "dirty"."dirty_revision" > "dirty"."processed_revision"
        and "dirty"."latest_dirty_at" <= ${input.staleBefore}
        and "connection"."status" = 'active'
        and "member"."billing_status" = 'active'
        and "member"."suspended_at" is null
      group by "dirty"."user_id"
      order by max("dirty"."latest_dirty_at") asc, "dirty"."user_id" asc
      limit ${limit}
    `);

    return rows.map((row) => ({
      dirtyConnectionCount: row.dirty_connection_count,
      latestDirtyAt: toIsoTimestamp(row.latest_dirty_at),
      userId: row.user_id,
    }));
  }

  async listDirtyConnectionsForSweep(input: {
    limit: number;
    staleBefore: Date;
  }): Promise<Array<{
    connectionId: string;
    dirtyRevision: bigint;
    latestDirtyAt: string;
    latestEventType: string | null;
    latestResourceCategory: string | null;
    latestTraceId: string | null;
    provider: string;
    userId: string;
  }>> {
    const limit = Math.max(1, Math.min(input.limit, 251));
    const rows = await this.prisma.$queryRaw<Array<{
      connection_id: string;
      dirty_revision: bigint;
      latest_dirty_at: Date;
      latest_event_type: string | null;
      latest_resource_category: string | null;
      latest_trace_id: string | null;
      provider: string;
      user_id: string;
    }>>(Prisma.sql`
      select
        "dirty"."connection_id",
        "dirty"."dirty_revision",
        "dirty"."latest_dirty_at",
        "dirty"."latest_event_type",
        "dirty"."latest_resource_category",
        "dirty"."latest_trace_id",
        "dirty"."provider",
        "dirty"."user_id"
      from "device_sync_dirty_connection" as "dirty"
      join "device_connection" as "connection"
        on "connection"."id" = "dirty"."connection_id"
        and "connection"."user_id" = "dirty"."user_id"
      join "hosted_member" as "member"
        on "member"."id" = "dirty"."user_id"
      where "dirty"."dirty_revision" > "dirty"."processed_revision"
        and "dirty"."latest_dirty_at" <= ${input.staleBefore}
        and "connection"."status" = 'active'
        and "member"."billing_status" = 'active'
        and "member"."suspended_at" is null
      order by "dirty"."latest_dirty_at" asc, "dirty"."connection_id" asc
      limit ${limit}
    `);

    return rows.map((row) => ({
      connectionId: row.connection_id,
      dirtyRevision: row.dirty_revision,
      latestDirtyAt: toIsoTimestamp(row.latest_dirty_at),
      latestEventType: row.latest_event_type,
      latestResourceCategory: row.latest_resource_category,
      latestTraceId: row.latest_trace_id,
      provider: row.provider,
      userId: row.user_id,
    }));
  }

  async markDirtyConnectionProcessed(input: {
    connectionId: string;
    processedRevision: bigint;
    userId: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedDeviceSyncDirtyConnectionRecord | null> {
    if (!input.tx) {
      return this.prisma.$transaction((tx) =>
        this.markDirtyConnectionProcessed({
          ...input,
          tx,
        }),
      );
    }

    const prisma = input.tx;

    for (let attempt = 0; attempt < DIRTY_CONNECTION_WRITE_MAX_ATTEMPTS; attempt += 1) {
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
        await waitForDirtyStateRetry(attempt);
        continue;
      }

      const record = await prisma.deviceSyncDirtyConnection.findFirst({
        where: {
          connectionId: input.connectionId,
          userId: input.userId,
        },
      });

      return record ? mapDirtyConnectionRecord(record) : null;
    }

    throw createDirtyStateContentionError("ack");
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

async function waitForDirtyStateRetry(attempt: number): Promise<void> {
  const delayMs = Math.min(25, 2 + attempt * 2 + Math.floor(Math.random() * 3));
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
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
      const maxLength = normalizedKey.toLowerCase() === "webhookdatajson"
        ? DIRTY_RESOURCE_PAYLOAD_WEBHOOK_DATA_JSON_MAX_LENGTH
        : DIRTY_RESOURCE_PAYLOAD_STRING_MAX_LENGTH;
      payload[normalizedKey] = entry.slice(0, maxLength);
    } else if (typeof entry === "boolean") {
      payload[normalizedKey] = entry;
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      payload[normalizedKey] = entry;
    }
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
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
