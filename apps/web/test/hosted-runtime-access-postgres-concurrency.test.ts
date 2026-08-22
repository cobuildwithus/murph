import { randomUUID } from "node:crypto";

import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  requireHostedRuntimeMembersActiveAccessForUpdateTx,
} from "@/src/lib/hosted-mailbox/runtime-access";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted runtime-access concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted runtime-access PostgreSQL concurrency proof",
  () => {
    it("serializes reciprocal cross-owned runtimes from one global first member row", async () => {
      const suffix = randomUUID();
      const firstMemberId = `member_runtime_access_a_${suffix}`;
      const secondMemberId = `member_runtime_access_b_${suffix}`;
      const firstGroupRuntimeId = `member_runtime_access_ga_${suffix}`;
      const secondGroupRuntimeId = `member_runtime_access_gb_${suffix}`;
      const firstApplicationName = `runtime_access_first_${suffix.slice(0, 8)}`;
      const secondApplicationName = `runtime_access_second_${suffix.slice(0, 8)}`;
      const blocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const first = createPrismaClient({
        databaseUrl: withPostgresApplicationName(
          databaseUrl,
          firstApplicationName,
        ),
        poolMax: 1,
      });
      const second = createPrismaClient({
        databaseUrl: withPostgresApplicationName(
          databaseUrl,
          secondApplicationName,
        ),
        poolMax: 1,
      });

      let releaseMemberLocks!: () => void;
      const memberLocksRelease = new Promise<void>((resolve) => {
        releaseMemberLocks = resolve;
      });
      let memberLocksAcquired!: () => void;
      const memberLocksReady = new Promise<void>((resolve) => {
        memberLocksAcquired = resolve;
      });
      const inFlight: Promise<unknown>[] = [];

      try {
        await blocker.hostedMember.createMany({
          data: [
            {
              billingStatus: HostedBillingStatus.active,
              id: firstMemberId,
            },
            {
              billingStatus: HostedBillingStatus.active,
              id: secondMemberId,
            },
            {
              billingStatus: HostedBillingStatus.not_started,
              id: firstGroupRuntimeId,
            },
            {
              billingStatus: HostedBillingStatus.not_started,
              id: secondGroupRuntimeId,
            },
          ],
        });
        await blocker.hostedThreadContainer.createMany({
          data: [
            {
              memberId: firstGroupRuntimeId,
              ownerMemberId: firstMemberId,
            },
            {
              memberId: secondGroupRuntimeId,
              ownerMemberId: secondMemberId,
            },
          ],
        });
        const blockerPromise = blocker.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT id
            FROM hosted_member
            WHERE id = ${firstMemberId}
            FOR UPDATE
          `;
          memberLocksAcquired();
          await memberLocksRelease;
        });
        inFlight.push(blockerPromise);
        await memberLocksReady;

        const firstAccess = first.$transaction((tx) =>
          requireHostedRuntimeMembersActiveAccessForUpdateTx(
            [firstMemberId, secondGroupRuntimeId],
            { prisma: tx },
          ),
        );
        const secondAccess = second.$transaction((tx) =>
          requireHostedRuntimeMembersActiveAccessForUpdateTx(
            [secondMemberId, firstGroupRuntimeId],
            { prisma: tx },
          ),
        );
        inFlight.push(firstAccess, secondAccess);
        await Promise.all([
          waitForPostgresLock({
            applicationName: firstApplicationName,
            observer,
          }),
          waitForPostgresLock({
            applicationName: secondApplicationName,
            observer,
          }),
        ]);

        // Both reciprocal calls must still be waiting on the same globally
        // sorted first member. A request-relative owner-first order would let
        // the A-to-GB call own B while the B-to-GA call waits on A.
        await expect(observer.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT id
            FROM hosted_member
            WHERE id = ${secondMemberId}
            FOR UPDATE NOWAIT
          `;
        })).resolves.toBeUndefined();

        releaseMemberLocks();
        await blockerPromise;
        await expect(Promise.all([firstAccess, secondAccess])).resolves.toEqual([
          undefined,
          undefined,
        ]);
      } finally {
        releaseMemberLocks();
        await Promise.allSettled(inFlight);
        await observer.hostedThreadContainer.deleteMany({
          where: {
            memberId: {
              in: [firstGroupRuntimeId, secondGroupRuntimeId],
            },
          },
        });
        await observer.hostedMember.deleteMany({
          where: {
            id: {
              in: [
                firstMemberId,
                secondMemberId,
                firstGroupRuntimeId,
                secondGroupRuntimeId,
              ],
            },
          },
        });
        await Promise.all([
          blocker.$disconnect(),
          observer.$disconnect(),
          first.$disconnect(),
          second.$disconnect(),
        ]);
      }
    });

  },
);

async function waitForPostgresLock(input: {
  applicationName: string;
  observer: ReturnType<typeof createPrismaClient>;
}): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [activity] = await input.observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE application_name = ${input.applicationName}
        AND state = 'active'
    `;
    if (activity?.waitEventType === "Lock") {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the reciprocal runtime-access writer to wait on a row lock.");
}

function withPostgresApplicationName(value: string, applicationName: string): string {
  const url = new URL(value);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
