import { randomUUID } from "node:crypto";

import type { ClaimDeviceSyncWebhookTraceInput } from "@murphai/device-syncd/types";
import { describe, expect, it } from "vitest";

import { PrismaHostedWebhookTraceStore } from "@/src/lib/device-sync/prisma-store/webhook-traces";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error("The device webhook trace batch proof requires a local DATABASE_URL.");
}

describe.skipIf(!runPostgresProof)(
  "device webhook trace batch admission (real PostgreSQL)",
  () => {
    it("claims fresh traces set-wise and preserves processed, active, stale, and duplicate outcomes", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const provider = `batch-proof-${suffix}`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const store = new PrismaHostedWebhookTraceStore({
        prisma,
        providerAccountBlindIndexKey: Buffer.alloc(32, 23),
      });
      const claimedAt = new Date();
      const initial = Array.from({ length: 8 }, (_, index) => createClaimInput({
        claimToken: `initial-${suffix}-${index}`,
        claimedAt,
        index,
        provider,
      }));

      try {
        await expect(store.claimWebhookTraceBatch(initial)).resolves.toEqual(
          Array.from({ length: 8 }, () => "claimed"),
        );
        await expect(prisma.deviceWebhookTrace.count({ where: { provider } })).resolves.toBe(8);

        await expect(store.completeWebhookTrace(
          provider,
          initial[0]!.traceId,
          initial[0]!.claimToken,
        )).resolves.toBe(true);
        await prisma.deviceWebhookTrace.update({
          data: {
            claimToken: `expired-${suffix}`,
            processingExpiresAt: new Date(claimedAt.getTime() - 1_000),
          },
          where: {
            provider_traceId: {
              provider,
              traceId: initial[2]!.traceId,
            },
          },
        });

        const retryAt = new Date(claimedAt.getTime() + 1_000);
        const processed = createClaimInput({
          claimToken: `processed-retry-${suffix}`,
          claimedAt: retryAt,
          index: 0,
          provider,
        });
        const active = createClaimInput({
          claimToken: `active-retry-${suffix}`,
          claimedAt: retryAt,
          index: 1,
          provider,
        });
        const stale = createClaimInput({
          claimToken: `stale-takeover-${suffix}`,
          claimedAt: retryAt,
          index: 2,
          provider,
        });
        const sameInputDuplicate = {
          ...stale,
          claimToken: `same-input-duplicate-${suffix}`,
        };

        await expect(store.claimWebhookTraceBatch([
          processed,
          active,
          stale,
          sameInputDuplicate,
        ])).resolves.toEqual([
          "processed",
          "processing",
          "claimed",
          "processing",
        ]);
        await expect(prisma.deviceWebhookTrace.findUniqueOrThrow({
          select: { claimToken: true, status: true },
          where: {
            provider_traceId: {
              provider,
              traceId: stale.traceId,
            },
          },
        })).resolves.toEqual({
          claimToken: stale.claimToken,
          status: "processing",
        });
      } finally {
        await prisma.deviceWebhookTrace.deleteMany({ where: { provider } });
        await prisma.$disconnect();
      }
    });
  },
);

function createClaimInput(input: {
  claimToken: string;
  claimedAt: Date;
  index: number;
  provider: string;
}): ClaimDeviceSyncWebhookTraceInput {
  return {
    claimedAt: input.claimedAt.toISOString(),
    claimToken: input.claimToken,
    eventType: "resource.created",
    externalAccountId: `opaque-account-${input.index}`,
    processingExpiresAt: new Date(input.claimedAt.getTime() + 5 * 60_000).toISOString(),
    provider: input.provider,
    receivedAt: input.claimedAt.toISOString(),
    traceId: input.index.toString(16).padStart(64, "0"),
  };
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgresql:"
      && ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
