import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";

import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type DeviceSyncDeletionFixture = {
  connectionId: string;
  deletionClient: PrismaClient;
  observer: PrismaClient;
  userId: string;
  webhookClient: PrismaClient;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createDeviceSyncDeletionFixture(): Promise<DeviceSyncDeletionFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
  }

  const fixtureId = randomUUID();
  const connectionId = `dsc_delete_lock_${fixtureId}`;
  const userId = `member_delete_lock_${fixtureId}`;
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const deletionClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const webhookClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const dirtyAt = new Date("2026-07-16T12:00:00.000Z");

  await observer.deviceConnection.create({
    data: {
      connectedAt: dirtyAt,
      id: connectionId,
      provider: "junction",
      providerAccountBlindIndex: `blind_${fixtureId}`,
      userId,
    },
  });
  await observer.deviceSyncDirtyConnection.create({
    data: {
      connectionId,
      dirtyRevision: 2n,
      eventCount: 2n,
      firstDirtyAt: dirtyAt,
      latestDirtyAt: dirtyAt,
      processedRevision: 2n,
      provider: "junction",
      userId,
    },
  });

  return {
    connectionId,
    deletionClient,
    observer,
    userId,
    webhookClient,
  };
}

async function cleanupDeviceSyncDeletionFixture(
  fixture: DeviceSyncDeletionFixture,
): Promise<void> {
  await fixture.observer.deviceSyncDirtyPayload.deleteMany({
    where: { connectionId: fixture.connectionId },
  });
  await fixture.observer.deviceSyncDirtyConnection.deleteMany({
    where: { connectionId: fixture.connectionId },
  });
  await fixture.observer.deviceConnection.deleteMany({
    where: { id: fixture.connectionId },
  });
  await Promise.all([
    fixture.deletionClient.$disconnect(),
    fixture.observer.$disconnect(),
    fixture.webhookClient.$disconnect(),
  ]);
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  observer: PrismaClient;
  pid: number;
}): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the transaction to wait on a PostgreSQL lock.");
}

function pauseBeforeDirtyMarkerUpdate(input: {
  allowUpdate: Deferred<void>;
  beforeUpdate: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const deviceSyncDirtyConnection = new Proxy(input.tx.deviceSyncDirtyConnection, {
    get(target, property) {
      if (property === "updateMany") {
        return async (args: Prisma.DeviceSyncDirtyConnectionUpdateManyArgs) => {
          input.beforeUpdate.resolve();
          await input.allowUpdate.promise;
          return target.updateMany(args);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy<Prisma.TransactionClient>(input.tx, {
    get(target, property) {
      if (property === "deviceSyncDirtyConnection") {
        return deviceSyncDirtyConnection;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function installHostedSecureBoxStringTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      return input.value;
    },
    encrypt() {
      return "hsb-test:device-sync-deletion-lock-proof";
    },
  });
}

function buildCompanionHrvResource() {
  const companionObservationJson = serializeCompanionHrvRmssdObservation({
    acceptedWindowCount: 72,
    completedWindowCount: 96,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-07-16",
    rmssdMs: 52.75,
    schema: COMPANION_HRV_RMSSD_SCHEMA,
  });
  return {
    count: 1,
    jobKind: "resource" as const,
    payload: {
      companionAdmissionId: createHash("sha256")
        .update(companionObservationJson)
        .digest("hex"),
      companionObservationJson,
      resource: COMPANION_HRV_RMSSD_RESOURCE,
      resourceCategory: "derived",
      sourceProviderSlug: "whoop",
    },
    resource: COMPANION_HRV_RMSSD_RESOURCE,
    resourceCategory: "derived",
    sourceProviderSlug: "whoop",
    windowEnd: null,
    windowStart: null,
  };
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "device-sync dirty-state PostgreSQL account-deletion ordering",
  () => {
    it("lets deletion finish before a waiting exact-payload CAS without deadlock", async () => {
      installHostedSecureBoxStringTestCodec();
      const fixture = await createDeviceSyncDeletionFixture();
      const payloadSweepFinished = createDeferred();
      const beforeWebhookUpdate = createDeferred();
      const allowWebhookUpdate = createDeferred();
      const webhookPid = createDeferred<number>();
      let deletionTransaction: Promise<void> | null = null;
      let webhookTransaction: Promise<unknown> | null = null;

      try {
        deletionTransaction = fixture.deletionClient.$transaction(async (tx) => {
          await tx.deviceSyncDirtyPayload.deleteMany({
            where: { userId: fixture.userId },
          });
          payloadSweepFinished.resolve();
          await beforeWebhookUpdate.promise;
          await tx.deviceSyncDirtyConnection.deleteMany({
            where: { userId: fixture.userId },
          });
          allowWebhookUpdate.resolve();
          await waitForBlockedBackend({
            observer: fixture.observer,
            pid: await webhookPid.promise,
          });
          await tx.deviceConnection.deleteMany({
            where: { userId: fixture.userId },
          });
        }, { timeout: 15_000 });

        await payloadSweepFinished.promise;
        const store = new PrismaHostedDirtyConnectionStore(fixture.webhookClient);
        const dirtyInput = {
          connectionId: fixture.connectionId,
          dirtyAt: "2026-07-16T12:01:00.000Z",
          eventType: "daily.data.steps.created",
          provider: "junction",
          resourceCategory: "timeseries",
          resources: [
            {
              count: 1,
              jobKind: "resource" as const,
              payload: {
                webhookDataJson: JSON.stringify({ source: "garmin", value: 789 }),
              },
              resource: "steps",
              resourceCategory: "timeseries",
              sourceProviderSlug: "garmin",
              windowEnd: "2026-07-17T00:00:00.000Z",
              windowStart: "2026-07-16T00:00:00.000Z",
            },
          ],
          traceId: "trace_delete_lock_proof",
          userId: fixture.userId,
        };
        const preparedPayloads = await store.prepareDirtyPayloads(dirtyInput);
        webhookTransaction = fixture.webhookClient.$transaction(async (tx) => {
          webhookPid.resolve(await readBackendPid(tx));
          return store.upsertDirtyConnection({
            ...dirtyInput,
            preparedPayloads,
            tx: pauseBeforeDirtyMarkerUpdate({
              allowUpdate: allowWebhookUpdate,
              beforeUpdate: beforeWebhookUpdate,
              tx,
            }),
          });
        }, { timeout: 15_000 });

        const [deletionOutcome, webhookOutcome] = await Promise.allSettled([
          deletionTransaction,
          webhookTransaction,
        ]);

        expect(deletionOutcome).toMatchObject({ status: "fulfilled" });
        expect(webhookOutcome).toMatchObject({
          reason: {
            code: "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION",
            retryable: true,
          },
          status: "rejected",
        });
        await expect(fixture.observer.deviceConnection.findUnique({
          where: { id: fixture.connectionId },
        })).resolves.toBeNull();
        await expect(fixture.observer.deviceSyncDirtyPayload.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);
      } finally {
        payloadSweepFinished.resolve();
        beforeWebhookUpdate.resolve();
        allowWebhookUpdate.resolve();
        await Promise.allSettled([
          ...(deletionTransaction ? [deletionTransaction] : []),
          ...(webhookTransaction ? [webhookTransaction] : []),
        ]);
        await cleanupDeviceSyncDeletionFixture(fixture);
        setHostedSecureBoxStringTestCodecForTests(null);
      }
    });

    it("locks dirty state before a companion receipt so deletion cannot form a cycle", async () => {
      installHostedSecureBoxStringTestCodec();
      const fixture = await createDeviceSyncDeletionFixture();
      const payloadSweepFinished = createDeferred();
      const beforeWebhookUpdate = createDeferred();
      const allowWebhookUpdate = createDeferred();
      const deletionPid = createDeferred<number>();
      let deletionTransaction: Promise<void> | null = null;
      let webhookTransaction: Promise<unknown> | null = null;

      try {
        deletionTransaction = fixture.deletionClient.$transaction(async (tx) => {
          deletionPid.resolve(await readBackendPid(tx));
          await tx.deviceSyncCompanionCaptureReceipt.deleteMany({
            where: { userId: fixture.userId },
          });
          await tx.deviceSyncDirtyPayload.deleteMany({
            where: { userId: fixture.userId },
          });
          payloadSweepFinished.resolve();
          await beforeWebhookUpdate.promise;
          await tx.deviceSyncDirtyConnection.deleteMany({
            where: { userId: fixture.userId },
          });
          await tx.deviceConnection.deleteMany({
            where: { userId: fixture.userId },
          });
        }, { timeout: 15_000 });

        await payloadSweepFinished.promise;
        const store = new PrismaHostedDirtyConnectionStore(fixture.webhookClient);
        const dirtyInput = {
          connectionId: fixture.connectionId,
          dirtyAt: "2026-07-16T12:01:00.000Z",
          eventType: "companion.hrv-rmssd.created",
          provider: "junction",
          resourceCategory: "derived",
          resources: [buildCompanionHrvResource()],
          traceId: "trace_companion_delete_lock_proof",
          userId: fixture.userId,
        };
        const preparedPayloads = await store.prepareDirtyPayloads(dirtyInput);
        webhookTransaction = fixture.webhookClient.$transaction(
          async (tx) => store.upsertDirtyConnection({
            ...dirtyInput,
            preparedPayloads,
            tx: pauseBeforeDirtyMarkerUpdate({
              allowUpdate: allowWebhookUpdate,
              beforeUpdate: beforeWebhookUpdate,
              tx,
            }),
          }),
          { timeout: 15_000 },
        );

        await beforeWebhookUpdate.promise;
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: await deletionPid.promise,
        });
        allowWebhookUpdate.resolve();

        const [deletionOutcome, webhookOutcome] = await Promise.allSettled([
          deletionTransaction,
          webhookTransaction,
        ]);

        expect(deletionOutcome).toMatchObject({ status: "fulfilled" });
        expect(webhookOutcome).toMatchObject({ status: "fulfilled" });
        await expect(fixture.observer.deviceConnection.findUnique({
          where: { id: fixture.connectionId },
        })).resolves.toBeNull();
        await expect(fixture.observer.deviceSyncCompanionCaptureReceipt.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);
        await expect(fixture.observer.deviceSyncDirtyPayload.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);
      } finally {
        payloadSweepFinished.resolve();
        beforeWebhookUpdate.resolve();
        allowWebhookUpdate.resolve();
        await Promise.allSettled([
          ...(deletionTransaction ? [deletionTransaction] : []),
          ...(webhookTransaction ? [webhookTransaction] : []),
        ]);
        await cleanupDeviceSyncDeletionFixture(fixture);
        setHostedSecureBoxStringTestCodecForTests(null);
      }
    });
  },
);
