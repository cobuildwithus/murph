import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  COMPANION_HRV_RMSSD_METHOD_VERSION,
  COMPANION_HRV_RMSSD_RESOURCE,
  COMPANION_HRV_RMSSD_SCHEMA,
  serializeCompanionHrvRmssdObservation,
} from "@murphai/contracts";
import { describe, expect, it, vi } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import type {
  HostedDeviceSyncDirtyResource,
  HostedPrismaTransactionClient,
} from "@/src/lib/device-sync/prisma-store/types";
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

type AdmissionLane = "companion" | "webhook";

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type Fixture = {
  admission: PrismaClient;
  connectionId: string;
  observer: PrismaClient;
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

async function createFixture(lane: AdmissionLane): Promise<Fixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL admission consent proof.");
  }

  const suffix = randomUUID().replaceAll("-", "");
  const userId = `member_dirty_admission_${lane}_${suffix}`;
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const admission = createPrismaClient({ databaseUrl, poolMax: 1 });
  const withdrawal = createPrismaClient({ databaseUrl, poolMax: 1 });
  const store = new PrismaDeviceSyncControlPlaneStore({
    codec: connectionCodec,
    prisma: admission,
    providerAccountBlindIndexKey: Buffer.alloc(32, 9),
  });
  const now = new Date("2026-07-16T12:00:00.000Z");
  const provider = lane === "companion" ? "junction" : "oura";

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
      source: "device-sync-admission-consent-test",
      status: "granted",
      updatedAt: now,
    },
  });
  const connection = await store.upsertConnection({
    connectedAt: "2026-07-16T12:00:00.000Z",
    ...(provider === "junction"
      ? {
          credential: {
            kind: "provider_config" as const,
            providerConfigKey: "junction",
          },
        }
      : {
          tokens: {
            accessToken: `access-${suffix}`,
            refreshToken: `refresh-${suffix}`,
          },
        }),
    displayName: provider === "junction" ? "Junction" : "Oura",
    existingAccountPolicy: "replace",
    externalAccountId: `${provider}_dirty_admission_${suffix}`,
    metadata: {},
    nextReconcileAt: null,
    ownerId: userId,
    provider,
    scopes: ["daily"],
  });

  return {
    admission,
    connectionId: connection.id,
    observer,
    store,
    userId,
    withdrawal,
  };
}

function buildResource(lane: AdmissionLane): HostedDeviceSyncDirtyResource {
  if (lane === "webhook") {
    return {
      count: 1,
      jobKind: "delete",
      payload: { objectId: "sleep-withdrawal-ordering" },
      resource: "sleep",
      resourceCategory: "sleep",
      sourceProviderSlug: "oura",
      windowEnd: null,
      windowStart: null,
    };
  }

  const companionObservationJson = serializeCompanionHrvRmssdObservation({
    acceptedWindowCount: 72,
    completedWindowCount: 96,
    methodVersion: COMPANION_HRV_RMSSD_METHOD_VERSION,
    nightDate: "2026-07-15",
    rmssdMs: 51.25,
    schema: COMPANION_HRV_RMSSD_SCHEMA,
  });
  return {
    count: 1,
    jobKind: "resource",
    payload: {
      companionAdmissionId: createHash("sha256")
        .update(companionObservationJson)
        .digest("hex"),
      companionObservationJson,
      resource: COMPANION_HRV_RMSSD_RESOURCE,
    },
    resource: COMPANION_HRV_RMSSD_RESOURCE,
    resourceCategory: "derived",
    sourceProviderSlug: "whoop",
    windowEnd: null,
    windowStart: null,
  };
}

function admitDirtyPayload(input: {
  fixture: Fixture;
  lane: AdmissionLane;
  onEntered?: () => Promise<void> | void;
}): Promise<unknown> {
  const callback = async (tx: HostedPrismaTransactionClient) => {
    await input.onEntered?.();
    return input.fixture.store.upsertDirtyConnection({
      connectionId: input.fixture.connectionId,
      dirtyAt: "2026-07-16T12:01:00.000Z",
      eventType: input.lane === "companion"
        ? "companion.hrv-rmssd.created"
        : "daily.data.deleted",
      provider: input.lane === "companion" ? "junction" : "oura",
      resourceCategory: input.lane === "companion" ? "derived" : "sleep",
      resources: [buildResource(input.lane)],
      traceId: `trace_dirty_admission_${input.lane}`,
      tx,
      userId: input.fixture.userId,
    });
  };

  return input.lane === "webhook"
    ? input.fixture.store.withHealthDataAdmissionLock(
        input.fixture.userId,
        input.fixture.connectionId,
        callback,
        { memberRowLockTimeoutMs: 5_000 },
      )
    : input.fixture.store.withHealthDataAdmissionLock(
        input.fixture.userId,
        input.fixture.connectionId,
        callback,
      );
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await fixture.observer.hostedMember.deleteMany({
    where: { id: fixture.userId },
  });
  await Promise.all([
    fixture.admission.$disconnect(),
    fixture.observer.$disconnect(),
    fixture.withdrawal.$disconnect(),
  ]);
  setHostedSecureBoxStringTestCodecForTests(null);
}

describe.skipIf(!runPostgresProof)(
  "device-sync dirty admission PostgreSQL consent ordering",
  () => {
    it.each<AdmissionLane>(["webhook", "companion"])(
      "does not prepare %s payloads after withdrawal commits first",
      async (lane) => {
        const fixture = await createFixture(lane);
        const withdrawalLocked = createDeferred();
        const allowWithdrawalCommit = createDeferred();
        const admissionCallback = vi.fn();
        const encrypt = vi.fn((input: { value: string }) => input.value);
        let withdrawalTransaction: Promise<void> | null = null;
        let admissionOutcome: Promise<unknown> | null = null;

        setHostedSecureBoxStringTestCodecForTests({
          decrypt: (input) => input.value,
          encrypt,
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

          const admissionPid = await readBackendPid(fixture.admission);
          admissionOutcome = admitDirtyPayload({
            fixture,
            lane,
            onEntered: admissionCallback,
          });
          await waitForBlockedBackend({
            observer: fixture.observer,
            pid: admissionPid,
          });

          allowWithdrawalCommit.resolve();
          await expect(withdrawalTransaction).resolves.toBeUndefined();
          await expect(admissionOutcome).rejects.toMatchObject({
            code: "HEALTH_DATA_CONSENT_REQUIRED",
          });
          expect(admissionCallback).not.toHaveBeenCalled();
          expect(encrypt).not.toHaveBeenCalled();
          await expect(fixture.observer.deviceSyncDirtyConnection.count({
            where: { connectionId: fixture.connectionId },
          })).resolves.toBe(0);
          await expect(fixture.observer.deviceSyncDirtyPayload.count({
            where: { connectionId: fixture.connectionId },
          })).resolves.toBe(0);
          await expect(fixture.observer.deviceSyncCompanionCaptureReceipt.count({
            where: { connectionId: fixture.connectionId },
          })).resolves.toBe(0);
        } finally {
          allowWithdrawalCommit.resolve();
          await Promise.allSettled([
            ...(withdrawalTransaction ? [withdrawalTransaction] : []),
            ...(admissionOutcome ? [admissionOutcome] : []),
          ]);
          await cleanupFixture(fixture);
        }
      },
    );

    it.each<AdmissionLane>(["webhook", "companion"])(
      "finishes consent-ordered %s preparation before a waiting withdrawal",
      async (lane) => {
        const fixture = await createFixture(lane);
        const admissionLocked = createDeferred();
        const allowPreparation = createDeferred();
        const encrypt = vi.fn((input: { value: string }) => input.value);
        let admissionOutcome: Promise<unknown> | null = null;
        let withdrawalOutcome: Promise<unknown> | null = null;

        setHostedSecureBoxStringTestCodecForTests({
          decrypt: (input) => input.value,
          encrypt,
        });
        try {
          admissionOutcome = admitDirtyPayload({
            fixture,
            lane,
            onEntered: async () => {
              admissionLocked.resolve();
              await allowPreparation.promise;
            },
          });
          await admissionLocked.promise;

          const withdrawalPid = await readBackendPid(fixture.withdrawal);
          withdrawalOutcome = revokeHostedConsentScope({
            memberId: fixture.userId,
            now: new Date("2026-07-16T12:02:00.000Z"),
            prisma: fixture.withdrawal,
            scope: "launch.health-data",
            source: "device-sync-admission-consent-test",
          });
          await waitForBlockedBackend({
            observer: fixture.observer,
            pid: withdrawalPid,
          });

          allowPreparation.resolve();
          await expect(admissionOutcome).resolves.toMatchObject({
            dirty: expect.objectContaining({ connectionId: fixture.connectionId }),
          });
          await expect(withdrawalOutcome).resolves.toMatchObject({ ok: true });
          expect(encrypt).toHaveBeenCalledTimes(1);
          await expect(fixture.observer.deviceSyncDirtyPayload.findFirstOrThrow({
            select: { credentialIndependent: true },
            where: { connectionId: fixture.connectionId },
          })).resolves.toEqual({ credentialIndependent: true });
          await expect(fixture.observer.hostedConsentGrant.findUniqueOrThrow({
            select: { status: true },
            where: {
              memberId_scope: {
                memberId: fixture.userId,
                scope: "launch.health-data",
              },
            },
          })).resolves.toEqual({ status: "revoked" });
          await expect(fixture.observer.deviceSyncCompanionCaptureReceipt.count({
            where: { connectionId: fixture.connectionId },
          })).resolves.toBe(lane === "companion" ? 1 : 0);
        } finally {
          allowPreparation.resolve();
          await Promise.allSettled([
            ...(admissionOutcome ? [admissionOutcome] : []),
            ...(withdrawalOutcome ? [withdrawalOutcome] : []),
          ]);
          await cleanupFixture(fixture);
        }
      },
    );
  },
);
