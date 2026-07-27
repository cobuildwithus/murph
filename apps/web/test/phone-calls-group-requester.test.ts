import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertHostedGroupPhoneCallRequesterHasOwnMurph,
} from "@/src/lib/phone-calls/group-requester";

const requesterMocks = vi.hoisted(() => ({
  hasHostedMemberActivationProof: vi.fn(),
  lookupHostedGroupParticipantMemberByProviderEvidence: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/participant-member", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-groups/participant-member")
  >("@/src/lib/hosted-groups/participant-member");
  return {
    ...actual,
    lookupHostedGroupParticipantMemberByProviderEvidence:
      requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence,
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

const LINQ_REQUESTER = {
  assistantInputId: `ain_${"1".repeat(32)}`,
  senderHandle: "+12125550123",
  source: "linq" as const,
};

const TELEGRAM_REQUESTER = {
  assistantInputId: `ain_${"2".repeat(32)}`,
  senderHandle: "telegram-user-123",
  source: "telegram" as const,
};

describe("group phone-call requester activation", () => {
  beforeEach(() => {
    requesterMocks.hasHostedMemberActivationProof.mockReset();
    requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence.mockReset();
  });

  it.each([
    ["missing requester", null, LINQ_ROUTE_AUTHORITY],
    [
      "provider mismatch",
      TELEGRAM_REQUESTER,
      LINQ_ROUTE_AUTHORITY,
    ],
    [
      "malformed accepted input ref",
      { ...LINQ_REQUESTER, assistantInputId: "provider-message-id" },
      LINQ_ROUTE_AUTHORITY,
    ],
    [
      "missing sender evidence",
      { ...LINQ_REQUESTER, senderHandle: "   " },
      LINQ_ROUTE_AUTHORITY,
    ],
  ] as const)("rejects %s before member resolution", async (
    _case,
    groupRequester,
    routeAuthority,
  ) => {
    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      groupRequester,
      prisma: {} as never,
      routeAuthority,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_ACTIVATION_REQUIRED",
    });
    expect(
      requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["Linq", LINQ_REQUESTER, LINQ_ROUTE_AUTHORITY, "member_linq_requester"],
    [
      "Telegram",
      TELEGRAM_REQUESTER,
      TELEGRAM_ROUTE_AUTHORITY,
      "member_telegram_requester",
    ],
  ] as const)("accepts an activated %s participant selected by exact provider evidence", async (
    _provider,
    groupRequester,
    routeAuthority,
    memberId,
  ) => {
    requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence
      .mockResolvedValue({ core: { id: memberId } });
    requesterMocks.hasHostedMemberActivationProof.mockResolvedValue(true);
    const prisma = {};

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      groupRequester,
      prisma: prisma as never,
      routeAuthority,
    })).resolves.toBeUndefined();

    expect(
      requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence,
    ).toHaveBeenCalledWith({
      participant: groupRequester,
      prisma,
    });
    expect(requesterMocks.hasHostedMemberActivationProof).toHaveBeenCalledWith({
      memberId,
      prisma,
    });
  });

  it("normalizes trusted sender evidence without changing the accepted message identity", async () => {
    requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence
      .mockResolvedValue({ core: { id: "member_linq_requester" } });
    requesterMocks.hasHostedMemberActivationProof.mockResolvedValue(true);
    const prisma = {};

    await assertHostedGroupPhoneCallRequesterHasOwnMurph({
      groupRequester: {
        ...LINQ_REQUESTER,
        senderHandle: "  +12125550123  ",
      },
      prisma: prisma as never,
      routeAuthority: LINQ_ROUTE_AUTHORITY,
    });

    expect(
      requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence,
    ).toHaveBeenCalledWith({
      participant: LINQ_REQUESTER,
      prisma,
    });
  });

  it("rejects an unresolvable provider sender", async () => {
    requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence
      .mockResolvedValue(null);
    const prisma = {};

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      groupRequester: LINQ_REQUESTER,
      prisma: prisma as never,
      routeAuthority: LINQ_ROUTE_AUTHORITY,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_ACTIVATION_REQUIRED",
    });
    expect(requesterMocks.hasHostedMemberActivationProof).not.toHaveBeenCalled();
  });

  it("rejects a resolved sender without durable Murph activation", async () => {
    requesterMocks.lookupHostedGroupParticipantMemberByProviderEvidence
      .mockResolvedValue({ core: { id: "member_unactivated" } });
    requesterMocks.hasHostedMemberActivationProof.mockResolvedValue(false);
    const prisma = {};

    await expect(assertHostedGroupPhoneCallRequesterHasOwnMurph({
      groupRequester: TELEGRAM_REQUESTER,
      prisma: prisma as never,
      routeAuthority: TELEGRAM_ROUTE_AUTHORITY,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_ACTIVATION_REQUIRED",
    });
  });
});
