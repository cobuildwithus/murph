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
}

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
