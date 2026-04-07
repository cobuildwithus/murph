import { PrismaClient } from "@prisma/client";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
} from "@murphai/device-syncd/public-ingress";

import { buildHostedProviderAccountBlindIndex } from "../crypto";
import { isUniqueViolation } from "./prisma-errors";
import type { HostedPrismaTransactionClient } from "./types";

export class PrismaHostedWebhookTraceStore {
  readonly prisma: PrismaClient;
  private readonly providerAccountBlindIndexKey: Buffer | null;

  constructor(input: { prisma: PrismaClient; providerAccountBlindIndexKey?: Buffer | null }) {
    this.prisma = input.prisma;
    this.providerAccountBlindIndexKey = input.providerAccountBlindIndexKey ?? null;
  }

  async claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): Promise<DeviceSyncWebhookTraceClaimResult> {
    const claimedAt = new Date(input.receivedAt);
    const processingExpiresAt = new Date(input.processingExpiresAt);
    const providerAccountBlindIndex = this.buildProviderAccountBlindIndex(input.provider, input.externalAccountId);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.prisma.deviceWebhookTrace.create({
          data: {
            provider: input.provider,
            traceId: input.traceId,
            providerAccountBlindIndex,
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
          providerAccountBlindIndex,
          eventType: input.eventType,
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

  private buildProviderAccountBlindIndex(provider: string, externalAccountId: string): string {
    if (!this.providerAccountBlindIndexKey) {
      throw new TypeError("Hosted device-sync provider account blind-index key is required.");
    }

    return buildHostedProviderAccountBlindIndex({
      key: this.providerAccountBlindIndexKey,
      provider,
      externalAccountId,
    });
  }
}
