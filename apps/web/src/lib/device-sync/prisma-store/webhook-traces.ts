import { Prisma, PrismaClient } from "@prisma/client";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
} from "@murph/device-syncd";

import { isUniqueViolation } from "./prisma-errors";
import type { HostedPrismaTransactionClient } from "./types";

export class PrismaHostedWebhookTraceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): Promise<DeviceSyncWebhookTraceClaimResult> {
    const claimedAt = new Date(input.receivedAt);
    const processingExpiresAt = new Date(input.processingExpiresAt);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.prisma.deviceWebhookTrace.create({
          data: {
            provider: input.provider,
            traceId: input.traceId,
            externalAccountId: input.externalAccountId,
            eventType: input.eventType,
            processingExpiresAt,
            receivedAt: claimedAt,
            payloadJson: Prisma.DbNull,
            status: "processing",
          },
        });
        return "claimed";
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }

      const existing = await this.prisma.deviceWebhookTrace.findUnique({
        where: {
          provider_traceId: {
            provider: input.provider,
            traceId: input.traceId,
          },
        },
        select: {
          processingExpiresAt: true,
          status: true,
        },
      });

      if (!existing) {
        continue;
      }

      if (existing.status === "processed") {
        return "processed";
      }

      if (existing.processingExpiresAt && existing.processingExpiresAt.getTime() > claimedAt.getTime()) {
        return "processing";
      }

      const takeover = await this.prisma.deviceWebhookTrace.updateMany({
        where: {
          provider: input.provider,
          traceId: input.traceId,
          status: "processing",
          OR: [
            {
              processingExpiresAt: null,
            },
            {
              processingExpiresAt: {
                lte: claimedAt,
              },
            },
          ],
        },
        data: {
          externalAccountId: input.externalAccountId,
          eventType: input.eventType,
          payloadJson: Prisma.DbNull,
          processingExpiresAt,
          receivedAt: claimedAt,
          status: "processing",
        },
      });

      return takeover.count > 0 ? "claimed" : "processing";
    }

    return "processing";
  }

  async completeWebhookTrace(
    provider: string,
    traceId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<void> {
    const prisma = tx ?? this.prisma;
    await prisma.deviceWebhookTrace.updateMany({
      where: {
        provider,
        traceId,
        status: "processing",
      },
      data: {
        processingExpiresAt: null,
        status: "processed",
      },
    });
  }

  async releaseWebhookTrace(provider: string, traceId: string): Promise<void> {
    await this.prisma.deviceWebhookTrace.deleteMany({
      where: {
        provider,
        traceId,
        status: "processing",
      },
    });
  }
}
