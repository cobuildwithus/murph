import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { normalizeNullableString, sanitizeHostedSqlErrorText } from "../shared";
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
        revokeWarningMessage: sanitizeHostedSqlErrorText(input.revokeWarning?.message),
        createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      },
    });

    return mapHostedSignalRecord(record);
  }

  async listSignalsForUser(userId: string, options: { afterId?: number; limit?: number } = {}): Promise<HostedSignalRecord[]> {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const records = await this.prisma.deviceSyncSignal.findMany({
      where: {
        userId,
        ...(typeof options.afterId === "number"
          ? {
              id: {
                gt: options.afterId,
              },
            }
          : {}),
      },
      orderBy: {
        id: "asc",
      },
      take: limit,
    });

    return records.map((record) => mapHostedSignalRecord(record));
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
    revokeWarning: record.revokeWarningCode || sanitizeHostedSqlErrorText(record.revokeWarningMessage)
      ? {
          ...(record.revokeWarningCode ? { code: record.revokeWarningCode } : {}),
          ...(sanitizeHostedSqlErrorText(record.revokeWarningMessage)
            ? { message: sanitizeHostedSqlErrorText(record.revokeWarningMessage) }
            : {}),
        }
      : null,
    createdAt: record.createdAt.toISOString(),
  } satisfies HostedSignalRecord;
}
