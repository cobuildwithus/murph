import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { HostedPhoneCallBrief } from "@murphai/hosted-execution/phone-calls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCallCircleMatchProposal } from "@/src/lib/call-circle/match-store";
import { writeCallCirclePreferences } from "@/src/lib/call-circle/participant-store";
import {
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  lockHostedAccountGroupRow,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import { removeHostedFamilyMemberTx } from "@/src/lib/hosted-onboarding/family-plan";
import { activeHostedMemberAccessWithParticipantsWhere } from "@/src/lib/hosted-onboarding/member-access";
import { createHostedPhoneCall } from "@/src/lib/phone-calls/service";
import { resolveVerifiedMemberTransferNumber } from "@/src/lib/phone-calls/transfer";
import type { PhoneCallRuntime } from "@/src/lib/phone-calls/types";
import { createPrismaClient } from "@/src/lib/prisma";

const BRIEF: HostedPhoneCallBrief = {
  allowTransferToUser: false,
  goal: "Confirm a synthetic test appointment.",
  instructions: ["Use only synthetic test data."],
  shareableFacts: {},
  successCriteria: "The synthetic appointment is confirmed.",
  timeZone: "UTC",
  to: {
    label: "Synthetic test office",
    phoneNumber: "+15550000000",
  },
};

describe("hosted phone-call account-deletion fence", () => {
  const clients: PrismaClient[] = [];
  const accountGroupIds: string[] = [];
  const groupIds: string[] = [];
  const memberIds: string[] = [];
  let memberId: string;

  beforeEach(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for DB tests.");
    for (let index = 0; index < 3; index += 1) {
      clients.push(createPrismaClient({ databaseUrl, poolMax: 1 }));
    }
    memberId = `member_phone_delete_${randomUUID().replaceAll("-", "")}`;
    memberIds.push(memberId);
    await clients[0]!.hostedMember.create({
      data: {
        billingStatus: "active",
        id: memberId,
      },
    });
  });

  afterEach(async () => {
    await clients[0]?.hostedAccountGroup.deleteMany({
      where: { id: { in: accountGroupIds } },
    });
    await clients[0]?.hostedGroup.deleteMany({ where: { id: { in: groupIds } } });
    await clients[0]?.hostedMember.deleteMany({ where: { id: { in: memberIds } } });
    groupIds.length = 0;
    accountGroupIds.length = 0;
    memberIds.length = 0;
    await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  });

  it.each(["direct-removal", "owner-deletion"] as const)(
    "rejects the provider marker after %s revocation wins the beneficiary lock",
    async (revocationKind) => {
      const revocationPrisma = clients[0]!;
      const providerPrisma = clients[1]!;
      const observerPrisma = clients[2]!;
      const beneficiaryMemberId = `member_family_a_${randomUUID().replaceAll("-", "")}`;
      const ownerMemberId = `member_family_z_${randomUUID().replaceAll("-", "")}`;
      const accountGroupId = `hbag_revocation_wins_${randomUUID().replaceAll("-", "")}`;
      const phoneCallId = `hpc_revocation_wins_${randomUUID().replaceAll("-", "")}`;
      memberIds.push(beneficiaryMemberId, ownerMemberId);
      accountGroupIds.push(accountGroupId);
      await seedActiveFamilySponsorship({
        beneficiaryMemberId,
        groupId: accountGroupId,
        ownerMemberId,
        prisma: revocationPrisma,
      });
      await revocationPrisma.hostedPhoneCall.create({
        data: {
          briefJson: BRIEF,
          id: phoneCallId,
          memberId: beneficiaryMemberId,
          provider: "retell",
          requestKey: `revocation-wins-${revocationKind}`,
          status: "starting",
        },
      });

      const revocationReady = createDeferred<void>();
      const releaseRevocation = createDeferred<void>();
      const revocation = revocationPrisma.$transaction(async (tx) => {
        if (revocationKind === "direct-removal") {
          const removed = await removeHostedFamilyMemberTx({
            groupId: accountGroupId,
            memberId: beneficiaryMemberId,
            ownerMemberId,
            tx,
          });
          if (!removed) throw new Error("Expected active Family membership removal.");
        } else {
          await deleteOwnedFamilySponsorshipTx({ ownerMemberId, tx });
        }
        revocationReady.resolve();
        await releaseRevocation.promise;
      });
      await revocationReady.promise;

      const providerBackendPid = createDeferred<number>();
      const providerMarker = providerPrisma.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
          select pg_backend_pid()::int as pid
        `;
        if (!backend) throw new Error("Missing PostgreSQL backend pid.");
        providerBackendPid.resolve(backend.pid);
        await lockHostedMemberRow(tx, beneficiaryMemberId);
        return tx.hostedPhoneCall.updateMany({
          data: { providerStartAttemptedAt: new Date() },
          where: {
            AND: [
              {
                id: phoneCallId,
                providerCallId: null,
                providerStartAttemptedAt: null,
                status: "starting",
              },
              {
                member: {
                  is: activeHostedMemberAccessWithParticipantsWhere(),
                },
              },
            ],
          },
        });
      });

      expect(await waitForPostgresBlock({
        backendPid: await providerBackendPid.promise,
        prisma: observerPrisma,
      })).toBe(true);
      releaseRevocation.resolve();
      await expect(revocation).resolves.toBeUndefined();
      await expect(providerMarker).resolves.toEqual({ count: 0 });
      await expect(providerPrisma.hostedPhoneCall.findUniqueOrThrow({
        select: { providerStartAttemptedAt: true },
        where: { id: phoneCallId },
      })).resolves.toEqual({ providerStartAttemptedAt: null });
    },
  );

  it.each(["direct-removal", "owner-deletion"] as const)(
    "makes %s wait when provider start wins the beneficiary lock",
    async (revocationKind) => {
      const providerPrisma = clients[0]!;
      const revocationPrisma = clients[1]!;
      const observerPrisma = clients[2]!;
      const beneficiaryMemberId = `member_family_a_${randomUUID().replaceAll("-", "")}`;
      const ownerMemberId = `member_family_z_${randomUUID().replaceAll("-", "")}`;
      const accountGroupId = `hbag_provider_wins_${randomUUID().replaceAll("-", "")}`;
      memberIds.push(beneficiaryMemberId, ownerMemberId);
      accountGroupIds.push(accountGroupId);
      await seedActiveFamilySponsorship({
        beneficiaryMemberId,
        groupId: accountGroupId,
        ownerMemberId,
        prisma: providerPrisma,
      });

      const preflightEntered = createDeferred<void>();
      const releasePreflight = createDeferred<void>();
      const providerStartEntered = createDeferred<void>();
      const releaseProviderStart = createDeferred<void>();
      const runtimeStartCalls: string[] = [];
      const runtime: PhoneCallRuntime = {
        resolveProviderCall: async () => ({ state: "not_found" }),
        start: async (call) => {
          runtimeStartCalls.push(call.id);
          providerStartEntered.resolve();
          await releaseProviderStart.promise;
          return { providerCallId: `provider_${call.id}` };
        },
        stopIfActive: async () => {},
        validateStart: async () => {},
      };
      const startup = createHostedPhoneCall({
        beforeStart: async () => {
          preflightEntered.resolve();
          await releasePreflight.promise;
          return true;
        },
        brief: BRIEF,
        memberId: beneficiaryMemberId,
        prisma: providerPrisma,
        providerStartMemberIds: [beneficiaryMemberId],
        requestKey: `provider-wins-${revocationKind}`,
        resultNotificationRouteResolver: async () => {},
        runtime,
      });
      await preflightEntered.promise;

      const revocationBackendPid = createDeferred<number>();
      const revocation = revocationPrisma.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
          select pg_backend_pid()::int as pid
        `;
        if (!backend) throw new Error("Missing PostgreSQL backend pid.");
        revocationBackendPid.resolve(backend.pid);
        if (revocationKind === "direct-removal") {
          const removed = await removeHostedFamilyMemberTx({
            groupId: accountGroupId,
            memberId: beneficiaryMemberId,
            ownerMemberId,
            tx,
          });
          if (!removed) throw new Error("Expected active Family membership removal.");
        } else {
          await deleteOwnedFamilySponsorshipTx({ ownerMemberId, tx });
        }
      });

      expect(await waitForPostgresBlock({
        backendPid: await revocationBackendPid.promise,
        prisma: observerPrisma,
      })).toBe(true);
      expect(runtimeStartCalls).toEqual([]);

      releasePreflight.resolve();
      await providerStartEntered.promise;
      await expect(revocation).resolves.toBeUndefined();
      if (revocationKind === "direct-removal") {
        await expect(revocationPrisma.hostedAccountGroupMembership.findUniqueOrThrow({
          select: { status: true },
          where: {
            groupId_memberId: {
              groupId: accountGroupId,
              memberId: beneficiaryMemberId,
            },
          },
        })).resolves.toEqual({ status: "removed" });
      } else {
        await expect(revocationPrisma.hostedAccountGroup.findUnique({
          where: { id: accountGroupId },
        })).resolves.toBeNull();
        await expect(revocationPrisma.hostedMember.findUnique({
          where: { id: beneficiaryMemberId },
        })).resolves.not.toBeNull();
      }
      releaseProviderStart.resolve();
      await expect(startup).resolves.toMatchObject({ status: "calling" });
    },
  );

  it("makes distinct group-owner deletion wait for the provider marker transaction", async () => {
    const startupPrisma = clients[0]!;
    const deletionPrisma = clients[1]!;
    const observerPrisma = clients[2]!;
    const ownerMemberId = `member_phone_owner_${randomUUID().replaceAll("-", "")}`;
    const runtimeMemberId = `member_phone_runtime_${randomUUID().replaceAll("-", "")}`;
    const partnerMemberId = `member_phone_partner_${randomUUID().replaceAll("-", "")}`;
    memberIds.push(ownerMemberId, runtimeMemberId, partnerMemberId);
    await startupPrisma.hostedMember.createMany({
      data: [ownerMemberId, runtimeMemberId, partnerMemberId].map((id) => ({
        billingStatus: "active" as const,
        id,
      })),
    });
    const preflightEntered = createDeferred<{ phoneCallId: string }>();
    const releasePreflight = createDeferred<void>();
    const providerStartEntered = createDeferred<void>();
    const releaseProviderStart = createDeferred<void>();
    const deletionBackendPid = createDeferred<number>();
    const deletionSnapshot = createDeferred<{
      providerCallId: string | null;
      providerStartAttemptedAt: Date | null;
    }>();
    const runtimeStartCalls: string[] = [];
    const runtime: PhoneCallRuntime = {
      resolveProviderCall: async () => ({ state: "not_found" }),
      start: async (call) => {
        runtimeStartCalls.push(call.id);
        providerStartEntered.resolve();
        await releaseProviderStart.promise;
        return { providerCallId: `provider_${call.id}` };
      },
      stopIfActive: async () => {},
      validateStart: async () => {},
    };

    const startup = createHostedPhoneCall({
      beforeStart: async ({ phoneCallId }) => {
        preflightEntered.resolve({ phoneCallId });
        await releasePreflight.promise;
        return true;
      },
      brief: BRIEF,
      memberId,
      prisma: startupPrisma,
      providerStartMemberIds: [
        memberId,
        partnerMemberId,
        ownerMemberId,
        runtimeMemberId,
      ],
      requestKey: "account-deletion-barrier",
      resultNotificationRouteResolver: async () => {},
      runtime,
    });
    const { phoneCallId } = await preflightEntered.promise;

    const deletion = (async () => {
      await deletionPrisma.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
          select pg_backend_pid()::int as pid
        `;
        if (!backend) throw new Error("Missing PostgreSQL backend pid.");
        deletionBackendPid.resolve(backend.pid);
        await tx.$queryRaw`
          select 1 from "hosted_member" where "id" = ${ownerMemberId} for update
        `;
        await tx.hostedMember.update({
          data: { suspendedAt: new Date() },
          where: { id: ownerMemberId },
        });
      });
      const snapshot = await deletionPrisma.hostedPhoneCall.findUniqueOrThrow({
        select: {
          providerCallId: true,
          providerStartAttemptedAt: true,
        },
        where: { id: phoneCallId },
      });
      deletionSnapshot.resolve(snapshot);
      if (
        snapshot.providerStartAttemptedAt !== null
        && snapshot.providerCallId === null
      ) {
        throw new Error("Phone call provider start is still in progress.");
      }
      await deletionPrisma.hostedMember.delete({ where: { id: ownerMemberId } });
    })();
    const deletionOutcome = deletion.then(
      () => ({ status: "deleted" as const }),
      (error: unknown) => ({ error, status: "blocked" as const }),
    );

    const backendPid = await deletionBackendPid.promise;
    const deletionWasBlocked = await waitForPostgresBlock({
      backendPid,
      prisma: observerPrisma,
    });
    expect(runtimeStartCalls).toEqual([]);

    releasePreflight.resolve();
    const snapshot = await deletionSnapshot.promise;

    expect(deletionWasBlocked).toBe(true);
    expect(snapshot.providerCallId).toBeNull();
    expect(snapshot.providerStartAttemptedAt).toBeInstanceOf(Date);
    const outcome = await deletionOutcome;
    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") {
      throw new Error("Expected deletion to fail closed.");
    }
    expect(outcome.error).toEqual(new Error(
      "Phone call provider start is still in progress.",
    ));
    await expect(deletionPrisma.hostedMember.findUnique({
      where: { id: ownerMemberId },
    })).resolves.not.toBeNull();
    await expect(deletionPrisma.hostedPhoneCall.findUnique({
      where: { id: phoneCallId },
    })).resolves.not.toBeNull();

    await providerStartEntered.promise;
    expect(runtimeStartCalls).toEqual([phoneCallId]);
    releaseProviderStart.resolve();
    await expect(startup).resolves.toMatchObject({ status: "calling" });
  });

  it.each(["member_a", "member_b"] as const)(
    "makes provider preflight observe a verified phone update that wins the %s lock",
    async (changedSide) => {
      const phoneWritePrisma = clients[0]!;
      const providerPrisma = clients[1]!;
      const observerPrisma = clients[2]!;
      const memberBId = `member_phone_peer_${randomUUID().replaceAll("-", "")}`;
      memberIds.push(memberBId);
      await phoneWritePrisma.hostedMember.create({
        data: {
          billingStatus: "active",
          id: memberBId,
        },
      });
      const originalPhones = {
        member_a: "+15551001001",
        member_b: "+15551001002",
      } as const;
      const updatedPhone = changedSide === "member_a"
        ? "+15551001003"
        : "+15551001004";
      await phoneWritePrisma.$transaction(async (tx) => {
        await writeVerifiedPhoneTx({
          memberId,
          phoneNumber: originalPhones.member_a,
          prisma: tx,
        });
        await writeVerifiedPhoneTx({
          memberId: memberBId,
          phoneNumber: originalPhones.member_b,
          prisma: tx,
        });
      });
      const initialMemberAPhone = await resolveVerifiedMemberTransferNumber({
        memberId,
        prisma: providerPrisma,
      });
      const initialMemberBPhone = await resolveVerifiedMemberTransferNumber({
        memberId: memberBId,
        prisma: providerPrisma,
      });
      expect(initialMemberAPhone).toBe(originalPhones.member_a);
      expect(initialMemberBPhone).toBe(originalPhones.member_b);

      const changedMemberId = changedSide === "member_a" ? memberId : memberBId;
      const phoneWriteLocked = createDeferred<void>();
      const releasePhoneWrite = createDeferred<void>();
      const phoneWrite = phoneWritePrisma.$transaction(async (tx) => {
        await lockHostedMemberRow(tx, changedMemberId);
        await writeVerifiedPhoneTx({
          memberId: changedMemberId,
          phoneNumber: updatedPhone,
          prisma: tx,
        });
        phoneWriteLocked.resolve();
        await releasePhoneWrite.promise;
      });
      await phoneWriteLocked.promise;

      const providerBackendPid = createDeferred<number>();
      const providerPreflight = providerPrisma.$transaction(async (tx) => {
        const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
          select pg_backend_pid()::int as pid
        `;
        if (!backend) throw new Error("Missing PostgreSQL backend pid.");
        providerBackendPid.resolve(backend.pid);
        for (const currentMemberId of [memberId, memberBId].sort()) {
          await lockHostedMemberRow(tx, currentMemberId);
        }
        const [currentMemberAPhone, currentMemberBPhone] = await Promise.all([
          resolveVerifiedMemberTransferNumber({
            memberId,
            prisma: tx,
          }),
          resolveVerifiedMemberTransferNumber({
            memberId: memberBId,
            prisma: tx,
          }),
        ]);
        return {
          accepted:
            currentMemberAPhone === initialMemberAPhone
            && currentMemberBPhone === initialMemberBPhone,
          currentMemberAPhone,
          currentMemberBPhone,
        };
      });

      expect(await waitForPostgresBlock({
        backendPid: await providerBackendPid.promise,
        prisma: observerPrisma,
      })).toBe(true);
      releasePhoneWrite.resolve();
      await expect(phoneWrite).resolves.toBeUndefined();
      await expect(providerPreflight).resolves.toEqual({
        accepted: false,
        currentMemberAPhone: changedSide === "member_a"
          ? updatedPhone
          : originalPhones.member_a,
        currentMemberBPhone: changedSide === "member_b"
          ? updatedPhone
          : originalPhones.member_b,
      });
    },
  );

  it("makes proposal creation observe a preference update that wins the member lock", async () => {
    const preferencePrisma = clients[0]!;
    const proposalPrisma = clients[1]!;
    const observerPrisma = clients[2]!;
    const memberBId = `member_preference_${randomUUID().replaceAll("-", "")}`;
    const groupId = `group_preference_${randomUUID().replaceAll("-", "")}`;
    const participantAId = `participant_a_${randomUUID().replaceAll("-", "")}`;
    const participantBId = `participant_b_${randomUUID().replaceAll("-", "")}`;
    const now = new Date("2026-07-06T15:00:00.000Z");
    const originalWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "17:30",
      startLocalTime: "17:00",
    };
    const updatedWindow = {
      dayOfWeek: 1 as const,
      endLocalTime: "18:30",
      startLocalTime: "18:00",
    };
    const originalPreferences = {
      cadence: "weekly" as const,
      memberCadences: [],
      timeZone: "UTC",
      windows: [originalWindow],
    };
    memberIds.push(memberBId);
    groupIds.push(groupId);

    await preferencePrisma.hostedMember.create({
      data: {
        billingStatus: "active",
        id: memberBId,
      },
    });
    await preferencePrisma.hostedGroup.create({
      data: {
        id: groupId,
        kind: "call_circle_test",
        ownerMemberId: memberId,
      },
    });
    await preferencePrisma.hostedGroupMember.createMany({
      data: [memberId, memberBId].map((currentMemberId) => ({
        groupId,
        id: `membership_${randomUUID().replaceAll("-", "")}`,
        joinedAt: now,
        memberId: currentMemberId,
      })),
    });
    await preferencePrisma.hostedCallCircleParticipant.createMany({
      data: [
        {
          groupId,
          id: participantAId,
          memberId,
          nextMatchingAt: now,
          preferencesJson: originalPreferences,
        },
        {
          groupId,
          id: participantBId,
          memberId: memberBId,
          nextMatchingAt: now,
          preferencesJson: originalPreferences,
        },
      ],
    });

    const preferenceLockEntered = createDeferred<void>();
    const releasePreferenceLock = createDeferred<void>();
    const proposalBackendPid = createDeferred<number>();
    const preferenceWrite = preferencePrisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, memberId);
      preferenceLockEntered.resolve();
      await releasePreferenceLock.promise;
      return await writeCallCirclePreferences({
        groupId,
        memberId,
        now,
        patch: { windows: [updatedWindow] },
        prisma: tx,
      });
    });
    await preferenceLockEntered.promise;

    const proposal = proposalPrisma.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`
        select pg_backend_pid()::int as pid
      `;
      if (!backend) throw new Error("Missing PostgreSQL backend pid.");
      proposalBackendPid.resolve(backend.pid);
      return await createCallCircleMatchProposal({
        proposal: {
          groupId,
          memberAId: memberId,
          memberBId,
          now,
          windowEndAt: new Date("2026-07-06T17:15:00.000Z"),
          windowStartAt: new Date("2026-07-06T17:00:00.000Z"),
        },
        prisma: tx,
      });
    });

    expect(await waitForPostgresBlock({
      backendPid: await proposalBackendPid.promise,
      prisma: observerPrisma,
    })).toBe(true);

    releasePreferenceLock.resolve();
    await expect(preferenceWrite).resolves.toBe("updated");
    await expect(proposal).resolves.toBeNull();
    await expect(preferencePrisma.hostedCallCircleMatch.count({
      where: { groupId },
    })).resolves.toBe(0);
    await expect(preferencePrisma.hostedCallCircleParticipant.findUniqueOrThrow({
      select: { preferencesJson: true },
      where: { groupId_memberId: { groupId, memberId } },
    })).resolves.toMatchObject({
      preferencesJson: expect.objectContaining({ windows: [updatedWindow] }),
    });
  });
});

async function writeVerifiedPhoneTx(input: {
  memberId: string;
  phoneNumber: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const phoneLookupKey = createHostedPhoneLookupKey(input.phoneNumber);
  if (!phoneLookupKey) throw new Error("Verified phone test seed requires a lookup key.");
  const phoneNumberEncrypted = `hsb-test:${Buffer.from(JSON.stringify({
    lane: "hosted-member-private-field",
    scope:
      "hosted-member-private-field:hosted-member-identity.phone-number",
    userId: input.memberId,
    value: input.phoneNumber,
  }), "utf8").toString("base64url")}`;
  await input.prisma.hostedMemberIdentity.upsert({
    create: {
      maskedPhoneNumberHint: readHostedPhoneHint(input.phoneNumber),
      memberId: input.memberId,
      phoneLookupKey,
      phoneNumberEncrypted,
      phoneNumberVerifiedAt: new Date("2026-07-06T14:00:00.000Z"),
    },
    update: {
      maskedPhoneNumberHint: readHostedPhoneHint(input.phoneNumber),
      phoneLookupKey,
      phoneNumberEncrypted,
      phoneNumberVerifiedAt: new Date("2026-07-06T14:00:00.000Z"),
    },
    where: { memberId: input.memberId },
  });
}

async function seedActiveFamilySponsorship(input: {
  beneficiaryMemberId: string;
  groupId: string;
  ownerMemberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedMember.createMany({
    data: [
      {
        billingStatus: "not_started",
        id: input.beneficiaryMemberId,
      },
      {
        billingStatus: "active",
        id: input.ownerMemberId,
      },
    ],
  });
  await input.prisma.hostedAccountGroup.create({
    data: {
      billingStatus: "active",
      id: input.groupId,
      ownerMemberId: input.ownerMemberId,
    },
  });
  await input.prisma.hostedAccountGroupMembership.createMany({
    data: [
      {
        groupId: input.groupId,
        id: `hbagm_owner_${randomUUID().replaceAll("-", "")}`,
        joinedAt: new Date(),
        memberId: input.ownerMemberId,
        role: "owner",
        status: "active",
      },
      {
        groupId: input.groupId,
        id: `hbagm_beneficiary_${randomUUID().replaceAll("-", "")}`,
        joinedAt: new Date(),
        memberId: input.beneficiaryMemberId,
        role: "member",
        status: "active",
      },
    ],
  });
}

async function deleteOwnedFamilySponsorshipTx(input: {
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const groups = await input.tx.hostedAccountGroup.findMany({
    orderBy: { id: "asc" },
    select: { id: true },
    where: { ownerMemberId: input.ownerMemberId },
  });
  for (const group of groups) {
    await lockHostedAccountGroupRow(input.tx, group.id);
  }
  const beneficiaryRows = await input.tx.hostedAccountGroupMembership.findMany({
    orderBy: { memberId: "asc" },
    select: { memberId: true },
    where: {
      group: { ownerMemberId: input.ownerMemberId },
      status: "active",
    },
  });
  const fenceMemberIds = [
    ...new Set([
      input.ownerMemberId,
      ...beneficiaryRows.map((row) => row.memberId),
    ]),
  ].sort();
  for (const currentMemberId of fenceMemberIds) {
    await lockHostedMemberRow(input.tx, currentMemberId);
  }
  await input.tx.hostedAccountGroupMembership.deleteMany({
    where: { group: { ownerMemberId: input.ownerMemberId } },
  });
  await input.tx.hostedAccountGroup.deleteMany({
    where: { ownerMemberId: input.ownerMemberId },
  });
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
