import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { saveDeviceProviderApplication } from "@/src/lib/device-sync/provider-applications/store";
import { PrismaHostedOAuthSessionStore } from "@/src/lib/device-sync/prisma-store/oauth-sessions";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type InteractiveTransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
  throw new Error("Expected the OAuth callback transaction to wait on a PostgreSQL lock.");
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

function pauseBeforeOAuthStateDeletion(input: {
  allowDelete: Deferred<void>;
  beforeDelete: Deferred<void>;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const deviceOauthSession = new Proxy(input.tx.deviceOauthSession, {
    get(target, property) {
      if (property === "deleteMany") {
        return async (args: Prisma.DeviceOauthSessionDeleteManyArgs) => {
          input.beforeDelete.resolve();
          await input.allowDelete.promise;
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

function captureTransactionBackend(input: {
  pid: Deferred<number>;
  prisma: PrismaClient;
}): PrismaClient {
  return new Proxy(input.prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return async <TResult>(
          callback: (tx: Prisma.TransactionClient) => Promise<TResult>,
          options?: InteractiveTransactionOptions,
        ): Promise<TResult> => target.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          const pid = rows[0]?.pid;
          if (typeof pid !== "number") {
            throw new Error("Expected a PostgreSQL backend pid.");
          }
          input.pid.resolve(pid);
          return callback(tx);
        }, options);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe.skipIf(!runPostgresProof)(
  "device OAuth and provider application PostgreSQL lock ordering",
  () => {
    it.each(["replacement_first", "callback_first"] as const)(
      "serializes credential replacement and callback consumption: %s",
      async (order) => {
      if (!databaseUrl) {
        throw new Error("DATABASE_URL is required for the PostgreSQL lock-order proof.");
      }
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `member_oauth_order_${suffix}`;
      const applicationId = `dpa_oauth_order_${suffix}`;
      const state = `oauth_order_${suffix}`;
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const replacementClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const callbackClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const replacementBeforeDelete = createDeferred();
      const allowReplacementDelete = createDeferred();
      const callbackPid = createDeferred<number>();
      let replacementOutcome: Promise<unknown> | null = null;
      let callbackOutcome: Promise<unknown> | null = null;

      setHostedSecureBoxStringTestCodecForTests({
        decrypt: (input) => input.value,
        encrypt: (input) => input.value,
      });
      try {
        await observer.hostedMember.create({ data: { id: memberId } });
        await observer.deviceProviderApplication.create({
          data: {
            configEncrypted: JSON.stringify({
              schema: "murph.device-provider-application.strava.v1",
              clientId: "initial-client",
              clientSecret: "initial-secret",
            }),
            id: applicationId,
            memberId,
            provider: "strava",
            revision: 1,
          },
        });
        await observer.deviceOauthSession.create({
          data: {
            createdAt: new Date("2026-09-04T12:00:00.000Z"),
            expiresAt: new Date("2026-09-04T13:00:00.000Z"),
            provider: "strava",
            providerApplicationId: applicationId,
            providerApplicationRevision: 1,
            state,
            userId: memberId,
          },
        });

        const callbackStore = new PrismaHostedOAuthSessionStore(
          captureTransactionBackend({ pid: callbackPid, prisma: callbackClient }),
        );
        const consume = () => callbackStore.consumeOAuthStateWithProviderApplication(
          state,
          "2026-09-04T12:01:00.000Z",
          { applicationId, provider: "strava", revision: 1 },
          "strava",
          memberId,
        );
        if (order === "callback_first") {
          callbackOutcome = consume();
          await expect(callbackOutcome).resolves.toMatchObject({ status: "consumed" });
        }

        replacementOutcome = saveDeviceProviderApplication({
          clientId: "replacement-client",
          clientSecret: "replacement-secret",
          expectedRevision: 1,
          memberId,
          prisma: wrapInteractiveTransactions({
            prisma: replacementClient,
            wrap: (tx) => pauseBeforeOAuthStateDeletion({
              allowDelete: allowReplacementDelete,
              beforeDelete: replacementBeforeDelete,
              tx,
            }),
          }),
          provider: "strava",
        });
        await replacementBeforeDelete.promise;

        if (order === "replacement_first") {
          callbackOutcome = consume();
          await waitForBlockedBackend({ observer, pid: await callbackPid.promise });
        }

        allowReplacementDelete.resolve();
        await expect(replacementOutcome).resolves.toMatchObject({ revision: 2 });
        const persisted = await observer.deviceOauthSession.findUnique({ where: { state } });
        if (order === "replacement_first") {
          await expect(callbackOutcome).resolves.toEqual({ status: "missing" });
          expect(persisted).toBeNull();
        } else {
          expect(persisted).toMatchObject({
            consumedAt: new Date("2026-09-04T12:01:00.000Z"),
            providerApplicationId: applicationId,
            providerApplicationRevision: 1,
          });
        }
      } finally {
        allowReplacementDelete.resolve();
        await Promise.allSettled([
          ...(replacementOutcome ? [replacementOutcome] : []),
          ...(callbackOutcome ? [callbackOutcome] : []),
        ]);
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
        await Promise.all([
          callbackClient.$disconnect(),
          replacementClient.$disconnect(),
          observer.$disconnect(),
        ]);
        setHostedSecureBoxStringTestCodecForTests(null);
      }
    },
    );
  },
);
