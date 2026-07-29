import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bindArmedHostedUsageReferralToNewContainerTx: vi.fn(),
  ensureHostedThreadContainerRouteTx: vi.fn(),
  hasActiveHostedLinqManagedLine: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readHostedRuntimeAiAccessDecision: vi.fn(),
  shouldIgnoreHostedLinqForLocalInboundGuard: vi.fn(),
}));

vi.mock("@/src/lib/hosted-growth/usage-referral", () => ({
  bindArmedHostedUsageReferralToNewContainerTx:
    mocks.bindArmedHostedUsageReferralToNewContainerTx,
}));

vi.mock("@/src/lib/hosted-routing/thread-container-service", () => ({
  ensureHostedThreadContainerRouteTx:
    mocks.ensureHostedThreadContainerRouteTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber:
    mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    mocks.lookupHostedMemberByVerifiedEmailAddress,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  hasActiveHostedLinqManagedLine: mocks.hasActiveHostedLinqManagedLine,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", () => ({
  shouldIgnoreHostedLinqForLocalInboundGuard:
    mocks.shouldIgnoreHostedLinqForLocalInboundGuard,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  provisionHostedLinqParticipantAddedOwnerTx,
} from "@/src/lib/hosted-onboarding/linq-participant-added-owner";

const CHAT_ID = "chat_existing_friends";
const LINE_PHONE = "+15550000000";
const ACTOR_PHONE = "+15551234567";
const CONTAINER_MEMBER_ID = "member_group_runtime_123";
const OWNER_MEMBER_ID = "member_owner_123";
const OCCURRED_AT = new Date("2026-07-29T05:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bindArmedHostedUsageReferralToNewContainerTx.mockResolvedValue({
    referralId: null,
  });
  mocks.ensureHostedThreadContainerRouteTx.mockResolvedValue({
    activationEventId: "member.activated:group",
    activationMailboxItemId: "mailbox_activation_123",
    containerMemberId: CONTAINER_MEMBER_ID,
    created: true,
    demotedMailboxConsumedAt: null,
  });
  mocks.hasActiveHostedLinqManagedLine.mockResolvedValue(true);
  mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
  mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
    core: {
      id: OWNER_MEMBER_ID,
      suspendedAt: null,
    },
  });
  mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });
  mocks.shouldIgnoreHostedLinqForLocalInboundGuard.mockReturnValue(false);
});

describe("provisionHostedLinqParticipantAddedOwnerTx", () => {
  it("binds the canonical route to the attributed adder", async () => {
    const prisma = {} as never;

    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      chatId: CHAT_ID,
      evidence: {
        addedByHandle: ACTOR_PHONE,
        linePhoneNumber: LINE_PHONE,
      },
      eventId: "evt_murph_added",
      occurredAt: OCCURRED_AT,
      prisma,
    })).resolves.toBe("owner_bound");

    expect(mocks.ensureHostedThreadContainerRouteTx).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "linq",
        mailboxDedupeKey: "evt_murph_added",
        occurredAt: OCCURRED_AT,
        ownerMemberId: OWNER_MEMBER_ID,
        prisma,
        threadId: CHAT_ID,
      }),
    );
    expect(
      mocks.bindArmedHostedUsageReferralToNewContainerTx,
    ).toHaveBeenCalledWith({
      occurredAt: OCCURRED_AT,
      ownerMemberId: OWNER_MEMBER_ID,
      targetContainerMemberId: CONTAINER_MEMBER_ID,
      tx: prisma,
    });
  });

  it("does not bind a route when the actor is unresolved", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue(null);

    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      chatId: CHAT_ID,
      evidence: {
        addedByHandle: ACTOR_PHONE,
        linePhoneNumber: LINE_PHONE,
      },
      eventId: "evt_murph_added",
      occurredAt: OCCURRED_AT,
      prisma: {} as never,
    })).resolves.toBe("actor_unresolved");

    expect(mocks.ensureHostedThreadContainerRouteTx).not.toHaveBeenCalled();
  });

  it("fails closed before identity lookup for an unmanaged line", async () => {
    mocks.hasActiveHostedLinqManagedLine.mockResolvedValue(false);

    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      chatId: CHAT_ID,
      evidence: {
        addedByHandle: ACTOR_PHONE,
        linePhoneNumber: LINE_PHONE,
      },
      eventId: "evt_murph_added",
      occurredAt: OCCURRED_AT,
      prisma: {} as never,
    })).resolves.toBe("line_unmanaged");

    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.ensureHostedThreadContainerRouteTx).not.toHaveBeenCalled();
  });

  it("never reassigns a route already bound by another owner", async () => {
    mocks.ensureHostedThreadContainerRouteTx.mockRejectedValue(
      hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
        httpStatus: 409,
        message: "already bound",
        retryable: false,
      }),
    );

    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      chatId: CHAT_ID,
      evidence: {
        addedByHandle: ACTOR_PHONE,
        linePhoneNumber: LINE_PHONE,
      },
      eventId: "evt_murph_added",
      occurredAt: OCCURRED_AT,
      prisma: {} as never,
    })).resolves.toBe("route_already_bound");

    expect(
      mocks.bindArmedHostedUsageReferralToNewContainerTx,
    ).not.toHaveBeenCalled();
  });
});
