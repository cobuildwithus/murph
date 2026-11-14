import { Prisma, PrismaClient } from "@prisma/client";

import { normalizeNullableString, omitHostedSqlErrorText } from "../shared";
import type { CreateHostedSignalInput, HostedSignalRecord } from "./types";

type HostedSignalPrismaRecord = Prisma.DeviceSyncSignalGetPayload<Prisma.DeviceSyncSignalDefaultArgs>;

export class PrismaHostedSignalStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createSignal(input: CreateHostedSignalInput): Promise<HostedSignalRecord> {
    const prisma = input.tx ?? this.prisma;
    const record = await prisma.deviceSyncSignal.create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId ?? null,
        provider: input.provider,
        kind: input.kind,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
        traceId: normalizeNullableString(input.traceId),
        eventType: normalizeNullableString(input.eventType),
        resourceCategory: normalizeNullableString(input.resourceCategory),
        sourceProviderSlug: normalizeNullableString(input.sourceProviderSlug),
        reason: normalizeNullableString(input.reason),
        nextReconcileAt: input.nextReconcileAt ? new Date(input.nextReconcileAt) : null,
        revokeWarningCode: normalizeNullableString(input.revokeWarning?.code),
        revokeWarningMessage: omitHostedSqlErrorText(input.revokeWarning?.message),
        createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      },
    });

    return mapHostedSignalRecord(record);
  }

  /**
   * Bounded read of durable data-receipt evidence for a set of connections.
   * Provider webhooks prove accepted push delivery; canonical import rows
   * prove that an exact pull payload reached its durable owner.
   *
   * Scoped to one source, it returns each event type's latest receipt per
   * connection, so a kind that comes in weekly keeps its time beside kinds
   * that come in every few minutes. Unscoped, it stays newest-first.
   */
  async listRecentConnectionStatusSignals(input: {
    userId: string;
    connectionIds: readonly string[];
    sourceProviderSlug?: string | null;
    limit?: number;
  }): Promise<HostedSignalRecord[]> {
    if (input.connectionIds.length === 0) {
      return [];
    }

    const limit = Math.min(
      Math.max(input.limit ?? DEFAULT_STATUS_SIGNAL_READ_LIMIT, 1),
      MAX_STATUS_SIGNAL_READ_LIMIT,
    );
    if (input.sourceProviderSlug) {
      // Walks the (userId, sourceProviderSlug, id) index. Receipt time is the
      // same one companion status reads: an import's completion, else when
      // Murph accepted the row.
      const records = await this.prisma.$queryRaw<HostedSignalPrismaRecord[]>(Prisma.sql`
        SELECT DISTINCT ON (connection_id, kind, event_type)
          id,
          user_id AS "userId",
          connection_id AS "connectionId",
          provider,
          kind,
          occurred_at AS "occurredAt",
          trace_id AS "traceId",
          event_type AS "eventType",
          resource_category AS "resourceCategory",
          source_provider_slug AS "sourceProviderSlug",
          reason,
          next_reconcile_at AS "nextReconcileAt",
          revoke_warning_code AS "revokeWarningCode",
          revoke_warning_message AS "revokeWarningMessage",
          created_at AS "createdAt"
        FROM device_sync_signal
        WHERE user_id = ${input.userId}
          AND source_provider_slug = ${input.sourceProviderSlug}
          AND connection_id IN (${Prisma.join([...input.connectionIds])})
          AND kind IN (${Prisma.join(STATUS_SIGNAL_KINDS)})
          AND event_type IS NOT NULL
        ORDER BY
          connection_id,
          kind,
          event_type,
          CASE WHEN kind = 'canonical_import' THEN COALESCE(occurred_at, created_at) ELSE created_at END DESC,
          id DESC
        LIMIT ${limit}
      `);

      return records.map(mapHostedSignalRecord);
    }

    // userId is required both as an ownership guard and so the newest-first
    // read can walk the existing (userId, id) index.
    const records = await this.prisma.deviceSyncSignal.findMany({
      where: {
        userId: input.userId,
        connectionId: { in: [...input.connectionIds] },
        kind: { in: [...STATUS_SIGNAL_KINDS] },
      },
      orderBy: { id: "desc" },
      take: limit,
    });

    return records.map(mapHostedSignalRecord);
  }
}

const STATUS_SIGNAL_KINDS = ["webhook_hint", "canonical_import"] as const;
const DEFAULT_STATUS_SIGNAL_READ_LIMIT = 300;
const MAX_STATUS_SIGNAL_READ_LIMIT = 500;

function mapHostedSignalRecord(record: HostedSignalPrismaRecord): HostedSignalRecord {
  return {
    id: record.id,
    userId: record.userId,
    connectionId: record.connectionId,
    provider: record.provider,
    kind: record.kind,
    occurredAt: record.occurredAt?.toISOString() ?? null,
    traceId: record.traceId,
    eventType: record.eventType,
    resourceCategory: record.resourceCategory,
    sourceProviderSlug: record.sourceProviderSlug,
    reason: record.reason,
    nextReconcileAt: record.nextReconcileAt?.toISOString() ?? null,
    revokeWarning: record.revokeWarningCode ? { code: record.revokeWarningCode } : null,
    createdAt: record.createdAt.toISOString(),
  } satisfies HostedSignalRecord;
}
