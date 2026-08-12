import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  LobPhysicalNoteRuntime,
} from "@/src/lib/physical-notes/lob-runtime";
import { createPrismaClient } from "@/src/lib/prisma";

const mocks = vi.hoisted(() => ({
  readUsageGate: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  isHostedThreadContainerNotificationDestination: () => false,
  requireHostedAssistantNotificationDestination: async () => ({
    conversationShape: "direct-member",
  }),
}));
vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readUsageGate,
}));
vi.mock("@/src/lib/hosted-execution/usage", () => ({
  recordHostedAiUsageRecords: mocks.recordUsage,
}));

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The physical-note concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "physical-note PostgreSQL concurrency",
  () => {
    let firstClient: PrismaClient | null = null;
    let secondClient: PrismaClient | null = null;
    let thirdClient: PrismaClient | null = null;
    let observerClient: PrismaClient | null = null;
    let memberId: string | null = null;

    beforeAll(async () => {
      vi.stubEnv("LOB_API_KEY", "test_physical_notes");
      vi.stubEnv("LOB_FROM_ADDRESS_ID", "adr_from_test");
      vi.stubEnv("LOB_PHYSICAL_NOTE_COST_USD_MICROS", "250000");
      vi.stubEnv("LOB_PHYSICAL_NOTE_PRICING_VERSION", "lob-test-v1");
      mocks.readUsageGate.mockResolvedValue({
        allowed: true,
        periodEnd: new Date(Date.now() + 60 * 60 * 1_000),
        periodStart: new Date(Date.now() - 60 * 60 * 1_000),
        remainingUsdMicros: 1_000_000n,
      });
      mocks.recordUsage.mockResolvedValue(undefined);

      firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      thirdClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      observerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      memberId = `member_physical_note_${randomUUID().replaceAll("-", "")}`;
      await firstClient.hostedMember.create({
        data: {
          billingStatus: "active",
          id: memberId,
        },
      });
    });

    beforeEach(async () => {
      const first = requirePrisma(firstClient);
      await first.hostedPhysicalNote.deleteMany({
        where: { memberId: requireMemberId(memberId) },
      });
      mocks.recordUsage.mockClear();
    });

    afterAll(async () => {
      if (firstClient && memberId) {
        await firstClient.hostedMember.deleteMany({
          where: { id: memberId },
        });
      }
      await firstClient?.$disconnect();
      await secondClient?.$disconnect();
      await thirdClient?.$disconnect();
      await observerClient?.$disconnect();
      vi.unstubAllEnvs();
    });

    it("admits exactly one complimentary claim across concurrent sends", async () => {
      const first = requirePrisma(firstClient);
      const second = requirePrisma(secondClient);
      const beneficiary = requireMemberId(memberId);
      const { createHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );

      const responses = await Promise.all([
        createHostedPhysicalNote({
          ...buildRequest(1, beneficiary),
          prisma: first,
          runtime: acceptedRuntime("ltr_concurrent_first"),
        }),
        createHostedPhysicalNote({
          ...buildRequest(2, beneficiary),
          prisma: second,
          runtime: acceptedRuntime("ltr_concurrent_second"),
        }),
      ]);

      expect(responses.map((response) => response.complimentary).sort())
        .toEqual([false, true]);
      expect(responses.map((response) => response.status))
        .toEqual(["accepted", "accepted"]);
      await expect(first.hostedPhysicalNote.count({
        where: {
          complimentaryOfferCode: "physical-note-v1",
          memberId: beneficiary,
        },
      })).resolves.toBe(1);
      expect(mocks.recordUsage).toHaveBeenCalledOnce();
    });

    it("preserves exactly one complimentary claim when stale release races admission", async () => {
      const lockHolder = requirePrisma(firstClient);
      const releasingClient = requirePrisma(secondClient);
      const admittingClient = requirePrisma(thirdClient);
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const staleId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const { createHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.create({
        data: {
          complimentaryOfferCode: "physical-note-v1",
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1_000),
          id: staleId,
          memberId: beneficiary,
          pricingVersion: "lob-test-v1",
          provider: "lob",
          providerCostUsdMicros: 250_000n,
          requestFingerprint: "stale-fingerprint",
          requestKey: `stale-${staleId}`,
          status: "starting",
        },
      });

      const memberLocked = createDeferred();
      const releaseMember = createDeferred();
      const holderTransaction = lockHolder.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT 1
          FROM "hosted_member"
          WHERE "id" = ${beneficiary}
          FOR UPDATE
        `;
        memberLocked.resolve();
        await releaseMember.promise;
      });

      try {
        await Promise.race([memberLocked.promise, holderTransaction]);
        const releasingPid = await readBackendPid(releasingClient);
        const releaseAndSend = createHostedPhysicalNote({
          ...buildRequest(3, beneficiary),
          prisma: releasingClient,
          runtime: {
            async create() {
              return {
                kind: "accepted",
                providerLetterId: "ltr_after_stale_release",
              };
            },
            async findLetterByNoteId() {
              return { kind: "absent" };
            },
          },
        });
        await waitForBlockedBackend({
          observer,
          pid: releasingPid,
        });

        const admittingPid = await readBackendPid(admittingClient);
        const concurrentAdmission = createHostedPhysicalNote({
          ...buildRequest(4, beneficiary),
          prisma: admittingClient,
          runtime: acceptedRuntime("ltr_concurrent_admission"),
        });
        await waitForBlockedBackend({
          observer,
          pid: admittingPid,
        });

        releaseMember.resolve();
        await holderTransaction;
        const responses = await Promise.all([
          releaseAndSend,
          concurrentAdmission,
        ]);

        expect(responses.map((response) => response.complimentary).sort())
          .toEqual([false, true]);
        await expect(observer.hostedPhysicalNote.count({
          where: {
            complimentaryOfferCode: "physical-note-v1",
            memberId: beneficiary,
          },
        })).resolves.toBe(1);
        await expect(observer.hostedPhysicalNote.findUnique({
          where: { id: staleId },
        })).resolves.toMatchObject({
          complimentaryOfferCode: null,
          status: "failed",
        });
        expect(mocks.recordUsage).toHaveBeenCalledOnce();
      } finally {
        releaseMember.resolve();
        await Promise.allSettled([holderTransaction]);
      }
    });

    it("revalidates every unresolved legacy note after waiting on the member lock", async () => {
      const lockHolder = requirePrisma(firstClient);
      const requestingClient = requirePrisma(secondClient);
      const observer = requirePrisma(observerClient);
      const beneficiary = requireMemberId(memberId);
      const firstLegacyId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const secondLegacyId = `hpn_${randomUUID().replaceAll("-", "")}`;
      const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const { createHostedPhysicalNote } = await import(
        "@/src/lib/physical-notes/service"
      );
      await observer.hostedPhysicalNote.createMany({
        data: [
          {
            complimentaryOfferCode: null,
            createdAt,
            failureReason: null,
            id: firstLegacyId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: "first-legacy-fingerprint",
            requestKey: `first-legacy-${firstLegacyId}`,
            status: "failed",
          },
          {
            complimentaryOfferCode: null,
            createdAt: new Date(createdAt.getTime() + 1),
            failureReason: null,
            id: secondLegacyId,
            memberId: beneficiary,
            pricingVersion: "lob-test-v1",
            provider: "lob",
            providerCostUsdMicros: 250_000n,
            requestFingerprint: "second-legacy-fingerprint",
            requestKey: `second-legacy-${secondLegacyId}`,
            status: "failed",
          },
        ],
      });

      const memberLocked = createDeferred();
      const resolveFirstLegacy = createDeferred();
      const holderTransaction = lockHolder.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT 1
          FROM "hosted_member"
          WHERE "id" = ${beneficiary}
          FOR UPDATE
        `;
        memberLocked.resolve();
        await resolveFirstLegacy.promise;
        await tx.hostedPhysicalNote.update({
          data: { failureReason: "unknown" },
          where: { id: firstLegacyId },
        });
      });
      const createProviderLetter = vi.fn(async () => ({
        kind: "accepted" as const,
        providerLetterId: "ltr_must_not_send",
      }));
      const findProviderLetter = vi.fn(async () => ({
        kind: "indeterminate" as const,
      }));

      try {
        await Promise.race([memberLocked.promise, holderTransaction]);
        const requestingPid = await readBackendPid(requestingClient);
        const request = createHostedPhysicalNote({
          ...buildRequest(5, beneficiary),
          prisma: requestingClient,
          runtime: {
            create: createProviderLetter,
            findLetterByNoteId: findProviderLetter,
          },
        });
        await waitForBlockedBackend({
          observer,
          pid: requestingPid,
        });

        resolveFirstLegacy.resolve();
        await holderTransaction;
        const response = await request;

        expect(response).toMatchObject({
          failureReason: "prior_note_unresolved",
          status: "failed",
        });
        expect(response.physicalNoteId).not.toBe(firstLegacyId);
        expect(response.physicalNoteId).not.toBe(secondLegacyId);
        expect(findProviderLetter).toHaveBeenCalledOnce();
        expect(findProviderLetter).toHaveBeenCalledWith({
          noteId: secondLegacyId,
          signal: undefined,
        });
        expect(createProviderLetter).not.toHaveBeenCalled();
        await expect(observer.hostedPhysicalNote.findUnique({
          where: { id: secondLegacyId },
        })).resolves.toMatchObject({
          failureReason: null,
          status: "failed",
        });
      } finally {
        resolveFirstLegacy.resolve();
        await Promise.allSettled([holderTransaction]);
      }
    });
  },
);

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) {
        throw new Error("Deferred promise is not initialized.");
      }
      resolvePromise(value);
    },
  };
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
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT cardinality(pg_blocking_pids(${input.pid})) > 0 AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the physical-note operation to wait on the member lock.");
}

function buildRequest(sequence: number, memberId: string) {
  return {
    artwork: {
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      sha256: sequence.toString(16).padStart(64, "0"),
      url: `https://assets.example.test/concurrent-note-${sequence}.png`,
    },
    memberId,
    originAssistantInputId: `ain_${sequence.toString(16).padStart(32, "0")}`,
    recipient: {
      addressLine1: "123 Main Street",
      city: "Atlanta",
      name: "Alex Example",
      postalCode: "30301",
      state: "GA",
    },
    requestKey: `physical-note-concurrent-${sequence}`,
  };
}

function acceptedRuntime(providerLetterId: string): LobPhysicalNoteRuntime {
  return {
    async create() {
      return {
        kind: "accepted",
        providerLetterId,
      };
    },
    async findLetterByNoteId() {
      return { kind: "indeterminate" };
    },
  };
}

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("Physical-note concurrency Prisma client is unavailable.");
  }
  return value;
}

function requireMemberId(value: string | null): string {
  if (!value) {
    throw new Error("Physical-note concurrency member id is unavailable.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
        url.hostname.toLowerCase(),
      );
  } catch {
    return false;
  }
}
