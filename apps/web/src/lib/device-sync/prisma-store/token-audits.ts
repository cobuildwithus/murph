import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { toJsonRecord } from "../shared";
import { toNullablePrismaJsonValue } from "./prisma-json";
import type { CreateHostedTokenAuditInput, HostedTokenAuditRecord } from "./types";

type HostedTokenAuditPrismaRecord = Prisma.DeviceTokenAuditGetPayload<Prisma.DeviceTokenAuditDefaultArgs>;

export class PrismaHostedTokenAuditStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createTokenAudit(input: CreateHostedTokenAuditInput): Promise<HostedTokenAuditRecord> {
    const prisma = input.tx ?? this.prisma;
    const record = await prisma.deviceTokenAudit.create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId,
        provider: input.provider,
        action: input.action,
        channel: input.channel,
        sessionId: input.sessionId ?? null,
        tokenVersion: input.tokenVersion,
        keyVersion: input.keyVersion,
        metadataJson: toNullablePrismaJsonValue(input.metadata),
        createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      },
    });
    const audit = mapHostedTokenAuditRecord(record);
    emitHostedTokenAuditLog(audit);
    return audit;
  }
}

function mapHostedTokenAuditRecord(record: HostedTokenAuditPrismaRecord): HostedTokenAuditRecord {
  return {
    id: record.id,
    userId: record.userId,
    connectionId: record.connectionId,
    provider: record.provider,
    action: record.action as HostedTokenAuditRecord["action"],
    channel: record.channel as HostedTokenAuditRecord["channel"],
    sessionId: record.sessionId,
    tokenVersion: record.tokenVersion,
    keyVersion: record.keyVersion,
    metadata: toJsonRecord(record.metadataJson),
    createdAt: record.createdAt.toISOString(),
  } satisfies HostedTokenAuditRecord;
}

function emitHostedTokenAuditLog(record: HostedTokenAuditRecord): void {
  console.warn(JSON.stringify({
    event: "device_sync_token_audit",
    action: record.action,
    channel: record.channel,
    connectionId: record.connectionId,
    provider: record.provider,
    sessionId: record.sessionId,
    tokenVersion: record.tokenVersion,
    keyVersion: record.keyVersion,
    createdAt: record.createdAt,
    userId: record.userId,
  }));
}
