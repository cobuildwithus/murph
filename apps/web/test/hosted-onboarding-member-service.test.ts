import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      encryptionKeyVersion: "v1",
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: "linq-secret",
      publicBaseUrl: "https://join.example.test",
      sessionCookieName: "hosted_session",
      sessionTtlDays: 30,
      stripeBillingMode: "payment",
      stripePriceId: "price_123",
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    }),
  };
});

import { ensureHostedMemberForPhone } from "@/src/lib/hosted-onboarding/member-service";

describe("ensureHostedMemberForPhone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves an existing Linq chat binding and verification timestamp when no new chat id is provided", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "member_123",
      linqChatId: "chat_existing",
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
    });
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          encryptedBootstrapSecret: "encrypted-secret",
          encryptionKeyVersion: "v1",
          id: "member_123",
          linqChatId: "chat_existing",
          phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
        }),
        update,
      },
    } as never;

    await ensureHostedMemberForPhone({
      linqChatId: null,
      normalizedPhoneNumber: "+15551234567",
      originalPhoneNumber: "+1 (555) 123-4567",
      prisma,
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      data: expect.objectContaining({
        linqChatId: undefined,
        phoneNumber: "+1 (555) 123-4567",
      }),
    });
    expect(update.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneNumberVerifiedAt: expect.anything(),
        }),
      }),
    );
  });

  it("updates the stored Linq chat binding when a new chat id is provided", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "member_123",
      linqChatId: "chat_new",
    });
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          encryptedBootstrapSecret: "encrypted-secret",
          encryptionKeyVersion: "v1",
          id: "member_123",
          linqChatId: "chat_existing",
        }),
        update,
      },
    } as never;

    await ensureHostedMemberForPhone({
      linqChatId: "chat_new",
      normalizedPhoneNumber: "+15551234567",
      originalPhoneNumber: "+15551234567",
      prisma,
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      data: expect.objectContaining({
        linqChatId: "chat_new",
        phoneNumber: "+15551234567",
      }),
    });
  });
});
