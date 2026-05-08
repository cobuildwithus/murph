import { PrismaClient } from "@prisma/client";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
} from "@murphai/device-syncd/public-ingress";

import { isUniqueViolation } from "./prisma-errors";
import type { HostedPrismaTransactionClient } from "./types";

const HOSTED_PROCESSED_WEBHOOK_TRACE_RETENTION_DAYS = 30;
// Hosted webhook dedupe is keyed by provider + trace id, so trace rows do not
// need a user-linked provider-account blind index.
const MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL = "_minimized_";

export class PrismaHostedWebhookTraceStore {
  readonly prisma: PrismaClient;

  constructor(input: { prisma: PrismaClient }) {
    this.prisma = input.prisma;
  }

  async claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): Promise<DeviceSyncWebhookTraceClaimResult> {
    const claimedAt = new Date(input.receivedAt);
    const processingExpiresAt = new Date(input.processingExpiresAt);
    await this.pruneProcessedWebhookTraces(this.prisma, new Date());

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.prisma.deviceWebhookTrace.create({
          data: {
            provider: input.provider,
            traceId: input.traceId,
            claimToken: input.claimToken,
            providerAccountBlindIndex: MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL,
            eventType: input.eventType,
            processingExpiresAt,
            receivedAt: claimedAt,
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
          providerAccountBlindIndex: MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL,
          eventType: input.eventType,
          claimToken: input.claimToken,
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
    claimToken: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<boolean> {
    const prisma = tx ?? this.prisma;
    const result = await prisma.deviceWebhookTrace.updateMany({
      where: {
        provider,
        traceId,
        claimToken,
        status: "processing",
      },
      data: {
        claimToken: null,
        processingExpiresAt: null,
        status: "processed",
      },
    });

    await this.pruneProcessedWebhookTraces(prisma, new Date());
    return result.count > 0;
  }

  async releaseWebhookTrace(provider: string, traceId: string, claimToken: string): Promise<void> {
    await this.prisma.deviceWebhookTrace.deleteMany({
      where: {
        provider,
        traceId,
        claimToken,
        status: "processing",
      },
    });

    await this.pruneProcessedWebhookTraces(this.prisma, new Date());
  }

  private async pruneProcessedWebhookTraces(
    prisma: HostedPrismaTransactionClient | PrismaClient,
    referenceNow: Date,
  ): Promise<void> {
    const retentionCutoff = new Date(
      referenceNow.getTime() - HOSTED_PROCESSED_WEBHOOK_TRACE_RETENTION_DAYS * 86_400_000,
    );

    await prisma.deviceWebhookTrace.deleteMany({
      where: {
        status: "processed",
        receivedAt: {
          lt: retentionCutoff,
        },
      },
    });
  }
}
