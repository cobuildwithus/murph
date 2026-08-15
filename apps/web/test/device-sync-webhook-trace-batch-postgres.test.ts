import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
  type DeviceWebhookQueuePayloadV1,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import {
  createDeviceSyncPublicIngress,
  createDeviceSyncRegistry,
} from "@murphai/device-syncd/public-ingress";
import { DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA } from "@murphai/device-syncd/prepared-webhook";
import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncWebhookTraceClaimResult,
} from "@murphai/device-syncd/types";
import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { PrismaHostedWebhookTraceStore } from "@/src/lib/device-sync/prisma-store/webhook-traces";
import { admitHostedDeviceWebhookBatch } from "@/src/lib/device-sync/webhook-batch";
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

    it("composes the 100-entry scheduler with hosted ingress and Prisma under the historical account skew", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const scalarProvider = `scalar-proof-${suffix}`;
      const batchProvider = `batch-proof-${suffix}`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const scalarMetrics = createDatabaseOperationMetrics();
      const batchMetrics = createDatabaseOperationMetrics();
      const scalarStore = new InstrumentedDeviceSyncControlPlaneStore({
        metrics: scalarMetrics,
        prisma,
      });
      const batchStore = new InstrumentedDeviceSyncControlPlaneStore({
        metrics: batchMetrics,
        prisma,
      });
      const scalarIngress = createDeviceSyncPublicIngress({
        publicBaseUrl: "https://sync.example.test/device-sync",
        registry: createDeviceSyncRegistry([]),
        store: scalarStore,
      });
      const batchIngress = createDeviceSyncPublicIngress({
        publicBaseUrl: "https://sync.example.test/device-sync",
        registry: createDeviceSyncRegistry([]),
        store: batchStore,
      });
      const accountIds = Array.from({ length: 100 }, (_, index) =>
        index < 65 ? "hot-account" : `independent-account-${Math.floor((index - 65) / 5)}`);
      const scalarEntries = accountIds.map((accountId, index) =>
        createQueuePayload({ accountId, index, provider: scalarProvider }));
      const batchEntries = accountIds.map((accountId, index) =>
        createQueuePayload({ accountId, index, provider: batchProvider }));

      try {
        const scalarStartedAt = performance.now();
        for (const entry of scalarEntries) {
          await expect(
            scalarIngress.handlePreparedWebhook(entry.preparedWebhook),
          ).resolves.toMatchObject({ accepted: true, duplicate: false });
        }
        const scalarDurationMs = performance.now() - scalarStartedAt;

        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const batchStartedAt = performance.now();
        const batchResult = await admitHostedDeviceWebhookBatch({
          entries: batchEntries,
          handleBatch: (entries) => batchIngress.handlePreparedWebhookBatch(
            entries.map((entry) => entry.preparedWebhook),
          ),
        });
        const batchDurationMs = performance.now() - batchStartedAt;
        info.mockRestore();

        expect(batchResult.entries).toHaveLength(100);
        expect(batchResult.entries.every((entry) => entry.disposition === "accepted")).toBe(true);
        expect(batchMetrics.scalarClaimTransactions).toBe(1);
        expect(batchMetrics.batchClaimTransactions).toBe(15);
        expect(batchMetrics.completedTransactions).toBe(100);
        expect(batchMetrics.maxActiveDatabaseOperations).toBe(4);
        expect(scalarMetrics.scalarClaimTransactions).toBe(100);
        expect(scalarMetrics.batchClaimTransactions).toBe(0);
        expect(scalarMetrics.completedTransactions).toBe(100);
        expect(scalarMetrics.maxActiveDatabaseOperations).toBe(1);

        const hotTraceIds = batchEntries.slice(0, 65).map(
          (entry) => entry.preparedWebhook.traceId,
        );
        expect(batchMetrics.claimedTraceIdsByAccount.get("hot-account")).toEqual(hotTraceIds);
        expect(batchMetrics.completedTraceIds.filter((traceId) =>
          hotTraceIds.includes(traceId))).toEqual(hotTraceIds);

        const scalarQueryCount = scalarMetrics.scalarClaimTransactions
          + scalarMetrics.completedTransactions;
        const batchQueryCount = batchMetrics.scalarClaimTransactions
          + batchMetrics.batchClaimTransactions * 2
          + batchMetrics.completedTransactions;
        expect(scalarQueryCount).toBe(200);
        expect(batchQueryCount).toBe(131);

        const modeledStormAccountCounts = [17_450, 4_650, 4_650] as const;
        const modeledBatchClaimTransactions = modeledStormAccountCounts.reduce(
          (total, count) => total + Math.ceil(count / 8),
          0,
        );
        const modeledScalarTransactions = 26_750 * 2;
        const modeledBatchTransactions = 26_750 + modeledBatchClaimTransactions;
        const modeledBatchQueries = 26_750 + modeledBatchClaimTransactions * 2;
        expect(modeledBatchClaimTransactions).toBe(3_346);
        expect(modeledBatchTransactions).toBe(30_096);
        expect(modeledBatchQueries).toBe(33_442);
        expect(modeledBatchTransactions / modeledScalarTransactions).toBeLessThan(0.57);

        console.info("Device webhook composed PostgreSQL load proof completed.", {
          batchDurationMs: Math.round(batchDurationMs),
          batchQueryCount,
          batchTransactions: batchMetrics.scalarClaimTransactions
            + batchMetrics.batchClaimTransactions
            + batchMetrics.completedTransactions,
          maxActiveDatabaseOperations: batchMetrics.maxActiveDatabaseOperations,
          modeledBatchQueries,
          modeledBatchTransactions,
          modeledEvents: 26_750,
          scalarDurationMs: Math.round(scalarDurationMs),
          scalarQueryCount,
          scalarTransactions: scalarMetrics.scalarClaimTransactions
            + scalarMetrics.completedTransactions,
        });
      } finally {
        vi.restoreAllMocks();
        await prisma.deviceWebhookTrace.deleteMany({
          where: { provider: { in: [scalarProvider, batchProvider] } },
        });
        await prisma.$disconnect();
      }
    }, 30_000);
  },
);

type DatabaseOperationMetrics = {
  activeDatabaseOperations: number;
  batchClaimTransactions: number;
  claimedTraceIdsByAccount: Map<string, string[]>;
  completedTraceIds: string[];
  completedTransactions: number;
  maxActiveDatabaseOperations: number;
  scalarClaimTransactions: number;
};

class InstrumentedDeviceSyncControlPlaneStore extends PrismaDeviceSyncControlPlaneStore {
  private readonly metrics: DatabaseOperationMetrics;

  constructor(input: { metrics: DatabaseOperationMetrics; prisma: PrismaClient }) {
    super({
      prisma: input.prisma,
      providerAccountBlindIndexKey: Buffer.alloc(32, 29),
    });
    this.metrics = input.metrics;
  }

  override async claimWebhookTrace(
    input: ClaimDeviceSyncWebhookTraceInput,
  ): Promise<DeviceSyncWebhookTraceClaimResult> {
    this.metrics.scalarClaimTransactions += 1;
    this.recordClaimedTraceIds(input.externalAccountId, [input.traceId]);
    return this.trackDatabaseOperation(() => super.claimWebhookTrace(input));
  }

  override async claimWebhookTraceBatch(
    inputs: readonly ClaimDeviceSyncWebhookTraceInput[],
  ): Promise<DeviceSyncWebhookTraceClaimResult[]> {
    this.metrics.batchClaimTransactions += 1;
    this.recordClaimedTraceIds(
      inputs[0]?.externalAccountId ?? "",
      inputs.map((input) => input.traceId),
    );
    return this.trackDatabaseOperation(() => super.claimWebhookTraceBatch(inputs));
  }

  override async completeWebhookTrace(
    provider: string,
    traceId: string,
    claimToken: string,
  ): Promise<boolean> {
    this.metrics.completedTransactions += 1;
    this.metrics.completedTraceIds.push(traceId);
    return this.trackDatabaseOperation(() =>
      super.completeWebhookTrace(provider, traceId, claimToken));
  }

  private async trackDatabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.metrics.activeDatabaseOperations += 1;
    this.metrics.maxActiveDatabaseOperations = Math.max(
      this.metrics.maxActiveDatabaseOperations,
      this.metrics.activeDatabaseOperations,
    );
    try {
      return await operation();
    } finally {
      this.metrics.activeDatabaseOperations -= 1;
    }
  }

  private recordClaimedTraceIds(accountId: string, traceIds: readonly string[]): void {
    const existing = this.metrics.claimedTraceIdsByAccount.get(accountId) ?? [];
    existing.push(...traceIds);
    this.metrics.claimedTraceIdsByAccount.set(accountId, existing);
  }
}

function createDatabaseOperationMetrics(): DatabaseOperationMetrics {
  return {
    activeDatabaseOperations: 0,
    batchClaimTransactions: 0,
    claimedTraceIdsByAccount: new Map(),
    completedTraceIds: [],
    completedTransactions: 0,
    maxActiveDatabaseOperations: 0,
    scalarClaimTransactions: 0,
  };
}

function createQueuePayload(input: {
  accountId: string;
  index: number;
  provider: string;
}): DeviceWebhookQueuePayloadV1 {
  const transportSuffix = input.index.toString(16).padStart(12, "0");
  return {
    preparedWebhook: {
      acceptanceMode: "durable_webhook_work",
      eventType: "resource.created",
      externalAccountId: input.accountId,
      jobs: [],
      provider: input.provider,
      receivedAt: "2026-04-10T12:00:00.000Z",
      schema: DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
      traceId: input.index.toString(16).padStart(64, "0"),
    },
    schema: DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
    transportId: `00000000-0000-4000-8000-${transportSuffix}`,
  };
}

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
