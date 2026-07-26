import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimHostedAcceptedAttemptFailureRecheck,
} from "@/src/lib/hosted-workspace/store";
import { createPrismaClient } from "@/src/lib/prisma";

const COOLDOWN_MS = 30_000;

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The accepted-attempt recheck claim proof requires a local DATABASE_URL.",
  );
}

// The claim replaced a log-row election, so the exactly-one-winner property is
// now PostgreSQL's conditional-update semantics rather than application logic.
// Mocked `updateMany` counts cannot prove that; two real clients can.
describe.skipIf(!runPostgresProof)(
  "accepted-attempt recheck claim ownership",
  () => {
    let observer: PrismaClient | null = null;
    let challenger: PrismaClient | null = null;
    let memberId: string | null = null;

    beforeAll(async () => {
      observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      challenger = createPrismaClient({ databaseUrl, poolMax: 1 });
      memberId = `member_recheck_claim_${randomUUID().replaceAll("-", "")}`;
      await observer.hostedMember.create({
        data: { billingStatus: "active", id: memberId },
      });
      await observer.hostedWorkspace.create({
        data: { userId: memberId },
      });
    });

    afterAll(async () => {
      if (observer && memberId) {
        await observer.hostedMember.deleteMany({ where: { id: memberId } });
      }
      await observer?.$disconnect();
      await challenger?.$disconnect();
    });

    it("elects exactly one winner and reopens only after the cooldown", async () => {
      const first = requirePrisma(observer);
      const second = requirePrisma(challenger);
      const userId = requireMemberId(memberId);
      const now = new Date("2026-07-25T12:00:00.000Z");

      const claims = await Promise.all([
        claimHostedAcceptedAttemptFailureRecheck({
          cooldownMs: COOLDOWN_MS,
          now,
          prisma: first,
          userId,
        }),
        claimHostedAcceptedAttemptFailureRecheck({
          cooldownMs: COOLDOWN_MS,
          now,
          prisma: second,
          userId,
        }),
      ]);

      expect(claims.filter(Boolean)).toHaveLength(1);

      // A later failure inside the window is suppressed rather than signaling a
      // second recheck. The window is closed through its final instant, so two
      // rechecks can never land within one cooldown span.
      await expect(claimHostedAcceptedAttemptFailureRecheck({
        cooldownMs: COOLDOWN_MS,
        now: new Date(now.getTime() + COOLDOWN_MS),
        prisma: first,
        userId,
      })).resolves.toBe(false);

      // Once the window has fully elapsed, recovery is available again.
      await expect(claimHostedAcceptedAttemptFailureRecheck({
        cooldownMs: COOLDOWN_MS,
        now: new Date(now.getTime() + COOLDOWN_MS + 1),
        prisma: second,
        userId,
      })).resolves.toBe(true);
    });
  },
);

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("Accepted-attempt recheck Prisma client is unavailable.");
  }
  return value;
}

function requireMemberId(value: string | null): string {
  if (!value) {
    throw new Error("Accepted-attempt recheck member id is unavailable.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
