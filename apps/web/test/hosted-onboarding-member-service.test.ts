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

import * as barrel from "@/src/lib/hosted-onboarding/member-service";
import {
  completeHostedPrivyVerification,
} from "@/src/lib/hosted-onboarding/authentication-service";
import {
  buildHostedInvitePageData,
  buildHostedInviteUrl,
  getHostedInviteStatus,
  issueHostedInvite,
  issueHostedInviteForPhone,
  requireHostedInviteForAuthentication,
} from "@/src/lib/hosted-onboarding/invite-service";
import {
  buildHostedMemberActivationDispatch,
} from "@/src/lib/hosted-onboarding/member-activation";
import {
  ensureHostedMemberForPhone,
} from "@/src/lib/hosted-onboarding/member-identity-service";

describe("ensureHostedMemberForPhone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves an existing Linq chat binding and verification timestamp when no new chat id is provided", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "member_123",
      linqChatId: "chat_existing",
      maskedPhoneNumberHint: "*** 4567",
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
    });
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          encryptedBootstrapSecret: "encrypted-secret",
          encryptionKeyVersion: "v1",
          id: "member_123",
          linqChatId: "chat_existing",
          maskedPhoneNumberHint: "*** 4567",
          phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
        }),
        update,
      },
    } as never;

    await ensureHostedMemberForPhone({
      linqChatId: null,
      normalizedPhoneNumber: "+15551234567",
      prisma,
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      data: expect.objectContaining({
        linqChatId: undefined,
        maskedPhoneNumberHint: "*** 4567",
        normalizedPhoneNumber: "+15551234567",
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
      maskedPhoneNumberHint: "*** 4567",
    });
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          encryptedBootstrapSecret: "encrypted-secret",
          encryptionKeyVersion: "v1",
          id: "member_123",
          linqChatId: "chat_existing",
          maskedPhoneNumberHint: "*** 4567",
        }),
        update,
      },
    } as never;

    await ensureHostedMemberForPhone({
      linqChatId: "chat_new",
      normalizedPhoneNumber: "+15551234567",
      prisma,
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      data: expect.objectContaining({
        linqChatId: "chat_new",
        maskedPhoneNumberHint: "*** 4567",
        normalizedPhoneNumber: "+15551234567",
      }),
    });
  });
});

describe("hosted-onboarding member-service barrel", () => {
  it("keeps the focused module exports available through the compatibility barrel", () => {
    expect(barrel.buildHostedInvitePageData).toBe(buildHostedInvitePageData);
    expect(barrel.buildHostedInviteUrl).toBe(buildHostedInviteUrl);
    expect(barrel.getHostedInviteStatus).toBe(getHostedInviteStatus);
    expect(barrel.issueHostedInvite).toBe(issueHostedInvite);
    expect(barrel.issueHostedInviteForPhone).toBe(issueHostedInviteForPhone);
    expect(barrel.requireHostedInviteForAuthentication).toBe(requireHostedInviteForAuthentication);
    expect(barrel.ensureHostedMemberForPhone).toBe(ensureHostedMemberForPhone);
    expect(barrel.completeHostedPrivyVerification).toBe(completeHostedPrivyVerification);
    expect(barrel.buildHostedMemberActivationDispatch).toBe(buildHostedMemberActivationDispatch);
  });
});
