import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildCallCircleSetupNotificationEventId,
} from "@/src/lib/call-circle/notifications";
import {
  acceptCallCircleOfferEnrollment,
  HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX,
} from "@/src/lib/call-circle/participant-store";
import {
  applyHostedLinqParticipantRemovalTx,
} from "@/src/lib/hosted-groups/linq-participant-removal";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  lockHostedGroupRow,
} from "@/src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "@/src/lib/prisma";

describe("Call Circle participant lifecycle serialization", () => {
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
    await clients[0]?.hostedThreadContainer.deleteMany({
      where: {
        OR: [
          { memberId: { in: memberIds } },
          { ownerMemberId: { in: memberIds } },
        ],
      },
    });
    await clients[0]?.hostedMember.deleteMany({
      where: { id: { in: memberIds } },
    });
    groupIds.length = 0;
    memberIds.length = 0;
    await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  });

  it("releases the live slot and gives an activated re-enrollment a fresh setup identity", async () => {
    const prisma = clients[0]!;
    const seed = await seedFullCallCircleGroup({
      groupIds,
      memberIds,
      prisma,
      withSetupNotification: true,
    });
    const removed = await prisma.$transaction((tx) =>
      applyHostedLinqParticipantRemovalTx({
        chatId: seed.chatId,
        handle: seed.departedPhone,
        removedAt: new Date("2026-07-13T12:00:00.000Z"),
        tx,
      }));
    expect(removed).toBe(true);

    await expect(prisma.hostedCallCircleParticipant.findUnique({
      where: {
        groupId_memberId: {
          groupId: seed.groupId,
          memberId: seed.departedMemberId,
        },
      },
    })).resolves.toBeNull();
    await expect(prisma.hostedMailboxItem.findUniqueOrThrow({
      select: { kind: true },
      where: { id: seed.setupMailboxItemId },
    })).resolves.toEqual({
      kind: "assistant.notification.superseded",
    });

    await prisma.hostedGroupMember.create({
      data: {
        groupId: seed.groupId,
        id: `hgm_rejoin_${seed.suffix}`,
        memberId: seed.departedMemberId,
      },
    });
    await expect(prisma.hostedCallCircleParticipant.findUnique({
      where: {
        groupId_memberId: {
          groupId: seed.groupId,
          memberId: seed.departedMemberId,
        },
      },
    })).resolves.toBeNull();

    const reenrolled = await acceptCallCircleOfferEnrollment({
      groupId: seed.groupId,
      memberId: seed.departedMemberId,
      now: new Date("2026-07-13T12:05:00.000Z"),
      offerPostedAt: new Date("2026-07-13T12:04:00.000Z"),
      prisma,
    });
    expect(reenrolled.id).not.toBe(seed.departedParticipantId);
    expect(buildCallCircleSetupNotificationEventId({
      enrollmentGeneration: reenrolled.enrollmentGeneration,
      groupId: seed.groupId,
      memberId: seed.departedMemberId,
      participantId: reenrolled.id,
    })).not.toBe(seed.setupEventId);
    await expect(prisma.hostedCallCircleParticipant.count({
      where: { groupId: seed.groupId },
    })).resolves.toBe(HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX);
  });

  it("serializes departure before a new activated enrollment counts the group", async () => {
    const removalPrisma = clients[0]!;
    const enrollmentPrisma = clients[1]!;
    const observerPrisma = clients[2]!;
    const seed = await seedFullCallCircleGroup({
      groupIds,
      memberIds,
      prisma: removalPrisma,
    });
    const removalReady = createDeferred<void>();
    const releaseRemoval = createDeferred<void>();

    const removal = removalPrisma.$transaction(async (tx) => {
      const result = await applyHostedLinqParticipantRemovalTx({
        chatId: seed.chatId,
        handle: seed.departedPhone,
        removedAt: new Date("2026-07-13T12:00:00.000Z"),
        tx,
      });
      removalReady.resolve();
      await releaseRemoval.promise;
      return result;
    });
    await removalReady.promise;

    const enrollmentBackendPid = createDeferred<number>();
    const enrollment = enrollmentPrisma.$transaction(async (tx) => {
      enrollmentBackendPid.resolve(await readBackendPid(tx));
      await lockHostedGroupRow(tx, seed.groupId);
      await tx.hostedGroupMember.create({
        data: {
          groupId: seed.groupId,
          id: `hgm_candidate_${seed.suffix}`,
          memberId: seed.candidateMemberId,
        },
      });
      return acceptCallCircleOfferEnrollment({
        groupId: seed.groupId,
        memberId: seed.candidateMemberId,
        now: new Date("2026-07-13T12:01:00.000Z"),
        offerPostedAt: new Date("2026-07-13T12:00:30.000Z"),
        prisma: tx,
      });
    });
    expect(await waitForPostgresBlock({
      backendPid: await enrollmentBackendPid.promise,
      prisma: observerPrisma,
    })).toBe(true);

    releaseRemoval.resolve();
    await expect(removal).resolves.toBe(true);
    await expect(enrollment).resolves.toMatchObject({
      groupId: seed.groupId,
      memberId: seed.candidateMemberId,
      status: "enrolled",
    });
    await expect(observerPrisma.hostedCallCircleParticipant.count({
      where: { groupId: seed.groupId },
    })).resolves.toBe(HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX);
  });
});

async function seedFullCallCircleGroup(input: {
  groupIds: string[];
  memberIds: string[];
  prisma: PrismaClient;
  withSetupNotification?: boolean;
}): Promise<{
  candidateMemberId: string;
  chatId: string;
  departedMemberId: string;
  departedParticipantId: string;
  departedPhone: string;
  groupId: string;
  setupEventId: string;
  setupMailboxItemId: string;
  suffix: string;
}> {
  const suffix = randomUUID().replaceAll("-", "");
  const participantMemberIds = Array.from(
    { length: HOSTED_CALL_CIRCLE_PARTICIPANTS_MAX },
    (_, index) => `member_call_circle_lifecycle_${index}_${suffix}`,
  );
  const [ownerMemberId, departedMemberId] = participantMemberIds;
  if (!ownerMemberId || !departedMemberId) {
    throw new Error("Call Circle lifecycle seed requires participants.");
  }
  const candidateMemberId = `member_call_circle_candidate_${suffix}`;
  const runtimeMemberId = `member_call_circle_runtime_${suffix}`;
  const groupId = `hgrp_call_circle_lifecycle_${suffix}`;
  const chatId = `chat_call_circle_lifecycle_${suffix}`;
  const departedPhone = `+1555${(
    Number.parseInt(suffix.slice(0, 8), 16) % 10_000_000
  ).toString().padStart(7, "0")}`;
  const departedParticipantId = `hccp_departed_${suffix}`;
  const setupMailboxItemId = `hmi_departed_setup_${suffix}`;
  const setupEventId = buildCallCircleSetupNotificationEventId({
    enrollmentGeneration: 1,
    groupId,
    memberId: departedMemberId,
    participantId: departedParticipantId,
  });
  const phoneLookupKey = createHostedPhoneLookupKey(departedPhone);
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: "linq",
    threadId: chatId,
  });
  if (!phoneLookupKey || !threadIdentityLookupKey) {
    throw new Error("Call Circle lifecycle seed requires lookup keys.");
  }

  input.groupIds.push(groupId);
  input.memberIds.push(
    ...participantMemberIds,
    candidateMemberId,
    runtimeMemberId,
  );
  await input.prisma.hostedMember.createMany({
    data: [
      ...participantMemberIds.map((id) => ({ billingStatus: "active", id })),
      { billingStatus: "active", id: candidateMemberId },
      { billingStatus: "active", id: runtimeMemberId },
    ],
  });
  await input.prisma.hostedMemberIdentity.create({
    data: {
      memberId: departedMemberId,
      phoneLookupKey,
      phoneNumberVerifiedAt: new Date("2026-07-13T11:00:00.000Z"),
    },
  });
  await input.prisma.hostedThreadContainer.create({
    data: {
      memberId: runtimeMemberId,
      ownerMemberId,
    },
  });
  await input.prisma.hostedThreadRoute.create({
    data: {
      channel: "linq",
      containerMemberId: runtimeMemberId,
      threadIdentityLookupKey,
      threadLookupKey: `hbidx:test-thread:${suffix}`,
    },
  });
  await input.prisma.hostedGroup.create({
    data: {
      id: groupId,
      ownerMemberId,
      runtimeMemberId,
    },
  });
  await input.prisma.hostedGroupMember.createMany({
    data: participantMemberIds.map((memberId, index) => ({
      groupId,
      id: `hgm_call_circle_lifecycle_${index}_${suffix}`,
      memberId,
      role: index === 0 ? "owner" : "member",
    })),
  });
  await input.prisma.hostedCallCircleParticipant.createMany({
    data: participantMemberIds.map((memberId, index) => ({
      groupId,
      id: index === 1
        ? departedParticipantId
        : `hccp_call_circle_lifecycle_${index}_${suffix}`,
      memberId,
      status: "enrolled",
    })),
  });
  if (input.withSetupNotification) {
    await input.prisma.hostedMailboxItem.create({
      data: {
        dedupeKey: setupEventId,
        id: setupMailboxItemId,
        kind: "assistant.notification.requested",
        lane: "assistant",
        laneSeq: 1n,
        occurredAt: new Date("2026-07-13T11:30:00.000Z"),
        payloadSchema: "hosted.assistant.notification.v1",
        userId: departedMemberId,
      },
    });
  }
  return {
    candidateMemberId,
    chatId,
    departedMemberId,
    departedParticipantId,
    departedPhone,
    groupId,
    setupEventId,
    setupMailboxItemId,
    suffix,
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
