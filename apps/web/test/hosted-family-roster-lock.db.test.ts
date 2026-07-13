import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const callCircleMocks = vi.hoisted(() => ({
  resolveVerifiedMemberTransferNumber: vi.fn(),
  runtimeStart: vi.fn(),
  runtimeStop: vi.fn(),
  runtimeValidateStart: vi.fn(),
}));
const familyRuntimeMocks = vi.hoisted(() => ({
  requireHostedStripeApi: vi.fn(),
}));
vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  activateHostedMemberForFamilySponsorshipTx: vi.fn(async ({ memberId }) => ({
    activated: false,
    hostedExecutionEventId: null,
    memberId,
  })),
}));
vi.mock("@/src/lib/phone-calls/retell-runtime", () => ({
  createRetellPhoneCallRuntime: () => ({
    start: callCircleMocks.runtimeStart,
    stop: callCircleMocks.runtimeStop,
    validateStart: callCircleMocks.runtimeValidateStart,
  }),
}));
vi.mock("@/src/lib/phone-calls/transfer", () => ({
  resolveVerifiedMemberTransferNumber:
    callCircleMocks.resolveVerifiedMemberTransferNumber,
}));
vi.mock("@/src/lib/hosted-onboarding/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/hosted-onboarding/runtime")>()),
  requireHostedStripeApi: familyRuntimeMocks.requireHostedStripeApi,
}));

import { startCallCircleConnectorCall } from "@/src/lib/call-circle/connector-call";
import {
  acceptHostedFamilyInviteTx,
  applyHostedFamilyStripeSubscriptionUpdatedTx,
  createHostedFamilyBillingCheckout,
  issueHostedFamilyInviteFromOwner,
  removeHostedFamilyMemberTx,
  writeHostedAccountGroupStripeBillingTx,
} from "@/src/lib/hosted-onboarding/family-plan";
import { assertActiveHostedPersonAccessAllowedTx } from "@/src/lib/hosted-onboarding/member-access";
import {
  lockHostedAccountGroupRow,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "@/src/lib/prisma";

describe("hosted Family roster serialization", () => {
  const clients: PrismaClient[] = [];
  const accountGroupIds: string[] = [];
  const groupIds: string[] = [];
  const memberIds: string[] = [];

  beforeEach(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for DB tests.");
    vi.stubEnv(
      "HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY",
      "price_family_roster_lock",
    );
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://example.test");
    vi.stubEnv("RETELL_CONNECTOR_AGENT_ID", "agent_family_roster_lock");
    callCircleMocks.resolveVerifiedMemberTransferNumber.mockReset();
    callCircleMocks.resolveVerifiedMemberTransferNumber.mockImplementation(
      async ({ memberId }: { memberId: string }) =>
        memberId.includes("invitee") ? "+15550000001" : "+15550000002",
    );
    callCircleMocks.runtimeStart.mockReset();
    callCircleMocks.runtimeStart.mockImplementation(async ({ id }: { id: string }) => ({
      providerCallId: `provider_${id}`,
    }));
    callCircleMocks.runtimeStop.mockReset();
    callCircleMocks.runtimeStop.mockResolvedValue(undefined);
    callCircleMocks.runtimeValidateStart.mockReset();
    callCircleMocks.runtimeValidateStart.mockResolvedValue(undefined);
    familyRuntimeMocks.requireHostedStripeApi.mockReset();
    familyRuntimeMocks.requireHostedStripeApi.mockReturnValue({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: "cs_test_familyRosterLock",
            url: "https://example.test/checkout/cs_test_familyRosterLock",
          }),
        },
      },
    });
    for (let index = 0; index < 4; index += 1) {
      clients.push(createPrismaClient({ databaseUrl, poolMax: 1 }));
    }
  });

  afterEach(async () => {
    await clients[0]?.hostedGroup.deleteMany({
      where: { id: { in: groupIds } },
    });
    await clients[0]?.hostedAccountGroup.deleteMany({
      where: { id: { in: accountGroupIds } },
    });
    await clients[0]?.hostedMember.deleteMany({
      where: { id: { in: memberIds } },
    });
    accountGroupIds.length = 0;
    groupIds.length = 0;
    memberIds.length = 0;
    await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
    vi.unstubAllEnvs();
  });

  it("keeps full subscription reconciliation group-first when invite acceptance races", async () => {
    const ownerLockPrisma = clients[0]!;
    const subscriptionPrisma = clients[1]!;
    const invitePrisma = clients[2]!;
    const observerPrisma = clients[3]!;
    const seed = await seedFamilyInvite({
      accountGroupIds,
      memberIds,
      prisma: ownerLockPrisma,
    });
    const ownerLocked = createDeferred<void>();
    const releaseOwner = createDeferred<void>();
    const ownerLock = ownerLockPrisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, seed.ownerMemberId);
      ownerLocked.resolve();
      await releaseOwner.promise;
    });
    await ownerLocked.promise;

    const subscriptionBackendPid = createDeferred<number>();
    const subscription = subscriptionPrisma.$transaction(async (tx) => {
      subscriptionBackendPid.resolve(await readBackendPid(tx));
      return applyFamilySubscriptionTx({ seed, tx });
    });
    expect(await waitForPostgresBlock({
      backendPid: await subscriptionBackendPid.promise,
      prisma: observerPrisma,
    })).toBe(true);

    const inviteBackendPid = createDeferred<number>();
    const acceptance = invitePrisma.$transaction(async (tx) => {
      inviteBackendPid.resolve(await readBackendPid(tx));
      return acceptHostedFamilyInviteTx({
        acceptedMemberId: seed.inviteeMemberId,
        inviteCode: seed.inviteCode,
        tx,
      });
    });
    expect(await waitForPostgresBlock({
      backendPid: await inviteBackendPid.promise,
      prisma: observerPrisma,
    })).toBe(true);

    releaseOwner.resolve();
    await expect(ownerLock).resolves.toBeUndefined();
    await expect(subscription).resolves.toMatchObject({ groupId: seed.groupId });
    await expect(acceptance).resolves.toMatchObject({
      memberId: seed.inviteeMemberId,
      status: "active",
    });
  });

  it.each(["acceptance", "billing"] as const)(
    "finishes owner-group setup before group-first %s races invite issuance",
    async (contenderKind) => {
      const ownerLockPrisma = clients[0]!;
      const invitePrisma = clients[1]!;
      const contenderPrisma = clients[2]!;
      const observerPrisma = clients[3]!;
      const seed = await seedFamilyInvite({
        accountGroupIds,
        memberIds,
        prisma: ownerLockPrisma,
      });
      const ownerLocked = createDeferred<void>();
      const releaseOwner = createDeferred<void>();
      const ownerLock = ownerLockPrisma.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, seed.ownerMemberId);
        ownerLocked.resolve();
        await releaseOwner.promise;
      });
      await ownerLocked.promise;

      const invite = issueHostedFamilyInviteFromOwner({
        ownerMemberId: seed.ownerMemberId,
        prisma: invitePrisma,
        targetLabel: "Family member",
      });
      expect(await waitForPostgresBlockedBackendCount({
        minimum: 1,
        prisma: observerPrisma,
      })).toBe(true);

      const contender = contenderKind === "acceptance"
        ? contenderPrisma.$transaction((tx) => acceptHostedFamilyInviteTx({
            acceptedMemberId: seed.inviteeMemberId,
            inviteCode: seed.inviteCode,
            tx,
          }))
        : contenderPrisma.$transaction((tx) =>
            writeHostedAccountGroupStripeBillingTx({
              billedSeatCount: 4,
              billingStatus: "unpaid",
              groupId: seed.groupId,
              tx,
            }));
      expect(await waitForPostgresBlockedBackendCount({
        minimum: 2,
        prisma: observerPrisma,
      })).toBe(true);

      releaseOwner.resolve();
      await expect(ownerLock).resolves.toBeUndefined();
      await expect(contender).resolves.toBeDefined();
      if (contenderKind === "acceptance") {
        await expect(invite).resolves.toMatchObject({
          invite: { status: "pending" },
        });
      } else {
        await expect(invite).rejects.toMatchObject({
          code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
        });
      }
    },
  );

  it("keeps checkout-attempt persistence group-first when billing races", async () => {
    const ownerLockPrisma = clients[0]!;
    const checkoutPrisma = clients[1]!;
    const billingPrisma = clients[2]!;
    const observerPrisma = clients[3]!;
    const seed = await seedFamilyInvite({
      accountGroupIds,
      memberIds,
      prisma: ownerLockPrisma,
    });
    await ownerLockPrisma.hostedAccountGroup.update({
      data: { billingStatus: "not_started" },
      where: { id: seed.groupId },
    });
    await ownerLockPrisma.hostedAccountGroupBillingRef.delete({
      where: { groupId: seed.groupId },
    });
    await ownerLockPrisma.hostedMember.update({
      data: { billingStatus: "not_started" },
      where: { id: seed.ownerMemberId },
    });
    const ownerLocked = createDeferred<void>();
    const releaseOwner = createDeferred<void>();
    const ownerLock = ownerLockPrisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, seed.ownerMemberId);
      ownerLocked.resolve();
      await releaseOwner.promise;
    });
    await ownerLocked.promise;

    const checkout = createHostedFamilyBillingCheckout({
      groupId: seed.groupId,
      ownerMemberId: seed.ownerMemberId,
      prisma: checkoutPrisma,
      seatCount: 2,
    });
    expect(await waitForPostgresBlockedBackendCount({
      minimum: 1,
      prisma: observerPrisma,
    })).toBe(true);
    const billing = billingPrisma.$transaction((tx) =>
      writeHostedAccountGroupStripeBillingTx({
        billedSeatCount: 2,
        billingStatus: "unpaid",
        groupId: seed.groupId,
        tx,
      }));
    expect(await waitForPostgresBlockedBackendCount({
      minimum: 2,
      prisma: observerPrisma,
    })).toBe(true);

    releaseOwner.resolve();
    await expect(ownerLock).resolves.toBeUndefined();
    await expect(checkout).resolves.toEqual({
      alreadyActive: false,
      url: "https://example.test/checkout/family/cs_test_familyRosterLock",
    });
    await expect(billing).resolves.toBeDefined();
  });

  it.each(["invite-first", "provider-first"] as const)(
    "keeps a confirmed Call Circle bridge live when Family acceptance reaches the member fence %s",
    async (winner) => {
      const ownerLockPrisma = clients[0]!;
      const acceptancePrisma = clients[1]!;
      const providerPrisma = clients[2]!;
      const observerPrisma = clients[3]!;
      const now = new Date();
      const seed = await seedFamilyCallCircleBridge({
        accountGroupIds,
        groupIds,
        memberIds,
        now,
        prisma: ownerLockPrisma,
      });
      const ownerLocked = createDeferred<void>();
      const releaseOwner = createDeferred<void>();
      const ownerLock = ownerLockPrisma.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, seed.ownerMemberId);
        ownerLocked.resolve();
        await releaseOwner.promise;
      });
      await ownerLocked.promise;

      const startAcceptance = () => acceptancePrisma.$transaction((tx) =>
        acceptHostedFamilyInviteTx({
          acceptedMemberId: seed.inviteeMemberId,
          inviteCode: seed.inviteCode,
          tx,
        }));
      const startProvider = () => startCallCircleConnectorCall({
        matchId: seed.matchId,
        now,
        prisma: providerPrisma,
      });
      let acceptance!: ReturnType<typeof startAcceptance>;
      let providerStart!: ReturnType<typeof startProvider>;
      let firstBlocked: boolean;
      let secondBlocked: boolean;

      if (winner === "invite-first") {
        acceptance = startAcceptance();
        firstBlocked = await waitForPostgresBlockedBackendCount({
          minimum: 1,
          prisma: observerPrisma,
        });
        providerStart = startProvider();
        secondBlocked = await waitForPostgresBlockedBackendCount({
          minimum: 2,
          prisma: observerPrisma,
        });
      } else {
        providerStart = startProvider();
        firstBlocked = await waitForPostgresBlockedBackendCount({
          minimum: 1,
          prisma: observerPrisma,
        });
        acceptance = startAcceptance();
        secondBlocked = await waitForPostgresBlockedBackendCount({
          minimum: 2,
          prisma: observerPrisma,
        });
      }

      releaseOwner.resolve();
      await expect(ownerLock).resolves.toBeUndefined();
      const outcomes = await Promise.allSettled([acceptance, providerStart]);
      expect(outcomes).toEqual([
        {
          status: "fulfilled",
          value: expect.objectContaining({
            memberId: seed.inviteeMemberId,
            status: "active",
          }),
        },
        {
          status: "fulfilled",
          value: expect.objectContaining({ status: "calling" }),
        },
      ]);
      expect(firstBlocked).toBe(true);
      expect(secondBlocked).toBe(true);
      expect(callCircleMocks.runtimeStart).toHaveBeenCalledTimes(1);
      await expect(providerPrisma.hostedCallCircleMatch.findUniqueOrThrow({
        select: {
          outcome: true,
          phoneCall: {
            select: {
              providerStartAttemptedAt: true,
              status: true,
            },
          },
          status: true,
        },
        where: { id: seed.matchId },
      })).resolves.toEqual({
        outcome: null,
        phoneCall: {
          providerStartAttemptedAt: expect.any(Date),
          status: "calling",
        },
        status: "bridging",
      });
    },
  );

  it("waits group-first when full subscription reconciliation races owner deletion", async () => {
    const deletionPrisma = clients[0]!;
    const subscriptionPrisma = clients[1]!;
    const observerPrisma = clients[2]!;
    const seed = await seedFamilyInvite({
      accountGroupIds,
      memberIds,
      prisma: deletionPrisma,
    });
    const groupLocked = createDeferred<void>();
    const releaseDeletion = createDeferred<void>();
    const deletion = deletionPrisma.$transaction((tx) =>
      deleteOwnedFamilyGroupTx({
        groupId: seed.groupId,
        onGroupLocked: async () => {
          groupLocked.resolve();
          await releaseDeletion.promise;
        },
        ownerMemberId: seed.ownerMemberId,
        tx,
      }));
    await groupLocked.promise;

    const subscriptionBackendPid = createDeferred<number>();
    const subscription = subscriptionPrisma.$transaction(async (tx) => {
      subscriptionBackendPid.resolve(await readBackendPid(tx));
      return applyFamilySubscriptionTx({ seed, tx });
    });
    expect(await waitForPostgresBlock({
      backendPid: await subscriptionBackendPid.promise,
      prisma: observerPrisma,
    })).toBe(true);

    releaseDeletion.resolve();
    await expect(deletion).resolves.toBeUndefined();
    await expect(subscription).resolves.toMatchObject({
      activations: [],
      groupId: seed.groupId,
    });
    await expect(observerPrisma.hostedAccountGroup.findUnique({
      where: { id: seed.groupId },
    })).resolves.toBeNull();
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

  it.each([
    ["access-first", "billing"],
    ["access-first", "removal"],
    ["revocation-first", "billing"],
    ["revocation-first", "removal"],
  ] as const)(
    "serializes sponsored access with %s %s without a deadlock",
    async (winner, revocationKind) => {
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

      if (winner === "access-first") {
        const access = firstPrisma.$transaction(async (tx) => {
          await assertActiveHostedPersonAccessAllowedTx({
            memberId: seed.beneficiaryMemberId,
            tx,
          });
          firstReady.resolve();
          await releaseFirst.promise;
        });
        await firstReady.promise;
        const revocationBackendPid = createDeferred<number>();
        const revocation = secondPrisma.$transaction(async (tx) => {
          revocationBackendPid.resolve(await readBackendPid(tx));
          await revokeSeedFamilyAccessTx({
            kind: revocationKind,
            seed,
            tx,
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await revocationBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(access).resolves.toBeUndefined();
        await expect(revocation).resolves.toBeUndefined();
      } else {
        const revocation = firstPrisma.$transaction(async (tx) => {
          await revokeSeedFamilyAccessTx({
            kind: revocationKind,
            seed,
            tx,
          });
          firstReady.resolve();
          await releaseFirst.promise;
        });
        await firstReady.promise;
        const accessBackendPid = createDeferred<number>();
        const access = secondPrisma.$transaction(async (tx) => {
          accessBackendPid.resolve(await readBackendPid(tx));
          return assertActiveHostedPersonAccessAllowedTx({
            memberId: seed.beneficiaryMemberId,
            tx,
          });
        });
        const blocked = await waitForPostgresBlock({
          backendPid: await accessBackendPid.promise,
          prisma: observerPrisma,
        });
        releaseFirst.resolve();
        expect(blocked).toBe(true);
        await expect(revocation).resolves.toBeUndefined();
        await expect(access).rejects.toMatchObject({
          code: "HOSTED_ACCESS_REQUIRED",
        });
      }
    },
  );
});

async function seedFamilyCallCircleBridge(input: {
  accountGroupIds: string[];
  groupIds: string[];
  memberIds: string[];
  now: Date;
  prisma: PrismaClient;
}): Promise<Awaited<ReturnType<typeof seedFamilyInvite>> & {
  matchId: string;
}> {
  const family = await seedFamilyInvite(input);
  const suffix = randomUUID().replaceAll("-", "");
  const groupId = `hgrp_family_call_circle_${suffix}`;
  const matchId = `hccm_family_call_circle_${suffix}`;
  const timeZone = resolveTestDaytimeTimeZone(input.now);
  input.groupIds.push(groupId);
  await input.prisma.hostedMember.updateMany({
    data: { billingStatus: "active" },
    where: {
      id: { in: [family.beneficiaryMemberId, family.inviteeMemberId] },
    },
  });
  await input.prisma.hostedGroup.create({
    data: {
      id: groupId,
      ownerMemberId: family.ownerMemberId,
      runtimeMemberId: family.ownerMemberId,
    },
  });
  await input.prisma.hostedGroupMember.createMany({
    data: [
      {
        groupId,
        id: `hgm_family_call_circle_owner_${suffix}`,
        memberId: family.ownerMemberId,
        role: "owner",
      },
      {
        groupId,
        id: `hgm_family_call_circle_invitee_${suffix}`,
        memberId: family.inviteeMemberId,
        role: "member",
      },
      {
        groupId,
        id: `hgm_family_call_circle_beneficiary_${suffix}`,
        memberId: family.beneficiaryMemberId,
        role: "member",
      },
    ],
  });
  await input.prisma.hostedCallCircleParticipant.createMany({
    data: [family.inviteeMemberId, family.beneficiaryMemberId].map((memberId, index) => ({
      groupId,
      id: `hccp_family_call_circle_${index}_${suffix}`,
      memberId,
      preferencesJson: { timeZone, windows: [] },
      status: "enrolled" as const,
    })),
  });
  await input.prisma.hostedCallCircleMatch.create({
    data: {
      finalAskedAt: new Date(input.now.getTime() - 5 * 60 * 1_000),
      groupId,
      id: matchId,
      memberAId: family.inviteeMemberId,
      memberBId: family.beneficiaryMemberId,
      sideAResponse: "confirmed",
      sideBResponse: "confirmed",
      status: "both_confirmed",
      windowEndAt: new Date(input.now.getTime() + 20 * 60 * 1_000),
      windowStartAt: new Date(input.now.getTime() - 10 * 60 * 1_000),
    },
  });
  return { ...family, matchId };
}

async function seedFamilyInvite(input: {
  accountGroupIds: string[];
  memberIds: string[];
  prisma: PrismaClient;
}): Promise<{
  beneficiaryMemberId: string;
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
  return { beneficiaryMemberId, groupId, inviteCode, inviteeMemberId, ownerMemberId };
}

async function applyFamilySubscriptionTx(input: {
  seed: Awaited<ReturnType<typeof seedFamilyInvite>>;
  tx: Prisma.TransactionClient;
}) {
  return applyHostedFamilyStripeSubscriptionUpdatedTx({
    dispatchContext: {
      eventCreatedAt: new Date("2026-07-13T12:00:00.000Z"),
    },
    subscription: {
      customer: `cus_${input.seed.groupId}`,
      id: `sub_${input.seed.groupId}`,
      items: {
        data: [{
          id: `si_${input.seed.groupId}`,
          // @ts-expect-error - the synthetic price includes only the id read by family reconciliation.
          price: { id: "price_family_roster_lock" },
          quantity: 4,
        }],
      },
      metadata: {
        accountGroupId: input.seed.groupId,
        billingPlanCode: "launch_family_monthly",
        kind: "hosted_family_plan",
        ownerMemberId: input.seed.ownerMemberId,
      },
      object: "subscription",
      status: "active",
    },
    tx: input.tx,
  });
}

async function revokeSeedFamilyAccessTx(input: {
  kind: "billing" | "removal";
  seed: Awaited<ReturnType<typeof seedFamilyInvite>>;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (input.kind === "billing") {
    await writeHostedAccountGroupStripeBillingTx({
      billedSeatCount: 4,
      billingStatus: "unpaid",
      groupId: input.seed.groupId,
      tx: input.tx,
    });
    return;
  }

  await removeHostedFamilyMemberTx({
    groupId: input.seed.groupId,
    memberId: input.seed.beneficiaryMemberId,
    ownerMemberId: input.seed.ownerMemberId,
    tx: input.tx,
  });
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

function resolveTestDaytimeTimeZone(now: Date): string {
  const offsetHours = 12 - now.getUTCHours();
  if (offsetHours === 0) return "UTC";
  return `Etc/GMT${offsetHours > 0 ? "-" : "+"}${Math.abs(offsetHours)}`;
}

async function readBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
    select pg_backend_pid()::int as pid
  `;
  if (!backend) throw new Error("Missing PostgreSQL backend pid.");
  return backend.pid;
}

async function waitForPostgresBlockedBackendCount(input: {
  minimum: number;
  prisma: PrismaClient;
}): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await input.prisma.$queryRaw<Array<{ count: number }>>`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and cardinality(pg_blocking_pids(pid)) > 0
    `;
    if ((row?.count ?? 0) >= input.minimum) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return false;
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
