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
  readHostedGroupMembershipParticipantRosters,
} from "../src/lib/hosted-groups/group-membership-participants";
import {
  createHostedLinqParticipantContact,
} from "../src/lib/hosted-onboarding/linq-participant-contact";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const REQUESTER_MEMBER_ID = "member_requester";
const REQUESTER_PHONE = "+12125550100";
const PROVIDER_PHONE = "+15550000000";
const PROVIDER_LOOKUP_KEY = createHostedLinqParticipantContact({
  kind: "phone",
  value: PROVIDER_PHONE,
})?.lookupKey;

if (!PROVIDER_LOOKUP_KEY) {
  throw new TypeError("Synthetic provider phone must produce a lookup key.");
}

function membership(index: number) {
  return {
    membershipId: `membership_${index}`,
    runtimeMemberId: `runtime_${index}`,
  };
}

function route(
  runtimeMemberId: string,
  threadId: string,
  accountLookupKey = PROVIDER_LOOKUP_KEY,
) {
  return {
    accountLookupKey,
    channel: "linq" as const,
    containerMemberId: runtimeMemberId,
    threadId,
  };
}

function summary(otherHandles: string[]) {
  return {
    handleCount: otherHandles.length + 2,
    handles: [
      { handle: PROVIDER_PHONE, isMe: true, status: "active" },
      { handle: REQUESTER_PHONE, isMe: false, status: "active" },
      ...otherHandles.map((handle) => ({
        handle,
        isMe: false,
        status: "active",
      })),
    ],
    handlesComplete: true,
    isGroup: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencyMocks.lookupHostedGroupParticipantMemberIdsByHandles
    .mockResolvedValue(new Map([[REQUESTER_PHONE, REQUESTER_MEMBER_ID]]));
  dependencyMocks.readHostedMemberAddressBookAdvisoryNames.mockResolvedValue({
    canonicalHandleCount: 0,
    contactMatchCount: 0,
    names: new Map(),
    outcome: "no_contact_match",
    requestedHandleCount: 0,
  });
});

describe("joined-group participant inventory", () => {
  it("keeps provider and route failures local to their memberships", async () => {
    const memberships = [membership(1), membership(2), membership(3)];
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set(memberships.map(({ runtimeMemberId }) => runtimeMemberId)),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities: new Map([
          ["runtime_1", route("runtime_1", "chat_1")],
          ["runtime_2", route("runtime_2", "chat_2")],
        ]),
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(["runtime_3"]),
      });
    dependencyMocks.getHostedLinqChatSummary.mockImplementation(
      async ({ chatId }: { chatId: string }) => {
        if (chatId === "chat_2") {
          throw new Error("synthetic provider failure");
        }
        return summary(["+14155550101", "+14155550202"]);
      },
    );
    dependencyMocks.readHostedMemberAddressBookAdvisoryNames.mockResolvedValue({
      canonicalHandleCount: 2,
      contactMatchCount: 1,
      names: new Map([["+14155550101", "Taylor"]]),
      outcome: "matched",
      requestedHandleCount: 2,
    });

    const result = await readHostedGroupMembershipParticipantRosters({
      memberId: REQUESTER_MEMBER_ID,
      memberships,
      now: NOW,
      prisma: {} as never,
    });

    expect(result.get("membership_1")).toEqual({
      participantCount: 3,
      participantLabels: [
        { displayName: "Taylor" },
        { phoneHint: { areaCode: "415", lastFour: "0202" } },
      ],
      status: "available",
    });
    expect(result.get("membership_2")).toEqual({
      status: "unavailable",
      unavailableReason: "participant_roster_unavailable",
    });
    expect(result.get("membership_3")).toEqual({
      status: "unavailable",
      unavailableReason: "group_route_unavailable",
    });
  });

  it("falls back to masked phone and email labels when advisory names fail", async () => {
    const memberships = [membership(1)];
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set(["runtime_1"]),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities: new Map([["runtime_1", route("runtime_1", "chat_1")]]),
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(),
      });
    dependencyMocks.getHostedLinqChatSummary.mockResolvedValue(
      summary(["+442079460321", "person@example.test"]),
    );
    dependencyMocks.readHostedMemberAddressBookAdvisoryNames.mockRejectedValue(
      new Error("synthetic address-book failure"),
    );

    const result = await readHostedGroupMembershipParticipantRosters({
      memberId: REQUESTER_MEMBER_ID,
      memberships,
      now: NOW,
      prisma: {} as never,
    });

    expect(result.get("membership_1")).toEqual({
      participantCount: 3,
      participantLabels: [
        { phoneHint: { lastFour: "0321" } },
        { emailParticipant: true },
      ],
      status: "available",
    });
  });

  it("excludes the routed provider account when Linq does not mark it as self", async () => {
    const memberships = [membership(1), membership(2)];
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set(["runtime_1", "runtime_2"]),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities: new Map([
          ["runtime_1", route("runtime_1", "chat_1")],
          ["runtime_2", route("runtime_2", "chat_2")],
        ]),
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(),
      });
    dependencyMocks.getHostedLinqChatSummary.mockImplementation(
      async ({ chatId }: { chatId: string }) => {
        const chatSummary = summary([
          chatId === "chat_1" ? "+14155550101" : "+14155550202",
        ]);
        if (chatId === "chat_1") {
          const provider = chatSummary.handles[0];
          if (provider) {
            provider.isMe = false;
          }
        }
        return chatSummary;
      },
    );

    const result = await readHostedGroupMembershipParticipantRosters({
      memberId: REQUESTER_MEMBER_ID,
      memberships,
      now: NOW,
      prisma: {} as never,
    });

    expect(result.get("membership_1")).toEqual({
      participantCount: 2,
      participantLabels: [
        { phoneHint: { areaCode: "415", lastFour: "0101" } },
      ],
      status: "available",
    });
    expect(result.get("membership_2")).toEqual({
      participantCount: 2,
      participantLabels: [
        { phoneHint: { areaCode: "415", lastFour: "0202" } },
      ],
      status: "available",
    });
  });

  it("bounds live provider concurrency at four groups", async () => {
    const memberships = Array.from({ length: 9 }, (_, index) => membership(index));
    dependencyMocks.readHostedRuntimeAiAllowedMemberIds.mockResolvedValue(
      new Set(memberships.map(({ runtimeMemberId }) => runtimeMemberId)),
    );
    dependencyMocks.readHostedThreadContainerLinqRouteAuthorities
      .mockResolvedValue({
        authorities: new Map(memberships.map(({ runtimeMemberId }, index) => [
          runtimeMemberId,
          route(runtimeMemberId, `chat_${index}`),
        ])),
        nonLinqContainerMemberIds: new Set(),
        unavailableContainerMemberIds: new Set(),
      });
    let inFlight = 0;
    let maxInFlight = 0;
    dependencyMocks.getHostedLinqChatSummary.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return summary(["+14155550101"]);
    });

    await readHostedGroupMembershipParticipantRosters({
      memberId: REQUESTER_MEMBER_ID,
      memberships,
      now: NOW,
      prisma: {} as never,
    });

    expect(maxInFlight).toBe(4);
  });
});
