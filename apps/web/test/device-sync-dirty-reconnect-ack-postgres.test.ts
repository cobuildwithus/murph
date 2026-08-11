import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const transactionOptions = { maxWait: 5_000, timeout: 15_000 } as const;
const connectionCodec = {
  decrypt: (value: string) => value.replace(/^enc:/u, ""),
  encrypt: (value: string) => `enc:${value}`,
  keyVersion: "v1",
};

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type InteractiveTransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};

type Fixture = {
  acknowledgement: PrismaClient;
  connectionId: string;
  dirtyPayloadId: string;
  dirtyRevision: bigint;
  externalAccountId: string;
  holder: PrismaClient;
  observer: PrismaClient;
  reconnect: PrismaClient;
  reconnectStore: PrismaDeviceSyncControlPlaneStore;
  userId: string;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function readBackendPid(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ pid: number }>>`
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

function buildConnectionInput(input: {
  connectedAt: string;
  externalAccountId: string;
  userId: string;
}) {
  return {
    connectedAt: input.connectedAt,
    displayName: "Oura",
    existingAccountPolicy: "replace" as const,
    externalAccountId: input.externalAccountId,
    metadata: {},
    nextReconcileAt: null,
    ownerId: input.userId,
    provider: "oura",
    scopes: ["daily"],
    tokens: {
      accessToken: `access-${input.connectedAt}`,
      refreshToken: `refresh-${input.connectedAt}`,
    },
  };
}

async function createFixture(): Promise<Fixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL reconnect acknowledgement proof.");
  }

  const suffix = randomUUID().replaceAll("-", "");
  const userId = `member_reconnect_ack_${suffix}`;
  const externalAccountId = `oura_reconnect_ack_${suffix}`;
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const acknowledgement = createPrismaClient({ databaseUrl, poolMax: 1 });
  const holder = createPrismaClient({ databaseUrl, poolMax: 1 });
  const reconnect = createPrismaClient({ databaseUrl, poolMax: 1 });
  const reconnectStore = new PrismaDeviceSyncControlPlaneStore({
    codec: connectionCodec,
    prisma: reconnect,
    providerAccountBlindIndexKey: Buffer.alloc(32, 7),
  });
  const now = new Date("2026-07-16T12:00:00.000Z");

  setHostedSecureBoxStringTestCodecForTests({
    decrypt: (input) => input.value,
    encrypt: (input) => input.value,
  });
  await observer.hostedMember.create({ data: { id: userId } });
  await observer.hostedConsentGrant.create({
    data: {
      createdAt: now,
      documentVersionsJson: {},
      grantedAt: now,
      memberId: userId,
      scope: "launch.health-data",
      source: "device-sync-reconnect-ack-test",
      status: "granted",
      updatedAt: now,
    },
  });
  const connection = await reconnectStore.upsertConnection(buildConnectionInput({
    connectedAt: now.toISOString(),
    externalAccountId,
    userId,
  }));
  const dirty = await reconnectStore.upsertDirtyConnection({
    connectionId: connection.id,
    dirtyAt: "2026-07-16T12:01:00.000Z",
    eventType: "daily.data.deleted",
    provider: "oura",
    resourceCategory: "sleep",
    resources: [{
      count: 1,
      jobKind: "delete",
      payload: { objectId: "sleep-reconnect-ack" },
      resource: "sleep",
      resourceCategory: "sleep",
      sourceProviderSlug: "oura",
      windowEnd: null,
      windowStart: null,
    }],
    traceId: "trace_reconnect_ack",
    userId,
  });
  const payload = await observer.deviceSyncDirtyPayload.findFirstOrThrow({
    select: { id: true },
    where: { connectionId: connection.id },
  });
  await observer.deviceSyncDirtyPayload.update({
    data: { credentialIndependent: null },
    where: { id: payload.id },
  });

  return {
    acknowledgement,
    connectionId: connection.id,
    dirtyPayloadId: payload.id,
    dirtyRevision: dirty.dirty.dirtyRevision,
    externalAccountId,
    holder,
    observer,
    reconnect,
    reconnectStore,
    userId,
  };
}

function interceptPayloadDeletes(input: {
  beforeDelete: () => Promise<void> | void;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const deviceSyncDirtyPayload = new Proxy(input.tx.deviceSyncDirtyPayload, {
    get(target, property) {
      if (property === "deleteMany") {
        return async (args: Prisma.DeviceSyncDirtyPayloadDeleteManyArgs) => {
          await input.beforeDelete();
          return target.deleteMany(args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy(input.tx, {
    get(target, property) {
      if (property === "deviceSyncDirtyPayload") {
        return deviceSyncDirtyPayload;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapInteractiveTransactions(input: {
  prisma: PrismaClient;
  wrap: (tx: Prisma.TransactionClient) => Prisma.TransactionClient;
}): PrismaClient {
  return new Proxy(input.prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return async <TResult>(
          callback: (tx: Prisma.TransactionClient) => Promise<TResult>,
          options?: InteractiveTransactionOptions,
        ): Promise<TResult> => target.$transaction(
          (tx) => callback(input.wrap(tx)),
          options,
        );
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await fixture.observer.hostedMember.deleteMany({
    where: { id: fixture.userId },
  });
  await Promise.all([
    fixture.acknowledgement.$disconnect(),
    fixture.holder.$disconnect(),
    fixture.observer.$disconnect(),
    fixture.reconnect.$disconnect(),
  ]);
  setHostedSecureBoxStringTestCodecForTests(null);
}

describe.skipIf(!runPostgresProof)(
  "device-sync reconnect and acknowledgement PostgreSQL lock ordering",
  () => {
    it("waits behind acknowledgement's dirty marker before classifying nullable rows", async () => {
      const fixture = await createFixture();
      const payloadDeleteReached = createDeferred();
      const allowPayloadDelete = createDeferred();
      const decrypt = vi.fn((input: { value: string }) => input.value);
      let acknowledgementOutcome: Promise<unknown> | null = null;
      let reconnectOutcome: Promise<unknown> | null = null;

      setHostedSecureBoxStringTestCodecForTests({
        decrypt,
        encrypt: (input) => input.value,
      });
      try {
        const acknowledgementStore = new PrismaHostedDirtyConnectionStore(
          wrapInteractiveTransactions({
            prisma: fixture.acknowledgement,
            wrap: (tx) => interceptPayloadDeletes({
              beforeDelete: async () => {
                payloadDeleteReached.resolve();
                await allowPayloadDelete.promise;
              },
              tx,
            }),
          }),
        );
        acknowledgementOutcome = acknowledgementStore.markDirtyConnectionProcessed({
          connectionId: fixture.connectionId,
          processedDirtyPayloadIds: [fixture.dirtyPayloadId],
          processedRevision: fixture.dirtyRevision,
          userId: fixture.userId,
        });
        await payloadDeleteReached.promise;

        const reconnectPid = await readBackendPid(fixture.reconnect);
        reconnectOutcome = fixture.reconnectStore.upsertConnection(buildConnectionInput({
          connectedAt: "2026-07-16T12:03:00.000Z",
          externalAccountId: fixture.externalAccountId,
          userId: fixture.userId,
        }));
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: reconnectPid,
        });
        expect(decrypt).not.toHaveBeenCalled();

        allowPayloadDelete.resolve();
        await expect(acknowledgementOutcome).resolves.toMatchObject({ stillDirty: false });
        await expect(reconnectOutcome).resolves.toMatchObject({ id: fixture.connectionId });
        await expect(fixture.observer.deviceConnection.findUniqueOrThrow({
          select: { connectedAt: true, status: true },
          where: { id: fixture.connectionId },
        })).resolves.toEqual({
          connectedAt: new Date("2026-07-16T12:03:00.000Z"),
          status: "active",
        });
        await expect(fixture.observer.deviceSyncDirtyPayload.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);
      } finally {
        allowPayloadDelete.resolve();
        await Promise.allSettled([
          ...(acknowledgementOutcome ? [acknowledgementOutcome] : []),
          ...(reconnectOutcome ? [reconnectOutcome] : []),
        ]);
        await cleanupFixture(fixture);
      }
    });

    it("holds the dirty marker through reconnect classification before acknowledgement", async () => {
      const fixture = await createFixture();
      const payloadLocked = createDeferred();
      const releasePayload = createDeferred();
      const decryptStarted = createDeferred();
      const acknowledgementDelete = vi.fn();
      const decrypt = vi.fn((input: { value: string }) => {
        decryptStarted.resolve();
        return input.value;
      });
      let holderOutcome: Promise<unknown> | null = null;
      let acknowledgementOutcome: Promise<unknown> | null = null;
      let reconnectOutcome: Promise<unknown> | null = null;

      setHostedSecureBoxStringTestCodecForTests({
        decrypt,
        encrypt: (input) => input.value,
      });
      try {
        holderOutcome = fixture.holder.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT 1
            FROM device_sync_dirty_payload
            WHERE id = ${fixture.dirtyPayloadId}
            FOR UPDATE
          `;
          payloadLocked.resolve();
          await releasePayload.promise;
        }, transactionOptions);
        await payloadLocked.promise;

        reconnectOutcome = fixture.reconnectStore.upsertConnection(buildConnectionInput({
          connectedAt: "2026-07-16T12:03:00.000Z",
          externalAccountId: fixture.externalAccountId,
          userId: fixture.userId,
        }));
        await decryptStarted.promise;

        const acknowledgementStore = new PrismaHostedDirtyConnectionStore(
          wrapInteractiveTransactions({
            prisma: fixture.acknowledgement,
            wrap: (tx) => interceptPayloadDeletes({
              beforeDelete: acknowledgementDelete,
              tx,
            }),
          }),
        );
        const acknowledgementPid = await readBackendPid(fixture.acknowledgement);
        acknowledgementOutcome = acknowledgementStore.markDirtyConnectionProcessed({
          connectionId: fixture.connectionId,
          processedDirtyPayloadIds: [fixture.dirtyPayloadId],
          processedRevision: fixture.dirtyRevision,
          userId: fixture.userId,
        });
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: acknowledgementPid,
        });
        expect(acknowledgementDelete).not.toHaveBeenCalled();

        releasePayload.resolve();
        await expect(holderOutcome).resolves.toBeUndefined();
        await expect(reconnectOutcome).resolves.toMatchObject({ id: fixture.connectionId });
        await expect(acknowledgementOutcome).resolves.toMatchObject({ stillDirty: false });
        expect(decrypt).toHaveBeenCalledTimes(1);
        expect(acknowledgementDelete).toHaveBeenCalledTimes(1);
        await expect(fixture.observer.deviceConnection.findUniqueOrThrow({
          select: { connectedAt: true, status: true },
          where: { id: fixture.connectionId },
        })).resolves.toEqual({
          connectedAt: new Date("2026-07-16T12:03:00.000Z"),
          status: "active",
        });
        await expect(fixture.observer.deviceSyncDirtyPayload.count({
          where: { connectionId: fixture.connectionId },
        })).resolves.toBe(0);
      } finally {
        releasePayload.resolve();
        await Promise.allSettled([
          ...(holderOutcome ? [holderOutcome] : []),
          ...(acknowledgementOutcome ? [acknowledgementOutcome] : []),
          ...(reconnectOutcome ? [reconnectOutcome] : []),
        ]);
        await cleanupFixture(fixture);
      }
    });
  },
);
