import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  claimCallCircleNotificationDelivery,
} from "@/src/lib/call-circle/notification-delivery";
import { declineCallCircleMatchSide } from "@/src/lib/call-circle/match-store";
import {
  supersedeCallCircleNotificationsTx,
} from "@/src/lib/call-circle/notifications";
import { createPrismaClient } from "@/src/lib/prisma";

describe("Call Circle notification delivery serialization", () => {
  const clients: PrismaClient[] = [];
  const groupIds: string[] = [];
  const memberIds: string[] = [];

  beforeEach(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for DB tests.");
    for (let index = 0; index < 3; index += 1) {
      clients.push(createPrismaClient({ databaseUrl, poolMax: 1 }));
    }
  });

  afterEach(async () => {
    await clients[0]?.hostedGroup.deleteMany({
      where: { id: { in: groupIds } },
    });
    await clients[0]?.hostedMember.deleteMany({
      where: { id: { in: memberIds } },
    });
    groupIds.length = 0;
    memberIds.length = 0;
    await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  });

  it.each(["claim-first", "supersede-first"] as const)(
    "serializes provider entry with notification supersession when %s",
    async (winner) => {
      const firstPrisma = clients[0]!;
      const secondPrisma = clients[1]!;
      const observerPrisma = clients[2]!;
      const seed = await seedSetupNotification({
        groupIds,
        memberIds,
        prisma: firstPrisma,
      });
      const firstReady = createDeferred<void>();
      const releaseFirst = createDeferred<void>();

      if (winner === "claim-first") {
        const claim = firstPrisma.$transaction(async (tx) => {
          await claimCallCircleNotificationDelivery({
            memberId: seed.memberId,
            prisma: tx,
            request: {
              answeredMailboxItemIds: [seed.mailboxItemId],
              deliveryIdempotencyKey: seed.eventId,
            },
          });
          firstReady.resolve();
          await releaseFirst.promise;
        });
        await firstReady.promise;
        const supersedeBackendPid = createDeferred<number>();
        const supersede = secondPrisma.$transaction(async (tx) => {
          supersedeBackendPid.resolve(await readBackendPid(tx));
          return supersedeCallCircleNotificationsTx({
            groupId: seed.groupId,
            now: new Date(),
            setupMemberIds: [seed.memberId],
            tx,
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await supersedeBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(claim).resolves.toBeUndefined();
        await expect(supersede).resolves.toBe(0);
        await expect(secondPrisma.hostedMailboxItem.findUniqueOrThrow({
          select: { consumedAt: true, kind: true },
          where: { id: seed.mailboxItemId },
        })).resolves.toMatchObject({
          consumedAt: expect.any(Date),
          kind: "assistant.notification.requested",
        });
      } else {
        const supersede = firstPrisma.$transaction(async (tx) => {
          const result = await supersedeCallCircleNotificationsTx({
            groupId: seed.groupId,
            now: new Date(),
            setupMemberIds: [seed.memberId],
            tx,
          });
          firstReady.resolve();
          await releaseFirst.promise;
          return result;
        });
        await firstReady.promise;
        const claimBackendPid = createDeferred<number>();
        const claim = secondPrisma.$transaction(async (tx) => {
          claimBackendPid.resolve(await readBackendPid(tx));
          return claimCallCircleNotificationDelivery({
            memberId: seed.memberId,
            prisma: tx,
            request: {
              answeredMailboxItemIds: [seed.mailboxItemId],
              deliveryIdempotencyKey: seed.eventId,
            },
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await claimBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(supersede).resolves.toBe(1);
        await expect(claim).rejects.toMatchObject({
          code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
        });
        await expect(secondPrisma.hostedMailboxItem.findUniqueOrThrow({
          select: { consumedAt: true, kind: true },
          where: { id: seed.mailboxItemId },
        })).resolves.toMatchObject({
          consumedAt: expect.any(Date),
          kind: "assistant.notification.superseded",
        });
      }
    },
  );

  it.each(["claim-first", "decline-first"] as const)(
    "serializes confirmation delivery with a partner decline when %s",
    async (winner) => {
      const firstPrisma = clients[0]!;
      const secondPrisma = clients[1]!;
      const observerPrisma = clients[2]!;
      const seed = await seedConfirmNotification({
        groupIds,
        memberIds,
        prisma: firstPrisma,
      });
      const firstReady = createDeferred<void>();
      const releaseFirst = createDeferred<void>();
      const decline = (prisma: Prisma.TransactionClient) =>
        declineCallCircleMatchSide({
          expectedAsk: seed.expectedAsk,
          groupId: seed.groupId,
          matchId: seed.matchId,
          memberAId: seed.memberId,
          memberBId: seed.partnerMemberId,
          memberId: seed.partnerMemberId,
          now: seed.now,
          prisma,
          side: "B",
        });

      if (winner === "claim-first") {
        const claim = firstPrisma.$transaction(async (tx) => {
          await claimCallCircleNotificationDelivery({
            memberId: seed.memberId,
            now: seed.now,
            prisma: tx,
            request: {
              answeredMailboxItemIds: [seed.mailboxItemId],
              deliveryIdempotencyKey: seed.eventId,
            },
          });
          firstReady.resolve();
          await releaseFirst.promise;
        });
        await firstReady.promise;
        const declineBackendPid = createDeferred<number>();
        const partnerDecline = secondPrisma.$transaction(async (tx) => {
          declineBackendPid.resolve(await readBackendPid(tx));
          return decline(tx);
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await declineBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(claim).resolves.toBeUndefined();
        await expect(partnerDecline).resolves.toBe(true);
        await expect(secondPrisma.hostedMailboxItem.findUniqueOrThrow({
          select: { consumedAt: true },
          where: { id: seed.mailboxItemId },
        })).resolves.toEqual({ consumedAt: expect.any(Date) });
      } else {
        const partnerDecline = firstPrisma.$transaction(async (tx) => {
          const result = await decline(tx);
          firstReady.resolve();
          await releaseFirst.promise;
          return result;
        });
        await firstReady.promise;
        const claimBackendPid = createDeferred<number>();
        const claim = secondPrisma.$transaction(async (tx) => {
          claimBackendPid.resolve(await readBackendPid(tx));
          return claimCallCircleNotificationDelivery({
            memberId: seed.memberId,
            now: seed.now,
            prisma: tx,
            request: {
              answeredMailboxItemIds: [seed.mailboxItemId],
              deliveryIdempotencyKey: seed.eventId,
            },
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await claimBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(partnerDecline).resolves.toBe(true);
        await expect(claim).rejects.toMatchObject({
          code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
        });
        await expect(secondPrisma.hostedMailboxItem.findUniqueOrThrow({
          select: { consumedAt: true, kind: true },
          where: { id: seed.mailboxItemId },
        })).resolves.toEqual({
          consumedAt: null,
          kind: "assistant.notification.requested",
        });
      }
    },
  );
});

async function seedSetupNotification(input: {
  groupIds: string[];
  memberIds: string[];
  prisma: PrismaClient;
}): Promise<{
  eventId: string;
  groupId: string;
  mailboxItemId: string;
  memberId: string;
  participantId: string;
}> {
  const suffix = randomUUID().replaceAll("-", "");
  const groupId = `hgrp_notification_claim_${suffix}`;
  const mailboxItemId = `hmi_notification_claim_${suffix}`;
  const memberId = `member_notification_claim_${suffix}`;
  const participantId = `hccp_notification_claim_${suffix}`;
  const eventId =
    `assistant.notification.requested:call-circle:setup:${groupId}:${memberId}:participant:${participantId}:enrollment:1`;
  input.groupIds.push(groupId);
  input.memberIds.push(memberId);
  await input.prisma.hostedMember.create({
    data: {
      billingStatus: "active",
      id: memberId,
    },
  });
  await input.prisma.hostedGroup.create({
    data: {
      id: groupId,
      ownerMemberId: memberId,
    },
  });
  await input.prisma.hostedGroupMember.create({
    data: {
      groupId,
      id: `hgm_notification_claim_${suffix}`,
      memberId,
      role: "owner",
    },
  });
  await input.prisma.hostedCallCircleParticipant.create({
    data: {
      groupId,
      id: participantId,
      memberId,
      status: "enrolled",
    },
  });
  await input.prisma.hostedMailboxItem.create({
    data: {
      dedupeKey: eventId,
      id: mailboxItemId,
      kind: "assistant.notification.requested",
      lane: "assistant",
      laneSeq: 1n,
      occurredAt: new Date(),
      payloadSchema: "hosted.assistant.notification.v1",
      userId: memberId,
    },
  });
  return { eventId, groupId, mailboxItemId, memberId, participantId };
}

async function seedConfirmNotification(input: {
  groupIds: string[];
  memberIds: string[];
  prisma: PrismaClient;
}) {
  const suffix = randomUUID().replaceAll("-", "");
  const groupId = `hgrp_notification_confirm_${suffix}`;
  const mailboxItemId = `hmi_notification_confirm_${suffix}`;
  const matchId = `hccm_notification_confirm_${suffix}`;
  const memberId = `member_notification_confirm_a_${suffix}`;
  const partnerMemberId = `member_notification_confirm_b_${suffix}`;
  const now = new Date("2026-07-12T17:05:00.000Z");
  const amAskedAt = new Date("2026-07-12T16:00:00.000Z");
  const finalAskedAt = new Date("2026-07-12T17:00:00.000Z");
  const windowStartAt = new Date("2026-07-12T18:00:00.000Z");
  const windowEndAt = new Date("2026-07-12T18:30:00.000Z");
  const eventId =
    `assistant.notification.requested:call-circle:final:${matchId}:${memberId}:${windowStartAt.toISOString()}`;
  input.groupIds.push(groupId);
  input.memberIds.push(memberId, partnerMemberId);
  await input.prisma.hostedMember.createMany({
    data: [memberId, partnerMemberId].map((id) => ({
      billingStatus: "active" as const,
      id,
    })),
  });
  await input.prisma.hostedGroup.create({
    data: {
      id: groupId,
      ownerMemberId: memberId,
    },
  });
  await input.prisma.hostedGroupMember.createMany({
    data: [memberId, partnerMemberId].map((id, index) => ({
      groupId,
      id: `hgm_notification_confirm_${index}_${suffix}`,
      memberId: id,
      role: index === 0 ? "owner" : "member",
    })),
  });
  await input.prisma.hostedCallCircleParticipant.createMany({
    data: [memberId, partnerMemberId].map((id, index) => ({
      groupId,
      id: `hccp_notification_confirm_${index}_${suffix}`,
      memberId: id,
      status: "enrolled" as const,
    })),
  });
  await input.prisma.hostedCallCircleMatch.create({
    data: {
      amAskedAt,
      finalAskedAt,
      groupId,
      id: matchId,
      memberAId: memberId,
      memberBId: partnerMemberId,
      status: "asking",
      windowEndAt,
      windowStartAt,
    },
  });
  await input.prisma.hostedMailboxItem.create({
    data: {
      dedupeKey: eventId,
      id: mailboxItemId,
      kind: "assistant.notification.requested",
      lane: "assistant",
      laneSeq: 1n,
      occurredAt: finalAskedAt,
      payloadSchema: "hosted.assistant.notification.v1",
      userId: memberId,
    },
  });
  return {
    eventId,
    expectedAsk: { amAskedAt, finalAskedAt, windowEndAt, windowStartAt },
    groupId,
    mailboxItemId,
    matchId,
    memberId,
    now,
    partnerMemberId,
  };
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
    select pg_backend_pid()::int as pid
  `;
  if (!backend) throw new Error("Missing PostgreSQL backend pid.");
  return backend.pid;
}

async function waitForPostgresBlock(input: {
  backendPid: number;
  prisma: PrismaClient;
}): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await input.prisma.$queryRaw<Array<{ blocked: boolean }>>`
      select cardinality(pg_blocking_pids(${input.backendPid})) > 0 as blocked
    `;
    if (row?.blocked) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
