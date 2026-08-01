import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  hasActivationProof: vi.fn(),
  readWake: vi.fn(),
  resolveSenderMemberId: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxConversationWakeByAssistantInputId: mocks.readWake,
}));
vi.mock("@/src/lib/hosted-onboarding/member-activation", () => ({
  hasHostedMemberActivationProof: mocks.hasActivationProof,
}));
vi.mock("@/src/lib/hosted-groups/group-message-sender", () => ({
  resolveHostedGroupMessageSenderMemberId: mocks.resolveSenderMemberId,
}));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

const ORIGIN_ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;
const PARTICIPANT_MEMBER_ID = "member_group_participant";
const ROUTE_AUTHORITY = {
  accountLookupKey: "group_account",
  channel: "linq",
  containerMemberId: "member_group_container",
  threadId: "group_thread",
} satisfies HostedExecutionExternalThreadRouteAuthority;
const WAKE = {
  userId: ROUTE_AUTHORITY.containerMemberId,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readWake.mockResolvedValue(WAKE);
  mocks.resolveSenderMemberId.mockResolvedValue(PARTICIPANT_MEMBER_ID);
  mocks.hasActivationProof.mockResolvedValue(true);
});

describe("hosted group participant action authority", () => {
  it("accepts one exact current, unsuspended, activated participant", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      member: { suspendedAt: null },
      memberId: PARTICIPANT_MEMBER_ID,
    }]);
    const {
      assertHostedGroupParticipantActionOriginHasOwnMurph,
    } = await import(
      "@/src/lib/hosted-groups/participant-action-authority"
    );
    mocks.getPrisma.mockReturnValue({
      hostedGroupMember: { findMany },
    });

    await expect(
      assertHostedGroupParticipantActionOriginHasOwnMurph({
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        routeAuthority: ROUTE_AUTHORITY,
      }),
    ).resolves.toBe(PARTICIPANT_MEMBER_ID);
    expect(mocks.readWake).toHaveBeenCalledWith({
      assistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
      memberId: ROUTE_AUTHORITY.containerMemberId,
      prisma: expect.anything(),
    });
    expect(mocks.resolveSenderMemberId).toHaveBeenCalledWith({
      prisma: expect.anything(),
      routeAuthority: ROUTE_AUTHORITY,
      wake: WAKE,
    });
    expect(findMany).toHaveBeenCalledWith({
      select: {
        member: { select: { suspendedAt: true } },
        memberId: true,
      },
      take: 2,
      where: {
        group: {
          is: { runtimeMemberId: ROUTE_AUTHORITY.containerMemberId },
        },
        joinedAt: { not: null },
        memberId: PARTICIPANT_MEMBER_ID,
      },
    });
  });

  it.each([
    ["the trusted wake is absent", null, PARTICIPANT_MEMBER_ID, true],
    ["the sender is not a current member", WAKE, PARTICIPANT_MEMBER_ID, false],
    ["the current member is not activated", WAKE, PARTICIPANT_MEMBER_ID, true],
  ])("rejects when %s", async (_label, wake, senderMemberId, currentMember) => {
    mocks.readWake.mockResolvedValue(wake);
    mocks.resolveSenderMemberId.mockResolvedValue(senderMemberId);
    mocks.hasActivationProof.mockResolvedValue(false);
    const findMany = vi.fn().mockResolvedValue(
      currentMember
        ? [{
            member: { suspendedAt: null },
            memberId: PARTICIPANT_MEMBER_ID,
          }]
        : [],
    );
    const {
      assertHostedGroupParticipantActionOriginHasOwnMurph,
    } = await import(
      "@/src/lib/hosted-groups/participant-action-authority"
    );
    mocks.getPrisma.mockReturnValue({
      hostedGroupMember: { findMany },
    });

    await expect(
      assertHostedGroupParticipantActionOriginHasOwnMurph({
        originAssistantInputId: ORIGIN_ASSISTANT_INPUT_ID,
        routeAuthority: ROUTE_AUTHORITY,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_GROUP_PARTICIPANT_ACTION_AUTHORITY_REQUIRED",
      httpStatus: 403,
      retryable: false,
    });
  });
});
