import { PrismaClient } from "@prisma/client";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
} from "@murphai/device-syncd/types";

import { buildHostedProviderAccountBlindIndex } from "../routing-index";
import type { HostedPrismaTransactionClient } from "./types";

// Processed-trace retention belongs to the hourly hosted retention job. This
// request-path store only claims, completes, or releases the one trace it is
// handling; a global prune on every webhook made unrelated rows the cost of
// serving a request.
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
    const claimedAt = new Date(input.claimedAt);
    const receivedAt = new Date(input.receivedAt);
    const processingExpiresAt = new Date(input.processingExpiresAt);
    const providerAccountBlindIndex = this.buildProviderAccountBlindIndex({
      externalAccountId: input.externalAccountId,
      provider: input.provider,
    });
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.deviceWebhookTrace.createMany({
        data: {
          provider: input.provider,
          traceId: input.traceId,
          claimToken: input.claimToken,
          providerAccountBlindIndex,
          eventType: input.eventType,
          processingExpiresAt,
          receivedAt,
          status: "processing",
        },
        skipDuplicates: true,
      });

      if (created.count > 0) {
        return "claimed";
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
        return "processing";
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
          receivedAt,
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
