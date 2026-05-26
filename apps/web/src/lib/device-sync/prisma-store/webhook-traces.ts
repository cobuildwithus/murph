import { PrismaClient } from "@prisma/client";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
} from "@murphai/device-syncd/public-ingress";

import { buildHostedProviderAccountBlindIndex } from "../routing-index";
import { tryAcquireHostedWebhookTraceOwnerLockTx } from "../webhook-trace-owner-lock";
import type { HostedPrismaTransactionClient } from "./types";

const HOSTED_PROCESSED_WEBHOOK_TRACE_RETENTION_DAYS = 30;
const MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL = "_minimized_";

export class PrismaHostedWebhookTraceStore {
  readonly prisma: PrismaClient;
  private readonly providerAccountBlindIndexKey: Buffer | null;

  constructor(input: {
    prisma: PrismaClient;
    providerAccountBlindIndexKey?: Buffer | null;
  }) {
    this.prisma = input.prisma;
    this.providerAccountBlindIndexKey = input.providerAccountBlindIndexKey ?? null;
  }

  async claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): Promise<DeviceSyncWebhookTraceClaimResult> {
    const claimedAt = new Date(input.receivedAt);
    const processingExpiresAt = new Date(input.processingExpiresAt);
    const providerAccountBlindIndex = this.buildProviderAccountBlindIndex({
      externalAccountId: input.externalAccountId,
      provider: input.provider,
    });
    await this.pruneProcessedWebhookTraces(this.prisma, new Date());

    return this.prisma.$transaction(async (tx) => {
      const lockAcquired = await tryAcquireHostedWebhookTraceOwnerLockTx({
        prisma: tx,
        provider: input.provider,
        providerAccountBlindIndex,
      });
      if (!lockAcquired) {
        return "processing";
      }

      const existing = await tx.deviceWebhookTrace.findUnique({
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
        await tx.deviceWebhookTrace.create({
          data: {
            provider: input.provider,
            traceId: input.traceId,
            claimToken: input.claimToken,
            providerAccountBlindIndex,
            eventType: input.eventType,
            processingExpiresAt,
            receivedAt: claimedAt,
            status: "processing",
          },
        });
        return "claimed";
      }

      if (existing.status === "processed") {
        return "processed";
      }

      if (existing.processingExpiresAt && existing.processingExpiresAt.getTime() > claimedAt.getTime()) {
        return "processing";
      }

      const takeover = await tx.deviceWebhookTrace.updateMany({
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
          providerAccountBlindIndex,
          eventType: input.eventType,
          claimToken: input.claimToken,
          processingExpiresAt,
          receivedAt: claimedAt,
          status: "processing",
        },
      });

      return takeover.count > 0 ? "claimed" : "processing";
    });
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

  private buildProviderAccountBlindIndex(input: {
    externalAccountId: string;
    provider: string;
  }): string {
    if (!this.providerAccountBlindIndexKey) {
      return MINIMIZED_HOSTED_WEBHOOK_TRACE_ACCOUNT_SENTINEL;
    }

    return buildHostedProviderAccountBlindIndex({
      key: this.providerAccountBlindIndexKey,
      externalAccountId: input.externalAccountId,
      provider: input.provider,
    });
  }
}
