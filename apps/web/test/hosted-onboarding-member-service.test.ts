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
    const existingMember = {
      id: "member_123",
      linqChatId: "chat_existing",
      maskedPhoneNumberHint: "*** 4567",
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
    };
    const identityUpsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
    });
    const currentIdentity = {
      maskedPhoneNumberHint: "*** 4567",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:existing",
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
      privyUserId: "did:privy:user_123",
      walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
      walletProvider: "privy",
    };
    const identityFindUnique = vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.memberId === "member_123") {
        return currentIdentity;
      }

      if (typeof where.phoneLookupKey === "string") {
        return {
          ...currentIdentity,
          member: existingMember,
          phoneLookupKey: where.phoneLookupKey,
        };
      }

      return null;
    });
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(existingMember),
      },
      hostedMemberIdentity: {
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    } as never;

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma,
    });

    expect(identityUpsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/),
      }),
      update: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/),
        phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
        privyUserId: "did:privy:user_123",
        walletAddress: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        walletChainType: "ethereum",
        walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
        walletProvider: "privy",
      }),
    });
    expect(identityUpsert.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        create: expect.objectContaining({
          phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
        }),
      }),
    );
  });

  it("creates new members with blind phone lookup storage", async () => {
    const identityUpsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
    });
    const identityFindUnique = vi.fn().mockResolvedValue(null);
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
      hostedMemberIdentity: {
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    } as never;

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billingStatus: "not_started",
        status: "invited",
      }),
    });
    expect(identityUpsert).toHaveBeenCalledWith({
      where: {
        memberId: expect.any(String),
      },
      create: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/),
      }),
      update: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/),
      }),
    });
  });

  it("recovers from a concurrent create conflict by refreshing the winning member row", async () => {
    const concurrentMember = {
      id: "member_123",
      linqChatId: "chat_existing",
      maskedPhoneNumberHint: "*** 4567",
    };
    const identityUpsert = vi.fn().mockResolvedValue({
      memberId: "member_123",
    });
    const identityFindUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.phoneLookupKey === "string") {
          return {
            maskedPhoneNumberHint: "*** 4567",
            member: concurrentMember,
            memberId: "member_123",
            phoneLookupKey: where.phoneLookupKey,
            phoneNumberVerifiedAt: null,
            privyUserId: null,
            walletAddress: null,
            walletChainType: null,
            walletCreatedAt: null,
            walletProvider: null,
          };
        }

        return null;
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
          .mockResolvedValueOnce(concurrentMember),
      },
      hostedMemberIdentity: {
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    } as never;

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(identityUpsert).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      create: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/),
      }),
      update: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/),
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
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      hostedMemberRouting: {
        updateMany,
        upsert,
      },
    } as never;

    await persistHostedMemberLinqChatBinding({
      linqChatId: "chat_new",
      memberId: "member_123",
      prisma,
    });

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        linqChatId: null,
      },
      where: {
        NOT: {
          memberId: "member_123",
        },
        linqChatId: "chat_new",
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      create: {
        linqChatId: "chat_new",
        memberId: "member_123",
        telegramUserLookupKey: null,
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
    const updateMany = vi.fn();
    const prisma = {
      hostedMemberRouting: {
        updateMany,
        upsert,
      },
    } as never;

    await persistHostedMemberLinqChatBinding({
      linqChatId: null,
      memberId: "member_123",
      prisma,
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
