import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencyMocks = vi.hoisted(() => ({
  getHostedLinqChatSummary: vi.fn(),
  lookupHostedGroupParticipantMemberIdsByHandles: vi.fn(),
  readHostedMemberAddressBookAdvisoryNames: vi.fn(),
  readHostedRuntimeAiAllowedMemberIds: vi.fn(),
  readHostedThreadContainerLinqRouteAuthorities: vi.fn(),
}));

vi.mock("../src/lib/hosted-address-book/projection", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-address-book/projection")
  >(),
  readHostedMemberAddressBookAdvisoryNames:
    dependencyMocks.readHostedMemberAddressBookAdvisoryNames,
}));

vi.mock("../src/lib/hosted-onboarding/linq-client", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-onboarding/linq-client")
  >(),
  getHostedLinqChatSummary: dependencyMocks.getHostedLinqChatSummary,
}));

vi.mock("../src/lib/hosted-onboarding/member-access", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-onboarding/member-access")
  >(),
  readHostedRuntimeAiAllowedMemberIds:
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds,
}));

vi.mock("../src/lib/hosted-routing/assistant-notification-destination", async (
  importOriginal,
) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-routing/assistant-notification-destination")
  >(),
  readHostedThreadContainerLinqRouteAuthorities:
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities,
}));

vi.mock("../src/lib/hosted-groups/participant-member", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../src/lib/hosted-groups/participant-member")
  >(),
  lookupHostedGroupParticipantMemberIdsByHandles:
    dependencyMocks.lookupHostedGroupParticipantMemberIdsByHandles,
}));

import {
  createHostedGroupParticipantTargetDigest,
  participantTargetMatches,
  selectHostedGroupByParticipants,
} from "../src/lib/hosted-groups/group-participant-target";

const REQUESTER_MEMBER_ID = "member_requester";
const REQUESTER_PHONE = "+12125550000";

beforeEach(() => {
  vi.clearAllMocks();
  dependencyMocks.readHostedMemberAddressBookAdvisoryNames.mockResolvedValue({
    canonicalHandleCount: 0,
    contactMatchCount: 0,
    names: new Map(),
    outcome: "no_contact_match",
    requestedHandleCount: 0,
  });
  dependencyMocks.lookupHostedGroupParticipantMemberIdsByHandles
    .mockResolvedValue(new Map([[REQUESTER_PHONE, REQUESTER_MEMBER_ID]]));
});

function phone(value: string, displayName: string | null = null) {
  return {
    contact: { kind: "phone" as const, lookupKey: `phone:${value}`, value },
    displayName,
  };
}

describe("hosted group participant targeting", () => {
  it("matches contact aliases and masked phone hints without exposing full handles", () => {
    expect(participantTargetMatches({
      participants: [
        phone("+14155559876", "Taylor / Tay"),
        phone("+447700900456"),
      ],
      target: {
        participantCount: 2,
        participants: [
          { displayName: "tay" },
          { phoneHint: { lastFour: "0456" } },
        ],
      },
    })).toBe(true);
  });

  it("requires distinct roster people for distinct participant clues", () => {
    expect(participantTargetMatches({
      participants: [phone("+14155559876", "Taylor")],
      target: {
        participants: [{ displayName: "Taylor" }, { displayName: "Taylor" }],
      },
    })).toBe(false);
  });

  it("binds replay to normalized evidence independent of cue order", () => {
    const first = createHostedGroupParticipantTargetDigest({
      participantCount: 2,
      participants: [
        { displayName: " Taylor  " },
        { phoneHint: { areaCode: "415", lastFour: "9876" } },
      ],
    });
    const reordered = createHostedGroupParticipantTargetDigest({
      participantCount: 2,
      participants: [
        { phoneHint: { areaCode: "415", lastFour: "9876" } },
        { displayName: "taylor" },
      ],
    });

    expect(first).toBe(reordered);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("selects for a current non-owner member across more than 25 groups", async () => {
    const memberships = Array.from({ length: 26 }, (_, index) => ({
      group: {
        displayName: null,
        runtimeMemberId: `runtime_group_${index}`,
      },
      id: `membership_${index}`,
      memberId: REQUESTER_MEMBER_ID,
    }));
    const authorities = new Map(memberships.map(({ group }, index) => [
      group.runtimeMemberId,
      {
        accountLookupKey: "linq-account",
        channel: "linq" as const,
        containerMemberId: group.runtimeMemberId,
        threadId: `chat_${index}`,
      },
    ]));
    const prisma = {
      hostedGroupMember: {
        findMany: vi.fn(async () => memberships),
      },
    };
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set(memberships.map(({ group }) => group.runtimeMemberId)),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities,
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(),
      });
    dependencyMocks.getHostedLinqChatSummary.mockImplementation(
      async ({ chatId }: { chatId: string }) => {
        const index = Number(chatId.replace("chat_", ""));
        return {
          handleCount: 3,
          handles: [
            { handle: "+15550000000", isMe: true, status: "active" },
            { handle: REQUESTER_PHONE, isMe: false, status: "active" },
            {
              handle: `+1650555${String(1_000 + index)}`,
              isMe: false,
              status: "active",
            },
          ],
          handlesComplete: true,
          isGroup: true,
        };
      },
    );
    dependencyMocks.readHostedMemberAddressBookAdvisoryNames.mockResolvedValue({
      canonicalHandleCount: 26,
      contactMatchCount: 1,
      names: new Map([["+16505551017", "Jordan"]]),
      outcome: "matched",
      requestedHandleCount: 26,
    });

    await expect(selectHostedGroupByParticipants({
      memberId: REQUESTER_MEMBER_ID,
      now: new Date("2026-08-26T12:00:00.000Z"),
      participantTarget: {
        participantCount: 1,
        participants: [{ displayName: "Jordan" }],
      },
      prisma: prisma as never,
      requestedLabel: null,
    })).resolves.toMatchObject({
      membershipId: "membership_17",
      status: "selected",
      targetLabel: "1 person: Jordan",
      targetRuntimeMemberId: "runtime_group_17",
    });
    expect(dependencyMocks.readHostedMemberAddressBookAdvisoryNames)
      .toHaveBeenCalledWith(expect.objectContaining({
        memberId: REQUESTER_MEMBER_ID,
      }));
  });

  it("does not claim uniqueness when any eligible roster is incomplete", async () => {
    const memberships = [0, 1].map((index) => ({
      group: {
        displayName: null,
        runtimeMemberId: `runtime_group_${index}`,
      },
      id: `membership_${index}`,
      memberId: REQUESTER_MEMBER_ID,
    }));
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set(memberships.map(({ group }) => group.runtimeMemberId)),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities: new Map(memberships.map(({ group }, index) => [
          group.runtimeMemberId,
          {
            accountLookupKey: "linq-account",
            channel: "linq" as const,
            containerMemberId: group.runtimeMemberId,
            threadId: `chat_${index}`,
          },
        ])),
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(),
      });
    dependencyMocks.getHostedLinqChatSummary.mockImplementation(
      async ({ chatId }: { chatId: string }) => ({
        handleCount: 3,
        handles: [
          { handle: "+15550000000", isMe: true, status: "active" },
          { handle: REQUESTER_PHONE, isMe: false, status: "active" },
          { handle: "+16505551017", isMe: false, status: "active" },
        ],
        handlesComplete: chatId === "chat_0",
        isGroup: true,
      }),
    );
    const prisma = {
      hostedGroupMember: {
        findMany: vi.fn(async () => memberships),
      },
    };

    await expect(selectHostedGroupByParticipants({
      memberId: REQUESTER_MEMBER_ID,
      now: new Date("2026-08-26T12:00:00.000Z"),
      participantTarget: {
        participants: [{ phoneHint: { lastFour: "1017" } }],
      },
      prisma: prisma as never,
      requestedLabel: null,
    })).resolves.toEqual({
      participantTargetDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      result: {
        status: "unavailable",
        unavailableReason: "participant_evidence_unavailable",
      },
      status: "result",
    });
  });

  it("fails closed before provider reads above the live-scan ceiling", async () => {
    const prisma = {
      hostedGroupMember: {
        findMany: vi.fn(async () => Array.from({ length: 101 }, (_, index) => ({
          group: {
            displayName: null,
            runtimeMemberId: `runtime_group_${index}`,
          },
          id: `membership_${index}`,
          memberId: REQUESTER_MEMBER_ID,
        }))),
      },
    };

    await expect(selectHostedGroupByParticipants({
      memberId: REQUESTER_MEMBER_ID,
      now: new Date("2026-08-26T12:00:00.000Z"),
      participantTarget: { participantCount: 1 },
      prisma: prisma as never,
      requestedLabel: null,
    })).resolves.toMatchObject({
      result: {
        status: "unavailable",
        unavailableReason: "too_many_groups",
      },
      status: "result",
    });
    expect(dependencyMocks.readHostedRuntimeAiAllowedMemberIds)
      .not.toHaveBeenCalled();
    expect(dependencyMocks.getHostedLinqChatSummary).not.toHaveBeenCalled();
  });
});
