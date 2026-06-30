import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx: vi.fn(),
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  syncHostedLinqConfiguredLinesTx: vi.fn(),
  upsertHostedMemberHomeLinqBindingTx: vi.fn(),
  upsertHostedMemberHomeLinqRecipientPhoneTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx: mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqBindingsByRecipientPhone: mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBindingTx: mocks.upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx: mocks.upsertHostedMemberHomeLinqRecipientPhoneTx,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  syncHostedLinqConfiguredLinesTx: mocks.syncHostedLinqConfiguredLinesTx,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
  };
});

import { resolveHostedMemberActivationLinqRoute } from "@/src/lib/hosted-onboarding/linq-home-routing";

describe("resolveHostedMemberActivationLinqRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx.mockResolvedValue(undefined);
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: [],
      linqMaxActiveMembersPerConversationPhone: null,
    });
    mocks.syncHostedLinqConfiguredLinesTx.mockResolvedValue(undefined);
    mocks.upsertHostedMemberHomeLinqBindingTx.mockResolvedValue(undefined);
    mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mockResolvedValue(undefined);
  });

  it("clears stale pending state when a durable home chat already exists", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          linqChatId: "chat_home",
          linqRecipientPhone: "+15550100001",
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: "+15550100002",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551234567"),
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_home",
        },
        identityId: hashHostedLinqRouteIdentifier("hbidx:phone:v1:test"),
        threadId: hashHostedLinqRouteIdentifier("chat_home"),
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_home",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("reuses a pending Linq thread when its recipient matches the chosen home line", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: ["+15550100001", "+15550100002"],
      linqMaxActiveMembersPerConversationPhone: 3,
    });
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([
        ["+15550100001", 1],
        ["+15550100002", 0],
      ]),
    );

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: "+15550100001",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551234567"),
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_pending",
        },
        identityId: hashHostedLinqRouteIdentifier("hbidx:phone:v1:test"),
        threadId: hashHostedLinqRouteIdentifier("chat_pending"),
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.syncHostedLinqConfiguredLinesTx).toHaveBeenCalledWith({
      activeMemberLimit: 3,
      phoneNumbers: ["+15550100001", "+15550100002"],
      prisma: {} as never,
    });
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("promotes an email-handle pending Linq thread without requiring a member phone", async () => {
    const emailLookupKey = "hbidx:email:v1:test";
    const member = buildMember({
      pendingLinqChatId: "chat_pending_email",
      pendingLinqParticipantContact: {
        kind: "email",
        lookupKey: emailLookupKey,
        observedAt: new Date("2026-04-12T00:01:00.000Z"),
        value: "buddy@icloud.com",
      },
      pendingLinqRecipientPhone: null,
    });
    member.identity = member.identity
      ? {
          ...member.identity,
          phoneLookupKey: null,
          phoneNumber: null,
        }
      : null;
    member.emailAuthorization = {
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: null,
      verifiedEmail: {
        address: "buddy@icloud.com",
        lookupKey: emailLookupKey,
        verifiedAt: new Date("2026-04-12T00:02:00.000Z"),
      },
    };
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: ["+15550100001"],
      linqMaxActiveMembersPerConversationPhone: 3,
    });
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([["+15550100001", 0]]),
    );

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member,
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: null,
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_pending_email",
        },
        identityId: hashHostedLinqRouteIdentifier(emailLookupKey, emailLookupKey),
        threadId: hashHostedLinqRouteIdentifier("chat_pending_email", emailLookupKey),
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending_email",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("assigns the pooled home line and builds a first-contact welcome route when there is no reusable pending thread", async () => {
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: ["+15550100001", "+15550100002"],
      linqMaxActiveMembersPerConversationPhone: 3,
    });
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(
      new Map([
        ["+15550100001", 3],
        ["+15550100002", 1],
      ]),
    );

    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: "+15550100001",
        }),
        prisma: {} as never,
      }),
    ).resolves.toEqual({
      welcomeRoute: {
        actorId: hashHostedLinqRouteIdentifier("+15551234567"),
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: "+15550100002",
            kind: "linq",
          },
          target: "+15551234567",
        },
        identityId: hashHostedLinqRouteIdentifier("hbidx:phone:v1:test"),
        threadId: null,
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
    expect(mocks.acquireHostedMemberHomeLinqRecipientAssignmentLockTx).toHaveBeenCalledWith({
      prisma: {} as never,
    });
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledWith({
      clearPending: true,
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100002",
    });
  });

  it("fails closed when activation has no usable pending thread and no configured home-line pool", async () => {
    await expect(
      resolveHostedMemberActivationLinqRoute({
        member: buildMember({
          pendingLinqChatId: "chat_pending",
          pendingLinqRecipientPhone: null,
        }),
        prisma: {} as never,
      }),
    ).rejects.toMatchObject({
      code: "LINQ_CONVERSATION_PHONE_REQUIRED",
      httpStatus: 500,
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
  });
});

function hashHostedLinqRouteIdentifier(
  value: string,
  secret = "hbidx:phone:v1:test",
): string {
  return hashHostedAssistantConversationIdentifier(
    createHostedAssistantConversationIdentifierBlind({
      secret,
      userId: "member_123",
    }),
    value,
  );
}

function buildMember(
  overrides: Partial<HostedMemberSnapshot["routing"]> = {},
): HostedMemberSnapshot {
  return {
    billingRef: null,
    core: {
      billingStatus: "incomplete",
      createdAt: new Date("2026-04-12T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
    identity: {
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:test",
      phoneNumber: "+15551234567",
      phoneNumberVerifiedAt: new Date("2026-04-12T00:00:00.000Z"),
      privyUserId: null,
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    },
    routing: {
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
      ...overrides,
    },
  };
}
