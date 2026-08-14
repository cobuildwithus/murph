import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readHostedUsageReferralRecoveryHeads,
} from "@/src/lib/hosted-growth/usage-referral-recovery";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The usage-referral recovery proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted usage-referral recovery PostgreSQL selection",
  () => {
    let prisma: PrismaClient | null = null;
    const memberIds: string[] = [];
    const referralIds: string[] = [];

    beforeAll(() => {
      prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    });

    afterAll(async () => {
      if (prisma && referralIds.length > 0) {
        await prisma.hostedUsageReferral.deleteMany({
          where: { id: { in: referralIds } },
        });
      }
      if (prisma && memberIds.length > 0) {
        await prisma.hostedMember.deleteMany({
          where: { id: { in: memberIds } },
        });
      }
      await prisma?.$disconnect();
    });

    it("selects one live lane head across predecessor, retention, and advanced-cursor states", async () => {
      const client = requirePrisma(prisma);
      const now = new Date("2026-08-11T04:00:00.000Z");
      const liveCreatedAt = new Date(now.getTime() - 60_000);
      const laterLiveCreatedAt = new Date(now.getTime() - 30_000);
      const latestLiveCreatedAt = new Date(now.getTime() - 20_000);
      const retiredCreatedAt = new Date(
        now.getTime() - 15 * 24 * 60 * 60_000,
      );
      const blockedMemberId = createId("member_referral_blocked_head");
      const retainedFloorMemberId = createId("member_referral_retained_floor");
      const advancedCursorMemberId = createId("member_referral_advanced_cursor");
      memberIds.push(
        blockedMemberId,
        retainedFloorMemberId,
        advancedCursorMemberId,
      );

      await client.hostedMember.createMany({
        data: [
          { billingStatus: "active", id: blockedMemberId },
          { billingStatus: "active", id: retainedFloorMemberId },
          { billingStatus: "active", id: advancedCursorMemberId },
        ],
      });
      await client.hostedMailboxLaneCounter.createMany({
        data: [
          {
            consumedSeq: 0n,
            lane: "system",
            nextSeq: 3n,
            userId: blockedMemberId,
          },
          {
            consumedSeq: 0n,
            lane: "system",
            nextSeq: 3n,
            userId: retainedFloorMemberId,
          },
          {
            consumedSeq: 1n,
            lane: "system",
            nextSeq: 4n,
            userId: advancedCursorMemberId,
          },
        ],
      });

      const genericHeadId = createId("mailbox_generic_head");
      const blockedReferralId = createId("mailbox_blocked_referral");
      const blockedReferralOwnerId = createId("usage_referral_blocked");
      const retiredPrefixId = createId("mailbox_retired_prefix");
      const retainedFloorReferralId = createId("mailbox_retained_floor_referral");
      const retainedFloorReferralOwnerId = createId("usage_referral_retained");
      const consumedLivePrefixId = createId("mailbox_consumed_live_prefix");
      const advancedCursorHeadId = createId("mailbox_advanced_cursor_head");
      const advancedCursorReferralId = createId("mailbox_advanced_cursor_referral");
      const advancedCursorReferralOwnerId = createId("usage_referral_advanced");
      referralIds.push(
        blockedReferralOwnerId,
        retainedFloorReferralOwnerId,
        advancedCursorReferralOwnerId,
      );
      const armedAt = new Date(now.getTime() - 4 * 60_000);
      const targetBoundAt = new Date(now.getTime() - 3 * 60_000);
      const qualifiedAt = new Date(now.getTime() - 2 * 60_000);
      const rewardedAt = new Date(now.getTime() - 90_000);
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
      await client.hostedUsageReferral.createMany({
        data: [
          usageReferral({
            armedAt,
            beneficiaryMemberId: blockedMemberId,
            celebrationQueuedAt: liveCreatedAt,
            expiresAt,
            id: blockedReferralOwnerId,
            qualifiedAt,
            rewardedAt,
            targetBoundAt,
          }),
          usageReferral({
            armedAt,
            beneficiaryMemberId: retainedFloorMemberId,
            celebrationQueuedAt: laterLiveCreatedAt,
            expiresAt,
            id: retainedFloorReferralOwnerId,
            qualifiedAt,
            rewardedAt,
            targetBoundAt,
          }),
          usageReferral({
            armedAt,
            beneficiaryMemberId: advancedCursorMemberId,
            celebrationQueuedAt: latestLiveCreatedAt,
            expiresAt,
            id: advancedCursorReferralOwnerId,
            qualifiedAt,
            rewardedAt,
            targetBoundAt,
          }),
        ],
      });
      await client.hostedMailboxItem.createMany({
        data: [
          mailboxItem({
            createdAt: liveCreatedAt,
            dedupeKey: createId("runtime.browser-vault-refresh-requested"),
            id: genericHeadId,
            kind: "runtime.browser-vault-refresh-requested",
            laneSeq: 1n,
            userId: blockedMemberId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            dedupeKey:
              `assistant.notification.requested:usage-referral-reward:${blockedReferralOwnerId}`,
            id: blockedReferralId,
            laneSeq: 2n,
            userId: blockedMemberId,
          }),
          mailboxItem({
            createdAt: retiredCreatedAt,
            dedupeKey: createId("runtime.maintenance-requested"),
            id: retiredPrefixId,
            kind: "runtime.maintenance-requested",
            laneSeq: 1n,
            userId: retainedFloorMemberId,
          }),
          mailboxItem({
            createdAt: laterLiveCreatedAt,
            dedupeKey:
              `assistant.notification.requested:usage-referral-reward:${retainedFloorReferralOwnerId}`,
            id: retainedFloorReferralId,
            laneSeq: 2n,
            userId: retainedFloorMemberId,
          }),
          mailboxItem({
            createdAt: liveCreatedAt,
            dedupeKey: createId("runtime.consumed-prefix"),
            id: consumedLivePrefixId,
            kind: "runtime.maintenance-requested",
            laneSeq: 1n,
            userId: advancedCursorMemberId,
          }),
          mailboxItem({
            createdAt: latestLiveCreatedAt,
            dedupeKey: createId("runtime.next-head"),
            id: advancedCursorHeadId,
            kind: "runtime.browser-vault-refresh-requested",
            laneSeq: 2n,
            userId: advancedCursorMemberId,
          }),
          mailboxItem({
            createdAt: new Date(now.getTime() - 10_000),
            dedupeKey:
              `assistant.notification.requested:usage-referral-reward:${advancedCursorReferralOwnerId}`,
            id: advancedCursorReferralId,
            laneSeq: 3n,
            userId: advancedCursorMemberId,
          }),
        ],
      });

      await expect(readHostedUsageReferralRecoveryHeads({
        now,
        prisma: client,
      })).resolves.toEqual([
        {
          id: genericHeadId,
          lane: "system",
          laneSeq: 1n,
          userId: blockedMemberId,
        },
        {
          id: retainedFloorReferralId,
          lane: "system",
          laneSeq: 2n,
          userId: retainedFloorMemberId,
        },
        {
          id: advancedCursorHeadId,
          lane: "system",
          laneSeq: 2n,
          userId: advancedCursorMemberId,
        },
      ]);
    });
  },
);

function usageReferral(input: {
  armedAt: Date;
  beneficiaryMemberId: string;
  celebrationQueuedAt: Date;
  expiresAt: Date;
  id: string;
  qualifiedAt: Date;
  rewardedAt: Date;
  targetBoundAt: Date;
}) {
  return {
    armedAt: input.armedAt,
    beneficiaryMemberId: input.beneficiaryMemberId,
    celebrationQueuedAt: input.celebrationQueuedAt,
    expiresAt: input.expiresAt,
    id: input.id,
    policyCode: "new_person_activation_v1" as const,
    policyVersion: "usage-referral-recovery-postgres.v1",
    qualifiedAt: input.qualifiedAt,
    rewardUsdMicros: 1n,
    rewardedAt: input.rewardedAt,
    status: "rewarded" as const,
    targetBoundAt: input.targetBoundAt,
  };
}

function mailboxItem(input: {
  createdAt: Date;
  dedupeKey: string;
  id: string;
  kind?: string;
  laneSeq: bigint;
  userId: string;
}) {
  return {
    createdAt: input.createdAt,
    dedupeKey: input.dedupeKey,
    id: input.id,
    kind: input.kind ?? "assistant.notification.requested",
    lane: "system",
    laneSeq: input.laneSeq,
    occurredAt: input.createdAt,
    payloadSchema: "murph.test.usage-referral-recovery.v1",
    userId: input.userId,
  };
}

function createId(label: string): string {
  return `${label}_${randomUUID().replaceAll("-", "")}`;
}

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("Usage-referral recovery Prisma client is unavailable.");
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
