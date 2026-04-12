import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  buildHostedLinqConversationHomeWelcome: vi.fn(() => "Welcome home"),
  countHostedMemberHomeLinqBindingsByRecipientPhone: vi.fn(),
  createHostedLinqChat: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  upsertHostedMemberHomeLinqBinding: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  countHostedMemberHomeLinqBindingsByRecipientPhone: mocks.countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBinding: mocks.upsertHostedMemberHomeLinqBinding,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", () => ({
  buildHostedLinqConversationHomeWelcome: mocks.buildHostedLinqConversationHomeWelcome,
  createHostedLinqChat: mocks.createHostedLinqChat,
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
    mocks.createHostedLinqChat.mockResolvedValue({
      chatId: "chat_created",
      messageId: "msg_created",
    });
    mocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: [],
      linqMaxActiveMembersPerConversationPhone: null,
    });
    mocks.upsertHostedMemberHomeLinqBinding.mockResolvedValue(undefined);
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
        sourceEventId: "evt_123",
        sourceType: "stripe_checkout",
      }),
    ).resolves.toEqual({
      firstContactLinqChatId: "chat_home",
    });

    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBinding).toHaveBeenCalledWith({
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
        sourceEventId: "evt_123",
        sourceType: "stripe_checkout",
      }),
    ).resolves.toEqual({
      firstContactLinqChatId: "chat_pending",
    });

    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBinding).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_pending",
      memberId: "member_123",
      prisma: {} as never,
      recipientPhone: "+15550100001",
    });
  });

  it("returns the new pooled home chat as first contact when there is no usable pending Linq thread", async () => {
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
        sourceEventId: "evt_123",
        sourceType: "stripe_checkout",
      }),
    ).resolves.toEqual({
      firstContactLinqChatId: "chat_created",
    });

    expect(mocks.createHostedLinqChat).toHaveBeenCalledWith({
      from: "+15550100002",
      idempotencyKey: "member-activation-home:stripe_checkout:member_123:evt_123",
      message: "Welcome home",
      signal: undefined,
      to: ["+15551234567"],
    });
    expect(mocks.upsertHostedMemberHomeLinqBinding).toHaveBeenCalledWith({
      clearPending: true,
      linqChatId: "chat_created",
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
        sourceEventId: "evt_123",
        sourceType: "stripe_checkout",
      }),
    ).rejects.toMatchObject({
      code: "LINQ_CONVERSATION_PHONE_REQUIRED",
      httpStatus: 500,
    });

    expect(mocks.createHostedLinqChat).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqBinding).not.toHaveBeenCalled();
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
      telegramUserLookupKey: null,
      ...overrides,
    },
  };
}
