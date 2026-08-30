import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { captureHostedGrowthDailySnapshot } from "@/src/lib/hosted-ops/growth-metrics";
import { createPrismaClient } from "@/src/lib/prisma";

vi.mock("server-only", () => ({}));

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Growth production-canary attribution proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "Growth production-canary attribution PostgreSQL proof",
  () => {
    it("omits two serialized canary runs while retaining ordinary traffic on the same Murph line", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const fixture = buildFixture();
      const originalCanaryPhoneNumber =
        process.env.HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER;

      try {
        process.env.HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER =
          fixture.canaryPhoneNumber;
        await prisma.hostedLinqLine.create({
          data: {
            phoneNumberHint: "•••• 0001",
            phoneNumberLookupKey: fixture.murphLineLookupKey,
            source: "test",
          },
        });

        await seedCanaryRun({
          attemptedAt: fixture.firstRunAttemptedAt,
          memberId: fixture.firstMemberId,
          pending: true,
          prisma,
          runLabel: "first",
          ...fixture,
        });
        await prisma.hostedMember.delete({
          where: { id: fixture.firstMemberId },
        });
        await seedCanaryRun({
          attemptedAt: fixture.secondRunAttemptedAt,
          memberId: fixture.secondMemberId,
          pending: false,
          prisma,
          runLabel: "second",
          ...fixture,
        });
        await prisma.hostedLinqDelivery.create({
          data: {
            attemptedAt: fixture.ordinaryAttemptedAt,
            id: fixture.ordinaryDeliveryId,
            linqChatLookupKey: fixture.ordinaryChatLookupKey,
            phoneNumberLookupKey: fixture.murphLineLookupKey,
            source: "hosted_runtime_linq_delivery",
            status: "accepted",
          },
        });

        const capture = await captureHostedGrowthDailySnapshot(
          fixture.captureAt,
          prisma,
        );

        expect(fixture.canaryPhoneLookupKey)
          .not.toBe(fixture.murphLineLookupKey);
        await expect(prisma.hostedLinqDelivery.count({
          where: {
            id: { in: fixture.canaryDeliveryIds },
            linqChatLookupKey: fixture.canaryChatLookupKey,
          },
        })).resolves.toBe(6);
        await expect(prisma.hostedLinqDelivery.count({
          where: {
            id: { in: fixture.canaryDeliveryIds },
            phoneNumberLookupKey: null,
          },
        })).resolves.toBe(2);
        await expect(prisma.hostedLinqDelivery.count({
          where: {
            id: { in: fixture.canaryDeliveryIds },
            phoneNumberLookupKey: fixture.murphLineLookupKey,
          },
        })).resolves.toBe(4);
        expect(capture.snapshot.outboundMessagesPriorDay).toBe(1);
      } finally {
        if (originalCanaryPhoneNumber === undefined) {
          delete process.env.HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER;
        } else {
          process.env.HOSTED_ONBOARDING_LINQ_PRODUCTION_CANARY_PHONE_NUMBER =
            originalCanaryPhoneNumber;
        }
        await cleanupFixture(prisma, fixture);
        await prisma.$disconnect();
      }
    });
  },
);

function buildFixture() {
  const suffix = randomUUID();
  const canaryPhoneNumber = buildTestPhoneNumber(suffix, 0n);
  const murphLinePhoneNumber = buildTestPhoneNumber(suffix, 1n);
  const snapshotDayOffset = Number(
    BigInt(`0x${suffix.replaceAll("-", "")}`) % 100_000n,
  );
  const snapshotDate = new Date(Date.UTC(2200, 0, 2 + snapshotDayOffset));
  const captureAt = new Date(snapshotDate.getTime() + 12 * 60 * 60 * 1000);
  const priorDayStart = new Date(snapshotDate.getTime() - 24 * 60 * 60 * 1000);
  const canaryChatLookupKey = requireLookupKey(
    createHostedLinqChatLookupKey(`chat_canary_${suffix}`),
  );
  const canaryDeliveryIds = Array.from(
    { length: 6 },
    (_, index) => `hld_growth_canary_${suffix}_${index}`,
  );

  return {
    canaryChatLookupKey,
    canaryDeliveryIds,
    canaryPhoneLookupKey: requireLookupKey(
      createHostedPhoneLookupKey(canaryPhoneNumber),
    ),
    canaryPhoneNumber,
    captureAt,
    firstMemberId: `member_growth_canary_first_${suffix}`,
    firstRunAttemptedAt: new Date(priorDayStart.getTime() + 60 * 60 * 1000),
    murphLineLookupKey: requireLookupKey(
      createHostedPhoneLookupKey(murphLinePhoneNumber),
    ),
    ordinaryAttemptedAt: new Date(priorDayStart.getTime() + 20 * 60 * 60 * 1000),
    ordinaryChatLookupKey: requireLookupKey(
      createHostedLinqChatLookupKey(`chat_ordinary_${suffix}`),
    ),
    ordinaryDeliveryId: `hld_growth_ordinary_${suffix}`,
    secondMemberId: `member_growth_canary_second_${suffix}`,
    secondRunAttemptedAt: new Date(priorDayStart.getTime() + 10 * 60 * 60 * 1000),
    snapshotDate,
  };
}

async function seedCanaryRun(input: ReturnType<typeof buildFixture> & {
  attemptedAt: Date;
  memberId: string;
  pending: boolean;
  prisma: PrismaClient;
  runLabel: "first" | "second";
}): Promise<void> {
  await input.prisma.hostedMember.create({
    data: { id: input.memberId },
  });
  await input.prisma.hostedMemberIdentity.create({
    data: {
      memberId: input.memberId,
      phoneLookupKey: input.canaryPhoneLookupKey,
    },
  });
  await input.prisma.hostedMemberRouting.create({
    data: {
      ...(input.pending
        ? { pendingLinqChatLookupKey: input.canaryChatLookupKey }
        : { linqChatLookupKey: input.canaryChatLookupKey }),
      memberId: input.memberId,
    },
  });
  const deliveryOffset = input.runLabel === "first" ? 0 : 3;
  await input.prisma.hostedLinqDelivery.createMany({
    data: [
      {
        attemptedAt: input.attemptedAt,
        id: requireDeliveryId(input.canaryDeliveryIds, deliveryOffset),
        linqChatLookupKey: input.canaryChatLookupKey,
        source: "hosted_web_instant_first_turn",
        status: "accepted",
        template: "instant_first_turn_v1",
      },
      ...[1, 2].map((offset) => ({
        attemptedAt: new Date(
          input.attemptedAt.getTime() + offset * 60 * 60 * 1000,
        ),
        id: requireDeliveryId(
          input.canaryDeliveryIds,
          deliveryOffset + offset,
        ),
        linqChatLookupKey: input.canaryChatLookupKey,
        phoneNumberLookupKey: input.murphLineLookupKey,
        source: "hosted_runtime_linq_delivery",
        status: "accepted",
      })),
    ],
  });
}

async function cleanupFixture(
  prisma: PrismaClient,
  fixture: ReturnType<typeof buildFixture>,
): Promise<void> {
  await prisma.$transaction([
    prisma.hostedGrowthDailySnapshot.deleteMany({
      where: { snapshotDate: fixture.snapshotDate },
    }),
    prisma.hostedLinqDelivery.deleteMany({
      where: {
        id: {
          in: [...fixture.canaryDeliveryIds, fixture.ordinaryDeliveryId],
        },
      },
    }),
    prisma.hostedMember.deleteMany({
      where: {
        id: { in: [fixture.firstMemberId, fixture.secondMemberId] },
      },
    }),
    prisma.hostedLinqLine.deleteMany({
      where: { phoneNumberLookupKey: fixture.murphLineLookupKey },
    }),
  ]).catch(() => undefined);
}

function buildTestPhoneNumber(seed: string, offset: bigint): string {
  const subscriber = (
    BigInt(`0x${seed.replaceAll("-", "")}`) + offset
  ) % 1_000_000_000n;
  return `+1555${subscriber.toString().padStart(9, "0")}`;
}

function requireLookupKey(value: string | null): string {
  if (!value) {
    throw new Error("Expected a privacy-safe lookup key.");
  }
  return value;
}

function requireDeliveryId(deliveryIds: string[], index: number): string {
  const deliveryId = deliveryIds[index];
  if (!deliveryId) {
    throw new Error(`Expected canary delivery ID at index ${index}.`);
  }
  return deliveryId;
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
