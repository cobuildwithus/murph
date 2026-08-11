import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { revokeHostedConsentScope } from "@/src/lib/legal/consent";
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

type Fixture = {
  connectionId: string;
  externalAccountId: string;
  holder: PrismaClient;
  observer: PrismaClient;
  reconnect: PrismaClient;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
  withdrawal: PrismaClient;
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
  throw new Error("Expected the transaction to wait on the hosted member lock.");
}

async function createFixture(): Promise<Fixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL consent-ordering proof.");
  }

  const suffix = randomUUID().replaceAll("-", "");
  const userId = `member_reconnect_consent_${suffix}`;
  const externalAccountId = `oura_reconnect_consent_${suffix}`;
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const holder = createPrismaClient({ databaseUrl, poolMax: 1 });
  const reconnect = createPrismaClient({ databaseUrl, poolMax: 1 });
  const withdrawal = createPrismaClient({ databaseUrl, poolMax: 1 });
  const store = new PrismaDeviceSyncControlPlaneStore({
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
      source: "device-sync-consent-ordering-test",
      status: "granted",
      updatedAt: now,
    },
  });
  const connection = await store.upsertConnection(buildConnectionInput({
    connectedAt: "2026-07-16T12:00:00.000Z",
    externalAccountId,
    userId,
  }));
  await store.upsertDirtyConnection({
    connectionId: connection.id,
    dirtyAt: "2026-07-16T12:01:00.000Z",
    eventType: "daily.data.updated",
    provider: "oura",
    resourceCategory: "sleep",
    resources: [{
      count: 1,
      jobKind: "delete",
      payload: { objectId: "sleep-deleted" },
      resource: "sleep",
      resourceCategory: "sleep",
      sourceProviderSlug: "oura",
      windowEnd: null,
      windowStart: null,
    }],
    traceId: "trace_reconnect_consent",
    userId,
  });
  await observer.deviceSyncDirtyPayload.updateMany({
    data: { credentialIndependent: null },
    where: { connectionId: connection.id },
  });

  return {
    connectionId: connection.id,
    externalAccountId,
    holder,
    observer,
    reconnect,
    store,
    userId,
    withdrawal,
  };
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

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await fixture.observer.hostedMember.deleteMany({
    where: { id: fixture.userId },
  });
  await Promise.all([
    fixture.observer.$disconnect(),
    fixture.holder.$disconnect(),
    fixture.reconnect.$disconnect(),
    fixture.withdrawal.$disconnect(),
  ]);
  setHostedSecureBoxStringTestCodecForTests(null);
}

describe.skipIf(!runPostgresProof)(
  "device-sync reconnect PostgreSQL consent ordering",
  () => {
    it("rejects without decrypting when withdrawal commits before reconnect admission", async () => {
      const fixture = await createFixture();
      const withdrawalLocked = createDeferred();
      const allowWithdrawalCommit = createDeferred();
      const decrypt = vi.fn((input: { value: string }) => input.value);
      let withdrawalTransaction: Promise<void> | null = null;
      let reconnectOutcome: Promise<unknown> | null = null;

      setHostedSecureBoxStringTestCodecForTests({
        decrypt,
        encrypt: (input) => input.value,
      });
      try {
        withdrawalTransaction = fixture.withdrawal.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT 1 FROM hosted_member WHERE id = ${fixture.userId} FOR UPDATE
          `;
          await tx.hostedConsentGrant.update({
            data: {
              revokedAt: new Date("2026-07-16T12:02:00.000Z"),
              status: "revoked",
            },
            where: {
              memberId_scope: {
                memberId: fixture.userId,
                scope: "launch.health-data",
              },
            },
          });
          withdrawalLocked.resolve();
          await allowWithdrawalCommit.promise;
        }, transactionOptions);
        await withdrawalLocked.promise;

        const reconnectPid = await readBackendPid(fixture.reconnect);
        reconnectOutcome = fixture.store.upsertConnection(buildConnectionInput({
          connectedAt: "2026-07-16T12:03:00.000Z",
          externalAccountId: fixture.externalAccountId,
          userId: fixture.userId,
        }));
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: reconnectPid,
        });

        allowWithdrawalCommit.resolve();
        await expect(withdrawalTransaction).resolves.toBeUndefined();
        await expect(reconnectOutcome).rejects.toMatchObject({
          code: "HEALTH_DATA_CONSENT_REQUIRED",
        });
        expect(decrypt).not.toHaveBeenCalled();
        await expect(fixture.observer.deviceSyncDirtyPayload.findFirstOrThrow({
          select: { credentialIndependent: true },
          where: { connectionId: fixture.connectionId },
        })).resolves.toEqual({ credentialIndependent: null });
      } finally {
        allowWithdrawalCommit.resolve();
        await Promise.allSettled([
          ...(withdrawalTransaction ? [withdrawalTransaction] : []),
          ...(reconnectOutcome ? [reconnectOutcome] : []),
        ]);
        await cleanupFixture(fixture);
      }
    });

    it("finishes consent-ordered classification before a waiting withdrawal", async () => {
      const fixture = await createFixture();
      const decryptStarted = createDeferred();
      const payloadLocked = createDeferred();
      const releasePayload = createDeferred();
      const decrypt = vi.fn((input: { value: string }) => {
        decryptStarted.resolve();
        return input.value;
      });
      let holderTransaction: Promise<void> | null = null;
      let reconnectOutcome: Promise<unknown> | null = null;
      let withdrawalOutcome: Promise<unknown> | null = null;

      setHostedSecureBoxStringTestCodecForTests({
        decrypt,
        encrypt: (input) => input.value,
      });
      try {
        holderTransaction = fixture.holder.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT 1
            FROM device_sync_dirty_payload
            WHERE connection_id = ${fixture.connectionId}
            FOR UPDATE
          `;
          payloadLocked.resolve();
          await releasePayload.promise;
        }, transactionOptions);
        await payloadLocked.promise;

        reconnectOutcome = fixture.store.upsertConnection(buildConnectionInput({
          connectedAt: "2026-07-16T12:03:00.000Z",
          externalAccountId: fixture.externalAccountId,
          userId: fixture.userId,
        }));
        await decryptStarted.promise;

        const withdrawalPid = await readBackendPid(fixture.withdrawal);
        withdrawalOutcome = revokeHostedConsentScope({
          memberId: fixture.userId,
          now: new Date("2026-07-16T12:04:00.000Z"),
          prisma: fixture.withdrawal,
          scope: "launch.health-data",
          source: "device-sync-consent-ordering-test",
        });
        await waitForBlockedBackend({
          observer: fixture.observer,
          pid: withdrawalPid,
        });

        releasePayload.resolve();
        await expect(holderTransaction).resolves.toBeUndefined();
        await expect(reconnectOutcome).resolves.toMatchObject({
          id: fixture.connectionId,
        });
        await expect(withdrawalOutcome).resolves.toMatchObject({ ok: true });
        expect(decrypt).toHaveBeenCalledTimes(1);
        await expect(fixture.observer.hostedConsentGrant.findUniqueOrThrow({
          select: { status: true },
          where: {
            memberId_scope: {
              memberId: fixture.userId,
              scope: "launch.health-data",
            },
          },
        })).resolves.toEqual({ status: "revoked" });
        await expect(fixture.observer.deviceSyncDirtyPayload.findFirstOrThrow({
          select: { credentialIndependent: true },
          where: { connectionId: fixture.connectionId },
        })).resolves.toEqual({ credentialIndependent: true });
      } finally {
        releasePayload.resolve();
        await Promise.allSettled([
          ...(holderTransaction ? [holderTransaction] : []),
          ...(reconnectOutcome ? [reconnectOutcome] : []),
          ...(withdrawalOutcome ? [withdrawalOutcome] : []),
        ]);
        await cleanupFixture(fixture);
      }
    });
  },
);
