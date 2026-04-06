import { Prisma } from "@prisma/client";
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
      stripeBillingMode: "payment",
      stripePriceId: "price_123",
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      encryptionKey: "test-hosted-contact-privacy-key",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    }),
    getHostedOnboardingSecretCodec: () => ({
      encrypt: (value: string) => `enc:${value}`,
      keyVersion: "v1",
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
  persistHostedMemberLinqChatBinding,
} from "@/src/lib/hosted-onboarding/member-identity-service";

describe("ensureHostedMemberForPhone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites phone storage to blind-indexed lookup data without dropping the stored signup chat binding", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "member_123",
      linqChatId: "chat_existing",
      maskedPhoneNumberHint: "*** 4567",
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
    });
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          id: "member_123",
          linqChatId: "chat_existing",
          maskedPhoneNumberHint: "*** 4567",
          phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
        }),
        update,
      },
    } as never;

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma,
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      data: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        normalizedPhoneNumber: expect.stringMatching(/^hbidx:phone:v1:/),
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

  it("creates new members with blind phone lookup storage", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "member_123",
      linqChatId: null,
      maskedPhoneNumberHint: "*** 4567",
    });
    const prisma = {
      hostedMember: {
        create,
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never;

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        normalizedPhoneNumber: expect.stringMatching(/^hbidx:phone:v1:/),
      }),
    });
  });

  it("recovers from a concurrent create conflict by refreshing the winning member row", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "member_123",
      linqChatId: null,
      maskedPhoneNumberHint: "*** 4567",
    });
    const create = vi.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        clientVersion: "test",
        code: "P2002",
      }),
    );
    const prisma = {
      hostedMember: {
        create,
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "member_123",
            linqChatId: "chat_existing",
            maskedPhoneNumberHint: "*** 4567",
          }),
        update,
      },
    } as never;

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      data: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        normalizedPhoneNumber: expect.stringMatching(/^hbidx:phone:v1:/),
      }),
    });
  });

  it("rejects invalid phone numbers", async () => {
    const prisma = {
      hostedMember: {
        findUnique: vi.fn(),
      },
    } as never;

    await expect(
      ensureHostedMemberForPhone({
        phoneNumber: "not-a-phone",
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "PHONE_NUMBER_INVALID",
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

describe("persistHostedMemberLinqChatBinding", () => {
  it("stores the latest Linq chat id in the additive routing table for future activation welcomes", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      hostedMemberRouting: {
        upsert,
      },
    } as never;

    await persistHostedMemberLinqChatBinding({
      linqChatId: "chat_new",
      memberId: "member_123",
      prisma,
    });

    expect(upsert).toHaveBeenCalledWith({
      create: {
        linqChatId: "chat_new",
        memberId: "member_123",
        telegramUserId: null,
      },
      update: {
        linqChatId: "chat_new",
      },
      where: {
        memberId: "member_123",
      },
    });
  });

  it("ignores empty chat ids", async () => {
    const upsert = vi.fn();
    const prisma = {
      hostedMemberRouting: {
        upsert,
      },
    } as never;

    await persistHostedMemberLinqChatBinding({
      linqChatId: null,
      memberId: "member_123",
      prisma,
    });

    expect(upsert).not.toHaveBeenCalled();
  });
});
