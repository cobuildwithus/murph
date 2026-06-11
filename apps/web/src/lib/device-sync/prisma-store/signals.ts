import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

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
   * Bounded newest-first read of durable webhook receipt signals
   * (`kind: "webhook_hint"`) for a set of connections. This is read-only
   * companion/status evidence over the existing signal ledger; rows are
   * written once per durably accepted provider webhook.
   */
  async listRecentConnectionWebhookSignals(input: {
    userId: string;
    connectionIds: readonly string[];
    limit?: number;
  }): Promise<HostedSignalRecord[]> {
    if (input.connectionIds.length === 0) {
      return [];
    }

    const limit = Math.min(
      Math.max(input.limit ?? DEFAULT_WEBHOOK_SIGNAL_READ_LIMIT, 1),
      MAX_WEBHOOK_SIGNAL_READ_LIMIT,
    );
    // userId is required both as an ownership guard and so the newest-first
    // read can walk the existing (userId, id) index.
    const records = await this.prisma.deviceSyncSignal.findMany({
      where: {
        userId: input.userId,
        connectionId: { in: [...input.connectionIds] },
        kind: "webhook_hint",
      },
      orderBy: { id: "desc" },
      take: limit,
    });

    return records.map(mapHostedSignalRecord);
  }
}

const DEFAULT_WEBHOOK_SIGNAL_READ_LIMIT = 300;
const MAX_WEBHOOK_SIGNAL_READ_LIMIT = 500;

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
    reason: record.reason,
    nextReconcileAt: record.nextReconcileAt?.toISOString() ?? null,
    revokeWarning: record.revokeWarningCode ? { code: record.revokeWarningCode } : null,
    createdAt: record.createdAt.toISOString(),
  } satisfies HostedSignalRecord;
}
