import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelOpenCallCircleMatchesForParticipant: vi.fn(),
  lockHostedGroupRow: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readHostedThreadRouteByThreadIdentity: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/match-store", () => ({
  cancelOpenCallCircleMatchesForParticipant:
    mocks.cancelOpenCallCircleMatchesForParticipant,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber:
    mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    mocks.lookupHostedMemberByVerifiedEmailAddress,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  lockHostedGroupRow: mocks.lockHostedGroupRow,
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  readHostedThreadRouteByThreadIdentity:
    mocks.readHostedThreadRouteByThreadIdentity,
}));

import { applyHostedLinqParticipantRemovalTx } from "@/src/lib/hosted-groups/linq-participant-removal";

describe("applyHostedLinqParticipantRemovalTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelOpenCallCircleMatchesForParticipant.mockResolvedValue(2);
    mocks.lockHostedGroupRow.mockResolvedValue(undefined);
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_123" },
    });
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue({
      containerMemberId: "container_123",
    });
  });

  it("removes group authority, participant projection, and open Call Circle work under one lock order", async () => {
    const trace: string[] = [];
    mocks.lockHostedGroupRow.mockImplementation(async () => {
      trace.push("lock-group");
    });
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      trace.push("lock-member");
    });
    mocks.cancelOpenCallCircleMatchesForParticipant.mockImplementation(async () => {
      trace.push("cancel-call-circle");
      return 2;
    });
    const tx = {
      hostedGroup: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: "group_123", runtimeMemberId: "container_123" })
          .mockResolvedValueOnce({ id: "group_123", runtimeMemberId: "container_123" }),
      },
      hostedGroupMember: {
        deleteMany: vi.fn(async () => {
          trace.push("delete-membership");
          return { count: 1 };
        }),
      },
      hostedThreadContainerParticipant: {
        updateMany: vi.fn(async () => {
          trace.push("mark-projection-removed");
          return { count: 1 };
        }),
      },
    };
    const removedAt = new Date("2026-07-12T12:00:00.000Z");

    await expect(applyHostedLinqParticipantRemovalTx({
      chatId: "chat_123",
      handle: "+15551234567",
      removedAt,
      tx: tx as never,
    })).resolves.toBe(true);

    expect(trace).toEqual([
      "lock-group",
      "lock-member",
      "delete-membership",
      "mark-projection-removed",
      "cancel-call-circle",
    ]);
    expect(mocks.readHostedThreadRouteByThreadIdentity).toHaveBeenCalledWith({
      channel: "linq",
      prisma: tx,
      threadId: "chat_123",
    });
    expect(tx.hostedGroupMember.deleteMany).toHaveBeenCalledWith({
      where: { groupId: "group_123", memberId: "member_123" },
    });
    expect(tx.hostedThreadContainerParticipant.updateMany).toHaveBeenCalledWith({
      data: { removedAt },
      where: {
        containerMemberId: "container_123",
        participantMemberId: "member_123",
        removedAt: null,
      },
    });
    expect(mocks.cancelOpenCallCircleMatchesForParticipant).toHaveBeenCalledWith({
      groupId: "group_123",
      memberId: "member_123",
      now: removedAt,
      prisma: tx,
    });
  });

  it("does not mutate group authority when the signed event has no canonical thread route", async () => {
    mocks.readHostedThreadRouteByThreadIdentity.mockResolvedValue(null);
    const tx = {
      hostedGroup: { findUnique: vi.fn() },
      hostedGroupMember: { deleteMany: vi.fn() },
      hostedThreadContainerParticipant: { updateMany: vi.fn() },
    };

    await expect(applyHostedLinqParticipantRemovalTx({
      chatId: "unknown_chat",
      handle: "+15551234567",
      removedAt: new Date("2026-07-12T12:00:00.000Z"),
      tx: tx as never,
    })).resolves.toBe(false);

    expect(tx.hostedGroup.findUnique).not.toHaveBeenCalled();
    expect(tx.hostedGroupMember.deleteMany).not.toHaveBeenCalled();
    expect(mocks.cancelOpenCallCircleMatchesForParticipant).not.toHaveBeenCalled();
  });

  it("fails closed if the provider handle resolves to another member after locking", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber
      .mockResolvedValueOnce({ core: { id: "member_123" } })
      .mockResolvedValueOnce({ core: { id: "member_456" } });
    const tx = {
      hostedGroup: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: "group_123", runtimeMemberId: "container_123" })
          .mockResolvedValueOnce({ id: "group_123", runtimeMemberId: "container_123" }),
      },
      hostedGroupMember: { deleteMany: vi.fn() },
      hostedThreadContainerParticipant: { updateMany: vi.fn() },
    };

    await expect(applyHostedLinqParticipantRemovalTx({
      chatId: "chat_123",
      handle: "+15551234567",
      removedAt: new Date("2026-07-12T12:00:00.000Z"),
      tx: tx as never,
    })).resolves.toBe(false);

    expect(tx.hostedGroupMember.deleteMany).not.toHaveBeenCalled();
    expect(mocks.cancelOpenCallCircleMatchesForParticipant).not.toHaveBeenCalled();
  });

  it("uses the verified-email identity owner for email participant handles", async () => {
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: { id: "member_123" },
    });
    const tx = {
      hostedGroup: {
        findUnique: vi.fn().mockResolvedValue({
          id: "group_123",
          runtimeMemberId: "container_123",
        }),
      },
      hostedGroupMember: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedThreadContainerParticipant: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await applyHostedLinqParticipantRemovalTx({
      chatId: "chat_123",
      handle: "member@example.test",
      removedAt: new Date("2026-07-12T12:00:00.000Z"),
      tx: tx as never,
    });

    expect(mocks.lookupHostedMemberByVerifiedEmailAddress).toHaveBeenCalledTimes(2);
    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
  });
});
