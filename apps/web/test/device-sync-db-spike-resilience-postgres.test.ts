import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

const controlPlaneMocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: controlPlaneMocks.createHostedDeviceSyncControlPlane,
}));

import {
  applyHostedDeviceSyncRuntimeResult,
  readHostedDeviceSyncRuntimeState,
} from "@/src/lib/device-sync/hosted-runtime-authority";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { handleHostedDeviceSyncWebhookAccepted } from "@/src/lib/device-sync/wake-service";
import { readHostedHealthDataConsentState } from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  runWithPrismaOperationTimings,
  type PrismaOperationTiming,
} from "@/src/lib/prisma-operation-timing";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The device-sync database-spike replay requires a local DATABASE_URL.",
  );
}

const INCIDENT_WEBHOOK_RECEIPTS = 1_641;
const INCIDENT_WINDOW_SECONDS = 120;
const INCIDENT_PEAK_RECEIPTS_PER_SECOND = 31;
const INCIDENT_SNAPSHOT_READS = 20;
const REPLAY_FOREGROUND_READS = 40;
const REPLAY_WEBHOOK_CONCURRENCY = 31;
const REPLAY_POOL_MAX = 15;
const RUNTIME_APPLY_CONNECTIONS = 100;
const RUNTIME_APPLY_FOREGROUND_READS = 40;
const RUNTIME_APPLY_POOL_MAX = 2;

describe.skipIf(!runPostgresProof)(
  "device-sync database-spike resilience (real PostgreSQL)",
  () => {
    it("replays the incident-shaped admission/snapshot overlap without exceeding the local pool or stranding durable work", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const applicationName = `murph_device_sync_spike_${suffix}`;
      const observerApplicationName = `murph_device_sync_spike_observer_${suffix}`;
      const replayDatabaseUrl = withApplicationName(databaseUrl, applicationName);
      const observerDatabaseUrl = withApplicationName(databaseUrl, observerApplicationName);
      const prisma = createPrismaClient({
        databaseUrl: replayDatabaseUrl,
        poolMax: REPLAY_POOL_MAX,
      });
      const observer = createPrismaClient({
        databaseUrl: observerDatabaseUrl,
        poolMax: 1,
      });
      const store = new PrismaDeviceSyncControlPlaneStore({ prisma });
      const memberId = `hbm_device_sync_spike_${suffix}`;
      const connectionId = `dsc_device_sync_spike_${suffix}`;
      const sourceId = `dcs_device_sync_spike_${suffix}`;
      const providerAccountBlindIndex = `blind_device_sync_spike_${suffix}`;
      const claimToken = `claim_device_sync_spike_${suffix}`;
      const connectedAt = new Date("2026-08-10T21:30:00.000Z");
      const incidentStartAt = new Date("2026-08-10T21:31:00.000Z");
      const perSecondCounts = buildIncidentReceiptDistribution();
      const receipts = buildIncidentReceipts({
        incidentStartAt,
        perSecondCounts,
        suffix,
      });
      const limiter = createConcurrencyLimiter(REPLAY_WEBHOOK_CONCURRENCY);
      const foregroundLatenciesMs: number[] = [];
      const poolSamples: Array<{ activeSessions: number; sessions: number }> = [];
      let keepSampling = true;
      let sampler: Promise<void> | null = null;

      controlPlaneMocks.createHostedDeviceSyncControlPlane.mockReturnValue({
        store,
      });

      try {
        await prisma.hostedMember.create({
          data: {
            id: memberId,
          },
        });
        await prisma.deviceConnection.create({
          data: {
            connectedAt,
            credentialKind: "none",
            credentialMetadataJson: {},
            externalAccountIdEncrypted: null,
            id: connectionId,
            metadataJson: {},
            provider: "junction",
            providerAccountBlindIndex,
            scopesJson: [],
            setupPhase: "source_confirmed",
            status: "active",
            userId: memberId,
          },
        });
        await prisma.deviceConnectionSource.create({
          data: {
            connectionId,
            firstSeenAt: connectedAt,
            id: sourceId,
            lastSeenAt: connectedAt,
            resourceAvailabilitySummaryJson: {},
            sourceInstanceKey: `garmin-${suffix}`,
            sourceProviderSlug: "garmin",
            status: "connected",
          },
        });
        await prisma.deviceSyncDirtyConnection.create({
          data: {
            connectionId,
            dirtyResourcesJson: {},
            dirtyRevision: 1n,
            eventCount: 1n,
            firstDirtyAt: connectedAt,
            latestDirtyAt: connectedAt,
            processedRevision: 0n,
            provider: "junction",
            resourceCategoryCountsJson: {},
            sourceProviderCountsJson: {},
            userId: memberId,
          },
        });
        await prisma.deviceWebhookTrace.createMany({
          data: receipts.map((receipt) => ({
            claimToken,
            eventType: "historical.data.activity.created",
            processingExpiresAt: new Date("2026-08-10T22:00:00.000Z"),
            provider: "junction",
            providerAccountBlindIndex,
            receivedAt: receipt.receivedAt,
            status: "processing",
            traceId: receipt.traceId,
          })),
        });

        sampler = sampleReplayPool({
          applicationName,
          observer,
          poolSamples,
          shouldContinue: () => keepSampling,
        });

        const operationTimings: PrismaOperationTiming[] = [];
        const { snapshotResults, webhookResults } = await runWithPrismaOperationTimings(
          operationTimings,
          async () => {
            // Wall clock is intentionally compressed: all receipts enter the
            // 31-wide lane immediately, while receivedAt retains the exact
            // 120-second bucket distribution and the 31-receipt peak second.
            const webhookPromises = receipts.map((receipt) =>
              limiter.run(async () => {
                const ownerId = await store.getConnectionOwnerId(connectionId);
                if (!ownerId) {
                  throw new Error("Synthetic replay connection lost its owner mapping.");
                }
                const consent = await readHostedHealthDataConsentState({
                  memberId: ownerId,
                  prisma,
                });
                if (consent === "revoked") {
                  throw new Error("Synthetic replay member unexpectedly has revoked consent.");
                }

                await handleHostedDeviceSyncWebhookAccepted({
                  account: {
                    connectedAt: connectedAt.toISOString(),
                    id: connectionId,
                    provider: "junction",
                  },
                  claimToken,
                  now: receipt.receivedAt.toISOString(),
                  ownerId,
                  store,
                  traceId: receipt.traceId,
                  webhook: {
                    acceptanceMode: "durable_webhook_work",
                    dataSourceProviderSlug: "garmin",
                    eventType: "historical.data.activity.created",
                    jobs: [],
                    occurredAt: receipt.receivedAt.toISOString(),
                    resourceCategory: "activity",
                    sourceProviderSlug: "garmin",
                  },
                });
                await store.markWebhookReceived(
                  connectionId,
                  receipt.receivedAt.toISOString(),
                );
              })
            );

            // The 20 snapshots represent the adjacent minute and begin while
            // the webhook lane is deterministically saturated. Foreground reads
            // share the same client pool during that overlap.
            expect(limiter.active()).toBe(REPLAY_WEBHOOK_CONCURRENCY);
            const snapshotPromises = Array.from(
              { length: INCIDENT_SNAPSHOT_READS },
              async () => readHostedDeviceSyncRuntimeState({
                request: new Request("https://control.example.test/api/internal/device-sync/runtime/snapshot", {
                  body: JSON.stringify({
                    includeCredentialMaterial: false,
                    userId: memberId,
                  }),
                  method: "POST",
                }),
                trustedUserId: memberId,
              }),
            );
            const foregroundPromises = Array.from(
              { length: REPLAY_FOREGROUND_READS },
              async () => {
                const startedAt = performance.now();
                await prisma.hostedMember.findUnique({
                  select: { id: true },
                  where: { id: memberId },
                });
                foregroundLatenciesMs.push(performance.now() - startedAt);
              },
            );

            const [completedWebhooks, completedSnapshots] = await Promise.all([
              Promise.all(webhookPromises),
              Promise.all(snapshotPromises),
              Promise.all(foregroundPromises),
            ]);
            return {
              snapshotResults: completedSnapshots,
              webhookResults: completedWebhooks,
            };
          },
        );
        const operationCounts = countPrismaOperations(operationTimings);

        expect(webhookResults).toHaveLength(INCIDENT_WEBHOOK_RECEIPTS);
        expect(snapshotResults).toHaveLength(INCIDENT_SNAPSHOT_READS);
        expect(limiter.maxActive()).toBe(REPLAY_WEBHOOK_CONCURRENCY);
        expect(perSecondCounts).toHaveLength(INCIDENT_WINDOW_SECONDS);
        expect(perSecondCounts.reduce((sum, count) => sum + count, 0)).toBe(
          INCIDENT_WEBHOOK_RECEIPTS,
        );
        expect(Math.max(...perSecondCounts)).toBe(INCIDENT_PEAK_RECEIPTS_PER_SECOND);
        for (const snapshot of snapshotResults) {
          expect(snapshot.connections).toHaveLength(1);
          expect(snapshot.connections[0]?.connection.id).toBe(connectionId);
          expect(snapshot.connections[0]?.sources).toEqual([
            expect.objectContaining({
              sourceProviderSlug: "garmin",
            }),
          ]);
        }

        expect(await prisma.deviceWebhookTrace.count({
          where: {
            provider: "junction",
            providerAccountBlindIndex,
            status: "processed",
          },
        })).toBe(INCIDENT_WEBHOOK_RECEIPTS);
        expect(await prisma.deviceSyncSignal.count({
          where: { connectionId },
        })).toBe(INCIDENT_WEBHOOK_RECEIPTS);

        const connection = await prisma.deviceConnection.findUniqueOrThrow({
          select: { lastWebhookAt: true },
          where: { id: connectionId },
        });
        expect(connection.lastWebhookAt).toEqual(receipts.at(-1)?.receivedAt);

        const dirty = await store.getDirtyConnection({
          connectionId,
          userId: memberId,
        });
        expect(dirty).not.toBeNull();
        if (!dirty) {
          throw new Error("Synthetic replay dirty state disappeared before acknowledgement.");
        }
        await store.markDirtyConnectionProcessed({
          connectionId,
          processedRevision: dirty.dirtyRevision,
          userId: memberId,
        });
        await expect(store.hasPendingDirtyConnection(connectionId)).resolves.toBe(false);

        expect(foregroundLatenciesMs).toHaveLength(REPLAY_FOREGROUND_READS);
        expect(operationCounts.get("DeviceConnection.findFirst") ?? 0).toBe(0);
        expect(operationCounts.get("DeviceConnection.findMany") ?? 0).toBe(
          INCIDENT_SNAPSHOT_READS,
        );
        expect(operationCounts.get("DeviceConnection.findUnique") ?? 0).toBeGreaterThanOrEqual(
          INCIDENT_WEBHOOK_RECEIPTS,
        );
        expect(operationCounts.get("DeviceConnection.findUnique") ?? 0).toBeLessThanOrEqual(
          INCIDENT_WEBHOOK_RECEIPTS * 2,
        );
        expect(operationCounts.get("DeviceConnection.updateMany") ?? 0).toBe(
          INCIDENT_WEBHOOK_RECEIPTS,
        );
        // Each source-attributed webhook deliberately rechecks live source
        // admission under the lock; the snapshot side contributes one batched
        // source read per snapshot, independent of connection cardinality.
        expect(operationCounts.get("DeviceConnectionSource.findMany") ?? 0).toBe(
          INCIDENT_WEBHOOK_RECEIPTS + INCIDENT_SNAPSHOT_READS,
        );
        expect(operationCounts.get("HostedMember.findUnique") ?? 0).toBe(
          REPLAY_FOREGROUND_READS,
        );
        const foregroundP95Ms = percentile(foregroundLatenciesMs, 0.95);
        expect(Number.isFinite(foregroundP95Ms)).toBe(true);
        expect(poolSamples.length).toBeGreaterThan(0);
        const maxObservedSessions = Math.max(...poolSamples.map((sample) => sample.sessions));
        const maxObservedActiveSessions = Math.max(
          ...poolSamples.map((sample) => sample.activeSessions),
        );
        expect(maxObservedSessions).toBeGreaterThan(0);
        expect(maxObservedSessions).toBeLessThanOrEqual(REPLAY_POOL_MAX);
        expect(maxObservedActiveSessions).toBeLessThanOrEqual(REPLAY_POOL_MAX);

        console.info("device-sync database-spike replay", {
          foregroundP95Ms: Number(foregroundP95Ms.toFixed(2)),
          foregroundReads: REPLAY_FOREGROUND_READS,
          deviceConnectionFindFirst: operationCounts.get("DeviceConnection.findFirst") ?? 0,
          deviceConnectionFindMany: operationCounts.get("DeviceConnection.findMany") ?? 0,
          deviceConnectionFindUnique: operationCounts.get("DeviceConnection.findUnique") ?? 0,
          deviceConnectionSourceFindMany:
            operationCounts.get("DeviceConnectionSource.findMany") ?? 0,
          maxObservedActiveSessions,
          maxObservedSessions,
          peakReceiptsPerOriginalSecond: Math.max(...perSecondCounts),
          poolMax: REPLAY_POOL_MAX,
          snapshotReads: INCIDENT_SNAPSHOT_READS,
          syntheticWindowSeconds: INCIDENT_WINDOW_SECONDS,
          webhookMaxConcurrency: limiter.maxActive(),
          webhookReceipts: receipts.length,
        });
      } finally {
        keepSampling = false;
        if (sampler) {
          await sampler;
        }
        await prisma.deviceWebhookTrace.deleteMany({
          where: {
            provider: "junction",
            providerAccountBlindIndex,
          },
        }).catch(() => undefined);
        await prisma.deviceConnection.deleteMany({
          where: { id: connectionId },
        }).catch(() => undefined);
        await prisma.hostedMember.deleteMany({
          where: { id: memberId },
        }).catch(() => undefined);
        await prisma.$disconnect();
        await observer.$disconnect();
        controlPlaneMocks.createHostedDeviceSyncControlPlane.mockReset();
      }
    }, 180_000);

    it("keeps foreground reads serviceable during a 100-update no-op apply on a two-connection pool", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const applicationName = `murph_device_sync_apply_${suffix}`;
      const observerApplicationName = `murph_device_sync_apply_observer_${suffix}`;
      const prisma = createPrismaClient({
        databaseUrl: withApplicationName(databaseUrl, applicationName),
        poolMax: RUNTIME_APPLY_POOL_MAX,
      });
      const observer = createPrismaClient({
        databaseUrl: withApplicationName(databaseUrl, observerApplicationName),
        poolMax: 1,
      });
      const store = new PrismaDeviceSyncControlPlaneStore({ prisma });
      const runWithConnectionMutationLock =
        store.withConnectionMutationLock.bind(store);
      let firstTransactionEnteredResolve!: () => void;
      const firstTransactionEntered = new Promise<void>((resolve) => {
        firstTransactionEnteredResolve = resolve;
      });
      let releaseFirstTransactionResolve!: () => void;
      const releaseFirstTransaction = new Promise<void>((resolve) => {
        releaseFirstTransactionResolve = resolve;
      });
      let activeApplyTransactions = 0;
      let maxActiveApplyTransactions = 0;
      const withConnectionMutationLock = vi.spyOn(
        store,
        "withConnectionMutationLock",
      ).mockImplementation(async (connectionId, callback) =>
        runWithConnectionMutationLock(connectionId, async (tx) => {
          activeApplyTransactions += 1;
          maxActiveApplyTransactions = Math.max(
            maxActiveApplyTransactions,
            activeApplyTransactions,
          );
          try {
            if (withConnectionMutationLock.mock.calls.length === 1) {
              firstTransactionEnteredResolve();
              await releaseFirstTransaction;
            }
            return await callback(tx);
          } finally {
            activeApplyTransactions -= 1;
          }
        })
      );
      const memberId = `hbm_device_sync_apply_${suffix}`;
      const connectedAt = new Date("2026-08-11T12:00:00.000Z");
      const connectionIds = Array.from(
        { length: RUNTIME_APPLY_CONNECTIONS },
        (_, index) => `dsc_device_sync_apply_${suffix}_${String(index).padStart(3, "0")}`,
      );
      const foregroundLatenciesMs: number[] = [];
      const poolSamples: Array<{ activeSessions: number; sessions: number }> = [];
      let keepSampling = true;
      let sampler: Promise<void> | null = null;

      controlPlaneMocks.createHostedDeviceSyncControlPlane.mockReturnValue({
        store,
      });

      try {
        await prisma.hostedMember.create({
          data: { id: memberId },
        });
        await prisma.deviceConnection.createMany({
          data: connectionIds.map((connectionId, index) => ({
            connectedAt,
            credentialKind: "none",
            credentialMetadataJson: {},
            externalAccountIdEncrypted: null,
            id: connectionId,
            metadataJson: {},
            provider: "oura",
            providerAccountBlindIndex:
              `blind_device_sync_apply_${suffix}_${String(index).padStart(3, "0")}`,
            scopesJson: [],
            status: "active",
            userId: memberId,
          })),
        });

        sampler = sampleReplayPool({
          applicationName,
          observer,
          poolSamples,
          shouldContinue: () => keepSampling,
        });

        const operationTimings: PrismaOperationTiming[] = [];
        const response = await runWithPrismaOperationTimings(
          operationTimings,
          async () => {
            const applyPromise = applyHostedDeviceSyncRuntimeResult({
              request: new Request("https://control.example.test/api/internal/device-sync/runtime/apply", {
                body: JSON.stringify({
                  updates: connectionIds.map((connectionId) => ({ connectionId })),
                  userId: memberId,
                }),
                method: "POST",
              }),
              trustedUserId: memberId,
            });
            await firstTransactionEntered;
            expect(activeApplyTransactions).toBe(1);
            expect(withConnectionMutationLock).toHaveBeenCalledTimes(1);
            const foreground = Array.from(
              { length: RUNTIME_APPLY_FOREGROUND_READS },
              async () => {
                const startedAt = performance.now();
                await prisma.hostedMember.findUnique({
                  select: { id: true },
                  where: { id: memberId },
                });
                foregroundLatenciesMs.push(performance.now() - startedAt);
              },
            );
            const foregroundFailure = await Promise.all(foreground).then(
              () => null,
              (error: unknown) => error,
            );
            expect(activeApplyTransactions).toBe(1);
            expect(withConnectionMutationLock).toHaveBeenCalledTimes(1);
            releaseFirstTransactionResolve();
            const applyResponse = await applyPromise;
            if (foregroundFailure) {
              throw foregroundFailure;
            }
            return applyResponse;
          },
        );
        const operationCounts = countPrismaOperations(operationTimings);

        expect(response.updates).toHaveLength(RUNTIME_APPLY_CONNECTIONS);
        expect(response.updates.every((update) =>
          update.tokenUpdate === "missing"
          && update.writeUpdate === "unchanged"
        )).toBe(true);
        expect(withConnectionMutationLock).toHaveBeenCalledTimes(
          RUNTIME_APPLY_CONNECTIONS,
        );
        expect(maxActiveApplyTransactions).toBe(1);
        expect(operationCounts.get("DeviceConnection.findMany") ?? 0).toBe(1);
        expect(operationCounts.get("DeviceConnection.findFirst") ?? 0).toBe(
          RUNTIME_APPLY_CONNECTIONS,
        );
        expect(operationCounts.get("DeviceConnectionSource.findMany") ?? 0).toBe(
          RUNTIME_APPLY_CONNECTIONS,
        );
        expect(operationCounts.get("DeviceConnection.update") ?? 0).toBe(0);
        expect(operationCounts.get("DeviceConnectionSource.upsert") ?? 0).toBe(0);
        expect(operationCounts.get("HostedMember.findUnique") ?? 0).toBe(
          RUNTIME_APPLY_FOREGROUND_READS,
        );
        expect(foregroundLatenciesMs).toHaveLength(
          RUNTIME_APPLY_FOREGROUND_READS,
        );
        expect(Number.isFinite(percentile(foregroundLatenciesMs, 0.95))).toBe(true);
        expect(poolSamples.length).toBeGreaterThan(0);
        expect(Math.max(...poolSamples.map((sample) => sample.sessions))).toBeLessThanOrEqual(
          RUNTIME_APPLY_POOL_MAX,
        );
        expect(Math.max(...poolSamples.map((sample) => sample.activeSessions))).toBeLessThanOrEqual(
          RUNTIME_APPLY_POOL_MAX,
        );
      } finally {
        keepSampling = false;
        if (sampler) {
          await sampler;
        }
        await prisma.deviceConnection.deleteMany({
          where: { id: { in: connectionIds } },
        }).catch(() => undefined);
        await prisma.hostedMember.deleteMany({
          where: { id: memberId },
        }).catch(() => undefined);
        await prisma.$disconnect();
        await observer.$disconnect();
        controlPlaneMocks.createHostedDeviceSyncControlPlane.mockReset();
      }
    }, 60_000);
  },
);

function buildIncidentReceiptDistribution(): number[] {
  const counts = Array.from({ length: INCIDENT_WINDOW_SECONDS }, () => 13);
  const peakSecond = 60;
  counts[peakSecond] = INCIDENT_PEAK_RECEIPTS_PER_SECOND;
  let remaining = INCIDENT_WEBHOOK_RECEIPTS
    - counts.reduce((sum, count) => sum + count, 0);

  for (let second = 0; second < counts.length && remaining > 0; second += 1) {
    if (second === peakSecond) {
      continue;
    }
    counts[second] += 1;
    remaining -= 1;
  }

  if (remaining !== 0) {
    throw new Error("Synthetic incident distribution does not sum to the target receipt count.");
  }
  return counts;
}

function buildIncidentReceipts(input: {
  incidentStartAt: Date;
  perSecondCounts: readonly number[];
  suffix: string;
}): Array<{ receivedAt: Date; traceId: string }> {
  const receipts: Array<{ receivedAt: Date; traceId: string }> = [];
  let ordinal = 0;

  for (const [second, count] of input.perSecondCounts.entries()) {
    for (let withinSecond = 0; withinSecond < count; withinSecond += 1) {
      receipts.push({
        receivedAt: new Date(
          input.incidentStartAt.getTime()
          + second * 1_000
          + Math.floor(withinSecond * (1_000 / count)),
        ),
        traceId: `trace_device_sync_spike_${input.suffix}_${ordinal}`,
      });
      ordinal += 1;
    }
  }

  return receipts;
}

function createConcurrencyLimiter(limit: number): {
  active: () => number;
  maxActive: () => number;
  run: <T>(task: () => Promise<T>) => Promise<T>;
} {
  let active = 0;
  let observedMax = 0;
  const waiters: Array<() => void> = [];

  return {
    active: () => active,
    maxActive: () => observedMax,
    run: async <T>(task: () => Promise<T>): Promise<T> => {
      if (active >= limit) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
      active += 1;
      observedMax = Math.max(observedMax, active);
      try {
        return await task();
      } finally {
        active -= 1;
        waiters.shift()?.();
      }
    },
  };
}

async function sampleReplayPool(input: {
  applicationName: string;
  observer: ReturnType<typeof createPrismaClient>;
  poolSamples: Array<{ activeSessions: number; sessions: number }>;
  shouldContinue: () => boolean;
}): Promise<void> {
  do {
    const rows = await input.observer.$queryRaw<Array<{
      activeSessions: number;
      sessions: number;
    }>>`
      SELECT
        count(*) FILTER (WHERE state = 'active')::int AS "activeSessions",
        count(*)::int AS "sessions"
      FROM pg_stat_activity
      WHERE application_name = ${input.applicationName}
    `;
    const sample = rows[0];
    if (sample) {
      input.poolSamples.push(sample);
    }
    if (input.shouldContinue()) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  } while (input.shouldContinue());
}

function countPrismaOperations(
  operations: readonly PrismaOperationTiming[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    counts.set(operation.key, (counts.get(operation.key) ?? 0) + 1);
  }
  return counts;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index] ?? Number.NaN;
}

function withApplicationName(value: string, applicationName: string): string {
  const parsed = new URL(value);
  parsed.searchParams.set("application_name", applicationName);
  return parsed.toString();
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
