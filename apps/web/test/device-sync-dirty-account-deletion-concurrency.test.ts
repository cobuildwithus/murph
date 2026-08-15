import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";

import { persistProviderTokenRefreshErrorStatus } from "@/src/lib/device-sync/agent-session-token-refresh";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { PrismaHostedDirtyConnectionStore } from "@/src/lib/device-sync/prisma-store/dirty-connections";
import { PrismaHostedOAuthSessionStore } from "@/src/lib/device-sync/prisma-store/oauth-sessions";
import { HostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { buildHostedProviderAccountBlindIndex } from "@/src/lib/device-sync/routing-index";
import { disconnectHostedDeviceSyncConnection } from "@/src/lib/device-sync/wake-service";
import { HostedDeviceSyncWebhookAdminService } from "@/src/lib/device-sync/webhook-admin-service";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import {
  assertNoDeviceRefreshLeasesBeforeAccountSuspensionTx,
  lockDeviceConnectionAuthorityRowsForAccountDeletionTx,
} from "@/src/lib/hosted-privacy/account-data-service";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  createDeviceSyncPublicIngress,
  createDeviceSyncRegistry,
} from "@murphai/device-syncd/public-ingress";
import type { DeviceSyncProvider } from "@murphai/device-syncd/types";

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
        webhookTransaction = fixture.webhookClient.$transaction(async (tx) => {
          webhookPid.resolve(await readBackendPid(tx));
          return store.upsertDirtyConnection({
            ...dirtyInput,
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
        webhookTransaction = fixture.webhookClient.$transaction(
          async (tx) => store.upsertDirtyConnection({
            ...dirtyInput,
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

describe.skipIf(!runPostgresConcurrencyProof)(
  "device OAuth PostgreSQL account-deletion fence",
  () => {
    it("locks connection and source authority rows before the terminal snapshot", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const userId = `member_device_authority_${fixtureId}`;
      const connectionId = `dsc_device_authority_${fixtureId}`;
      const sourceId = `dcss_device_authority_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const writer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const deletion = createPrismaClient({ databaseUrl, poolMax: 1 });
      const connectionWriteStarted = createDeferred();
      const releaseConnectionWrite = createDeferred();
      const sourceWriteStarted = createDeferred();
      const releaseSourceWrite = createDeferred();

      try {
        await observer.hostedMember.create({ data: { id: userId } });
        await observer.deviceConnection.create({
          data: {
            connectedAt: new Date("2026-08-11T12:00:00.000Z"),
            id: connectionId,
            provider: "oura",
            providerAccountBlindIndex: `hbdi:${fixtureId}`,
            tokenVersion: 1,
            userId,
          },
        });
        await observer.deviceConnectionSource.create({
          data: {
            connectionId,
            firstSeenAt: new Date("2026-08-11T12:00:00.000Z"),
            id: sourceId,
            lastSeenAt: new Date("2026-08-11T12:00:00.000Z"),
            sourceInstanceKey: "primary",
            sourceProviderSlug: "oura",
            status: "connected",
          },
        });

        const connectionWrite = writer.$transaction(async (tx) => {
          await tx.deviceConnection.update({
            data: { tokenVersion: 2 },
            where: { id: connectionId },
          });
          connectionWriteStarted.resolve();
          await releaseConnectionWrite.promise;
        }, { timeout: 15_000 });
        await connectionWriteStarted.promise;

        const connectionLock = deletion.$transaction(async (tx) => {
          const pid = await readBackendPid(tx);
          const locked = lockDeviceConnectionAuthorityRowsForAccountDeletionTx({
            memberId: userId,
            prisma: tx,
          });
          await waitForBlockedBackend({ observer, pid });
          releaseConnectionWrite.resolve();
          await connectionWrite;
          await locked;
          return tx.deviceConnection.findUnique({
            select: { tokenVersion: true },
            where: { id: connectionId },
          });
        }, { timeout: 15_000 });
        await expect(connectionLock).resolves.toEqual({ tokenVersion: 2 });

        const sourceWrite = writer.$transaction(async (tx) => {
          await tx.deviceConnectionSource.update({
            data: { status: "error" },
            where: { id: sourceId },
          });
          sourceWriteStarted.resolve();
          await releaseSourceWrite.promise;
        }, { timeout: 15_000 });
        await sourceWriteStarted.promise;

        const sourceLock = deletion.$transaction(async (tx) => {
          const pid = await readBackendPid(tx);
          const locked = lockDeviceConnectionAuthorityRowsForAccountDeletionTx({
            memberId: userId,
            prisma: tx,
          });
          await waitForBlockedBackend({ observer, pid });
          releaseSourceWrite.resolve();
          await sourceWrite;
          await locked;
          return tx.deviceConnectionSource.findUnique({
            select: { status: true },
            where: { id: sourceId },
          });
        }, { timeout: 15_000 });
        await expect(sourceLock).resolves.toEqual({ status: "error" });
      } finally {
        releaseConnectionWrite.resolve();
        releaseSourceWrite.resolve();
        await observer.deviceConnectionSource.deleteMany({
          where: { connectionId },
        });
        await observer.deviceConnection.deleteMany({ where: { id: connectionId } });
        await observer.hostedMember.deleteMany({ where: { id: userId } });
        await Promise.all([
          deletion.$disconnect(),
          observer.$disconnect(),
          writer.$disconnect(),
        ]);
      }
    });

    it("persists provider-revocation ownership when suspension wins after provider success", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const userId = `member_oauth_provider_${fixtureId}`;
      const externalAccountId = `provider-account-${fixtureId}`;
      const providerSucceeded = createDeferred();
      const releaseProviderResult = createDeferred();
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: {
          decrypt: (value) => value,
          encrypt: (value) => value,
          keyVersion: "test-device-key-v1",
        },
        prisma,
        providerAccountBlindIndexKey: Buffer.alloc(32, 17),
      });
      const provider: DeviceSyncProvider = {
        connectionHandler: {
          async beginConnection(input) {
            return {
              authorizationUrl:
                `https://provider.example.test/authorize?state=${input.state}`,
            };
          },
          async completeConnection() {
            providerSucceeded.resolve();
            await releaseProviderResult.promise;
            return {
              credential: {
                kind: "oauth_tokens",
                tokens: {
                  accessToken: "access-token",
                  refreshToken: "refresh-token",
                },
              },
              externalAccountId,
              scopes: ["read:data"],
            };
          },
          async refreshTokens() {
            return { accessToken: "refreshed-access-token" };
          },
          async revokeAccess() {
            throw new Error("provider revocation outcome unavailable");
          },
        },
        descriptor: {
          displayName: "Deletion fence proof",
          normalization: {
            metricFamilies: ["activity"],
            snapshotParser: "schema",
          },
          oauth: {
            callbackPath: "/oauth/deletion-proof/callback",
            defaultScopes: ["read:data"],
          },
          provider: "deletion-proof",
          sourcePriorityHints: {
            defaultPriority: 50,
            metricFamilies: { activity: 50 },
          },
          transportModes: ["oauth_callback"],
        },
        provider: "deletion-proof",
      };
      const ingress = createDeviceSyncPublicIngress({
        publicBaseUrl: "https://sync.example.test/device-sync",
        registry: createDeviceSyncRegistry([provider]),
        store,
      });

      try {
        await prisma.hostedMember.create({ data: { id: userId } });
        const begin = await ingress.startConnection({
          ownerId: userId,
          provider: provider.provider,
        });
        const callback = ingress.handleOAuthCallback({
          expectedOwnerId: userId,
          provider: provider.provider,
          state: begin.state,
          code: "provider-success",
        });
        await providerSucceeded.promise;
        await prisma.deviceOauthSession.update({
          data: { expiresAt: new Date("2026-08-11T12:04:00.000Z") },
          where: { state: begin.state },
        });
        await expect(store.deleteExpiredOAuthStates(
          "2026-08-11T12:05:00.000Z",
        )).resolves.toBe(0);
        await expect(store.consumeOAuthState(
          begin.state,
          "2026-08-11T12:05:00.000Z",
          provider.provider,
          userId,
        )).resolves.toMatchObject({ status: "replayed" });
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM hosted_member WHERE id = ${userId} FOR UPDATE`;
          await tx.hostedMember.update({
            data: { suspendedAt: new Date("2026-08-11T12:05:00.000Z") },
            where: { id: userId },
          });
        });
        await expect(store.consumeOAuthState(
          begin.state,
          "2026-08-11T12:06:00.000Z",
          provider.provider,
          userId,
        )).resolves.toMatchObject({ status: "replayed" });
        await expect(prisma.deviceOauthSession.count({
          where: { state: begin.state },
        })).resolves.toBe(1);
        releaseProviderResult.resolve();

        await expect(callback).rejects.toMatchObject({
          code: "CONNECTION_OWNER_SUSPENDED",
        });
        await expect(prisma.deviceOauthSession.findUnique({
          where: { state: begin.state },
        })).resolves.toBeNull();
        await expect(prisma.deviceConnection.findFirst({
          select: {
            setupPhase: true,
            status: true,
            tokenVersion: true,
            userId: true,
          },
          where: {
            provider: provider.provider,
            userId,
          },
        })).resolves.toEqual({
          setupPhase: "failed",
          status: "reauthorization_required",
          tokenVersion: 1,
          userId,
        });
      } finally {
        releaseProviderResult.resolve();
        await prisma.deviceOauthSession.deleteMany({ where: { userId } });
        await prisma.deviceConnection.deleteMany({ where: { userId } });
        await prisma.hostedMember.deleteMany({ where: { id: userId } });
        await prisma.$disconnect();
      }
    });

    it("clears a failed OAuth credential only after confirmed revocation of its exact epoch", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const userId = `member_oauth_cleanup_${fixtureId}`;
      const connectionId = `dsc_oauth_cleanup_${fixtureId}`;
      const connectedAt = new Date("2026-08-11T12:00:00.000Z");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: {
          decrypt: (value) => value,
          encrypt: (value) => value,
          keyVersion: "test-device-key-v1",
        },
        prisma,
        providerAccountBlindIndexKey: Buffer.alloc(32, 19),
      });
      try {
        await prisma.hostedMember.create({ data: { id: userId } });
        await prisma.deviceConnection.create({
          data: {
            accessTokenEncrypted: "durable-access-token",
            connectedAt,
            credentialKind: "oauth_tokens",
            externalAccountIdEncrypted: "provider-account",
            id: connectionId,
            keyVersion: "test-device-key-v1",
            provider: "oauth-cleanup-proof",
            providerAccountBlindIndex: `blind_${fixtureId}`,
            refreshTokenEncrypted: "durable-refresh-token",
            status: "active",
            tokenVersion: 1,
            userId,
          },
        });

        await expect(store.withConnectionMutationLock(
          connectionId,
          async (tx) => store.claimConnectionRefreshLease({
            connectionId,
            leaseExpiresAt: "2026-08-11T12:05:00.000Z",
            leaseOwner: "agent-refresh:postgres-proof",
            now: "2026-08-11T12:00:30.000Z",
            tokenVersion: 1,
            tx,
            userId,
          }),
        )).resolves.toEqual({ status: "claimed" });
        await expect(store.markConnectionSetupFailed({
          accountId: connectionId,
          code: "OAUTH_SETUP_FAILED",
          expectedConnectedAt: connectedAt.toISOString(),
          message: "post-connect setup failed",
          now: "2026-08-11T12:01:00.000Z",
        })).resolves.toMatchObject({
          applied: false,
          blockedByRefreshLease: true,
          oauthTokenVersion: 1,
        });
        await expect(store.clearOAuthCredentialAfterConfirmedRevoke({
          accountId: connectionId,
          expectedConnectedAt: connectedAt.toISOString(),
          expectedTokenVersion: 1,
          now: "2026-08-11T12:01:30.000Z",
        })).resolves.toBe(false);
        await store.withConnectionMutationLock(connectionId, async (tx) => {
          await store.persistStoredConnectionTokenBundle({
            connectionId,
            externalAccountId: "provider-account",
            provider: "oauth-cleanup-proof",
            refreshLeaseOwner: "agent-refresh:postgres-proof",
            tokenBundle: {
              accessToken: "rotated-access-token",
              accessTokenExpiresAt: null,
              keyVersion: "test-device-key-v1",
              refreshToken: "rotated-refresh-token",
              tokenVersion: 2,
            },
            tx,
          });
          await expect(store.clearConnectionRefreshLease({
            connectionId,
            leaseOwner: "agent-refresh:postgres-proof",
            tx,
          })).resolves.toBe(true);
        });

        await expect(store.markConnectionSetupFailed({
          accountId: connectionId,
          code: "OAUTH_SETUP_FAILED",
          expectedConnectedAt: connectedAt.toISOString(),
          message: "post-connect setup failed",
          now: "2026-08-11T12:01:00.000Z",
        })).resolves.toMatchObject({ applied: true });
        await expect(store.getOAuthCleanupAccount({
          accountId: connectionId,
          expectedConnectedAt: connectedAt.toISOString(),
          expectedTokenVersion: 2,
        })).resolves.toMatchObject({
          credential: {
            kind: "oauth_tokens",
            tokens: {
              accessToken: "rotated-access-token",
              refreshToken: "rotated-refresh-token",
            },
          },
        });
        await expect(prisma.deviceConnection.findUnique({
          select: {
            accessTokenEncrypted: true,
            credentialKind: true,
            refreshTokenEncrypted: true,
            setupPhase: true,
            status: true,
            tokenVersion: true,
          },
          where: { id: connectionId },
        })).resolves.toEqual({
          accessTokenEncrypted: "rotated-access-token",
          credentialKind: "oauth_tokens",
          refreshTokenEncrypted: "rotated-refresh-token",
          setupPhase: "failed",
          status: "reauthorization_required",
          tokenVersion: 2,
        });

        await expect(store.clearOAuthCredentialAfterConfirmedRevoke({
          accountId: connectionId,
          expectedConnectedAt: connectedAt.toISOString(),
          expectedTokenVersion: 1,
          now: "2026-08-11T12:01:30.000Z",
        })).resolves.toBe(false);
        await expect(store.clearOAuthCredentialAfterConfirmedRevoke({
          accountId: connectionId,
          expectedConnectedAt: connectedAt.toISOString(),
          expectedTokenVersion: 2,
          now: "2026-08-11T12:02:00.000Z",
        })).resolves.toBe(true);
        await expect(prisma.deviceConnection.findUnique({
          select: {
            accessTokenEncrypted: true,
            credentialKind: true,
            refreshTokenEncrypted: true,
            tokenVersion: true,
          },
          where: { id: connectionId },
        })).resolves.toEqual({
          accessTokenEncrypted: null,
          credentialKind: "none",
          refreshTokenEncrypted: null,
          tokenVersion: null,
        });
      } finally {
        await prisma.deviceConnection.deleteMany({ where: { id: connectionId } });
        await prisma.hostedMember.deleteMany({ where: { id: userId } });
        await prisma.$disconnect();
      }
    });

    it("retains OAuth disconnect authority across ambiguous revoke and clears it only after retry", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      installHostedSecureBoxStringTestCodec();
      const fixtureId = randomUUID();
      const userId = `member_oauth_disconnect_${fixtureId}`;
      const connectionId = `dsc_oauth_disconnect_${fixtureId}`;
      const connectedAt = new Date("2026-08-11T12:00:00.000Z");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: {
          decrypt: (value) => value,
          encrypt: (value) => value,
          keyVersion: "test-device-key-v1",
        },
        prisma,
        providerAccountBlindIndexKey: Buffer.alloc(32, 23),
      });
      const registry = createDeviceSyncRegistry();
      const receivedAccessTokens: string[] = [];

      try {
        await prisma.hostedMember.create({ data: { id: userId } });
        await prisma.deviceConnection.create({
          data: {
            accessTokenEncrypted: "durable-access-token",
            connectedAt,
            credentialKind: "oauth_tokens",
            externalAccountIdEncrypted: "provider-account",
            id: connectionId,
            keyVersion: "test-device-key-v1",
            provider: "oauth-disconnect-proof",
            providerAccountBlindIndex: `blind_${fixtureId}`,
            refreshTokenEncrypted: "durable-refresh-token",
            status: "active",
            tokenVersion: 1,
            userId,
          },
        });

        const unavailable = await disconnectHostedDeviceSyncConnection({
          connectionId,
          registry,
          store,
          userId,
        });
        expect(unavailable).toMatchObject({
          connection: {
            lastErrorCode: "DISCONNECT_RECOVERY_REQUIRED",
            status: "reauthorization_required",
          },
          warning: { code: "PROVIDER_REVOKE_NOT_CONFIGURED" },
        });
        await expect(prisma.deviceConnection.findUnique({
          select: {
            accessTokenEncrypted: true,
            credentialKind: true,
            refreshTokenEncrypted: true,
            status: true,
            tokenVersion: true,
          },
          where: { id: connectionId },
        })).resolves.toEqual({
          accessTokenEncrypted: "durable-access-token",
          credentialKind: "oauth_tokens",
          refreshTokenEncrypted: "durable-refresh-token",
          status: "reauthorization_required",
          tokenVersion: 1,
        });

        const failed = await disconnectHostedDeviceSyncConnection({
          connectionId,
          registry,
          revokeAccess: async (account) => {
            if (account.credential.kind !== "oauth_tokens") {
              throw new Error("Expected durable OAuth cleanup authority.");
            }
            receivedAccessTokens.push(account.credential.tokens.accessToken);
            expect(account.credential).toMatchObject({
              kind: "oauth_tokens",
              tokens: {
                accessToken: "durable-access-token",
                refreshToken: "durable-refresh-token",
              },
            });
            throw new Error("provider revocation outcome unavailable");
          },
          store,
          userId,
        });
        expect(failed).toMatchObject({
          connection: {
            lastErrorCode: "DISCONNECT_RECOVERY_REQUIRED",
            status: "reauthorization_required",
          },
          warning: { code: "PROVIDER_REVOKE_FAILED" },
        });
        await expect(prisma.deviceConnection.findUnique({
          select: {
            accessTokenEncrypted: true,
            credentialKind: true,
            refreshTokenEncrypted: true,
            status: true,
            tokenVersion: true,
          },
          where: { id: connectionId },
        })).resolves.toEqual({
          accessTokenEncrypted: "durable-access-token",
          credentialKind: "oauth_tokens",
          refreshTokenEncrypted: "durable-refresh-token",
          status: "reauthorization_required",
          tokenVersion: 1,
        });

        const succeeded = await disconnectHostedDeviceSyncConnection({
          connectionId,
          registry,
          revokeAccess: async (account) => {
            if (account.credential.kind !== "oauth_tokens") {
              throw new Error("Expected durable OAuth cleanup authority.");
            }
            receivedAccessTokens.push(account.credential.tokens.accessToken);
          },
          store,
          userId,
        });
        expect(succeeded).toMatchObject({
          connection: { status: "disconnected" },
        });
        await expect(prisma.deviceConnection.findUnique({
          select: {
            accessTokenEncrypted: true,
            credentialKind: true,
            refreshTokenEncrypted: true,
            status: true,
            tokenVersion: true,
          },
          where: { id: connectionId },
        })).resolves.toEqual({
          accessTokenEncrypted: null,
          credentialKind: "none",
          refreshTokenEncrypted: null,
          status: "disconnected",
          tokenVersion: null,
        });
        expect(receivedAccessTokens).toEqual([
          "durable-access-token",
          "durable-access-token",
        ]);
      } finally {
        await prisma.deviceSyncSignal.deleteMany({ where: { connectionId } });
        await prisma.deviceConnection.deleteMany({ where: { id: connectionId } });
        await prisma.hostedMember.deleteMany({ where: { id: userId } });
        await prisma.$disconnect();
        setHostedSecureBoxStringTestCodecForTests(null);
      }
    });

    it("uses raw credential kind as the sole disconnect cleanup authority", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      installHostedSecureBoxStringTestCodec();
      const fixtureId = randomUUID();
      const userId = `member_provider_cleanup_${fixtureId}`;
      const noneConnectionId = `dsc_none_cleanup_${fixtureId}`;
      const providerConnectionId = `dsc_provider_cleanup_${fixtureId}`;
      const sourceId = `dcss_provider_cleanup_${fixtureId}`;
      const connectedAt = new Date("2026-08-11T12:00:00.000Z");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: {
          decrypt: (value) => value,
          encrypt: (value) => value,
          keyVersion: "test-device-key-v1",
        },
        prisma,
        providerAccountBlindIndexKey: Buffer.alloc(32, 29),
      });
      const registry = createDeviceSyncRegistry();
      const receivedProviderConfigKeys: string[] = [];

      try {
        await prisma.hostedMember.create({ data: { id: userId } });
        await prisma.deviceConnection.createMany({
          data: [
            {
              connectedAt,
              credentialKind: "none",
              externalAccountIdEncrypted: "completed-provider-account",
              id: noneConnectionId,
              provider: "cleanup-complete-proof",
              providerAccountBlindIndex: `none_${fixtureId}`,
              status: "reauthorization_required",
              userId,
            },
            {
              connectedAt,
              credentialKind: "provider_config",
              externalAccountIdEncrypted: "provider-account",
              id: providerConnectionId,
              provider: "provider-config-cleanup-proof",
              providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
                externalAccountId: "provider-account",
                key: Buffer.alloc(32, 29),
                provider: "provider-config-cleanup-proof",
              }),
              providerConfigKey: "provider-cleanup-config",
              status: "active",
              userId,
            },
          ],
        });
        await prisma.deviceConnectionSource.create({
          data: {
            connectionId: providerConnectionId,
            firstSeenAt: connectedAt,
            id: sourceId,
            lastSeenAt: connectedAt,
            sourceInstanceKey: "primary",
            sourceProviderSlug: "provider-source",
            status: "connected",
          },
        });

        const localOnly = await disconnectHostedDeviceSyncConnection({
          connectionId: noneConnectionId,
          registry,
          revokeAccess: async () => {
            throw new Error("credentialKind=none must not invoke provider cleanup");
          },
          store,
          userId,
        });
        expect(localOnly).toMatchObject({
          connection: { status: "disconnected" },
        });
        await expect(prisma.deviceConnection.findUnique({
          select: { credentialKind: true, status: true },
          where: { id: noneConnectionId },
        })).resolves.toEqual({
          credentialKind: "none",
          status: "disconnected",
        });

        const failed = await disconnectHostedDeviceSyncConnection({
          connectionId: providerConnectionId,
          registry,
          revokeAccess: async (account) => {
            if (account.credential.kind !== "provider_config") {
              throw new Error("Expected durable provider-config cleanup authority.");
            }
            receivedProviderConfigKeys.push(account.credential.providerConfigKey);
            throw new Error("provider deregistration outcome unavailable");
          },
          store,
          userId,
        });
        expect(failed).toMatchObject({
          connection: {
            lastErrorCode: "DISCONNECT_RECOVERY_REQUIRED",
            status: "reauthorization_required",
          },
          warning: { code: "PROVIDER_REVOKE_FAILED" },
        });
        await expect(prisma.deviceConnection.findUnique({
          select: { credentialKind: true, providerConfigKey: true, status: true },
          where: { id: providerConnectionId },
        })).resolves.toEqual({
          credentialKind: "provider_config",
          providerConfigKey: "provider-cleanup-config",
          status: "reauthorization_required",
        });
        await expect(prisma.deviceConnectionSource.findUnique({
          select: { status: true },
          where: { id: sourceId },
        })).resolves.toEqual({ status: "connected" });

        const succeeded = await disconnectHostedDeviceSyncConnection({
          connectionId: providerConnectionId,
          registry,
          revokeAccess: async (account) => {
            if (account.credential.kind !== "provider_config") {
              throw new Error("Expected durable provider-config cleanup authority.");
            }
            receivedProviderConfigKeys.push(account.credential.providerConfigKey);
          },
          store,
          userId,
        });
        expect(succeeded).toMatchObject({
          connection: { status: "disconnected" },
        });
        await expect(prisma.deviceConnection.findUnique({
          select: { credentialKind: true, providerConfigKey: true, status: true },
          where: { id: providerConnectionId },
        })).resolves.toEqual({
          credentialKind: "none",
          providerConfigKey: null,
          status: "disconnected",
        });
        await expect(prisma.deviceConnectionSource.findUnique({
          select: { status: true },
          where: { id: sourceId },
        })).resolves.toEqual({ status: "disconnected" });
        expect(receivedProviderConfigKeys).toEqual([
          "provider-cleanup-config",
          "provider-cleanup-config",
        ]);
      } finally {
        await prisma.deviceSyncSignal.deleteMany({
          where: { connectionId: { in: [noneConnectionId, providerConnectionId] } },
        });
        await prisma.deviceConnectionSource.deleteMany({
          where: { connectionId: providerConnectionId },
        });
        await prisma.deviceConnection.deleteMany({
          where: { id: { in: [noneConnectionId, providerConnectionId] } },
        });
        await prisma.hostedMember.deleteMany({ where: { id: userId } });
        await prisma.$disconnect();
        setHostedSecureBoxStringTestCodecForTests(null);
      }
    });

    it("retries disconnected retained credentials during consent withdrawal", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      installHostedSecureBoxStringTestCodec();
      const fixtureId = randomUUID();
      const userId = `member_consent_cleanup_${fixtureId}`;
      const retainedConnectionId = `dsc_consent_cleanup_${fixtureId}`;
      const noneConnectionId = `dsc_consent_none_${fixtureId}`;
      const sourceId = `dcss_consent_cleanup_${fixtureId}`;
      const connectedAt = new Date("2026-08-11T12:00:00.000Z");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const routingIndexKey = Buffer.alloc(32, 31);
      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: {
          decrypt: (value) => value,
          encrypt: (value) => value,
          keyVersion: "test-device-key-v1",
        },
        prisma,
        providerAccountBlindIndexKey: routingIndexKey,
      });
      let revokeShouldFail = true;
      const receivedProviderConfigKeys: string[] = [];
      const provider: DeviceSyncProvider = {
        connectionHandler: {
          async beginConnection() {
            return { authorizationUrl: "https://provider.example.test/connect" };
          },
          async completeConnection() {
            throw new Error("Connection completion is not used in this proof.");
          },
          async revokeAccess(account) {
            if (account.credential.kind !== "provider_config") {
              throw new Error("Expected durable provider-config cleanup authority.");
            }
            receivedProviderConfigKeys.push(account.credential.providerConfigKey);
            if (revokeShouldFail) {
              throw new Error("provider deregistration outcome unavailable");
            }
          },
        },
        credentialPolicy: {
          kind: "provider_config",
          providerConfigKey: "consent-cleanup-config",
        },
        descriptor: {
          connection: {
            callbackPath: "/connect/consent-cleanup/callback",
            kind: "external_link",
          },
          displayName: "Consent cleanup proof",
          normalization: {
            metricFamilies: ["activity"],
            snapshotParser: "schema",
          },
          provider: "consent-cleanup-proof",
          sourcePriorityHints: {
            defaultPriority: 50,
            metricFamilies: { activity: 50 },
          },
          transportModes: ["external_link"],
        },
        provider: "consent-cleanup-proof",
      };
      const registry = createDeviceSyncRegistry([provider]);
      const request = new Request("https://control.example.test/api/legal/health-data-consent");
      const context = {
        allowedReturnOrigins: [],
        env: {
          allowedMutationOrigins: [],
          allowedReturnOrigins: [],
          isProduction: false,
          publicBaseUrl: null,
          routingIndexKey,
          trustedUserAssertionHeader: "x-hosted-user-assertion",
          trustedUserSignatureHeader: "x-hosted-user-signature",
          trustedUserSigningSecret: null,
        },
        publicIngressBaseUrl: "https://control.example.test/api/device-sync",
        publicIngressBaseUrlSource: "request" as const,
        request,
        store,
      };
      const service = new HostedDeviceSyncPublicIngressService(
        context,
        new HostedDeviceSyncWebhookAdminService(context),
        registry,
      );

      try {
        await prisma.hostedMember.create({ data: { id: userId } });
        await prisma.hostedConsentGrant.create({
          data: {
            createdAt: connectedAt,
            documentVersionsJson: {},
            grantedAt: connectedAt,
            memberId: userId,
            revokedAt: connectedAt,
            scope: "launch.health-data",
            source: "device-sync-consent-cleanup-proof",
            status: "revoked",
            updatedAt: connectedAt,
          },
        });
        await prisma.deviceConnection.createMany({
          data: [
            {
              connectedAt,
              credentialKind: "provider_config",
              externalAccountIdEncrypted: "provider-account",
              id: retainedConnectionId,
              provider: provider.provider,
              providerAccountBlindIndex: buildHostedProviderAccountBlindIndex({
                externalAccountId: "provider-account",
                key: routingIndexKey,
                provider: provider.provider,
              }),
              providerConfigKey: "consent-cleanup-config",
              status: "disconnected",
              userId,
            },
            {
              connectedAt,
              credentialKind: "none",
              id: noneConnectionId,
              provider: "consent-none-proof",
              providerAccountBlindIndex: `none_${fixtureId}`,
              status: "disconnected",
              userId,
            },
          ],
        });
        await prisma.deviceConnectionSource.create({
          data: {
            connectionId: retainedConnectionId,
            firstSeenAt: connectedAt,
            id: sourceId,
            lastSeenAt: connectedAt,
            sourceInstanceKey: "primary",
            sourceProviderSlug: "provider-source",
            status: "connected",
          },
        });

        await expect(service.disconnectAllConnections(userId)).resolves.toEqual({
          attemptedCount: 1,
          disconnectedCount: 0,
          failedCount: 1,
        });
        await expect(prisma.deviceConnection.findUnique({
          select: { credentialKind: true, providerConfigKey: true, status: true },
          where: { id: retainedConnectionId },
        })).resolves.toEqual({
          credentialKind: "provider_config",
          providerConfigKey: "consent-cleanup-config",
          status: "reauthorization_required",
        });
        await expect(prisma.deviceConnectionSource.findUnique({
          select: { status: true },
          where: { id: sourceId },
        })).resolves.toEqual({ status: "connected" });

        revokeShouldFail = false;
        await expect(service.disconnectAllConnections(userId)).resolves.toEqual({
          attemptedCount: 1,
          disconnectedCount: 1,
          failedCount: 0,
        });
        await expect(prisma.deviceConnection.findUnique({
          select: { credentialKind: true, providerConfigKey: true, status: true },
          where: { id: retainedConnectionId },
        })).resolves.toEqual({
          credentialKind: "none",
          providerConfigKey: null,
          status: "disconnected",
        });
        await expect(prisma.deviceConnectionSource.findUnique({
          select: { status: true },
          where: { id: sourceId },
        })).resolves.toEqual({ status: "disconnected" });
        await expect(prisma.deviceConnection.findUnique({
          select: { credentialKind: true, status: true },
          where: { id: noneConnectionId },
        })).resolves.toEqual({ credentialKind: "none", status: "disconnected" });

        // Recreate the legacy shape and prove a first-attempt successful retry
        // also terminalizes its child sources. The preceding fail-then-success
        // path enters from reauthorization_required instead.
        await prisma.deviceConnection.update({
          data: {
            credentialKind: "provider_config",
            providerConfigKey: "consent-cleanup-config",
            status: "disconnected",
          },
          where: { id: retainedConnectionId },
        });
        await prisma.deviceConnectionSource.update({
          data: { status: "connected" },
          where: { id: sourceId },
        });
        await expect(service.disconnectAllConnections(userId)).resolves.toEqual({
          attemptedCount: 1,
          disconnectedCount: 1,
          failedCount: 0,
        });
        await expect(prisma.deviceConnection.findUnique({
          select: { credentialKind: true, providerConfigKey: true, status: true },
          where: { id: retainedConnectionId },
        })).resolves.toEqual({
          credentialKind: "none",
          providerConfigKey: null,
          status: "disconnected",
        });
        await expect(prisma.deviceConnectionSource.findUnique({
          select: { status: true },
          where: { id: sourceId },
        })).resolves.toEqual({ status: "disconnected" });
        expect(receivedProviderConfigKeys).toEqual([
          "consent-cleanup-config",
          "consent-cleanup-config",
          "consent-cleanup-config",
        ]);
        await expect(prisma.hostedConsentEvent.count({
          where: { memberId: userId },
        })).resolves.toBe(0);
      } finally {
        await prisma.deviceSyncSignal.deleteMany({
          where: { connectionId: { in: [retainedConnectionId, noneConnectionId] } },
        });
        await prisma.deviceConnectionSource.deleteMany({
          where: { connectionId: retainedConnectionId },
        });
        await prisma.deviceConnection.deleteMany({ where: { userId } });
        await prisma.hostedConsentEvent.deleteMany({ where: { memberId: userId } });
        await prisma.hostedConsentGrant.deleteMany({ where: { memberId: userId } });
        await prisma.hostedMember.deleteMany({ where: { id: userId } });
        await prisma.$disconnect();
        setHostedSecureBoxStringTestCodecForTests(null);
      }
    });

    it("discards only an exact owner/provider unconsumed callback admission", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const ownerId = `member_oauth_owner_${fixtureId}`;
      const foreignOwnerId = `member_oauth_foreign_${fixtureId}`;
      const state = `oauth_discard_${fixtureId}`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const store = new PrismaHostedOAuthSessionStore(prisma);
      try {
        await prisma.hostedMember.createMany({
          data: [{ id: ownerId }, { id: foreignOwnerId }],
        });
        await prisma.deviceOauthSession.create({
          data: {
            createdAt: new Date("2026-08-11T12:00:00.000Z"),
            expiresAt: new Date("2026-08-11T13:00:00.000Z"),
            provider: "oura",
            state,
            userId: ownerId,
          },
        });

        await expect(store.discardUnconsumedOAuthState(
          state,
          "2026-08-11T12:00:30.000Z",
          "oura",
          foreignOwnerId,
        )).resolves.toMatchObject({ status: "owner_mismatch" });
        await expect(store.discardUnconsumedOAuthState(
          state,
          "2026-08-11T12:00:30.000Z",
          "whoop",
          ownerId,
        )).resolves.toMatchObject({ status: "provider_mismatch" });
        const consumed = await store.consumeOAuthState(
          state,
          "2026-08-11T12:01:00.000Z",
          "oura",
          ownerId,
        );
        expect(consumed).toMatchObject({ status: "consumed" });
        await expect(store.discardUnconsumedOAuthState(
          state,
          "2026-08-11T12:01:30.000Z",
          "oura",
          ownerId,
        )).resolves.toMatchObject({ status: "replayed" });
        await expect(prisma.deviceOauthSession.count({
          where: { state },
        })).resolves.toBe(1);
        if (consumed.status !== "consumed") {
          throw new Error("Expected the callback admission to be consumed.");
        }
        await expect(store.resolveOAuthStateWithoutProviderAuthority({
          state,
          consumedAt: consumed.consumedAt,
        })).resolves.toBe(true);

        await prisma.deviceOauthSession.create({
          data: {
            createdAt: new Date("2026-08-11T12:02:00.000Z"),
            expiresAt: new Date("2026-08-11T13:00:00.000Z"),
            provider: "oura",
            state,
            userId: ownerId,
          },
        });
        await expect(store.discardUnconsumedOAuthState(
          state,
          "2026-08-11T12:03:00.000Z",
          "oura",
          ownerId,
        )).resolves.toMatchObject({ status: "discarded" });
        await expect(prisma.deviceOauthSession.count({
          where: { state },
        })).resolves.toBe(0);
      } finally {
        await prisma.deviceOauthSession.deleteMany({ where: { state } });
        await prisma.hostedMember.deleteMany({
          where: { id: { in: [ownerId, foreignOwnerId] } },
        });
        await prisma.$disconnect();
      }
    });

    it("rolls back the connection write when exact OAuth claim resolution fails", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const userId = `member_oauth_atomic_${fixtureId}`;
      const state = `oauth_atomic_${fixtureId}`;
      const externalAccountId = `oauth-account-${fixtureId}`;
      const consumedAt = new Date("2026-08-11T12:01:00.000Z");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: {
          decrypt: (value) => value,
          encrypt: (value) => value,
          keyVersion: "test-device-key-v1",
        },
        prisma,
        providerAccountBlindIndexKey: Buffer.alloc(32, 19),
      });
      const connectionInput = {
        connectedAt: "2026-08-11T12:02:00.000Z",
        existingAccountPolicy: "replace" as const,
        externalAccountId,
        oauthClaim: {
          state,
          consumedAt: "2026-08-11T12:01:01.000Z",
        },
        ownerId: userId,
        provider: "oura",
        scopes: ["daily"],
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
        },
      };

      try {
        await prisma.hostedMember.create({ data: { id: userId } });
        await prisma.deviceOauthSession.create({
          data: {
            consumedAt,
            createdAt: new Date("2026-08-11T12:00:00.000Z"),
            expiresAt: new Date("2026-08-11T13:00:00.000Z"),
            provider: "oura",
            state,
            userId,
          },
        });

        await expect(store.upsertConnection(connectionInput)).rejects.toMatchObject({
          code: "OAUTH_STATE_CHANGED",
        });
        await expect(prisma.deviceConnection.count({ where: { userId } })).resolves.toBe(0);
        await expect(prisma.deviceOauthSession.count({ where: { state } })).resolves.toBe(1);

        await expect(store.upsertConnection({
          ...connectionInput,
          oauthClaim: {
            state,
            consumedAt: consumedAt.toISOString(),
          },
        })).resolves.toMatchObject({ provider: "oura" });
        await expect(prisma.deviceConnection.count({ where: { userId } })).resolves.toBe(1);
        await expect(prisma.deviceOauthSession.count({ where: { state } })).resolves.toBe(0);
      } finally {
        await prisma.deviceOauthSession.deleteMany({ where: { state } });
        await prisma.deviceConnection.deleteMany({ where: { userId } });
        await prisma.hostedMember.deleteMany({ where: { id: userId } });
        await prisma.$disconnect();
      }
    });

    it("waits behind suspension and rejects the callback before provider work", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const userId = `member_oauth_delete_${fixtureId}`;
      const state = `oauth_delete_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const deletionClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const callbackClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const deletionLocked = createDeferred();
      const allowSuspensionCommit = createDeferred();
      const callbackPid = createDeferred<number>();

      try {
        await observer.hostedMember.create({ data: { id: userId } });
        await observer.deviceOauthSession.create({
          data: {
            createdAt: new Date("2026-08-11T12:00:00.000Z"),
            expiresAt: new Date("2026-08-11T13:00:00.000Z"),
            provider: "oura",
            state,
            userId,
          },
        });

        const suspension = deletionClient.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM hosted_member WHERE id = ${userId} FOR UPDATE`;
          deletionLocked.resolve();
          await allowSuspensionCommit.promise;
          await tx.hostedMember.update({
            data: { suspendedAt: new Date("2026-08-11T12:05:00.000Z") },
            where: { id: userId },
          });
        }, { timeout: 15_000 });
        await deletionLocked.promise;

        const instrumentedCallbackClient = new Proxy(callbackClient, {
          get(target, property) {
            if (property === "$transaction") {
              return async <TResult>(
                transaction: (tx: Prisma.TransactionClient) => Promise<TResult>,
              ) => target.$transaction(async (tx) => {
                callbackPid.resolve(await readBackendPid(tx));
                return transaction(tx);
              });
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const store = new PrismaHostedOAuthSessionStore(
          instrumentedCallbackClient,
        );
        const callback = store.consumeOAuthState(
          state,
          "2026-08-11T12:06:00.000Z",
          "oura",
          userId,
        );
        await waitForBlockedBackend({
          observer,
          pid: await callbackPid.promise,
        });
        allowSuspensionCommit.resolve();
        await suspension;

        await expect(callback).resolves.toEqual({ status: "missing" });
        await expect(observer.deviceOauthSession.findUnique({
          where: { state },
        })).resolves.toBeNull();
      } finally {
        allowSuspensionCommit.resolve();
        await observer.deviceOauthSession.deleteMany({ where: { state } });
        await observer.hostedMember.deleteMany({ where: { id: userId } });
        await Promise.all([
          callbackClient.$disconnect(),
          deletionClient.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });

    it("serializes refresh-lease admission with account suspension in both lock orders", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const userId = `member_refresh_delete_${fixtureId}`;
      const connectionId = `dsc_refresh_delete_${fixtureId}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const deletionClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const refreshClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const refreshClaimed = createDeferred();
      const allowRefreshCommit = createDeferred();
      const deletionLocked = createDeferred();
      const allowSuspensionCommit = createDeferred();

      try {
        await observer.hostedMember.create({ data: { id: userId } });
        await observer.deviceConnection.create({
          data: {
            connectedAt: new Date("2026-08-11T12:00:00.000Z"),
            id: connectionId,
            provider: "oura",
            providerAccountBlindIndex: `blind_${fixtureId}`,
            status: "active",
            tokenVersion: 1,
            userId,
          },
        });
        const store = new PrismaDeviceSyncControlPlaneStore({
          prisma: refreshClient,
        });

        // Refresh owns the member lifetime first: suspension waits, then sees
        // the committed lease and exits without suspending the member.
        const refreshFirst = store.withHealthDataAdmissionLock(
          userId,
          connectionId,
          async (tx) => {
            const result = await store.claimConnectionRefreshLease({
              connectionId,
              leaseExpiresAt: "2026-08-11T12:10:00.000Z",
              leaseOwner: "agent-refresh:refresh-first",
              now: "2026-08-11T12:05:00.000Z",
              tokenVersion: 1,
              tx,
              userId,
            });
            refreshClaimed.resolve();
            await allowRefreshCommit.promise;
            return result;
          },
          { requireActiveMember: true },
        );
        await refreshClaimed.promise;

        const refreshFirstDeletionPid = createDeferred<number>();
        const refreshFirstSuspension = deletionClient.$transaction(async (tx) => {
          refreshFirstDeletionPid.resolve(await readBackendPid(tx));
          await tx.$queryRaw`SELECT 1 FROM hosted_member WHERE id = ${userId} FOR UPDATE`;
          await assertNoDeviceRefreshLeasesBeforeAccountSuspensionTx({
            memberIds: [userId],
            prisma: tx,
          });
          await tx.hostedMember.update({
            data: { suspendedAt: new Date("2026-08-11T12:06:00.000Z") },
            where: { id: userId },
          });
        }, { timeout: 15_000 });
        await waitForBlockedBackend({
          observer,
          pid: await refreshFirstDeletionPid.promise,
        });
        allowRefreshCommit.resolve();

        await expect(refreshFirst).resolves.toEqual({ status: "claimed" });
        await expect(refreshFirstSuspension).rejects.toMatchObject({
          code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
        });
        await expect(observer.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: userId },
        })).resolves.toEqual({ suspendedAt: null });
        await observer.deviceConnection.update({
          data: {
            refreshLeaseExpiresAt: null,
            refreshLeaseOwner: null,
            refreshLeaseTokenVersion: null,
          },
          where: { id: connectionId },
        });

        // Suspension owns the member lifetime first: refresh waits, observes
        // suspendedAt, and rejects before its connection callback can claim a
        // lease or begin provider work.
        const suspensionFirst = deletionClient.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM hosted_member WHERE id = ${userId} FOR UPDATE`;
          await assertNoDeviceRefreshLeasesBeforeAccountSuspensionTx({
            memberIds: [userId],
            prisma: tx,
          });
          deletionLocked.resolve();
          await allowSuspensionCommit.promise;
          await tx.hostedMember.update({
            data: { suspendedAt: new Date("2026-08-11T12:07:00.000Z") },
            where: { id: userId },
          });
        }, { timeout: 15_000 });
        await deletionLocked.promise;

        const refreshPid = createDeferred<number>();
        const instrumentedRefreshClient = new Proxy(refreshClient, {
          get(target, property) {
            if (property === "$transaction") {
              return async <TResult>(
                transaction: (tx: Prisma.TransactionClient) => Promise<TResult>,
              ) => target.$transaction(async (tx) => {
                refreshPid.resolve(await readBackendPid(tx));
                return transaction(tx);
              });
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const suspensionFirstStore = new PrismaDeviceSyncControlPlaneStore({
          prisma: instrumentedRefreshClient,
        });
        let refreshConnectionCallbackReached = false;
        const suspendedRefresh = suspensionFirstStore.withHealthDataAdmissionLock(
          userId,
          connectionId,
          async (tx) => {
            refreshConnectionCallbackReached = true;
            return suspensionFirstStore.claimConnectionRefreshLease({
              connectionId,
              leaseExpiresAt: "2026-08-11T12:12:00.000Z",
              leaseOwner: "agent-refresh:suspension-first",
              now: "2026-08-11T12:07:30.000Z",
              tokenVersion: 1,
              tx,
              userId,
            });
          },
          { requireActiveMember: true },
        );
        await waitForBlockedBackend({
          observer,
          pid: await refreshPid.promise,
        });
        allowSuspensionCommit.resolve();
        await suspensionFirst;

        await expect(suspendedRefresh).rejects.toMatchObject({
          code: "CONNECTION_OWNER_SUSPENDED",
        });
        expect(refreshConnectionCallbackReached).toBe(false);
        await expect(observer.deviceConnection.findUnique({
          select: {
            refreshLeaseExpiresAt: true,
            refreshLeaseOwner: true,
            refreshLeaseTokenVersion: true,
          },
          where: { id: connectionId },
        })).resolves.toEqual({
          refreshLeaseExpiresAt: null,
          refreshLeaseOwner: null,
          refreshLeaseTokenVersion: null,
        });
      } finally {
        allowRefreshCommit.resolve();
        allowSuspensionCommit.resolve();
        await observer.deviceConnection.deleteMany({ where: { id: connectionId } });
        await observer.hostedMember.deleteMany({ where: { id: userId } });
        await Promise.all([
          deletionClient.$disconnect(),
          observer.$disconnect(),
          refreshClient.$disconnect(),
        ]);
      }
    });

    it("blocks suspension after an ambiguous refresh replaces its lease with a reconnect fence", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const userId = `member_refresh_unknown_delete_${fixtureId}`;
      const connectionId = `dsc_refresh_unknown_delete_${fixtureId}`;
      const leaseOwner = "agent-refresh:ambiguous-before-suspension";
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const deletionClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const refreshClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const store = new PrismaDeviceSyncControlPlaneStore({
        codec: {
          decrypt: (value) => value,
          encrypt: (value) => value,
          keyVersion: "test-device-key-v1",
        },
        prisma: refreshClient,
      });
      const connectedAt = "2026-08-11T12:00:00.000Z";
      const account = {
        accessTokenExpiresAt: "2026-08-11T13:00:00.000Z",
        connectedAt,
        createdAt: connectedAt,
        credential: {
          kind: "oauth_tokens" as const,
          tokens: {
            accessToken: "access-token",
            accessTokenExpiresAt: "2026-08-11T13:00:00.000Z",
            refreshToken: "refresh-token",
          },
        },
        disconnectGeneration: 0,
        displayName: "Oura",
        externalAccountId: "provider-account",
        id: connectionId,
        keyVersion: "test-device-key-v1",
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        metadata: {},
        nextReconcileAt: null,
        provider: "oura",
        scopes: ["daily"],
        setupExpiresAt: null,
        setupPhase: null,
        status: "active" as const,
        tokenVersion: 1,
        updatedAt: connectedAt,
      };
      const currentTokenBundle = {
        accessToken: "access-token",
        accessTokenExpiresAt: "2026-08-11T13:00:00.000Z",
        keyVersion: "test-device-key-v1",
        refreshToken: "refresh-token",
        tokenVersion: 1,
      };
      let providerCleanupAttempted = false;

      try {
        await observer.hostedMember.create({ data: { id: userId } });
        await observer.deviceConnection.create({
          data: {
            accessTokenEncrypted: "access-token",
            accessTokenExpiresAt: new Date("2026-08-11T13:00:00.000Z"),
            connectedAt: new Date(connectedAt),
            credentialKind: "oauth_tokens",
            externalAccountIdEncrypted: "provider-account",
            id: connectionId,
            keyVersion: "test-device-key-v1",
            provider: "oura",
            providerAccountBlindIndex: `blind_${fixtureId}`,
            refreshTokenEncrypted: "refresh-token",
            status: "active",
            tokenVersion: 1,
            userId,
          },
        });

        // This is the state immediately after deletion preflight: there is no
        // lease or reconnect marker yet, so a refresh may still be admitted.
        await expect(assertNoDeviceRefreshLeasesBeforeAccountSuspensionTx({
          memberIds: [userId],
          prisma: observer,
        })).resolves.toBeUndefined();
        await expect(store.withHealthDataAdmissionLock(
          userId,
          connectionId,
          async (tx) => store.claimConnectionRefreshLease({
            connectionId,
            leaseExpiresAt: "2026-08-11T12:10:00.000Z",
            leaseOwner,
            now: "2026-08-11T12:05:00.000Z",
            tokenVersion: 1,
            tx,
            userId,
          }),
          { requireActiveMember: true },
        )).resolves.toEqual({ status: "claimed" });

        await store.withConnectionMutationLock(connectionId, async (tx) => {
          await persistProviderTokenRefreshErrorStatus({
            account,
            currentTokenBundle,
            error: new Error("The provider did not confirm whether token rotation completed."),
            now: "2026-08-11T12:05:30.000Z",
            refreshLeaseOwner: leaseOwner,
            store,
            tx,
            userId,
          });
          await expect(store.clearConnectionRefreshLease({
            connectionId,
            leaseOwner,
            tx,
          })).resolves.toBe(true);
        });

        const suspension = deletionClient.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM hosted_member WHERE id = ${userId} FOR UPDATE`;
          await assertNoDeviceRefreshLeasesBeforeAccountSuspensionTx({
            memberIds: [userId],
            prisma: tx,
          });
          await tx.hostedMember.update({
            data: { suspendedAt: new Date("2026-08-11T12:06:00.000Z") },
            where: { id: userId },
          });
          providerCleanupAttempted = true;
        });

        await expect(suspension).rejects.toMatchObject({
          code: "ACCOUNT_DELETION_DEVICE_AUTHORIZATION_IN_FLIGHT",
        });
        expect(providerCleanupAttempted).toBe(false);
        await expect(observer.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: userId },
        })).resolves.toEqual({ suspendedAt: null });
        await expect(observer.deviceConnection.findUnique({
          select: {
            accessTokenEncrypted: true,
            lastErrorCode: true,
            refreshLeaseExpiresAt: true,
            refreshLeaseOwner: true,
            refreshLeaseTokenVersion: true,
            status: true,
          },
          where: { id: connectionId },
        })).resolves.toEqual({
          accessTokenEncrypted: null,
          lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
          refreshLeaseExpiresAt: null,
          refreshLeaseOwner: null,
          refreshLeaseTokenVersion: null,
          status: "reauthorization_required",
        });
      } finally {
        await observer.deviceSyncSignal.deleteMany({ where: { connectionId } });
        await observer.deviceConnection.deleteMany({ where: { id: connectionId } });
        await observer.hostedMember.deleteMany({ where: { id: userId } });
        await Promise.all([
          deletionClient.$disconnect(),
          observer.$disconnect(),
          refreshClient.$disconnect(),
        ]);
      }
    });

    it("retains a callback claim across epoch mismatch and transaction rollback", async () => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
      }
      const fixtureId = randomUUID();
      const state = `oauth_finalize_${fixtureId}`;
      const consumedAt = new Date("2026-08-11T12:01:00.000Z");
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      try {
        await prisma.deviceOauthSession.create({
          data: {
            consumedAt,
            createdAt: new Date("2026-08-11T12:00:00.000Z"),
            expiresAt: new Date("2026-08-11T13:00:00.000Z"),
            provider: "oura",
            state,
          },
        });
        const store = new PrismaHostedOAuthSessionStore(prisma);
        await expect(store.resolveOAuthStateWithoutProviderAuthority({
          state,
          consumedAt: "2026-08-11T12:02:00.000Z",
        })).resolves.toBe(false);
        await expect(prisma.deviceOauthSession.count({
          where: { state },
        })).resolves.toBe(1);

        await expect(prisma.$transaction(async (tx) => {
          const txStore = new PrismaHostedOAuthSessionStore(tx as never);
          await expect(txStore.resolveOAuthStateWithoutProviderAuthority({
            state,
            consumedAt: consumedAt.toISOString(),
          })).resolves.toBe(true);
          throw new Error("force callback finalizer rollback");
        })).rejects.toThrow("force callback finalizer rollback");
        await expect(prisma.deviceOauthSession.count({
          where: { state },
        })).resolves.toBe(1);
        await expect(store.resolveOAuthStateWithoutProviderAuthority({
          state,
          consumedAt: consumedAt.toISOString(),
        })).resolves.toBe(true);
      } finally {
        await prisma.deviceOauthSession.deleteMany({ where: { state } });
        await prisma.$disconnect();
      }
    });
  },
);
