import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForFamilySponsorshipTx: vi.fn(async ({ memberId }) => ({
    activated: false,
    hostedExecutionEventId: null,
    memberId,
  })),
}));

import {
  acceptHostedFamilyInviteTx,
  writeHostedAccountGroupStripeBillingTx,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  lockHostedAccountGroupRow,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "@/src/lib/prisma";

describe("hosted Family roster serialization", () => {
  const clients: PrismaClient[] = [];
  const accountGroupIds: string[] = [];
  const memberIds: string[] = [];

  beforeEach(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for DB tests.");
    for (let index = 0; index < 3; index += 1) {
      clients.push(createPrismaClient({ databaseUrl, poolMax: 1 }));
    }
  });

  afterEach(async () => {
    await clients[0]?.hostedAccountGroup.deleteMany({
      where: { id: { in: accountGroupIds } },
    });
    await clients[0]?.hostedMember.deleteMany({
      where: { id: { in: memberIds } },
    });
    accountGroupIds.length = 0;
    memberIds.length = 0;
    await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  });

  it.each(["invite-first", "deletion-first"] as const)(
    "serializes invite acceptance with Family owner deletion when %s",
    async (winner) => {
      const firstPrisma = clients[0]!;
      const secondPrisma = clients[1]!;
      const observerPrisma = clients[2]!;
      const seed = await seedFamilyInvite({
        accountGroupIds,
        memberIds,
        prisma: firstPrisma,
      });
      const firstReady = createDeferred<void>();
      const releaseFirst = createDeferred<void>();

      if (winner === "invite-first") {
        const acceptance = firstPrisma.$transaction((tx) =>
          acceptHostedFamilyInviteTx({
            acceptedMemberId: seed.inviteeMemberId,
            inviteCode: seed.inviteCode,
            onAcceptedMemberValidated: async () => {
              firstReady.resolve();
              await releaseFirst.promise;
            },
            tx,
          }),
        );
        await firstReady.promise;
        const deletionBackendPid = createDeferred<number>();
        const deletion = secondPrisma.$transaction(async (tx) => {
          deletionBackendPid.resolve(await readBackendPid(tx));
          await deleteOwnedFamilyGroupTx({
            groupId: seed.groupId,
            ownerMemberId: seed.ownerMemberId,
            tx,
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await deletionBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(acceptance).resolves.toMatchObject({
          memberId: seed.inviteeMemberId,
          status: "active",
        });
        await expect(deletion).resolves.toBeUndefined();
        await expect(secondPrisma.hostedMember.findUnique({
          where: { id: seed.inviteeMemberId },
        })).resolves.not.toBeNull();
      } else {
        const deletion = firstPrisma.$transaction((tx) =>
          deleteOwnedFamilyGroupTx({
            groupId: seed.groupId,
            onGroupLocked: async () => {
              firstReady.resolve();
              await releaseFirst.promise;
            },
            ownerMemberId: seed.ownerMemberId,
            tx,
          }),
        );
        await firstReady.promise;
        const acceptanceBackendPid = createDeferred<number>();
        const acceptance = secondPrisma.$transaction(async (tx) => {
          acceptanceBackendPid.resolve(await readBackendPid(tx));
          return acceptHostedFamilyInviteTx({
            acceptedMemberId: seed.inviteeMemberId,
            inviteCode: seed.inviteCode,
            tx,
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await acceptanceBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(deletion).resolves.toBeUndefined();
        await expect(acceptance).rejects.toMatchObject({
          code: "HOSTED_FAMILY_INVITE_NOT_FOUND",
        });
      }
    },
  );

  it.each(["invite-first", "billing-first"] as const)(
    "serializes invite acceptance with access-revoking billing when %s",
    async (winner) => {
      const firstPrisma = clients[0]!;
      const secondPrisma = clients[1]!;
      const observerPrisma = clients[2]!;
      const seed = await seedFamilyInvite({
        accountGroupIds,
        memberIds,
        prisma: firstPrisma,
      });
      const firstReady = createDeferred<void>();
      const releaseFirst = createDeferred<void>();

      if (winner === "invite-first") {
        const acceptance = firstPrisma.$transaction((tx) =>
          acceptHostedFamilyInviteTx({
            acceptedMemberId: seed.inviteeMemberId,
            inviteCode: seed.inviteCode,
            onAcceptedMemberValidated: async () => {
              firstReady.resolve();
              await releaseFirst.promise;
            },
            tx,
          }),
        );
        await firstReady.promise;
        const billingBackendPid = createDeferred<number>();
        const billing = secondPrisma.$transaction(async (tx) => {
          billingBackendPid.resolve(await readBackendPid(tx));
          await writeHostedAccountGroupStripeBillingTx({
            billedSeatCount: 4,
            billingStatus: "unpaid",
            groupId: seed.groupId,
            tx,
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await billingBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(acceptance).resolves.toMatchObject({
          memberId: seed.inviteeMemberId,
        });
        await expect(billing).resolves.toBeUndefined();
        await expect(secondPrisma.hostedAccountGroup.findUniqueOrThrow({
          select: { billingStatus: true },
          where: { id: seed.groupId },
        })).resolves.toEqual({ billingStatus: "unpaid" });
      } else {
        const billing = firstPrisma.$transaction(async (tx) => {
          await writeHostedAccountGroupStripeBillingTx({
            billedSeatCount: 4,
            billingStatus: "unpaid",
            groupId: seed.groupId,
            tx,
          });
          firstReady.resolve();
          await releaseFirst.promise;
        });
        await firstReady.promise;
        const acceptanceBackendPid = createDeferred<number>();
        const acceptance = secondPrisma.$transaction(async (tx) => {
          acceptanceBackendPid.resolve(await readBackendPid(tx));
          return acceptHostedFamilyInviteTx({
            acceptedMemberId: seed.inviteeMemberId,
            inviteCode: seed.inviteCode,
            tx,
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await acceptanceBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(billing).resolves.toBeUndefined();
        await expect(acceptance).rejects.toMatchObject({
          code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
        });
      }
    },
  );

  it("revalidates owner suspension after waiting for the owner-member lock", async () => {
    const firstPrisma = clients[0]!;
    const secondPrisma = clients[1]!;
    const observerPrisma = clients[2]!;
    const seed = await seedFamilyInvite({
      accountGroupIds,
      memberIds,
      prisma: firstPrisma,
    });
    const firstReady = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    const suspension = firstPrisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, seed.ownerMemberId);
      await tx.hostedMember.update({
        data: { suspendedAt: new Date() },
        where: { id: seed.ownerMemberId },
      });
      firstReady.resolve();
      await releaseFirst.promise;
    });
    await firstReady.promise;
    const acceptanceBackendPid = createDeferred<number>();
    const acceptance = secondPrisma.$transaction(async (tx) => {
      acceptanceBackendPid.resolve(await readBackendPid(tx));
      return acceptHostedFamilyInviteTx({
        acceptedMemberId: seed.inviteeMemberId,
        inviteCode: seed.inviteCode,
        tx,
      });
    });
    const blocked = await waitForPostgresBlock({
      backendPid: await acceptanceBackendPid.promise,
      prisma: observerPrisma,
    });
    releaseFirst.resolve();
    expect(blocked).toBe(true);
    await expect(suspension).resolves.toBeUndefined();
    await expect(acceptance).rejects.toMatchObject({
      code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
    });
  });
});

async function seedFamilyInvite(input: {
  accountGroupIds: string[];
  memberIds: string[];
  prisma: PrismaClient;
}): Promise<{
  groupId: string;
  inviteCode: string;
  inviteeMemberId: string;
  ownerMemberId: string;
}> {
  const suffix = randomUUID().replaceAll("-", "");
  const beneficiaryMemberId = `member_family_beneficiary_${suffix}`;
  const inviteeMemberId = `member_family_invitee_${suffix}`;
  const ownerMemberId = `member_family_owner_${suffix}`;
  const groupId = `hbag_family_roster_${suffix}`;
  const inviteCode = `family_roster_${suffix}`;
  input.accountGroupIds.push(groupId);
  input.memberIds.push(beneficiaryMemberId, inviteeMemberId, ownerMemberId);
  await input.prisma.hostedMember.createMany({
    data: [
      { billingStatus: "not_started", id: beneficiaryMemberId },
      { billingStatus: "not_started", id: inviteeMemberId },
      { billingStatus: "active", id: ownerMemberId },
    ],
  });
  await input.prisma.hostedAccountGroup.create({
    data: {
      billingStatus: "active",
      billingRef: {
        create: {
          billedSeatCount: 4,
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_family_monthly",
        },
      },
      id: groupId,
      invites: {
        create: {
          channel: "family",
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          id: `hbagi_${suffix}`,
          inviteCode,
          invitedByMemberId: ownerMemberId,
          status: "pending",
        },
      },
      memberships: {
        create: [
          {
            id: `hbagm_owner_${suffix}`,
            joinedAt: new Date(),
            memberId: ownerMemberId,
            role: "owner",
            status: "active",
          },
          {
            id: `hbagm_beneficiary_${suffix}`,
            joinedAt: new Date(),
            memberId: beneficiaryMemberId,
            role: "member",
            status: "active",
          },
        ],
      },
      ownerMemberId,
    },
  });
  return { groupId, inviteCode, inviteeMemberId, ownerMemberId };
}

async function deleteOwnedFamilyGroupTx(input: {
  groupId: string;
  onGroupLocked?: () => Promise<void>;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await lockHostedAccountGroupRow(input.tx, input.groupId);
  await input.onGroupLocked?.();
  const beneficiaryRows = await input.tx.hostedAccountGroupMembership.findMany({
    orderBy: { memberId: "asc" },
    select: { memberId: true },
    where: { groupId: input.groupId, status: "active" },
  });
  const memberIds = [...new Set([
    input.ownerMemberId,
    ...beneficiaryRows.map((row) => row.memberId),
  ])].sort();
  for (const memberId of memberIds) {
    await lockHostedMemberRow(input.tx, memberId);
  }
  await input.tx.hostedAccountGroup.delete({ where: { id: input.groupId } });
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
