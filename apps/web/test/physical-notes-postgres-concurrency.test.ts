import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
      memberId = `member_physical_note_${randomUUID().replaceAll("-", "")}`;
      await firstClient.hostedMember.create({
        data: {
          billingStatus: "active",
          id: memberId,
        },
      });
    });

    afterAll(async () => {
      if (firstClient && memberId) {
        await firstClient.hostedMember.deleteMany({
          where: { id: memberId },
        });
      }
      await firstClient?.$disconnect();
      await secondClient?.$disconnect();
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
  },
);

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
