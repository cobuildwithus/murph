import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { PrismaDeviceProviderSetupStore } from "@/src/lib/device-sync/provider-setup/store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const testCodec = {
  decrypt: (value: string) => value.replace(/^enc:/u, ""),
  encrypt: (value: string) => `enc:${value}`,
  keyVersion: "v1",
};

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The provider setup OAuth/deletion concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type TransactionProbe = {
  backendPid: Deferred<number>;
  pauseAfterMemberLock?: {
    acquired: Deferred<void>;
    release: Deferred<void>;
  };
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function bounded<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the OAuth/deletion contender to wait on the member row.");
}

function wrapTransactionClient(
  client: PrismaClient,
  probe: TransactionProbe,
): PrismaClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return (operation: unknown, options?: unknown) => {
          if (typeof operation !== "function") {
            return Reflect.apply(target.$transaction, target, [operation, options]);
          }
          const callback = operation as (
            tx: Prisma.TransactionClient,
          ) => Promise<unknown>;
          return Reflect.apply(target.$transaction, target, [
            async (tx: Prisma.TransactionClient) => {
              probe.backendPid.resolve(await readBackendPid(tx));
              return callback(wrapMemberLockTransaction(tx, probe));
            },
            options,
          ]);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapMemberLockTransaction(
  tx: Prisma.TransactionClient,
  probe: TransactionProbe,
): Prisma.TransactionClient {
  let queryRawCalls = 0;
  return new Proxy(tx, {
    get(target, property) {
      if (property === "$queryRaw") {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(target.$queryRaw, target, args);
          queryRawCalls += 1;
          if (queryRawCalls === 1 && probe.pauseAfterMemberLock) {
            probe.pauseAfterMemberLock.acquired.resolve();
            await probe.pauseAfterMemberLock.release.promise;
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "member-owned provider OAuth/deletion PostgreSQL concurrency",
  () => {
    it.each(["callback", "deletion"] as const)(
      "serializes the setup and connection when %s wins the member row",
      async (winner) => {
        const suffix = randomUUID().replaceAll("-", "");
        const memberId = `member_provider_delete_${suffix}`;
        const applicationId = `dpa_provider_delete_${suffix}`;
        const setupId = `dps_provider_delete_${suffix}`;
        const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
        const callbackBaseClient = createPrismaClient({ databaseUrl, poolMax: 1 });
        const deletionBaseClient = createPrismaClient({ databaseUrl, poolMax: 1 });
        const winnerAcquired = createDeferred();
        const releaseWinner = createDeferred();
        const callbackProbe: TransactionProbe = {
          backendPid: createDeferred<number>(),
          ...(winner === "callback"
            ? { pauseAfterMemberLock: { acquired: winnerAcquired, release: releaseWinner } }
            : {}),
        };
        const deletionProbe: TransactionProbe = {
          backendPid: createDeferred<number>(),
          ...(winner === "deletion"
            ? { pauseAfterMemberLock: { acquired: winnerAcquired, release: releaseWinner } }
            : {}),
        };
        const callbackStore = new PrismaDeviceSyncControlPlaneStore({
          codec: testCodec,
          prisma: wrapTransactionClient(callbackBaseClient, callbackProbe),
          providerAccountBlindIndexKey: Buffer.alloc(32, 7),
        });
        const deletionStore = new PrismaDeviceProviderSetupStore(
          wrapTransactionClient(deletionBaseClient, deletionProbe),
        );
        const callbackProjectionStore = new PrismaDeviceProviderSetupStore(
          callbackBaseClient,
        );
        let callback: Promise<unknown> | null = null;
        let deletion: Promise<unknown> | null = null;

        try {
          await observer.hostedMember.create({ data: { id: memberId } });
          await observer.deviceProviderApplication.create({
            data: {
              configEncrypted: "sealed-test-application",
              id: applicationId,
              memberId,
              provider: "strava",
              revision: 1,
            },
          });
          await observer.deviceProviderSetup.create({
            data: {
              active: true,
              connectSourceId: "strava",
              connectTarget: "strava",
              id: setupId,
              memberId,
              provider: "strava",
              providerApplicationId: applicationId,
              providerApplicationRevision: 1,
              status: "oauth_in_progress",
              version: 1,
            },
          });
          const setup = await deletionStore.readOwned({
            memberId,
            provider: "strava",
            setupId,
          });
          const startCallback = () => callbackStore.upsertConnectionWithProviderApplication({
              connectedAt: "2026-08-13T12:00:00.000Z",
              displayName: "Strava",
              existingAccountPolicy: "replace",
              externalAccountId: `athlete_${suffix}`,
              metadata: {},
              nextReconcileAt: null,
              ownerId: memberId,
              provider: "strava",
              scopes: ["activity:read_all"],
              tokens: {
                accessToken: "access-token",
                accessTokenExpiresAt: null,
                refreshToken: "refresh-token",
              },
          }, {
            applicationId,
            provider: "strava",
            revision: 1,
          });
          const startDeletion = () => deletionStore.beginDeletion(setup);

          if (winner === "callback") {
            callback = startCallback();
            await bounded(winnerAcquired.promise, "the callback member-row lock");
            deletion = startDeletion();
            const contenderPid = await bounded(
              deletionProbe.backendPid.promise,
              "the deletion backend pid",
            );
            await waitForBlockedBackend({ observer, pid: contenderPid });
          } else {
            deletion = startDeletion();
            await bounded(winnerAcquired.promise, "the deletion member-row lock");
            callback = startCallback();
            const contenderPid = await bounded(
              callbackProbe.backendPid.promise,
              "the callback backend pid",
            );
            await waitForBlockedBackend({ observer, pid: contenderPid });
          }

          releaseWinner.resolve();
          const [callbackResult, deletionResult] = await bounded(
            Promise.allSettled([callback, deletion]),
            "the OAuth/deletion race",
          );
          if (winner === "callback") {
            await callbackProjectionStore.markConnectedForExactApplication({
              applicationId,
              memberId,
              provider: "strava",
              revision: 1,
            });
          }
          const finalSetup = await observer.deviceProviderSetup.findUniqueOrThrow({
            where: { id: setupId },
          });
          const connections = await observer.deviceConnection.findMany({
            where: { userId: memberId },
          });

          if (winner === "callback") {
            expect(callbackResult.status).toBe("fulfilled");
            expect(deletionResult).toMatchObject({
              status: "fulfilled",
              value: { kind: "connection_conflict" },
            });
            expect(finalSetup.status).toBe("disconnect_first");
            expect(connections).toHaveLength(1);
          } else {
            expect(deletionResult).toMatchObject({
              status: "fulfilled",
              value: { kind: "ready" },
            });
            expect(callbackResult).toMatchObject({
              reason: { code: "PROVIDER_APPLICATION_STALE" },
              status: "rejected",
            });
            expect(finalSetup.status).toBe("deletion_pending");
            expect(connections).toHaveLength(0);
          }
        } finally {
          releaseWinner.resolve();
          await Promise.allSettled([
            ...(callback ? [callback] : []),
            ...(deletion ? [deletion] : []),
          ]);
          await observer.deviceConnection.deleteMany({ where: { userId: memberId } });
          await observer.deviceProviderSetup.deleteMany({ where: { memberId } });
          await observer.deviceProviderApplication.deleteMany({ where: { memberId } });
          await observer.hostedMember.deleteMany({ where: { id: memberId } });
          await Promise.all([
            callbackBaseClient.$disconnect(),
            deletionBaseClient.$disconnect(),
            observer.$disconnect(),
          ]);
        }
      },
      30_000,
    );
  },
);
