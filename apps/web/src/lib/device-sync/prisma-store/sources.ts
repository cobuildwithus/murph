import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  DeviceConnectionSourceResourceAvailabilitySummary,
  DeviceConnectionSourceStatus,
} from "@murphai/device-syncd/client";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT } from "@murphai/device-syncd/hosted-runtime";
import {
  buildJunctionProviderSourceInstanceKey,
  canonicalizeJunctionProviderSlug,
  listJunctionDeviceConnectRouteEntries,
} from "@murphai/device-syncd/connect-config";
import {
  isDeviceSyncSourceDisconnectFenced,
} from "@murphai/device-syncd/public-account";

import {
  generateHostedRandomPrefixedId,
  maybeDate,
  normalizeNullableString,
  omitHostedSqlErrorText,
} from "../shared";
import { resolveHostedJunctionConnectionSource } from "../connection-source-lifecycle";
import { toNullablePrismaJsonValue } from "./prisma-json";
import type { HostedPrismaTransactionClient } from "./types";

export const hostedConnectionSourceRecordArgs = {
  select: {
    connectionId: true,
    createdAt: true,
    displayName: true,
    firstSeenAt: true,
    id: true,
    lastErrorCode: true,
    lastErrorMessage: true,
    lifecycleEpoch: true,
    lastSeenAt: true,
    lastDataAt: true,
    resourceAvailabilitySummaryJson: true,
    sourceInstanceKey: true,
    sourceProviderSlug: true,
    status: true,
    updatedAt: true,
  },
} satisfies Prisma.DeviceConnectionSourceDefaultArgs;

export type HostedConnectionSourceRecord =
  Prisma.DeviceConnectionSourceGetPayload<typeof hostedConnectionSourceRecordArgs>;

export type HostedConnectionSourceAdmissionCandidate = Omit<
  Pick<
    HostedConnectionSourceRecord,
    | "lastErrorCode"
    | "lastErrorMessage"
    | "lifecycleEpoch"
    | "lastSeenAt"
    | "sourceInstanceKey"
    | "sourceProviderSlug"
    | "status"
  >,
  "lifecycleEpoch" | "status"
> & {
  lifecycleEpoch: number;
  status: DeviceConnectionSourceStatus;
};

export interface HostedDeviceConnectionSource {
  id: string;
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName: string | null;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary: DeviceConnectionSourceResourceAvailabilitySummary | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lifecycleEpoch: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Last inbound payload carrying this source's data; null until one has. */
  lastDataAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertHostedDeviceConnectionSourceInput {
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName?: string | null;
  status?: DeviceConnectionSourceStatus | null;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lifecycleEpoch?: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  /** Omit to preserve the stored arrival signal; the reconcile projection must. */
  lastDataAt?: string | null;
  now?: string;
  tx?: HostedPrismaTransactionClient;
}

export interface MarkHostedDeviceConnectionSourceDataReceivedInput {
  connectionId: string;
  now?: string;
  sourceProviderSlug: string;
  tx?: HostedPrismaTransactionClient;
}

export interface MarkHostedDeviceConnectionSourcesDisconnectedInput {
  connectionId: string;
  now?: string;
  tx?: HostedPrismaTransactionClient;
}

export interface ListHostedBoundedConnectionSourcesForConnectionsInput {
  connectionIds: readonly string[];
  excludeDisconnected?: boolean;
  limitPerConnection?: number;
  sourceProviderSlugs?: readonly string[] | null;
  tx?: HostedPrismaTransactionClient;
}

type HostedBoundedConnectionSourceRecord = HostedConnectionSourceRecord & {
  projectionRowNumber: bigint | number;
};

const SAFE_SOURCE_INSTANCE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const SAFE_SOURCE_PROVIDER_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z0-9_][A-Z0-9_-]*$/u;
const SAFE_SUMMARY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const SAFE_SUMMARY_STRING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/u;
const HOSTED_CONNECTION_SOURCE_AVAILABILITY_KEY_LIMIT = 96;
const HOSTED_CONNECTION_SOURCE_LEGACY_ALIAS_EXTRA_ROW_LIMIT =
  listJunctionDeviceConnectRouteEntries().reduce(
    (count, entry) => count + (entry.route.sourceProviderSlugAliases?.length ?? 0),
    0,
  );

export class PrismaHostedConnectionSourceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async upsertConnectionSource(
    input: UpsertHostedDeviceConnectionSourceInput,
  ): Promise<HostedDeviceConnectionSource> {
    const prisma = input.tx ?? this.prisma;
    const connectionId = requireConnectionId(input.connectionId);
    const normalizedInputSourceInstanceKey = normalizeSourceInstanceKey(input.sourceInstanceKey);
    const normalizedInputSourceProviderSlug = normalizeSourceProviderSlug(input.sourceProviderSlug);
    const canonicalIdentity = resolveCanonicalHostedJunctionSourceIdentity({
      connectionId,
      sourceInstanceKey: normalizedInputSourceInstanceKey,
      sourceProviderSlug: normalizedInputSourceProviderSlug,
    });
    const sourceInstanceKey = canonicalIdentity?.sourceInstanceKey
      ?? normalizedInputSourceInstanceKey;
    const sourceProviderSlug = canonicalIdentity?.sourceProviderSlug
      ?? normalizedInputSourceProviderSlug;

    const now = resolveSourceTimestamp(input.now, new Date());
    const lastSeenAt = resolveSourceTimestamp(input.lastSeenAt, now);
    const firstSeenAt = resolveSourceTimestamp(input.firstSeenAt, lastSeenAt);
    const status = normalizeSourceStatus(input.status);
    const hasDisplayName = hasOwnInputProperty(input, "displayName");
    const hasResourceAvailabilitySummary = hasOwnInputProperty(input, "resourceAvailabilitySummary");
    const hasLastErrorCode = hasOwnInputProperty(input, "lastErrorCode");
    const hasLastErrorMessage = hasOwnInputProperty(input, "lastErrorMessage");
    const hasLifecycleEpoch = hasOwnInputProperty(input, "lifecycleEpoch");
    const hasLastDataAt = hasOwnInputProperty(input, "lastDataAt");
    const lastDataAt = hasLastDataAt ? maybeDate(input.lastDataAt) ?? null : null;
    const displayName = hasDisplayName
      ? sanitizeSourceDisplayName(input.displayName)
      : null;
    const lastErrorCode = hasLastErrorCode
      ? sanitizeSourceErrorCode(input.lastErrorCode)
      : null;
    const lastErrorMessage = hasLastErrorMessage
      ? omitHostedSqlErrorText(input.lastErrorMessage)
      : null;
    const resourceAvailabilitySummary = hasResourceAvailabilitySummary
      ? sanitizeResourceAvailabilitySummary(input.resourceAvailabilitySummary)
      : null;
    const update: Prisma.DeviceConnectionSourceUpdateInput = {
      lastSeenAt,
      sourceProviderSlug,
      status,
    };

    if (hasDisplayName) {
      update.displayName = displayName;
    }

    if (hasResourceAvailabilitySummary) {
      update.resourceAvailabilitySummaryJson = toNullablePrismaJsonValue(
        resourceAvailabilitySummary,
      );
    }

    if (hasLastErrorCode || status !== "error") {
      update.lastErrorCode = lastErrorCode;
    }

    if (hasLastErrorMessage || status !== "error") {
      update.lastErrorMessage = lastErrorMessage;
    }

    if (hasLifecycleEpoch) {
      update.lifecycleEpoch = requireSourceLifecycleEpoch(input.lifecycleEpoch);
    }

    // Only an explicit value moves the arrival signal. The reconcile projection
    // omits it, so a source the provider still lists but no longer feeds keeps
    // its real last-delivery instant.
    if (hasLastDataAt) {
      update.lastDataAt = lastDataAt;
    }

    const record = await prisma.deviceConnectionSource.upsert({
      where: {
        connectionId_sourceInstanceKey: {
          connectionId,
          sourceInstanceKey,
        },
      },
      create: {
        connectionId,
        displayName,
        firstSeenAt,
        id: generateHostedRandomPrefixedId("dcs"),
        lastErrorCode,
        lastErrorMessage,
        lifecycleEpoch: hasLifecycleEpoch
          ? requireSourceLifecycleEpoch(input.lifecycleEpoch)
          : 1,
        lastSeenAt,
        lastDataAt,
        resourceAvailabilitySummaryJson: toNullablePrismaJsonValue(resourceAvailabilitySummary),
        sourceInstanceKey,
        sourceProviderSlug,
        status,
      },
      update,
      ...hostedConnectionSourceRecordArgs,
    });

    return mapHostedConnectionSourceRecord(record);
  }

  /**
   * Records that an inbound payload carried this source's data. Matching is by
   * provider slug because that is what the webhook envelope names, and the
   * update is forward-only so an out-of-order redelivery cannot rewind the
   * signal a stall is measured against.
   *
   * This never creates a source row: a payload that arrives before the connect
   * projection recorded the source leaves nothing to stamp, and staleness falls
   * back to `first_seen_at` for a source that has never delivered.
   */
  async markConnectionSourceDataReceived(
    input: MarkHostedDeviceConnectionSourceDataReceivedInput,
  ): Promise<number> {
    const prisma = input.tx ?? this.prisma;
    const lastDataAt = resolveSourceTimestamp(input.now, new Date());
    const result = await prisma.deviceConnectionSource.updateMany({
      where: {
        connectionId: requireConnectionId(input.connectionId),
        sourceProviderSlug: normalizeSourceProviderSlug(input.sourceProviderSlug),
        OR: [
          { lastDataAt: null },
          { lastDataAt: { lt: lastDataAt } },
        ],
      },
      data: {
        lastDataAt,
        updatedAt: lastDataAt,
      },
    });

    return result.count;
  }

  async markConnectionSourcesDisconnected(
    input: MarkHostedDeviceConnectionSourcesDisconnectedInput,
  ): Promise<number> {
    const prisma = input.tx ?? this.prisma;
    const updatedAt = resolveSourceTimestamp(input.now, new Date());
    const result = await prisma.deviceConnectionSource.updateMany({
      where: {
        connectionId: requireConnectionId(input.connectionId),
        status: {
          not: "disconnected",
        },
      },
      data: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSeenAt: updatedAt,
        status: "disconnected",
        updatedAt,
      },
    });

    return result.count;
  }

  async listConnectionSources(
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]> {
    const prisma = tx ?? this.prisma;
    const normalizedConnectionId = requireConnectionId(connectionId);
    let records = await prisma.deviceConnectionSource.findMany({
      where: {
        connectionId: normalizedConnectionId,
      },
      orderBy: [
        { lastSeenAt: "desc" },
        { sourceProviderSlug: "asc" },
        { sourceInstanceKey: "asc" },
        { id: "asc" },
      ],
      ...hostedConnectionSourceRecordArgs,
    });
    if (tx) {
      const legacyIdentities = new Map<string, CanonicalHostedJunctionSourceIdentity>();
      for (const record of records) {
        const identity = resolveCanonicalHostedJunctionSourceIdentity(record);
        if (
          identity
          && (
            record.sourceInstanceKey !== identity.sourceInstanceKey
            || record.sourceProviderSlug !== identity.sourceProviderSlug
          )
        ) {
          legacyIdentities.set(identity.sourceInstanceKey, identity);
        }
      }
      for (const identity of legacyIdentities.values()) {
        await reconcileStoredCanonicalJunctionSourceIdentity({ identity, prisma, records });
      }
      if (legacyIdentities.size > 0) {
        records = await prisma.deviceConnectionSource.findMany({
          where: { connectionId: normalizedConnectionId },
          orderBy: [
            { lastSeenAt: "desc" },
            { sourceProviderSlug: "asc" },
            { sourceInstanceKey: "asc" },
            { id: "asc" },
          ],
          ...hostedConnectionSourceRecordArgs,
        });
      }
    }

    return collapseHostedConnectionSourceRecords(records)
      .map(mapHostedConnectionSourceRecord);
  }

  async resolveConnectionSourceAdmissionCandidate(input: {
    connectionId: string;
    sourceInstanceKey?: string;
    sourceProviderSlug: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedConnectionSourceAdmissionCandidate | null> {
    const prisma = input.tx ?? this.prisma;
    const connectionId = requireConnectionId(input.connectionId);
    const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug)
      ?? normalizeSourceProviderSlug(input.sourceProviderSlug);
    const sourceProviderSlugs = expandCanonicalHostedSourceProviderSlugFilter([
      sourceProviderSlug,
    ]);
    // Admission supports one established opaque identity alongside one row for
    // each current/legacy route spelling. Read one sentinel beyond that fixed
    // set so ambiguous physical state fails closed instead of choosing a
    // partial authority snapshot.
    const physicalRowLimit = sourceProviderSlugs.length + 1;
    const records = await prisma.deviceConnectionSource.findMany({
      where: {
        connectionId,
        sourceProviderSlug: { in: sourceProviderSlugs },
      },
      orderBy: [
        { lastSeenAt: "desc" },
        { sourceProviderSlug: "asc" },
        { sourceInstanceKey: "asc" },
        { id: "asc" },
      ],
      take: physicalRowLimit + 1,
      ...hostedConnectionSourceRecordArgs,
    });
    if (records.length > physicalRowLimit) {
      throw sourceContractError(
        "CONNECTION_SOURCE_SNAPSHOT_SATURATED",
        "Hosted device connection source admission exceeded its bounded semantic authority.",
      );
    }
    const semanticSources = collapseHostedConnectionSourceRecords(records)
      .map(mapHostedConnectionSourceRecord);
    const source = resolveHostedJunctionConnectionSource(
      semanticSources,
      sourceProviderSlug,
    );
    return source
      ? {
          lastErrorCode: source.lastErrorCode,
          lastErrorMessage: source.lastErrorMessage,
          lifecycleEpoch: source.lifecycleEpoch,
          lastSeenAt: new Date(source.lastSeenAt),
          sourceInstanceKey: source.sourceInstanceKey,
          sourceProviderSlug: source.sourceProviderSlug,
          status: source.status,
        }
      : null;
  }

  async listConnectionSourcesForConnections(
    connectionIds: readonly string[],
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedDeviceConnectionSource[]> {
    const prisma = tx ?? this.prisma;
    const normalizedConnectionIds = [...new Set(connectionIds.map(requireConnectionId))];

    if (normalizedConnectionIds.length === 0) {
      return [];
    }

    const records = await prisma.deviceConnectionSource.findMany({
      where: {
        connectionId: {
          in: normalizedConnectionIds,
        },
      },
      orderBy: [
        { connectionId: "asc" },
        { lastSeenAt: "desc" },
        { sourceProviderSlug: "asc" },
        { sourceInstanceKey: "asc" },
        { id: "asc" },
      ],
      ...hostedConnectionSourceRecordArgs,
    });

    return collapseHostedConnectionSourceRecords(records)
      .map(mapHostedConnectionSourceRecord);
  }

  async listBoundedConnectionSourcesForConnections(
    input: ListHostedBoundedConnectionSourcesForConnectionsInput,
  ): Promise<HostedDeviceConnectionSource[]> {
    const prisma = input.tx ?? this.prisma;
    const connectionIds = [...new Set(input.connectionIds.map(requireConnectionId))];
    if (connectionIds.length === 0) {
      return [];
    }
    const requestedLimit = input.limitPerConnection
      ?? HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT;
    const limitPerConnection = Math.min(
      requireSourceProjectionLimit(requestedLimit),
      HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
    );
    const sourceProviderSlugs = input.sourceProviderSlugs == null
      ? null
      : expandCanonicalHostedSourceProviderSlugFilter(input.sourceProviderSlugs);
    if (sourceProviderSlugs !== null && sourceProviderSlugs.length === 0) {
      return [];
    }
    const sourceFilter = sourceProviderSlugs === null
      ? Prisma.empty
      : Prisma.sql`AND source_provider_slug IN (${Prisma.join(sourceProviderSlugs)})`;
    const physicalRowLimit = limitPerConnection
      + HOSTED_CONNECTION_SOURCE_LEGACY_ALIAS_EXTRA_ROW_LIMIT
      + 1;
    const records = await prisma.$queryRaw<HostedBoundedConnectionSourceRecord[]>(
      Prisma.sql`
        SELECT
          id,
          connection_id AS "connectionId",
          source_instance_key AS "sourceInstanceKey",
          source_provider_slug AS "sourceProviderSlug",
          display_name AS "displayName",
          status,
          resource_availability_summary_json AS "resourceAvailabilitySummaryJson",
          last_error_code AS "lastErrorCode",
          last_error_message AS "lastErrorMessage",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt",
          last_data_at AS "lastDataAt",
          lifecycle_epoch AS "lifecycleEpoch",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          "projectionRowNumber"
        FROM (
          SELECT
            source.*,
            ROW_NUMBER() OVER (
              PARTITION BY connection_id
              ORDER BY
                last_seen_at DESC,
                source_provider_slug ASC,
                source_instance_key ASC,
                id ASC
            ) AS "projectionRowNumber"
          FROM device_connection_source AS source
          WHERE connection_id IN (${Prisma.join(connectionIds)})
            ${sourceFilter}
        ) AS bounded_source
        WHERE "projectionRowNumber" <= ${physicalRowLimit}
        ORDER BY
          connection_id ASC,
          last_seen_at DESC,
          source_provider_slug ASC,
          source_instance_key ASC,
          id ASC
      `,
    );

    const physicalSaturated = records.some(
      (record) => Number(record.projectionRowNumber) >= physicalRowLimit,
    );
    const projected = collapseHostedConnectionSourceRecords(records)
      .filter((record) => input.excludeDisconnected !== true || record.status !== "disconnected");
    const projectedCountsByConnection = new Map<string, number>();
    for (const record of projected) {
      projectedCountsByConnection.set(
        record.connectionId,
        (projectedCountsByConnection.get(record.connectionId) ?? 0) + 1,
      );
    }
    if (
      physicalSaturated
      || [...projectedCountsByConnection.values()].some((count) => count > limitPerConnection)
    ) {
      throw sourceContractError(
        "CONNECTION_SOURCE_SNAPSHOT_SATURATED",
        `Hosted device connection source authority exceeds the ${limitPerConnection}-row per-connection snapshot bound.`,
      );
    }

    return projected.map(mapHostedConnectionSourceRecord);
  }
}

interface CanonicalHostedJunctionSourceIdentity {
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
}

function resolveCanonicalHostedJunctionSourceIdentity(input: {
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
}): CanonicalHostedJunctionSourceIdentity | null {
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug);
  if (!sourceProviderSlug) {
    return null;
  }
  const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: input.connectionId,
    sourceProviderSlug,
  });
  if (
    !sourceInstanceKey
    || (
      sourceProviderSlug === input.sourceProviderSlug
      && sourceInstanceKey !== input.sourceInstanceKey
    )
  ) {
    return null;
  }
  return {
    connectionId: input.connectionId,
    sourceInstanceKey,
    sourceProviderSlug,
  };
}

function collapseHostedConnectionSourceRecords(
  records: readonly HostedConnectionSourceRecord[],
): HostedConnectionSourceRecord[] {
  const recordsByCanonicalKey = new Map<string, HostedConnectionSourceRecord[]>();
  const collapsed: HostedConnectionSourceRecord[] = [];

  for (const record of records) {
    const identity = resolveCanonicalHostedJunctionSourceIdentity({
      connectionId: record.connectionId,
      sourceInstanceKey: normalizeSourceInstanceKey(record.sourceInstanceKey),
      sourceProviderSlug: normalizeSourceProviderSlug(record.sourceProviderSlug),
    });
    if (!identity) {
      collapsed.push(record);
      continue;
    }
    const key = `${identity.connectionId}\u0000${identity.sourceInstanceKey}`;
    const group = recordsByCanonicalKey.get(key) ?? [];
    group.push(record);
    recordsByCanonicalKey.set(key, group);
  }

  collapsed.push(
    ...[...recordsByCanonicalKey.values()].map((groupedRecords) => {
      const first = groupedRecords[0];
      const identity = first && resolveCanonicalHostedJunctionSourceIdentity({
        connectionId: first.connectionId,
        sourceInstanceKey: first.sourceInstanceKey,
        sourceProviderSlug: first.sourceProviderSlug,
      });
      if (!identity) {
        throw new TypeError("Canonical hosted Junction source identity was lost.");
      }
      return mergeCanonicalHostedJunctionSourceRecords(identity, groupedRecords);
    }),
  );
  return collapsed.sort((left, right) =>
    left.connectionId.localeCompare(right.connectionId)
    || right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
    || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
    || left.sourceInstanceKey.localeCompare(right.sourceInstanceKey)
    || left.id.localeCompare(right.id)
  );
}

function mergeCanonicalHostedJunctionSourceRecords(
  identity: CanonicalHostedJunctionSourceIdentity,
  records: readonly HostedConnectionSourceRecord[],
): HostedConnectionSourceRecord {
  if (records.length === 0) {
    throw new TypeError("Canonical hosted Junction source reconciliation requires a stored row.");
  }
  const maxLifecycleEpoch = Math.max(
    ...records.map((record) => readSourceLifecycleEpoch(record.lifecycleEpoch)),
  );
  const statusPrecedence: Record<DeviceConnectionSourceStatus, number> = {
    connected: 1,
    unavailable: 2,
    error: 3,
    disconnected: 4,
  };
  const maxEpochRecords = records
    .filter((record) => readSourceLifecycleEpoch(record.lifecycleEpoch) === maxLifecycleEpoch)
    .sort((left, right) =>
      statusPrecedence[normalizeSourceStatus(right.status)]
      - statusPrecedence[normalizeSourceStatus(left.status)]
      || right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
      || right.updatedAt.getTime() - left.updatedAt.getTime()
      || left.id.localeCompare(right.id)
    );
  const authority = maxEpochRecords[0];
  if (!authority) {
    throw new TypeError("Canonical hosted Junction source reconciliation lost epoch authority.");
  }
  const fenceAuthority = [...maxEpochRecords]
    .filter(isDeviceSyncSourceDisconnectFenced)
    .sort((left, right) =>
      right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
      || right.updatedAt.getTime() - left.updatedAt.getTime()
      || left.id.localeCompare(right.id)
    )[0];
  const errorAuthority = fenceAuthority ?? authority;
  const canonicalRecord = records.find((record) =>
    record.sourceInstanceKey === identity.sourceInstanceKey
    && record.sourceProviderSlug === identity.sourceProviderSlug
  );
  const displayRecord = maxEpochRecords.find((record) => sanitizeSourceDisplayName(record.displayName));
  const availability: DeviceConnectionSourceResourceAvailabilitySummary = {};
  for (const record of [...records].sort((left, right) =>
    readSourceLifecycleEpoch(right.lifecycleEpoch) - readSourceLifecycleEpoch(left.lifecycleEpoch)
    || right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
    || right.updatedAt.getTime() - left.updatedAt.getTime()
    || left.id.localeCompare(right.id)
  )) {
    const summary = sanitizeResourceAvailabilitySummary(
      readResourceAvailabilitySummary(record.resourceAvailabilitySummaryJson),
    );
    for (const key of Object.keys(summary ?? {}).sort()) {
      if (Object.keys(availability).length >= HOSTED_CONNECTION_SOURCE_AVAILABILITY_KEY_LIMIT) {
        break;
      }
      if (!Object.prototype.hasOwnProperty.call(availability, key)) {
        availability[key] = summary?.[key] ?? null;
      }
    }
  }
  const firstSeenAt = new Date(Math.min(...records.map((record) => record.firstSeenAt.getTime())));
  const lastSeenAt = new Date(Math.max(...records.map((record) => record.lastSeenAt.getTime())));
  const lastDataMs = Math.max(
    ...records.map((record) => record.lastDataAt?.getTime() ?? Number.NEGATIVE_INFINITY),
  );

  return {
    ...authority,
    id: canonicalRecord?.id ?? authority.id,
    connectionId: identity.connectionId,
    createdAt: new Date(Math.min(...records.map((record) => record.createdAt.getTime()))),
    displayName: sanitizeSourceDisplayName(displayRecord?.displayName),
    firstSeenAt,
    lastDataAt: Number.isFinite(lastDataMs) ? new Date(lastDataMs) : null,
    lastErrorCode: sanitizeSourceErrorCode(errorAuthority.lastErrorCode),
    lastErrorMessage: omitHostedSqlErrorText(errorAuthority.lastErrorMessage),
    lifecycleEpoch: maxLifecycleEpoch,
    lastSeenAt,
    resourceAvailabilitySummaryJson: Object.keys(availability).length > 0 ? availability : null,
    sourceInstanceKey: identity.sourceInstanceKey,
    sourceProviderSlug: identity.sourceProviderSlug,
    status: normalizeSourceStatus(authority.status),
    updatedAt: new Date(Math.max(...records.map((record) => record.updatedAt.getTime()))),
  };
}

async function reconcileStoredCanonicalJunctionSourceIdentity(input: {
  identity: CanonicalHostedJunctionSourceIdentity;
  prisma: PrismaClient | HostedPrismaTransactionClient;
  records?: readonly HostedConnectionSourceRecord[];
}): Promise<void> {
  const records = input.records ?? await input.prisma.deviceConnectionSource.findMany({
    where: { connectionId: input.identity.connectionId },
    ...hostedConnectionSourceRecordArgs,
  });
  const groupedRecords = records.filter((record) => {
    const identity = resolveCanonicalHostedJunctionSourceIdentity({
      connectionId: record.connectionId,
      sourceInstanceKey: record.sourceInstanceKey,
      sourceProviderSlug: record.sourceProviderSlug,
    });
    return identity?.sourceInstanceKey === input.identity.sourceInstanceKey;
  });
  if (
    groupedRecords.length === 0
    || (
      groupedRecords.length === 1
      && groupedRecords[0]?.sourceInstanceKey === input.identity.sourceInstanceKey
      && groupedRecords[0]?.sourceProviderSlug === input.identity.sourceProviderSlug
    )
  ) {
    return;
  }
  const merged = mergeCanonicalHostedJunctionSourceRecords(input.identity, groupedRecords);
  const data = {
    displayName: merged.displayName,
    firstSeenAt: merged.firstSeenAt,
    lastDataAt: merged.lastDataAt,
    lastErrorCode: merged.lastErrorCode,
    lastErrorMessage: merged.lastErrorMessage,
    lifecycleEpoch: readSourceLifecycleEpoch(merged.lifecycleEpoch),
    lastSeenAt: merged.lastSeenAt,
    resourceAvailabilitySummaryJson: toNullablePrismaJsonValue(
      readResourceAvailabilitySummary(merged.resourceAvailabilitySummaryJson),
    ),
    sourceProviderSlug: input.identity.sourceProviderSlug,
    status: normalizeSourceStatus(merged.status),
  } satisfies Prisma.DeviceConnectionSourceUncheckedUpdateInput;
  const canonical = await input.prisma.deviceConnectionSource.upsert({
    where: {
      connectionId_sourceInstanceKey: {
        connectionId: input.identity.connectionId,
        sourceInstanceKey: input.identity.sourceInstanceKey,
      },
    },
    create: {
      ...data,
      connectionId: input.identity.connectionId,
      createdAt: merged.createdAt,
      id: generateHostedRandomPrefixedId("dcs"),
      sourceInstanceKey: input.identity.sourceInstanceKey,
      updatedAt: merged.updatedAt,
    },
    update: data,
    ...hostedConnectionSourceRecordArgs,
  });
  const loserIds = groupedRecords
    .filter((record) => record.id !== canonical.id)
    .map((record) => record.id);
  if (loserIds.length > 0) {
    await input.prisma.deviceConnectionSource.deleteMany({
      where: {
        connectionId: input.identity.connectionId,
        id: { in: loserIds },
      },
    });
  }
}

export function expandCanonicalHostedSourceProviderSlugFilter(values: readonly string[]): string[] {
  const normalizedValues = normalizeSourceProviderSlugList(values);
  const requestedCanonicalValues = new Set(
    normalizedValues.map((value) => canonicalizeJunctionProviderSlug(value) ?? value),
  );
  const expanded = new Set(normalizedValues);
  for (const entry of listJunctionDeviceConnectRouteEntries()) {
    if (!requestedCanonicalValues.has(entry.route.sourceProviderSlug)) {
      continue;
    }
    expanded.add(entry.route.sourceProviderSlug);
    for (const alias of entry.route.sourceProviderSlugAliases ?? []) {
      expanded.add(alias);
    }
  }
  return [...expanded];
}

export function mapHostedConnectionSourceRecord(
  record: HostedConnectionSourceRecord,
): HostedDeviceConnectionSource {
  return {
    connectionId: record.connectionId,
    createdAt: record.createdAt.toISOString(),
    displayName: sanitizeSourceDisplayName(record.displayName),
    firstSeenAt: record.firstSeenAt.toISOString(),
    id: record.id,
    lastErrorCode: sanitizeSourceErrorCode(record.lastErrorCode),
    lastErrorMessage: omitHostedSqlErrorText(record.lastErrorMessage),
    lifecycleEpoch: readSourceLifecycleEpoch(record.lifecycleEpoch),
    lastSeenAt: record.lastSeenAt.toISOString(),
    lastDataAt: record.lastDataAt?.toISOString() ?? null,
    resourceAvailabilitySummary: sanitizeResourceAvailabilitySummary(
      readResourceAvailabilitySummary(record.resourceAvailabilitySummaryJson),
    ),
    sourceInstanceKey: normalizeSourceInstanceKey(record.sourceInstanceKey),
    sourceProviderSlug: normalizeSourceProviderSlug(record.sourceProviderSlug),
    status: normalizeSourceStatus(record.status),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function requireSourceLifecycleEpoch(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw sourceContractError(
      "CONNECTION_SOURCE_LIFECYCLE_EPOCH_INVALID",
      "Hosted device connection source lifecycle epochs must be positive integers.",
    );
  }
  return value;
}

function readSourceLifecycleEpoch(value: unknown): number {
  if (value === null || value === undefined || value === 0) {
    return 1;
  }
  return requireSourceLifecycleEpoch(value);
}

function requireConnectionId(value: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw sourceContractError("CONNECTION_SOURCE_CONNECTION_REQUIRED", "Hosted device connection source requires a connection id.");
  }

  return normalized;
}

function normalizeSourceInstanceKey(value: string): string {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null;

  if (
    !normalized
    || normalized.length > 128
    || !SAFE_SOURCE_INSTANCE_KEY_PATTERN.test(normalized)
  ) {
    throw sourceContractError(
      "CONNECTION_SOURCE_INSTANCE_KEY_INVALID",
      "Hosted device connection source instance keys must be stable opaque slugs.",
    );
  }

  return normalized;
}

function normalizeSourceProviderSlug(value: string): string {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null;

  if (
    !normalized
    || normalized.length > 80
    || !SAFE_SOURCE_PROVIDER_SLUG_PATTERN.test(normalized)
  ) {
    throw sourceContractError(
      "CONNECTION_SOURCE_PROVIDER_SLUG_INVALID",
      "Hosted device connection source provider slugs must be compact public slugs.",
    );
  }

  return normalized;
}

function normalizeSourceProviderSlugList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  for (const value of values) {
    const normalized = normalizeSourceProviderSlug(value);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
}

function requireSourceProjectionLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw sourceContractError(
      "CONNECTION_SOURCE_LIST_LIMIT_INVALID",
      "Hosted device connection source snapshot limits must be positive integers.",
    );
  }

  return value;
}

function hasOwnInputProperty<T extends object>(
  input: T,
  key: PropertyKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function normalizeSourceStatus(value: string | null | undefined): DeviceConnectionSourceStatus {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? "connected";

  if (
    normalized !== "connected"
    && normalized !== "unavailable"
    && normalized !== "error"
    && normalized !== "disconnected"
  ) {
    throw sourceContractError(
      "CONNECTION_SOURCE_STATUS_INVALID",
      "Hosted device connection source status must be a supported source lifecycle value.",
    );
  }

  return normalized;
}

function sanitizeSourceDisplayName(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value?.replace(/[\u0000-\u001f\u007f]/gu, " "));

  if (!normalized) {
    return null;
  }

  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

function sanitizeSourceErrorCode(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value)?.toUpperCase() ?? null;

  if (!normalized) {
    return null;
  }

  if (normalized.length > 80 || !SAFE_ERROR_CODE_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function sanitizeResourceAvailabilitySummary(
  value: Record<string, unknown> | null | undefined,
): DeviceConnectionSourceResourceAvailabilitySummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const summary: DeviceConnectionSourceResourceAvailabilitySummary = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = sanitizeSummaryKey(rawKey);

    if (!key) {
      continue;
    }

    const scalar = sanitizeSummaryScalar(rawValue);

    if (scalar !== undefined) {
      summary[key] = scalar;
    }
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function sanitizeSummaryKey(value: string): string | null {
  const key = normalizeNullableString(value);

  if (
    !key
    || key.length > 64
    || !SAFE_SUMMARY_KEY_PATTERN.test(key)
    || isBlockedSourceSummaryKey(key)
  ) {
    return null;
  }

  return key;
}

function sanitizeSummaryScalar(value: unknown): boolean | number | string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeNullableString(value);

  if (
    !normalized
    || normalized.length > 64
    || !SAFE_SUMMARY_STRING_PATTERN.test(normalized)
    || isBlockedSourceSummaryScalar(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

function isBlockedSourceSummaryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, "");

  return isBlockedSourceSummaryNormalizedText(normalized);
}

function isBlockedSourceSummaryScalar(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, "");

  return isBlockedSourceSummaryNormalizedText(normalized);
}

function isBlockedSourceSummaryNormalizedText(normalized: string): boolean {
  return normalized === "id"
    || normalized.includes("accountid")
    || normalized.includes("clientuserid")
    || normalized.includes("deviceid")
    || normalized.includes("externalid")
    || normalized.includes("hmac")
    || normalized.includes("imei")
    || normalized.includes("macaddress")
    || normalized.includes("ownerid")
    || normalized.includes("raw")
    || normalized.includes("secret")
    || normalized.includes("serial")
    || normalized.includes("sourceid")
    || normalized.includes("token")
    || normalized.includes("userid");
}

function readResourceAvailabilitySummary(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function resolveSourceTimestamp(value: string | null | undefined, fallback: Date): Date {
  return maybeDate(value) ?? fallback;
}

function sourceContractError(code: string, message: string): Error {
  return deviceSyncError({
    code,
    message,
    retryable: false,
    httpStatus: 400,
  });
}
