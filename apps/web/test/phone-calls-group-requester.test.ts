import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  type HostedExecutionExternalThreadRouteAuthority,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertHostedGroupPhoneCallRequesterHasOwnMurph,
} from "@/src/lib/phone-calls/group-requester";

const requesterMocks = vi.hoisted(() => ({
  hasHostedMemberActivationProof: vi.fn(),
  lookupHostedGroupParticipantMemberByHandle: vi.fn(),
  readHostedMailboxWakeByItemId: vi.fn(),
  resolveHostedMemberRoutingByTelegramUserId: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-mailbox/store")
  >("@/src/lib/hosted-mailbox/store");
  return {
    ...actual,
    readHostedMailboxWakeByItemId:
      requesterMocks.readHostedMailboxWakeByItemId,
  };
});

vi.mock("@/src/lib/hosted-groups/participant-member", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-groups/participant-member")
  >("@/src/lib/hosted-groups/participant-member");
  return {
    ...actual,
    lookupHostedGroupParticipantMemberByHandle:
      requesterMocks.lookupHostedGroupParticipantMemberByHandle,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-routing-store")
  >("@/src/lib/hosted-onboarding/hosted-member-routing-store");
  return {
    ...actual,
    resolveHostedMemberRoutingByTelegramUserId:
      requesterMocks.resolveHostedMemberRoutingByTelegramUserId,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-activation", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-activation")
  >("@/src/lib/hosted-onboarding/member-activation");
  return {
    ...actual,
    hasHostedMemberActivationProof:
      requesterMocks.hasHostedMemberActivationProof,
  };
});

const LINQ_ROUTE_AUTHORITY = {
  accountLookupKey: "linq-account-key",
  channel: "linq",
  containerMemberId: "group-runtime-member",
  threadId: "linq-group-thread",
} satisfies HostedExecutionExternalThreadRouteAuthority;

const TELEGRAM_ROUTE_AUTHORITY = {
  channel: "telegram",
  containerMemberId: "group-runtime-member",
  threadId: "telegram-group-thread",
} satisfies HostedExecutionExternalThreadRouteAuthority;

describe("group phone-call requester activation", () => {
  beforeEach(() => {
    requesterMocks.hasHostedMemberActivationProof.mockReset();
    requesterMocks.lookupHostedGroupParticipantMemberByHandle.mockReset();
    requesterMocks.readHostedMailboxWakeByItemId.mockReset();
    requesterMocks.resolveHostedMemberRoutingByTelegramUserId.mockReset();
  });

  it("rejects missing mailbox provenance", async () => {
    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      inboundMailboxItemIds: [],
      prisma: {} as never,
      routeAuthority: LINQ_ROUTE_AUTHORITY,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_PROVENANCE_REQUIRED",
    });
    expect(requesterMocks.readHostedMailboxWakeByItemId).not.toHaveBeenCalled();
  });

  it("accepts an activated Linq participant derived from the trusted mailbox wake", async () => {
    requesterMocks.readHostedMailboxWakeByItemId.mockResolvedValue(
      buildLinqGroupWake({
        eventId: "mailbox_linq",
        from: "+12125550123",
      }),
    );
    requesterMocks.lookupHostedGroupParticipantMemberByHandle.mockResolvedValue({
      core: { id: "member_linq_requester" },
    });
    requesterMocks.hasHostedMemberActivationProof.mockResolvedValue(true);

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      inboundMailboxItemIds: ["mailbox_linq"],
      prisma: {} as never,
      routeAuthority: LINQ_ROUTE_AUTHORITY,
    })).resolves.toBeUndefined();

    expect(
      requesterMocks.lookupHostedGroupParticipantMemberByHandle,
    ).toHaveBeenCalledWith({
      handle: "+12125550123",
      prisma: {},
    });
    expect(requesterMocks.hasHostedMemberActivationProof).toHaveBeenCalledWith({
      memberId: "member_linq_requester",
      prisma: {},
    });
  });

  it("accepts an activated Telegram participant through the canonical Telegram binding", async () => {
    requesterMocks.readHostedMailboxWakeByItemId.mockResolvedValue(
      buildTelegramGroupWake({
        eventId: "mailbox_telegram",
        from: "telegram-user-123",
      }),
    );
    requesterMocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: {
        core: { id: "member_telegram_requester" },
      },
      status: "found",
    });
    requesterMocks.hasHostedMemberActivationProof.mockResolvedValue(true);

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      inboundMailboxItemIds: ["mailbox_telegram"],
      prisma: {} as never,
      routeAuthority: TELEGRAM_ROUTE_AUTHORITY,
    })).resolves.toBeUndefined();

    expect(
      requesterMocks.resolveHostedMemberRoutingByTelegramUserId,
    ).toHaveBeenCalledWith({
      prisma: {},
      telegramUserId: "telegram-user-123",
    });
    expect(requesterMocks.hasHostedMemberActivationProof).toHaveBeenCalledWith({
      memberId: "member_telegram_requester",
      prisma: {},
    });
  });

  it("rejects mailbox evidence from a different group route", async () => {
    requesterMocks.readHostedMailboxWakeByItemId.mockResolvedValue(
      buildLinqGroupWake({
        eventId: "mailbox_wrong_route",
        from: "+12125550123",
      }),
    );

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      inboundMailboxItemIds: ["mailbox_wrong_route"],
      prisma: {} as never,
      routeAuthority: {
        ...LINQ_ROUTE_AUTHORITY,
        threadId: "another-group-thread",
      },
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_PROVENANCE_REQUIRED",
    });
    expect(
      requesterMocks.lookupHostedGroupParticipantMemberByHandle,
    ).not.toHaveBeenCalled();
  });

  it("rejects an unresolvable group requester", async () => {
    requesterMocks.readHostedMailboxWakeByItemId.mockResolvedValue(
      buildLinqGroupWake({
        eventId: "mailbox_unresolved",
        from: "+12125550123",
      }),
    );
    requesterMocks.lookupHostedGroupParticipantMemberByHandle.mockResolvedValue(
      null,
    );

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      inboundMailboxItemIds: ["mailbox_unresolved"],
      prisma: {} as never,
      routeAuthority: LINQ_ROUTE_AUTHORITY,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_PROVENANCE_REQUIRED",
    });
    expect(requesterMocks.hasHostedMemberActivationProof).not.toHaveBeenCalled();
  });

  it("rejects a resolved requester without Murph activation proof", async () => {
    requesterMocks.readHostedMailboxWakeByItemId.mockResolvedValue(
      buildTelegramGroupWake({
        eventId: "mailbox_unactivated",
        from: "telegram-user-123",
      }),
    );
    requesterMocks.resolveHostedMemberRoutingByTelegramUserId.mockResolvedValue({
      lookup: {
        core: { id: "member_unactivated" },
      },
      status: "found",
    });
    requesterMocks.hasHostedMemberActivationProof.mockResolvedValue(false);

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      inboundMailboxItemIds: ["mailbox_unactivated"],
      prisma: {} as never,
      routeAuthority: TELEGRAM_ROUTE_AUTHORITY,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_ACTIVATION_REQUIRED",
    });
  });

  it("rejects mailbox evidence that resolves to more than one requester", async () => {
    const wakes = new Map<string, HostedExecutionWake>([
      ["mailbox_one", buildLinqGroupWake({
        eventId: "mailbox_one",
        from: "+12125550111",
      })],
      ["mailbox_two", buildLinqGroupWake({
        eventId: "mailbox_two",
        from: "+12125550222",
      })],
    ]);
    requesterMocks.readHostedMailboxWakeByItemId.mockImplementation(
      async ({ mailboxItemId }: { mailboxItemId: string }) =>
        wakes.get(mailboxItemId) ?? null,
    );
    requesterMocks.lookupHostedGroupParticipantMemberByHandle.mockImplementation(
      async ({ handle }: { handle: string }) => ({
        core: {
          id: handle.endsWith("111") ? "member_one" : "member_two",
        },
      }),
    );

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      inboundMailboxItemIds: ["mailbox_one", "mailbox_two"],
      prisma: {} as never,
      routeAuthority: LINQ_ROUTE_AUTHORITY,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_PROVENANCE_REQUIRED",
    });
    expect(requesterMocks.hasHostedMemberActivationProof).not.toHaveBeenCalled();
  });
});

function buildLinqGroupWake(input: {
  eventId: string;
  from: string;
}) {
  return buildHostedExecutionLinqConversationMessageWake({
    accountLookupKey: "linq-account-key",
    contactKind: "phone",
    contactLookupKey: "sender-contact-lookup",
    eventId: input.eventId,
    linqMessage: {
      chatId: "linq-group-thread",
      from: input.from,
      isFromMe: false,
      messageId: input.eventId,
      parts: [{ type: "text", value: "Please make the call." }],
      threadIsDirect: false,
    },
    occurredAt: "2026-07-25T12:00:00.000Z",
    routeAuthority: LINQ_ROUTE_AUTHORITY,
    userId: "group-runtime-member",
  });
}

function buildTelegramGroupWake(input: {
  eventId: string;
  from: string;
}) {
  return buildHostedExecutionTelegramConversationMessageWake({
    eventId: input.eventId,
    occurredAt: "2026-07-25T12:00:00.000Z",
    routeAuthority: TELEGRAM_ROUTE_AUTHORITY,
    telegramMessage: {
      from: input.from,
      messageId: input.eventId,
      schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
      text: "Please make the call.",
      threadId: "telegram-group-thread",
      threadIsDirect: false,
    },
    userId: "group-runtime-member",
  });
}
