import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ComputerKernelClient } from "@/src/lib/computer-use/kernel-client";
import { ComputerUseService } from "@/src/lib/computer-use/service";
import { PrismaComputerUseStore } from "@/src/lib/computer-use/store";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";
import { MemberOwnedProviderSetupService } from "@/src/lib/device-sync/provider-setup/service";
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

class PausedRunAdmissionStore extends PrismaDeviceProviderSetupStore {
  private paused = false;

  constructor(
    prisma: PrismaClient,
    private readonly admissionReached: Deferred<void>,
    private readonly releaseAdmission: Deferred<void>,
  ) {
    super(prisma);
  }

  override async transition(
    input: Parameters<PrismaDeviceProviderSetupStore["transition"]>[0],
  ): ReturnType<PrismaDeviceProviderSetupStore["transition"]> {
    if (!this.paused && input.browserRunId && input.status === "browser_setup") {
      this.paused = true;
      this.admissionReached.resolve();
      await this.releaseAdmission.promise;
    }
    return super.transition(input);
  }
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createProviderSetupKernel(input: {
  ensureProfileReached: Deferred<void>;
  releaseEnsureProfile: Deferred<void>;
}): ComputerKernelClient & {
  createdBrowsers: number;
  navigationCalls: number;
} {
  return {
    createdBrowsers: 0,
    navigationCalls: 0,
    async createBrowser() {
      this.createdBrowsers += 1;
      return {
        liveViewUrl: "https://proxy.test-browser.onkernel.com/live/provider-setup",
        sessionId: "kernel-provider-setup",
      };
    },
    async deleteBrowserByIdOrName() {},
    async deleteManagedAuthConnection() {},
    async deleteProfile() {},
    async ensureManagedAuthConnection(managedInput) {
      return {
        browserSessionId: null,
        domain: managedInput.domain,
        flowExpiresAt: null,
        flowStatus: null,
        hostedUrl: null,
        id: "managed-auth-provider-setup",
        profileName: managedInput.profileName,
        status: "NEEDS_AUTH" as const,
      };
    },
    async ensureProfile() {
      input.ensureProfileReached.resolve();
      await input.releaseEnsureProfile.promise;
    },
    async executePlaywright() {
      this.navigationCalls += 1;
      return {
        result: {
          title: "Provider applications",
          url: "https://www.strava.com/settings/api",
          visibleText: "Provider applications",
        },
      };
    },
    async findManagedAuthConnection() {
      return null;
    },
    async listManagedAuthConnections() {
      return [];
    },
    async osControl() {},
    async startManagedAuthLogin() {
      return {
        flowExpiresAt: new Date("2026-08-13T12:30:00.000Z"),
        hostedUrl: "https://auth.onkernel.com/login/provider-setup",
      };
    },
  };
}

function createInFlightProviderSetupKernel(input: {
  browserMaterialized: Deferred<void>;
  createBrowserReached: Deferred<void>;
  materializeBrowser: Deferred<void>;
  releaseCreateBrowser: Deferred<void>;
}): ComputerKernelClient & {
  browserLive: boolean;
  deleteCalls: string[];
  navigationCalls: number;
} {
  return {
    browserLive: false,
    deleteCalls: [],
    navigationCalls: 0,
    async createBrowser() {
      input.createBrowserReached.resolve();
      await input.materializeBrowser.promise;
      this.browserLive = true;
      input.browserMaterialized.resolve();
      await input.releaseCreateBrowser.promise;
      return {
        liveViewUrl: "https://proxy.test-browser.onkernel.com/live/provider-setup-in-flight",
        sessionId: "kernel-provider-setup-in-flight",
      };
    },
    async deleteBrowserByIdOrName(idOrName) {
      this.deleteCalls.push(idOrName);
      this.browserLive = false;
    },
    async deleteManagedAuthConnection() {},
    async deleteProfile() {},
    async ensureManagedAuthConnection(managedInput) {
      return {
        browserSessionId: null,
        domain: managedInput.domain,
        flowExpiresAt: null,
        flowStatus: null,
        hostedUrl: null,
        id: "managed-auth-provider-setup",
        profileName: managedInput.profileName,
        status: "NEEDS_AUTH" as const,
      };
    },
    async ensureProfile() {},
    async executePlaywright() {
      this.navigationCalls += 1;
      return {
        result: {
          title: "Provider applications",
          url: "https://www.strava.com/settings/api",
          visibleText: "Provider applications",
        },
      };
    },
    async findManagedAuthConnection() {
      return null;
    },
    async listManagedAuthConnections() {
      return [];
    },
    async osControl() {},
    async startManagedAuthLogin() {
      return {
        flowExpiresAt: new Date("2026-08-13T12:30:00.000Z"),
        hostedUrl: "https://auth.onkernel.com/login/provider-setup",
      };
    },
  };
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
  "member-owned provider setup PostgreSQL concurrency",
  () => {
    it.each(["cancel_first", "binding_first"] as const)(
      "retires the reserved setup run when %s wins browser admission",
      async (winner) => {
        const suffix = randomUUID().replaceAll("-", "");
        const memberId = `member_provider_cancel_${suffix}`;
        const setupId = `dps_provider_cancel_${suffix}`;
        const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
        const admissionReached = createDeferred();
        const releaseAdmission = createDeferred();
        const ensureProfileReached = createDeferred();
        const releaseEnsureProfile = createDeferred();
        const setupStore = winner === "cancel_first"
          ? new PausedRunAdmissionStore(prisma, admissionReached, releaseAdmission)
          : new PrismaDeviceProviderSetupStore(prisma);
        const kernel = createProviderSetupKernel({
          ensureProfileReached,
          releaseEnsureProfile,
        });
        const computerStore = new PrismaComputerUseStore(prisma);
        const computer = new ComputerUseService({
          env: { HOSTED_COMPUTER_PROFILE_NAMESPACE: "test" },
          kernel,
          now: () => new Date("2026-08-13T12:00:00.000Z"),
          store: computerStore,
        });
        const service = new MemberOwnedProviderSetupService("strava", {
          computer,
          store: setupStore,
        });
        let begin: Promise<PromiseSettledResult<unknown>[]> | null = null;
        vi.stubEnv("HOSTED_WEB_BASE_URL", "https://web.example.test");

        try {
          await prisma.hostedMember.create({ data: { id: memberId } });
          await prisma.deviceProviderSetup.create({
            data: {
              active: true,
              connectSourceId: "strava",
              connectTarget: "strava",
              id: setupId,
              memberId,
              provider: "strava",
              status: "authorized",
              version: 1,
            },
          });

          begin = Promise.allSettled([service.beginBrowserSetup(memberId)]);
          if (winner === "cancel_first") {
            await bounded(admissionReached.promise, "reserved run admission");
          } else {
            await bounded(ensureProfileReached.promise, "bound run provisioning");
            await expect(prisma.deviceProviderSetup.findUniqueOrThrow({
              where: { id: setupId },
            })).resolves.toMatchObject({
              browserRunId: expect.any(String),
              status: "browser_setup",
            });
          }

          await expect(service.cancel(memberId, setupId)).resolves.toMatchObject({
            status: winner === "cancel_first" ? "canceled" : "canceling",
          });
          releaseAdmission.resolve();
          releaseEnsureProfile.resolve();
          const [beginResult] = await bounded(begin, "provider setup cancellation race");
          expect(beginResult.status).toBe("rejected");
          if (winner === "binding_first") {
            await expect(service.read(memberId)).resolves.toMatchObject({
              status: "canceled",
            });
          }

          const setup = await prisma.deviceProviderSetup.findUniqueOrThrow({
            where: { id: setupId },
          });
          const runs = await prisma.hostedComputerRun.findMany({
            where: { memberId },
          });
          const activeRun = await computerStore.findActiveRunForMember({
            memberId,
            now: new Date("2026-08-13T12:00:00.000Z"),
          });

          expect(setup).toMatchObject({
            browserRunId: null,
            status: "canceled",
          });
          expect(runs).toHaveLength(1);
          expect(runs[0]?.status).toBe("failed");
          expect(activeRun).toBeNull();
          expect(kernel.createdBrowsers).toBe(0);
          expect(kernel.navigationCalls).toBe(0);
        } finally {
          releaseAdmission.resolve();
          releaseEnsureProfile.resolve();
          if (begin) {
            await begin;
          }
          vi.unstubAllEnvs();
          await prisma.hostedComputerHandoff.deleteMany({ where: { memberId } });
          await prisma.deviceProviderSetup.deleteMany({ where: { memberId } });
          await prisma.hostedComputerRun.deleteMany({ where: { memberId } });
          await prisma.hostedMember.deleteMany({ where: { id: memberId } });
          await prisma.$disconnect();
        }
      },
      30_000,
    );

    it("keeps cancellation fenced until an in-flight browser create is quiescent", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `member_provider_create_cancel_${suffix}`;
      const setupId = `dps_provider_create_cancel_${suffix}`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const browserMaterialized = createDeferred();
      const createBrowserReached = createDeferred();
      const materializeBrowser = createDeferred();
      const releaseCreateBrowser = createDeferred();
      const kernel = createInFlightProviderSetupKernel({
        browserMaterialized,
        createBrowserReached,
        materializeBrowser,
        releaseCreateBrowser,
      });
      const computer = new ComputerUseService({
        env: { HOSTED_COMPUTER_PROFILE_NAMESPACE: "test" },
        kernel,
        now: () => new Date("2026-08-13T12:00:00.000Z"),
        store: new PrismaComputerUseStore(prisma),
      });
      const service = new MemberOwnedProviderSetupService("strava", {
        computer,
        store: new PrismaDeviceProviderSetupStore(prisma),
      });
      let begin: Promise<PromiseSettledResult<unknown>[]> | null = null;
      vi.stubEnv("HOSTED_WEB_BASE_URL", "https://web.example.test");

      try {
        await prisma.hostedMember.create({ data: { id: memberId } });
        await prisma.deviceProviderSetup.create({
          data: {
            active: true,
            connectSourceId: "strava",
            connectTarget: "strava",
            id: setupId,
            memberId,
            provider: "strava",
            status: "authorized",
            version: 1,
          },
        });

        begin = Promise.allSettled([service.beginBrowserSetup(memberId)]);
        await bounded(createBrowserReached.promise, "in-flight browser create");

        await expect(service.cancel(memberId, setupId)).resolves.toMatchObject({
          status: "canceling",
        });
        await expect(prisma.hostedComputerRun.findFirstOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          kernelSessionId: null,
          status: "cleanup_pending",
        });
        expect(kernel.browserLive).toBe(false);
        expect(kernel.navigationCalls).toBe(0);

        materializeBrowser.resolve();
        await bounded(browserMaterialized.promise, "late browser materialization");
        releaseCreateBrowser.resolve();
        const [beginResult] = await bounded(begin, "late browser create response");
        expect(beginResult.status).toBe("rejected");
        expect(kernel.browserLive).toBe(false);
        expect(kernel.navigationCalls).toBe(0);

        await expect(service.read(memberId)).resolves.toMatchObject({
          status: "canceled",
        });
        await expect(prisma.hostedComputerRun.findFirstOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          kernelSessionId: null,
          status: expect.stringMatching(/^(canceled|failed)$/u),
        });
      } finally {
        materializeBrowser.resolve();
        releaseCreateBrowser.resolve();
        if (begin) {
          await begin;
        }
        vi.unstubAllEnvs();
        await prisma.hostedComputerHandoff.deleteMany({ where: { memberId } });
        await prisma.deviceProviderSetup.deleteMany({ where: { memberId } });
        await prisma.hostedComputerRun.deleteMany({ where: { memberId } });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    }, 30_000);

    it("settles a canceled setup after an in-flight create response is lost", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `member_provider_create_loss_${suffix}`;
      const setupId = `dps_provider_create_loss_${suffix}`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const browserMaterialized = createDeferred();
      const createBrowserReached = createDeferred();
      const materializeBrowser = createDeferred();
      const releaseCreateBrowser = createDeferred();
      const kernel = createInFlightProviderSetupKernel({
        browserMaterialized,
        createBrowserReached,
        materializeBrowser,
        releaseCreateBrowser,
      });
      let now = new Date("2026-08-13T12:00:00.000Z");
      const computer = new ComputerUseService({
        env: { HOSTED_COMPUTER_PROFILE_NAMESPACE: "test" },
        kernel,
        now: () => now,
        store: new PrismaComputerUseStore(prisma),
      });
      const service = new MemberOwnedProviderSetupService("strava", {
        computer,
        now: () => now,
        store: new PrismaDeviceProviderSetupStore(prisma),
      });
      let begin: Promise<PromiseSettledResult<unknown>[]> | null = null;
      vi.stubEnv("HOSTED_WEB_BASE_URL", "https://web.example.test");

      try {
        await prisma.hostedMember.create({ data: { id: memberId } });
        await prisma.deviceProviderSetup.create({
          data: {
            active: true,
            connectSourceId: "strava",
            connectTarget: "strava",
            id: setupId,
            memberId,
            provider: "strava",
            status: "authorized",
            version: 1,
          },
        });

        begin = Promise.allSettled([service.beginBrowserSetup(memberId)]);
        await bounded(createBrowserReached.promise, "lost browser create response");
        await expect(service.cancel(memberId, setupId)).resolves.toMatchObject({
          status: "canceling",
        });

        materializeBrowser.resolve();
        await bounded(browserMaterialized.promise, "unobserved browser materialization");
        expect(kernel.browserLive).toBe(true);

        const cleanupClaim = await prisma.hostedComputerRun.findFirstOrThrow({
          where: { memberId },
        });
        now = new Date(cleanupClaim.updatedAt.getTime() + 120_001);
        await expect(service.read(memberId)).resolves.toMatchObject({
          status: "canceled",
        });
        expect(kernel.browserLive).toBe(false);
        expect(kernel.navigationCalls).toBe(0);
        await expect(prisma.hostedComputerRun.findFirstOrThrow({
          where: { memberId },
        })).resolves.toMatchObject({
          kernelSessionId: null,
          status: "expired",
        });

        releaseCreateBrowser.resolve();
        const [beginResult] = await bounded(begin, "released lost create response");
        expect(beginResult.status).toBe("rejected");
        expect(kernel.browserLive).toBe(false);
        expect(kernel.navigationCalls).toBe(0);
      } finally {
        materializeBrowser.resolve();
        releaseCreateBrowser.resolve();
        if (begin) {
          await begin;
        }
        vi.unstubAllEnvs();
        await prisma.hostedComputerHandoff.deleteMany({ where: { memberId } });
        await prisma.deviceProviderSetup.deleteMany({ where: { memberId } });
        await prisma.hostedComputerRun.deleteMany({ where: { memberId } });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    }, 30_000);

    it("deactivates a deleted tombstone before creating a successor setup", async () => {
      const suffix = randomUUID().replaceAll("-", "");
      const memberId = `member_provider_reconnect_${suffix}`;
      const setupId = `dps_provider_reconnect_${suffix}`;
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const store = new PrismaDeviceProviderSetupStore(prisma);
      const unreachable = async (): Promise<never> => {
        throw new Error("Unexpected provider browser call.");
      };
      const service = new MemberOwnedProviderSetupService("strava", {
        computer: {
          acquireOwnedRun: unreachable,
          actOwnedRun: unreachable,
          captureAndSealProviderCredentialsInOwnedRun: unreachable,
          finishOwnedRun: unreachable,
          hasOwnedRunHandoff: unreachable,
          issueOwnedRunHandoff: unreachable,
        },
        store,
      });

      try {
        await prisma.hostedMember.create({ data: { id: memberId } });
        await prisma.deviceProviderSetup.create({
          data: {
            active: true,
            completedAt: new Date("2026-08-13T12:00:00.000Z"),
            connectSourceId: "strava",
            connectTarget: "strava",
            id: setupId,
            memberId,
            provider: "strava",
            status: "deleted",
            version: 2,
          },
        });

        const successor = await service.ensure(memberId);
        const rows = await prisma.deviceProviderSetup.findMany({
          orderBy: { createdAt: "asc" },
          where: { memberId },
        });

        expect(successor).toMatchObject({
          active: true,
          status: "pending",
        });
        expect(successor.id).not.toBe(setupId);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
          active: false,
          browserRunId: null,
          id: setupId,
          status: "deleted",
        });
        expect(rows[1]).toMatchObject({
          active: true,
          id: successor.id,
          status: "pending",
        });
      } finally {
        await prisma.deviceProviderSetup.deleteMany({ where: { memberId } });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });

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
