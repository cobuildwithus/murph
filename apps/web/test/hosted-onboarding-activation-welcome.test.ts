import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
  };
});

import { drainHostedActivationWelcomeMessages } from "@/src/lib/hosted-onboarding/activation-welcome";

describe("hosted activation welcome delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_123",
      messageId: "msg_123",
    });
  });

  it("sends the deterministic welcome once for queued active members", async () => {
    const prisma = {
      hostedMember: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "member_123",
            linqChatId: "chat_123",
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await expect(
      drainHostedActivationWelcomeMessages({
        memberIds: [
          "member_123",
        ],
        prisma: prisma as never,
      }),
    ).resolves.toEqual([
      "member_123",
    ]);

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        idempotencyKey: "hosted-activation-welcome:member_123",
      }),
    );
    expect(prisma.hostedMember.updateMany).toHaveBeenCalledWith({
      data: {
        onboardingWelcomeSentAt: expect.any(Date),
      },
      where: expect.objectContaining({
        id: "member_123",
        onboardingWelcomeQueuedAt: {
          not: null,
        },
        onboardingWelcomeSentAt: null,
      }),
    });
  });

  it("leaves the welcome queued when Linq send fails", async () => {
    mocks.sendHostedLinqChatMessage.mockRejectedValue(new Error("linq timeout"));
    const prisma = {
      hostedMember: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "member_123",
            linqChatId: "chat_123",
          },
        ]),
        updateMany: vi.fn(),
      },
    };

    await expect(
      drainHostedActivationWelcomeMessages({
        memberIds: [
          "member_123",
        ],
        prisma: prisma as never,
      }),
    ).resolves.toEqual([]);

    expect(prisma.hostedMember.updateMany).not.toHaveBeenCalled();
  });
});
