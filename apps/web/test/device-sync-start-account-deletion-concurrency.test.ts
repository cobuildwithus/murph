import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY,
  type CommitPublicDeviceSyncConnectionStartInput,
  type CommitPublicDeviceSyncSdkConnectionStartInput,
} from "@murphai/device-syncd/types";

import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const connectedAt = "2026-07-26T12:00:00.000Z";
const setupExpiresAt = "2026-07-26T12:30:00.000Z";
const suspendedAt = new Date("2026-07-26T12:01:00.000Z");

if (runPostgresConcurrencyProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error(
    "The device-sync start/account-deletion concurrency proof requires a local DATABASE_URL.",
  );
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
type Fixture = {
  deletion: PrismaClient;
  externalAccountId: string;
  memberId: string;
  observer: PrismaClient;
  starter: PrismaClient;
  state: string;
};

const testCodec = {
  keyVersion: "test:v1",
  decrypt: (value: string) => value.replace(/^encrypted:/u, ""),
  encrypt: (value: string) => `encrypted:${value}`,
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createFixture(): Promise<Fixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL concurrency proof.");
  }

  const id = randomUUID();
  const fixture = {
    deletion: createPrismaClient({ databaseUrl, poolMax: 1 }),
    externalAccountId: `junction-user-${id}`,
    memberId: `member_device_start_delete_${id}`,
    observer: createPrismaClient({ databaseUrl, poolMax: 1 }),
    starter: createPrismaClient({ databaseUrl, poolMax: 1 }),
    state: `device-start-${id}`,
  };
  await fixture.observer.hostedMember.create({ data: { id: fixture.memberId } });
  return fixture;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await fixture.observer.deviceOauthSession.deleteMany({ where: { userId: fixture.memberId } });
  await fixture.observer.deviceConnection.deleteMany({ where: { userId: fixture.memberId } });
  await fixture.observer.hostedMember.deleteMany({ where: { id: fixture.memberId } });
  await Promise.all([
    fixture.deletion.$disconnect(),
    fixture.observer.$disconnect(),
    fixture.starter.$disconnect(),
  ]);
}

function buildStartInput(
  fixture: Fixture,
  options: { seed?: boolean; stateSuffix?: string } = {},
): CommitPublicDeviceSyncConnectionStartInput {
  return {
    connectionSeed: options.seed === false
      ? null
      : {
          connectedAt,
          credential: { kind: "provider_config", providerConfigKey: "junction" },
          externalAccountId: fixture.externalAccountId,
          ownerId: fixture.memberId,
          provider: "junction",
          setupExpiresAt,
          setupPhase: "pending_link",
        },
    oauthState: {
      createdAt: connectedAt,
      expiresAt: setupExpiresAt,
      metadata: { connectTarget: "garmin" },
      ownerId: fixture.memberId,
      provider: "junction",
      returnTo: "https://murph.example/device-sync/connect/complete",
      state: `${fixture.state}${options.stateSuffix ?? ""}`,
    },
  };
}

function buildSdkStartInput(
  fixture: Fixture,
  options: { stateSuffix?: string } = {},
): CommitPublicDeviceSyncSdkConnectionStartInput {
  return {
    connectionSeed: {
      connectedAt,
      credential: { kind: "provider_config", providerConfigKey: "junction" },
      externalAccountId: fixture.externalAccountId,
      ownerId: fixture.memberId,
      provider: "junction",
      reuseEstablishedConnection: true,
      setupPhase: "source_confirmed",
    },
    state: `${fixture.state}${options.stateSuffix ?? "-sdk"}`,
  };
}

function createStore(prisma: PrismaClient): PrismaDeviceSyncControlPlaneStore {
  return new PrismaDeviceSyncControlPlaneStore({
    codec: testCodec,
    prisma,
    providerAccountBlindIndexKey: Buffer.alloc(32, 17),
  });
}

async function stageStart(
  store: PrismaDeviceSyncControlPlaneStore,
  input: CommitPublicDeviceSyncConnectionStartInput,
): Promise<void> {
  await store.stageConnectionStart({
    ...input.oauthState,
    metadata: {
      ...(input.oauthState.metadata ?? {}),
      [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
    },
  });
}

function mapTransactions(
  prisma: PrismaClient,
  map: (
    tx: Prisma.TransactionClient,
  ) => Prisma.TransactionClient | Promise<Prisma.TransactionClient>,
): PrismaClient {
  return new Proxy(prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) =>
          target.$transaction(async (tx) => callback(await map(tx)));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseOAuthStateFinalize(input: {
  allow: Deferred<void>;
  entered: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const deviceOauthSession = new Proxy(input.tx.deviceOauthSession, {
    get(target, property) {
      if (property === "updateMany") {
        return async (args: Prisma.DeviceOauthSessionUpdateManyArgs) => {
          input.entered.resolve();
          await input.allow.promise;
          return target.updateMany(args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(input.tx, {
    get(target, property) {
      if (property === "deviceOauthSession") {
        return deviceOauthSession;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseStagedStartConsume(input: {
  allow: Deferred<void>;
  entered: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const deviceOauthSession = new Proxy(input.tx.deviceOauthSession, {
    get(target, property) {
      if (property === "deleteMany") {
        return async (args: Prisma.DeviceOauthSessionDeleteManyArgs) => {
          input.entered.resolve();
          await input.allow.promise;
          return target.deleteMany(args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(input.tx, {
    get(target, property) {
      if (property === "deviceOauthSession") {
        return deviceOauthSession;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pauseMissingConnectionLookup(input: {
  allow: Deferred<void>;
  entered: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const deviceConnection = new Proxy(input.tx.deviceConnection, {
    get(target, property) {
      if (property === "findUnique") {
        return async (args: Prisma.DeviceConnectionFindUniqueArgs) => {
          const result = await target.findUnique(args);
          if (!result) {
            input.entered.resolve();
            await input.allow.promise;
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(input.tx, {
    get(target, property) {
      if (property === "deviceConnection") {
        return deviceConnection;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  if (typeof rows[0]?.pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return rows[0].pid;
}

async function waitForBlockedBackend(observer: PrismaClient, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the transaction to wait on a PostgreSQL lock.");
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "device-sync connection-start/account-deletion PostgreSQL ordering",
  () => {
    it("commits seed and state before a waiting deletion observes and removes both", async () => {
      const fixture = await createFixture();
      const enteredStateCreate = deferred();
      const allowStateCreate = deferred();
      const deletionPid = deferred<number>();
      const stageStore = createStore(fixture.starter);
      const commitStore = createStore(mapTransactions(fixture.starter, (tx) =>
        pauseOAuthStateFinalize({ allow: allowStateCreate, entered: enteredStateCreate, tx })
      ));
      const startInput = buildStartInput(fixture);
      await stageStart(stageStore, startInput);
      const start = commitStore.commitConnectionStart(startInput);
      let deletion: Promise<{
        connections: Array<{ connectedAt: Date; id: string; userId: string }>;
        states: Array<{
          createdAt: Date;
          metadataJson: Prisma.JsonValue;
          state: string;
          userId: string | null;
        }>;
      }> | null = null;

      try {
        await enteredStateCreate.promise;
        deletion = fixture.deletion.$transaction(async (tx) => {
          deletionPid.resolve(await readBackendPid(tx));
          await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${fixture.memberId} FOR UPDATE`;
          await tx.hostedMember.update({ data: { suspendedAt }, where: { id: fixture.memberId } });
          const connections = await tx.deviceConnection.findMany({
            select: { connectedAt: true, id: true, userId: true },
            where: { userId: fixture.memberId },
          });
          const states = await tx.deviceOauthSession.findMany({
            select: { createdAt: true, metadataJson: true, state: true, userId: true },
            where: { userId: fixture.memberId },
          });
          await tx.deviceOauthSession.deleteMany({ where: { userId: fixture.memberId } });
          await tx.deviceConnection.deleteMany({ where: { userId: fixture.memberId } });
          return { connections, states };
        }, { timeout: 15_000 });

        await waitForBlockedBackend(fixture.observer, await deletionPid.promise);
        allowStateCreate.resolve();
        const [, observed] = await Promise.all([start, deletion]);

        expect(observed.connections).toEqual([
          expect.objectContaining({ userId: fixture.memberId }),
        ]);
        expect(observed.states).toEqual([
          expect.objectContaining({ state: fixture.state, userId: fixture.memberId }),
        ]);
        expect(observed.connections[0]?.connectedAt.toISOString()).toBe(connectedAt);
        expect(observed.states[0]?.createdAt.toISOString()).toBe(connectedAt);
        expect(observed.states[0]?.metadataJson).toMatchObject({
          __murphSeededConnectionAccountId: observed.connections[0]?.id,
          __murphSeededConnectionSetupExpiresAt: setupExpiresAt,
          connectTarget: "garmin",
        });
        await expect(fixture.observer.deviceConnection.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(0);
        await expect(fixture.observer.deviceOauthSession.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(0);
      } finally {
        allowStateCreate.resolve();
        await Promise.allSettled([start, ...(deletion ? [deletion] : [])]);
        await cleanupFixture(fixture);
      }
    });

    it("a successful start consumes only its own marker while a sibling provider request remains live", async () => {
      const fixture = await createFixture();
      const store = createStore(fixture.starter);
      const firstInput = buildStartInput(fixture, { stateSuffix: "-first" });
      const secondInput = buildStartInput(fixture, { stateSuffix: "-second" });

      try {
        await stageStart(store, firstInput);
        await stageStart(store, secondInput);
        await store.commitConnectionStart(secondInput);

        const states = await fixture.observer.deviceOauthSession.findMany({
          orderBy: { state: "asc" },
          select: { metadataJson: true, state: true },
          where: { userId: fixture.memberId },
        });
        expect(states).toEqual([
          {
            metadataJson: expect.objectContaining({
              [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
            }),
            state: firstInput.oauthState.state,
          },
          {
            metadataJson: expect.not.objectContaining({
              [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
            }),
            state: secondInput.oauthState.state,
          },
        ]);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it("keeps staged seeded and seedless starts visible when suspension wins before finalization", async () => {
      const fixture = await createFixture();
      const store = createStore(fixture.starter);
      const seededInput = buildStartInput(fixture);
      const seedlessInput = buildStartInput(fixture, {
        seed: false,
        stateSuffix: "-seedless",
      });

      try {
        await stageStart(store, seededInput);
        await stageStart(store, seedlessInput);
        await fixture.deletion.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${fixture.memberId} FOR UPDATE`;
          await tx.hostedMember.update({ data: { suspendedAt }, where: { id: fixture.memberId } });
        });

        await expect(store.commitConnectionStart(seededInput)).rejects.toMatchObject({
          code: "CONNECTION_OWNER_UNAVAILABLE",
          httpStatus: 403,
        });
        await expect(store.commitConnectionStart(seedlessInput)).rejects.toMatchObject({
          code: "CONNECTION_OWNER_UNAVAILABLE",
          httpStatus: 403,
        });
        const pendingStates = await fixture.observer.deviceOauthSession.findMany({
          orderBy: { state: "asc" },
          where: { userId: fixture.memberId },
        });
        expect(pendingStates).toHaveLength(2);
        for (const pendingState of pendingStates) {
          expect(pendingState.metadataJson).toMatchObject({
            [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
          });
        }

        await expect(fixture.observer.deviceConnection.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(0);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it("rejects seeded and seedless staging when deletion suspends the member first", async () => {
      const fixture = await createFixture();
      const memberSuspended = deferred();
      const releaseDeletion = deferred();
      const startPid = deferred<number>();
      let stage: Promise<void> | null = null;
      const deletion = fixture.deletion.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${fixture.memberId} FOR UPDATE`;
        await tx.hostedMember.update({ data: { suspendedAt }, where: { id: fixture.memberId } });
        memberSuspended.resolve();
        await releaseDeletion.promise;
      }, { timeout: 15_000 });

      try {
        await memberSuspended.promise;
        const store = createStore(mapTransactions(fixture.starter, async (tx) => {
          startPid.resolve(await readBackendPid(tx));
          return tx;
        }));
        const seededInput = buildStartInput(fixture);
        stage = stageStart(store, seededInput);
        const seededStartRejection = expect(stage).rejects.toMatchObject({
          code: "CONNECTION_OWNER_UNAVAILABLE",
          httpStatus: 403,
        });
        await waitForBlockedBackend(fixture.observer, await startPid.promise);
        releaseDeletion.resolve();
        await deletion;
        await seededStartRejection;

        const seedlessInput = buildStartInput(fixture, {
          seed: false,
          stateSuffix: "-seedless",
        });
        await expect(stageStart(store, seedlessInput)).rejects.toMatchObject({
          code: "CONNECTION_OWNER_UNAVAILABLE",
          httpStatus: 403,
        });
        await expect(fixture.observer.deviceConnection.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(0);
        await expect(fixture.observer.deviceOauthSession.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(0);
      } finally {
        releaseDeletion.resolve();
        await Promise.allSettled([deletion, ...(stage ? [stage] : [])]);
        await cleanupFixture(fixture);
      }
    });

    it("retains an SDK marker and creates no local connection when suspension wins after staging", async () => {
      const fixture = await createFixture();
      const store = createStore(fixture.starter);
      const sdkInput = buildSdkStartInput(fixture);

      try {
        await store.stageConnectionStart({
          createdAt: connectedAt,
          expiresAt: setupExpiresAt,
          metadata: {
            [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
          },
          ownerId: fixture.memberId,
          provider: "junction",
          returnTo: null,
          state: sdkInput.state,
        });
        await fixture.deletion.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${fixture.memberId} FOR UPDATE`;
          await tx.hostedMember.update({ data: { suspendedAt }, where: { id: fixture.memberId } });
        });

        await expect(store.commitSdkConnectionStart(sdkInput)).rejects.toMatchObject({
          code: "CONNECTION_OWNER_UNAVAILABLE",
          httpStatus: 403,
        });
        await expect(fixture.observer.deviceConnection.count({
          where: { userId: fixture.memberId },
        })).resolves.toBe(0);
        await expect(fixture.observer.deviceOauthSession.findUnique({
          where: { state: sdkInput.state },
        })).resolves.toMatchObject({
          metadataJson: expect.objectContaining({
            [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
          }),
        });
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it("resolves a cross-owner SDK insert race as an ownership conflict and retains the losing marker", async () => {
      const fixture = await createFixture();
      const challenger = createPrismaClient({ databaseUrl, poolMax: 1 });
      const challengerMemberId = `member_device_start_challenger_${randomUUID()}`;
      const firstLookupEntered = deferred();
      const secondLookupEntered = deferred();
      const allowConnectionInsert = deferred();
      const firstStore = createStore(mapTransactions(fixture.starter, (tx) =>
        pauseMissingConnectionLookup({
          allow: allowConnectionInsert,
          entered: firstLookupEntered,
          tx,
        })
      ));
      const secondStore = createStore(mapTransactions(challenger, (tx) =>
        pauseMissingConnectionLookup({
          allow: allowConnectionInsert,
          entered: secondLookupEntered,
          tx,
        })
      ));
      const firstInput = buildSdkStartInput(fixture, { stateSuffix: "-sdk-first" });
      const secondInput: CommitPublicDeviceSyncSdkConnectionStartInput = {
        connectionSeed: {
          ...firstInput.connectionSeed,
          ownerId: challengerMemberId,
        },
        state: `${fixture.state}-sdk-second`,
      };
      let starts: Array<Promise<unknown>> = [];

      try {
        await fixture.observer.hostedMember.create({ data: { id: challengerMemberId } });
        await firstStore.stageConnectionStart({
          createdAt: connectedAt,
          expiresAt: setupExpiresAt,
          metadata: {
            [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
          },
          ownerId: fixture.memberId,
          provider: "junction",
          returnTo: null,
          state: firstInput.state,
        });
        await secondStore.stageConnectionStart({
          createdAt: connectedAt,
          expiresAt: setupExpiresAt,
          metadata: {
            [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
          },
          ownerId: challengerMemberId,
          provider: "junction",
          returnTo: null,
          state: secondInput.state,
        });

        starts = [
          firstStore.commitSdkConnectionStart(firstInput),
          secondStore.commitSdkConnectionStart(secondInput),
        ];
        await Promise.all([firstLookupEntered.promise, secondLookupEntered.promise]);
        allowConnectionInsert.resolve();
        const results = await Promise.allSettled(starts);
        const fulfilled = results.filter((result) => result.status === "fulfilled");
        const rejected = results.filter((result) => result.status === "rejected");

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.reason).toMatchObject({
          code: "CONNECTION_OWNERSHIP_CONFLICT",
          httpStatus: 409,
        });
        await expect(fixture.observer.deviceConnection.count({
          where: {
            userId: { in: [fixture.memberId, challengerMemberId] },
          },
        })).resolves.toBe(1);
        const pendingMarkers = await fixture.observer.deviceOauthSession.findMany({
          select: { state: true, userId: true },
          where: {
            metadataJson: {
              path: [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY],
              equals: true,
            },
            userId: { in: [fixture.memberId, challengerMemberId] },
          },
        });
        expect(pendingMarkers).toHaveLength(1);
        const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
        expect(pendingMarkers[0]).toEqual({
          state: winnerIndex === 0 ? secondInput.state : firstInput.state,
          userId: winnerIndex === 0 ? challengerMemberId : fixture.memberId,
        });
      } finally {
        allowConnectionInsert.resolve();
        await Promise.allSettled(starts);
        await fixture.observer.deviceOauthSession.deleteMany({
          where: { userId: challengerMemberId },
        });
        await fixture.observer.deviceConnection.deleteMany({
          where: { userId: challengerMemberId },
        });
        await fixture.observer.hostedMember.deleteMany({
          where: { id: challengerMemberId },
        });
        await challenger.$disconnect();
        await cleanupFixture(fixture);
      }
    });

    it("atomically commits an SDK connection before a waiting deletion can observe it", async () => {
      const fixture = await createFixture();
      const enteredMarkerConsume = deferred();
      const allowMarkerConsume = deferred();
      const deletionPid = deferred<number>();
      const stageStore = createStore(fixture.starter);
      const commitStore = createStore(mapTransactions(fixture.starter, (tx) =>
        pauseStagedStartConsume({
          allow: allowMarkerConsume,
          entered: enteredMarkerConsume,
          tx,
        })
      ));
      const sdkInput = buildSdkStartInput(fixture);
      await stageStore.stageConnectionStart({
        createdAt: connectedAt,
        expiresAt: setupExpiresAt,
        metadata: {
          [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY]: true,
        },
        ownerId: fixture.memberId,
        provider: "junction",
        returnTo: null,
        state: sdkInput.state,
      });
      const start = commitStore.commitSdkConnectionStart(sdkInput);
      let deletion: Promise<{
        connections: number;
        pendingStarts: number;
      }> | null = null;

      try {
        await enteredMarkerConsume.promise;
        deletion = fixture.deletion.$transaction(async (tx) => {
          deletionPid.resolve(await readBackendPid(tx));
          await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${fixture.memberId} FOR UPDATE`;
          await tx.hostedMember.update({ data: { suspendedAt }, where: { id: fixture.memberId } });
          return {
            connections: await tx.deviceConnection.count({
              where: { userId: fixture.memberId },
            }),
            pendingStarts: await tx.deviceOauthSession.count({
              where: {
                metadataJson: {
                  path: [DEVICE_SYNC_CONNECTION_START_PENDING_STATE_METADATA_KEY],
                  equals: true,
                },
                userId: fixture.memberId,
              },
            }),
          };
        }, { timeout: 15_000 });

        await waitForBlockedBackend(fixture.observer, await deletionPid.promise);
        allowMarkerConsume.resolve();
        const [, observed] = await Promise.all([start, deletion]);
        expect(observed).toEqual({
          connections: 1,
          pendingStarts: 0,
        });
      } finally {
        allowMarkerConsume.resolve();
        await Promise.allSettled([start, ...(deletion ? [deletion] : [])]);
        await cleanupFixture(fixture);
      }
    });
  },
);

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
