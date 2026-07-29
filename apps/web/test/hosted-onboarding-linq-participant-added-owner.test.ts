import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bindArmedHostedUsageReferralToNewContainerTx: vi.fn(),
  ensureHostedLinqThreadContainerRouteFromParticipantAddTx: vi.fn(),
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
  ensureHostedLinqThreadContainerRouteFromParticipantAddTx:
    mocks.ensureHostedLinqThreadContainerRouteFromParticipantAddTx,
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

import type {
  HostedLinqParticipantChangedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  hasHostedLinqParticipantAddedOwnerCandidate,
  isHostedLinqGroupOwnerFromAdderRequired,
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
  mocks.ensureHostedLinqThreadContainerRouteFromParticipantAddTx
    .mockResolvedValue({
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
      event: buildParticipantAddedEvent(),
      prisma,
    })).resolves.toBe("owner_bound");

    expect(
      mocks.ensureHostedLinqThreadContainerRouteFromParticipantAddTx,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it("accepts a managed line even when the provider omits participant is_me", async () => {
    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      event: buildParticipantAddedEvent({ participantIsMe: undefined }),
      prisma: {} as never,
    })).resolves.toBe("owner_bound");

    expect(mocks.hasActiveHostedLinqManagedLine).toHaveBeenCalledOnce();
  });

  it("selects the lock-safe owner path only after managed-line preflight", async () => {
    await expect(hasHostedLinqParticipantAddedOwnerCandidate({
      event: buildParticipantAddedEvent({ participantIsMe: undefined }),
      prisma: {} as never,
    })).resolves.toBe(true);

    expect(mocks.hasActiveHostedLinqManagedLine).toHaveBeenCalledOnce();
  });

  it("rejects explicit non-Murph participant evidence before line lookup", async () => {
    await expect(hasHostedLinqParticipantAddedOwnerCandidate({
      event: buildParticipantAddedEvent({ participantIsMe: false }),
      prisma: {} as never,
    })).resolves.toBe(false);
    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      event: buildParticipantAddedEvent({ participantIsMe: false }),
      prisma: {} as never,
    })).resolves.toBe("owner_evidence_missing");

    expect(mocks.hasActiveHostedLinqManagedLine).not.toHaveBeenCalled();
  });

  it("keeps an actor-less payload non-authoritative", async () => {
    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      event: buildParticipantAddedEvent({ actorHandle: null }),
      prisma: {} as never,
    })).resolves.toBe("owner_evidence_missing");

    expect(mocks.hasActiveHostedLinqManagedLine).not.toHaveBeenCalled();
    expect(
      mocks.ensureHostedLinqThreadContainerRouteFromParticipantAddTx,
    ).not.toHaveBeenCalled();
  });

  it("rejects Murph itself as the alleged adder", async () => {
    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      event: buildParticipantAddedEvent({ actorHandle: LINE_PHONE }),
      prisma: {} as never,
    })).resolves.toBe("owner_evidence_missing");
  });

  it("does not bind a route when the actor is unresolved", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue(null);

    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      event: buildParticipantAddedEvent(),
      prisma: {} as never,
    })).resolves.toBe("actor_unresolved");

    expect(
      mocks.ensureHostedLinqThreadContainerRouteFromParticipantAddTx,
    ).not.toHaveBeenCalled();
  });

  it("fails closed before identity lookup for an unmanaged line", async () => {
    mocks.hasActiveHostedLinqManagedLine.mockResolvedValue(false);

    await expect(provisionHostedLinqParticipantAddedOwnerTx({
      event: buildParticipantAddedEvent(),
      prisma: {} as never,
    })).resolves.toBe("line_unmanaged");

    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
    expect(
      mocks.ensureHostedLinqThreadContainerRouteFromParticipantAddTx,
    ).not.toHaveBeenCalled();
  });
});

describe("adder ownership rollout", () => {
  it("requires the exact opt-in value", () => {
    expect(isHostedLinqGroupOwnerFromAdderRequired({})).toBe(false);
    expect(isHostedLinqGroupOwnerFromAdderRequired({
      HOSTED_LINQ_GROUP_OWNER_FROM_ADDER_REQUIRED: "true",
    })).toBe(false);
    expect(isHostedLinqGroupOwnerFromAdderRequired({
      HOSTED_LINQ_GROUP_OWNER_FROM_ADDER_REQUIRED: "1",
    })).toBe(true);
  });
});

function buildParticipantAddedEvent(input: {
  actorHandle?: string | null;
  participantIsMe?: boolean;
} = {}): HostedLinqParticipantChangedEvent {
  const actorHandle = input.actorHandle === undefined
    ? ACTOR_PHONE
    : input.actorHandle;
  return {
    api_version: "v3",
    created_at: OCCURRED_AT.toISOString(),
    data: {
      ...(actorHandle
        ? {
            added_by_handle: {
              handle: actorHandle,
              is_me: false,
              service: "iMessage",
            },
          }
        : {}),
      added_at: OCCURRED_AT.toISOString(),
      chat_id: CHAT_ID,
      participant: {
        handle: LINE_PHONE,
        ...(input.participantIsMe === undefined
          ? {}
          : { is_me: input.participantIsMe }),
        service: "iMessage",
      },
    },
    event_id: "evt_murph_added",
    event_type: "participant.added",
    trace_id: "trace_murph_added",
    webhook_version: "2026-02-03",
  };
}
