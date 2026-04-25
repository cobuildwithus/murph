import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  upsertHostedMemberHomeLinqBindingTx: vi.fn(),
  upsertHostedMemberHomeLinqRecipientPhoneTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  countHostedMemberHomeLinqBindingsByRecipientPhone: mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBindingTx: mocks.upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx: mocks.upsertHostedMemberHomeLinqRecipientPhoneTx,
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
    mocks.countHostedMemberHomeLinqBindingsByRecipientPhone.mockResolvedValue(new Map());
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: [],
      linqMaxActiveMembersPerConversationPhone: null,
    });
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
        actorId: "+15551234567",
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_home",
        },
        identityId: "hbidx:phone:v1:test",
        threadId: "chat_home",
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
        actorId: "+15551234567",
        channel: "linq",
        delivery: {
          kind: "thread",
          target: "chat_pending",
        },
        identityId: "hbidx:phone:v1:test",
        threadId: "chat_pending",
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBindingTx).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("assigns the pooled home line and returns a participant welcome route when there is no reusable pending thread", async () => {
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
        actorId: "+15551234567",
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: "+15550100002",
            kind: "linq",
          },
          target: "+15551234567",
        },
        identityId: "hbidx:phone:v1:test",
        threadId: null,
        threadIsDirect: true,
      },
    });

    expect(mocks.upsertHostedMemberHomeLinqBindingTx).not.toHaveBeenCalled();
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
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
      ...overrides,
    },
  };
}
