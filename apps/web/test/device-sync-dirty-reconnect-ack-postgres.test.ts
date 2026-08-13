import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { buildJunctionProviderSourceInstanceKey } from "@murphai/device-syncd/connect-config";
import { createDeviceSyncRegistry } from "@murphai/device-syncd/registry";
import type { DeviceSyncProvider } from "@murphai/device-syncd/types";
import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";
import { completeHostedGoogleHealthFitbitMigration } from "@/src/lib/device-sync/wake-service";
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

type FitbitCutoverFixture = {
  admission: PrismaClient;
  admissionStore: PrismaDeviceSyncControlPlaneStore;
  connectionId: string;
  cutover: PrismaClient;
  cutoverStore: PrismaDeviceSyncControlPlaneStore;
  observer: PrismaClient;
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

function buildJunctionSourceInstanceKey(
  connectionId: string,
  sourceProviderSlug: string,
): string {
  const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId,
    sourceProviderSlug,
  });
  if (!sourceInstanceKey) {
    throw new Error("Expected a canonical Junction source instance key.");
  }
  return sourceInstanceKey;
}

function createJunctionCutoverProvider(input: {
  revokeSourceAccess: () => Promise<void>;
}): DeviceSyncProvider {
  return {
    connectionHandler: {
      async beginConnection() {
        return { authorizationUrl: "https://provider.example/connect" };
      },
      async completeConnection() {
        return {
          credential: {
            kind: "provider_config",
            providerConfigKey: "junction",
          },
          externalAccountId: "junction-cutover-account",
        };
      },
      async isSourceAccessActive() {
        return true;
      },
      revokeSourceAccess: input.revokeSourceAccess,
    },
    credentialPolicy: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    descriptor: {
      connection: {
        callbackPath: "/connect/junction/callback",
        kind: "external_link",
      },
      displayName: "Junction",
      normalization: {
        metricFamilies: ["sleep"],
        snapshotParser: "schema",
      },
      provider: "junction",
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: { sleep: 50 },
      },
      transportModes: ["external_link"],
    },
    provider: "junction",
  };
}

async function createFitbitCutoverFixture(): Promise<FitbitCutoverFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL Fitbit cutover proof.");
  }

  const suffix = randomUUID().replaceAll("-", "");
  const userId = `member_fitbit_cutover_${suffix}`;
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const admission = createPrismaClient({ databaseUrl, poolMax: 1 });
  const cutover = createPrismaClient({ databaseUrl, poolMax: 1 });
  const admissionStore = new PrismaDeviceSyncControlPlaneStore({
    codec: connectionCodec,
    prisma: admission,
    providerAccountBlindIndexKey: Buffer.alloc(32, 11),
  });
  const cutoverStore = new PrismaDeviceSyncControlPlaneStore({
    codec: connectionCodec,
    prisma: cutover,
    providerAccountBlindIndexKey: Buffer.alloc(32, 11),
  });
  const now = new Date("2026-08-11T10:00:00.000Z");

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
      source: "device-sync-fitbit-cutover-lock-test",
      status: "granted",
      updatedAt: now,
    },
  });
  const connection = await admissionStore.upsertConnection({
    connectedAt: now.toISOString(),
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    displayName: "Junction",
    existingAccountPolicy: "replace",
    externalAccountId: `junction_fitbit_cutover_${suffix}`,
    metadata: {},
    nextReconcileAt: null,
    ownerId: userId,
    provider: "junction",
    scopes: ["sleep"],
    setupPhase: "source_confirmed",
    status: "active",
  });
  await admissionStore.upsertConnectionSource({
    connectionId: connection.id,
    firstSeenAt: "2026-08-11T09:00:00.000Z",
    lastDataAt: "2026-08-11T09:55:00.000Z",
    lastSeenAt: "2026-08-11T10:00:00.000Z",
    now: "2026-08-11T10:00:00.000Z",
    resourceAvailabilitySummary: {
      canonicalCoverageBoundary_sleep: "2026-08-11T09:55:00.000Z",
      sleep: true,
    },
    sourceInstanceKey: buildJunctionSourceInstanceKey(connection.id, "fitbit"),
    sourceProviderSlug: "fitbit",
    status: "connected",
  });
  await admissionStore.upsertConnectionSource({
    connectionId: connection.id,
    firstSeenAt: "2026-08-11T10:01:00.000Z",
    lastDataAt: "2026-08-11T10:05:00.000Z",
    lastSeenAt: "2026-08-11T10:05:00.000Z",
    now: "2026-08-11T10:05:00.000Z",
    resourceAvailabilitySummary: {
      historicalBackfillCompletedAt: "2026-08-11T10:04:00.000Z",
      sleep: true,
    },
    sourceInstanceKey: buildJunctionSourceInstanceKey(
      connection.id,
      "google_health",
    ),
    sourceProviderSlug: "google_health",
    status: "connected",
  });

  return {
    admission,
    admissionStore,
    connectionId: connection.id,
    cutover,
    cutoverStore,
    observer,
    userId,
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

async function cleanupFitbitCutoverFixture(
  fixture: FitbitCutoverFixture,
): Promise<void> {
  await fixture.observer.hostedMember.deleteMany({
    where: { id: fixture.userId },
  });
  await Promise.all([
    fixture.admission.$disconnect(),
    fixture.cutover.$disconnect(),
    fixture.observer.$disconnect(),
  ]);
  setHostedSecureBoxStringTestCodecForTests(null);
}

describe.skipIf(!runPostgresProof)(
  "device-sync connection mutation and acknowledgement PostgreSQL lock ordering",
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

    it("commits accepted Fitbit work before cutover can claim the source", async () => {
      const fixture = await createFitbitCutoverFixture();
      const dirtyWritten = createDeferred();
      const allowDirtyCommit = createDeferred();
      const revokeSourceAccess = vi.fn(async () => undefined);
      const registry = createDeviceSyncRegistry([
        createJunctionCutoverProvider({ revokeSourceAccess }),
      ]);
      let admissionOutcome: Promise<unknown> | null = null;
      let cutoverOutcome: Promise<unknown> | null = null;

      try {
        admissionOutcome = fixture.admissionStore.withConnectionMutationLock(
          fixture.connectionId,
          async (tx) => {
            const dirty = await fixture.admissionStore.upsertDirtyConnection({
              connectionId: fixture.connectionId,
              dirtyAt: "2026-08-11T10:06:00.000Z",
              eventType: "sleep.updated",
              provider: "junction",
              resourceCategory: "sleep",
              resources: [{
                count: 1,
                jobKind: "resource",
                payload: { objectId: "fitbit-sleep-cutover-lock" },
                resource: "sleep",
                resourceCategory: "sleep",
                sourceProviderSlug: "fitbit",
                windowEnd: "2026-08-11T10:00:00.000Z",
                windowStart: "2026-08-10T10:00:00.000Z",
              }],
              traceId: "trace_fitbit_cutover_lock",
              tx,
              userId: fixture.userId,
            });
            dirtyWritten.resolve();
            await allowDirtyCommit.promise;
            return dirty;
          },
        );
        await dirtyWritten.promise;

        const cutoverPid = await readBackendPid(fixture.cutover);
        cutoverOutcome = completeHostedGoogleHealthFitbitMigration({
          connectionId: fixture.connectionId,
          registry,
          store: fixture.cutoverStore,
          userId: fixture.userId,
        });
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: cutoverPid,
        });
        expect(revokeSourceAccess).not.toHaveBeenCalled();

        allowDirtyCommit.resolve();
        await expect(admissionOutcome).resolves.toMatchObject({
          dirty: { dirtyRevision: 1n },
        });
        await expect(cutoverOutcome).resolves.toEqual({
          connectionId: fixture.connectionId,
          status: "pending",
        });
        expect(revokeSourceAccess).not.toHaveBeenCalled();
        await expect(fixture.observer.deviceConnectionSource.findFirstOrThrow({
          select: { lastErrorCode: true, status: true },
          where: {
            connectionId: fixture.connectionId,
            sourceProviderSlug: "fitbit",
          },
        })).resolves.toEqual({
          lastErrorCode: null,
          status: "connected",
        });

        const dirty = await fixture.observer.deviceSyncDirtyConnection.findUniqueOrThrow({
          select: { dirtyRevision: true },
          where: { connectionId: fixture.connectionId },
        });
        const payloads = await fixture.observer.deviceSyncDirtyPayload.findMany({
          select: { id: true },
          where: { connectionId: fixture.connectionId },
        });
        await expect(fixture.admissionStore.markDirtyConnectionProcessed({
          connectionId: fixture.connectionId,
          processedDirtyPayloadIds: payloads.map(({ id }) => id),
          processedRevision: dirty.dirtyRevision,
          userId: fixture.userId,
        })).resolves.toMatchObject({ stillDirty: false });

        await expect(completeHostedGoogleHealthFitbitMigration({
          connectionId: fixture.connectionId,
          registry,
          store: fixture.cutoverStore,
          userId: fixture.userId,
        })).resolves.toEqual({
          connectionId: fixture.connectionId,
          status: "complete",
        });
        expect(revokeSourceAccess).toHaveBeenCalledOnce();
        await expect(fixture.observer.deviceConnectionSource.findFirstOrThrow({
          select: { lastErrorCode: true, status: true },
          where: {
            connectionId: fixture.connectionId,
            sourceProviderSlug: "fitbit",
          },
        })).resolves.toEqual({
          lastErrorCode: "SOURCE_USER_DISCONNECTED",
          status: "disconnected",
        });
      } finally {
        allowDirtyCommit.resolve();
        await Promise.allSettled([
          ...(admissionOutcome ? [admissionOutcome] : []),
          ...(cutoverOutcome ? [cutoverOutcome] : []),
        ]);
        await cleanupFitbitCutoverFixture(fixture);
      }
    }, 60_000);
  },
);
