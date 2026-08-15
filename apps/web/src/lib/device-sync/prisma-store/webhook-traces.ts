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
const HOSTED_WEBHOOK_TRACE_CLAIM_BATCH_MAX_SIZE = 16;

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

  async claimWebhookTraceBatch(
    inputs: readonly ClaimDeviceSyncWebhookTraceInput[],
  ): Promise<DeviceSyncWebhookTraceClaimResult[]> {
    if (inputs.length === 0) return [];
    if (inputs.length > HOSTED_WEBHOOK_TRACE_CLAIM_BATCH_MAX_SIZE) {
      throw new RangeError(
        `Hosted webhook trace claim batches cannot exceed ${HOSTED_WEBHOOK_TRACE_CLAIM_BATCH_MAX_SIZE} entries.`,
      );
    }

    const firstByKey = new Map<string, ClaimDeviceSyncWebhookTraceInput>();
    for (const input of inputs) {
      const key = buildWebhookTraceKey(input.provider, input.traceId);
      if (!firstByKey.has(key)) firstByKey.set(key, input);
    }
    const uniqueInputs = [...firstByKey.values()];
    const prepared = uniqueInputs.map((input) => ({
      claimedAt: new Date(input.claimedAt),
      input,
      processingExpiresAt: new Date(input.processingExpiresAt),
      providerAccountBlindIndex: this.buildProviderAccountBlindIndex({
        externalAccountId: input.externalAccountId,
        provider: input.provider,
      }),
      receivedAt: new Date(input.receivedAt),
    }));

    const firstResults = await this.prisma.$transaction(async (tx) => {
      await tx.deviceWebhookTrace.createMany({
        data: prepared.map((entry) => ({
          provider: entry.input.provider,
          traceId: entry.input.traceId,
          claimToken: entry.input.claimToken,
          providerAccountBlindIndex: entry.providerAccountBlindIndex,
          eventType: entry.input.eventType,
          processingExpiresAt: entry.processingExpiresAt,
          receivedAt: entry.receivedAt,
          status: "processing",
        })),
        skipDuplicates: true,
      });

      const rows = await tx.deviceWebhookTrace.findMany({
        where: {
          OR: prepared.map((entry) => ({
            provider: entry.input.provider,
            traceId: entry.input.traceId,
          })),
        },
        select: {
          claimToken: true,
          processingExpiresAt: true,
          provider: true,
          status: true,
          traceId: true,
        },
      });
      const rowsByKey = new Map(rows.map((row) => [
        buildWebhookTraceKey(row.provider, row.traceId),
        row,
      ]));
      const results = new Map<string, DeviceSyncWebhookTraceClaimResult>();

      for (const entry of prepared) {
        const key = buildWebhookTraceKey(entry.input.provider, entry.input.traceId);
        const row = rowsByKey.get(key);
        if (!row) {
          results.set(key, "processing");
          continue;
        }
        if (row.status === "processed") {
          results.set(key, "processed");
          continue;
        }
        if (row.claimToken === entry.input.claimToken) {
          results.set(key, "claimed");
          continue;
        }
        if (
          row.processingExpiresAt
          && row.processingExpiresAt.getTime() > entry.claimedAt.getTime()
        ) {
          results.set(key, "processing");
          continue;
        }

        const takeover = await tx.deviceWebhookTrace.updateMany({
          where: {
            provider: entry.input.provider,
            traceId: entry.input.traceId,
            status: "processing",
            OR: [
              { processingExpiresAt: null },
              { processingExpiresAt: { lte: entry.claimedAt } },
            ],
          },
          data: {
            providerAccountBlindIndex: entry.providerAccountBlindIndex,
            eventType: entry.input.eventType,
            claimToken: entry.input.claimToken,
            processingExpiresAt: entry.processingExpiresAt,
            receivedAt: entry.receivedAt,
            status: "processing",
          },
        });
        results.set(key, takeover.count > 0 ? "claimed" : "processing");
      }
      return results;
    });

    const seen = new Set<string>();
    return inputs.map((input) => {
      const key = buildWebhookTraceKey(input.provider, input.traceId);
      const firstResult = firstResults.get(key) ?? "processing";
      if (!seen.has(key)) {
        seen.add(key);
        return firstResult;
      }
      return firstResult === "processed" ? "processed" : "processing";
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

function buildWebhookTraceKey(provider: string, traceId: string): string {
  return `${provider}\u0000${traceId}`;
}
