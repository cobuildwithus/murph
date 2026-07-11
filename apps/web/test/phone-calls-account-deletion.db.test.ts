import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { HostedPhoneCallBrief } from "@murphai/hosted-execution/phone-calls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCallCircleMatchProposal } from "@/src/lib/call-circle/match-store";
import { writeCallCirclePreferences } from "@/src/lib/call-circle/participant-store";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { createHostedPhoneCall } from "@/src/lib/phone-calls/service";
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
    await clients[0]?.hostedGroup.deleteMany({ where: { id: { in: groupIds } } });
    await clients[0]?.hostedMember.deleteMany({ where: { id: { in: memberIds } } });
    groupIds.length = 0;
    memberIds.length = 0;
    await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  });

  it("makes deletion wait for the provider marker transaction and observe its committed marker", async () => {
    const startupPrisma = clients[0]!;
    const deletionPrisma = clients[1]!;
    const observerPrisma = clients[2]!;
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
      start: async (call) => {
        runtimeStartCalls.push(call.id);
        providerStartEntered.resolve();
        await releaseProviderStart.promise;
        return { providerCallId: `provider_${call.id}` };
      },
      stop: async () => {},
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
          select 1 from "hosted_member" where "id" = ${memberId} for update
        `;
        await tx.hostedMember.update({
          data: { suspendedAt: new Date() },
          where: { id: memberId },
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
      await deletionPrisma.hostedMember.delete({ where: { id: memberId } });
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
      where: { id: memberId },
    })).resolves.not.toBeNull();
    await expect(deletionPrisma.hostedPhoneCall.findUnique({
      where: { id: phoneCallId },
    })).resolves.not.toBeNull();

    await providerStartEntered.promise;
    expect(runtimeStartCalls).toEqual([phoneCallId]);
    releaseProviderStart.resolve();
    await expect(startup).resolves.toMatchObject({ status: "calling" });
  });

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
