import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import * as barrel from "@/src/lib/hosted-onboarding/member-service";
import {
  completeHostedPrivyVerification,
} from "@/src/lib/hosted-onboarding/authentication-service";
import {
  abortHostedInvitePhoneCode,
  buildHostedInvitePageData,
  buildHostedInviteUrl,
  confirmHostedInvitePhoneCode,
  getHostedInviteStatus,
  issueHostedInvite,
  issueHostedInviteForPhone,
  prepareHostedInvitePhoneCode,
  requireHostedInviteForAuthentication,
} from "@/src/lib/hosted-onboarding/invite-service";
import {
} from "@/src/lib/hosted-onboarding/member-activation";
import {
  ensureHostedMemberForPhone,
} from "@/src/lib/hosted-onboarding/member-identity-service";
import {
  clearHostedMemberPendingLinqNewChatReservationTx,
  reserveHostedMemberPendingLinqNewChatTx,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberPendingLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: {
          v1: Buffer.alloc(32, 7),
        },
        readVersions: ["v1"],
      },
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: "linq-secret",
      publicBaseUrl: "https://join.example.test",
      stripeBillingMode: "payment",
      stripePriceIdsByPlan: {
        launch_edge_monthly: "price_edge_monthly_123",
        launch_monthly: "price_monthly_123",
      },
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    }),
  };
});

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  provisionActiveHostedDomainRootEnvelopeForUserOnly: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2026-04-07T01:00:00.000Z");

describe("ensureHostedMemberForPhone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites phone lookup storage while preserving verified identity fields on existing members", async () => {
    const existingMember = makeMember({
      id: "member_123",
      suspendedAt: null,
    });
    const currentIdentity = await makeIdentityRecord({
      memberId: "member_123",
      phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
      privyUserId: "did:privy:user_existing",
      privyUserLookupKey: "hbidx:privy-user:v1:existing",
      signupPhoneCodeSendAttemptId: "hbpc_old",
      signupPhoneCodeSendAttemptStartedAt: new Date("2026-03-20T12:05:00.000Z"),
      signupPhoneCodeSentAt: new Date("2026-03-20T12:05:00.000Z"),
      signupPhoneNumber: "+15550001111",
      walletAddress: "0x1234",
      walletAddressLookupKey: "hbidx:wallet-address:v1:existing",
      walletChainType: "ethereum",
      walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
      walletProvider: "privy",
    });
    const identityUpsert = vi.fn().mockResolvedValue(currentIdentity);
    const identityFindFirst = vi.fn().mockImplementation(async ({
      where,
    }: {
      where: {
        phoneLookupKey?: {
          in?: string[];
        };
      };
    }) => {
      const phoneLookupKeys = where.phoneLookupKey?.in ?? [];

      if (phoneLookupKeys.length === 0) {
        return null;
      }

      return {
        ...currentIdentity,
        member: existingMember,
        phoneLookupKey: phoneLookupKeys[0] ?? currentIdentity.phoneLookupKey,
      };
    });
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
    const prisma = asRootPrisma({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(existingMember),
      },
      hostedMemberIdentity: {
        findFirst: identityFindFirst,
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    });

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma: prisma as never,
    });

    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberId: "member_123",
      },
      create: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        privyUserIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
      update: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        privyUserIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
    }));
    const identityUpsertInput = identityUpsert.mock.calls[0]?.[0];
    expect(identityUpsertInput?.create).not.toHaveProperty("walletAddressEncrypted");
    expect(identityUpsertInput?.create).not.toHaveProperty("walletAddressLookupKey");
    expect(identityUpsertInput?.create).not.toHaveProperty("walletChainType");
    expect(identityUpsertInput?.create).not.toHaveProperty("walletCreatedAt");
    expect(identityUpsertInput?.create).not.toHaveProperty("walletProvider");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletAddressEncrypted");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletAddressLookupKey");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletChainType");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletCreatedAt");
    expect(identityUpsertInput?.update).not.toHaveProperty("walletProvider");
  });

  it("creates new members with blind phone lookup storage plus encrypted signup phone state", async () => {
    const identityCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn(async ({
      data,
    }: {
      data: { id: string };
    }) => makeMember({
      id: data.id,
      suspendedAt: null,
    }));
    const prisma = asRootPrisma({
      hostedMember: {
        create,
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberIdentity: {
        createMany: identityCreateMany,
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma: prisma as never,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        billingStatus: "not_started",
      }),
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
    expect(identityCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
      skipDuplicates: true,
    }));
  });

  it("recovers from a concurrent create conflict by refreshing the winning member row", async () => {
    const concurrentMember = makeMember({
      id: "member_123",
      suspendedAt: null,
    });
    const currentIdentity = await makeIdentityRecord({
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:existing",
      signupPhoneNumber: "+15550001111",
    });
    const identityUpsert = vi.fn().mockResolvedValue(currentIdentity);
    const identityFindFirst = vi.fn().mockResolvedValue(null);
    const identityFindUnique = vi.fn().mockImplementation(async ({
      where,
    }: {
      where: Record<string, unknown>;
    }) => {
      if (where.memberId === "member_123") {
        return currentIdentity;
      }

      if (typeof where.phoneLookupKey === "string") {
        return {
          ...currentIdentity,
          member: concurrentMember,
          phoneLookupKey: where.phoneLookupKey,
        };
      }

      return null;
    });
    const create = vi.fn(async ({ data }: { data: { id: string } }) => makeMember({
      id: data.id,
      suspendedAt: null,
    }));
    const identityCreateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = asRootPrisma({
      hostedMember: {
        create,
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(concurrentMember),
      },
      hostedMemberIdentity: {
        createMany: identityCreateMany,
        findFirst: identityFindFirst,
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    });

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma: prisma as never,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberId: "member_123",
      },
      update: expect.objectContaining({
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        signupPhoneNumberEncrypted: expect.stringMatching(/^hsb-test:/u),
      }),
    }));
  });

  it("does not provision control roots or rewrite identity for suspended existing phone members", async () => {
    const suspendedMember = makeMember({
      id: "member_suspended",
      suspendedAt: new Date("2026-04-07T02:00:00.000Z"),
    });
    const currentIdentity = await makeIdentityRecord({
      memberId: "member_suspended",
      phoneLookupKey: "hbidx:phone:v1:suspended",
      signupPhoneNumber: "+15550001111",
    });
    const identityUpsert = vi.fn().mockResolvedValue(currentIdentity);
    const prisma = asRootPrisma({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(suspendedMember),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn().mockResolvedValue({
          ...currentIdentity,
          member: suspendedMember,
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: identityUpsert,
      },
    });

    const { provisionActiveHostedDomainRootEnvelopeForUserOnly } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );

    await expect(ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_SUSPENDED",
    });

    expect(provisionActiveHostedDomainRootEnvelopeForUserOnly).not.toHaveBeenCalled();
    expect(identityUpsert).not.toHaveBeenCalled();
  });

  it("rejects invalid phone numbers", async () => {
    const prisma = asRootPrisma({
      hostedMember: {
        findUnique: vi.fn(),
      },
    });

    await expect(
      ensureHostedMemberForPhone({
        phoneNumber: "not-a-phone",
        prisma: prisma as never,
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
  });
});

describe("prepareHostedInvitePhoneCode", () => {
  it("returns a stored phone for the Privy client send and records the transient send attempt", async () => {
    const hostedMemberIdentity = {
      findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
        memberId: "member_123",
        signupPhoneNumber: "+15551234567",
      })),
      update: vi.fn().mockResolvedValue({}),
    };
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity,
    });

    const result = await prepareHostedInvitePhoneCode({
      inviteCode: "invite-code",
      now: NOW,
      prisma: prisma as never,
    });

    expect(result).toEqual({
      phoneHint: "*** 4567",
      phoneNumber: "+15551234567",
      sendAttemptId: expect.stringMatching(/^hbpc_/u),
    });

    expect(hostedMemberIdentity.update).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      data: {
        signupPhoneCodeSendAttemptId: expect.stringMatching(/^hbpc_/u),
        signupPhoneCodeSendAttemptStartedAt: NOW,
      },
    });
  });

  it("falls back to manual entry when the stored signup phone is unavailable", async () => {
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
          memberId: "member_123",
          signupPhoneNumber: null,
        })),
        update: vi.fn(),
      },
    });

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: NOW,
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "SIGNUP_PHONE_UNAVAILABLE",
      httpStatus: 409,
    });
  });

  it("reuses the canonical verified phone hint after the signup-only phone has been cleared", async () => {
    const hostedMemberIdentity = {
      findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
        memberId: "member_123",
        phoneNumber: "+15557654321",
        signupPhoneNumber: null,
      })),
      update: vi.fn().mockResolvedValue({}),
    };
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity,
    });

    const result = await prepareHostedInvitePhoneCode({
      inviteCode: "invite-code",
      now: NOW,
      prisma: prisma as never,
    });

    expect(result).toEqual({
      phoneHint: "*** 4567",
      phoneNumber: "+15557654321",
      sendAttemptId: expect.stringMatching(/^hbpc_/u),
    });
  });

  it("rate limits repeated invite send-code requests", async () => {
    const update = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
          memberId: "member_123",
          signupPhoneCodeSentAt: new Date("2026-04-07T01:00:30.000Z"),
          signupPhoneNumber: "+15551234567",
        })),
        update,
      },
    });

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:45.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "PHONE_CODE_COOLDOWN",
      httpStatus: 429,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rate limits repeated invite send-code requests while a send attempt is in flight", async () => {
    const update = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
          memberId: "member_123",
          signupPhoneCodeSendAttemptId: "hbpc_in_flight",
          signupPhoneCodeSendAttemptStartedAt: new Date("2026-04-07T01:00:30.000Z"),
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: "+15551234567",
        })),
        update,
      },
    });

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:45.000Z"),
        prisma: prisma as never,
      }),
    ).rejects.toMatchObject({
      code: "PHONE_CODE_COOLDOWN",
      httpStatus: 429,
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("confirmHostedInvitePhoneCode", () => {
  it("clears the pending attempt after a successful Privy send confirmation", async () => {
    const hostedMemberIdentity = {
      findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
        memberId: "member_123",
        signupPhoneCodeSendAttemptId: "hbpc_confirm",
        signupPhoneCodeSendAttemptStartedAt: NOW,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: "+15551234567",
      })),
      update: vi.fn().mockResolvedValue({}),
    };
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity,
    });

    await expect(
      confirmHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:08.000Z"),
        prisma: prisma as never,
        sendAttemptId: "hbpc_confirm",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(hostedMemberIdentity.update).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      data: {
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: new Date("2026-04-07T01:00:08.000Z"),
      },
    });
  });

  it("rejects stale or mismatched invite send-code confirmations", async () => {
    const update = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
          memberId: "member_123",
          signupPhoneCodeSendAttemptId: "hbpc_current",
          signupPhoneCodeSendAttemptStartedAt: NOW,
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: "+15551234567",
        })),
        update,
      },
    });

    await expect(
      confirmHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:20.000Z"),
        prisma: prisma as never,
        sendAttemptId: "hbpc_old",
      }),
    ).rejects.toMatchObject({
      code: "PHONE_CODE_ATTEMPT_INVALID",
      httpStatus: 409,
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("abortHostedInvitePhoneCode", () => {
  it("clears only the pending attempt after a failed Privy send", async () => {
    const hostedMemberIdentity = {
      findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
        memberId: "member_123",
        signupPhoneCodeSendAttemptId: "hbpc_abort",
        signupPhoneCodeSendAttemptStartedAt: NOW,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: "+15551234567",
      })),
      update: vi.fn().mockResolvedValue({}),
    };
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity,
    });

    await expect(
      abortHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:05.000Z"),
        prisma: prisma as never,
        sendAttemptId: "hbpc_abort",
      }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(hostedMemberIdentity.update).toHaveBeenCalledWith({
      where: {
        memberId: "member_123",
      },
      data: {
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: new Date("2026-04-07T01:00:05.000Z"),
      },
    });
  });

  it("ignores stale abort requests so they cannot clear a later cooldown", async () => {
    const update = vi.fn();
    const prisma = asRootPrisma({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(await makeIdentityRecord({
          memberId: "member_123",
          signupPhoneCodeSendAttemptId: "hbpc_current",
          signupPhoneCodeSendAttemptStartedAt: NOW,
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: "+15551234567",
        })),
        update,
      },
    });

    await expect(
      abortHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:05.000Z"),
        prisma: prisma as never,
        sendAttemptId: "hbpc_old",
      }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("upsertHostedMemberHomeLinqBinding", () => {
  it("stores the latest Linq home chat id in the routing table for future activation welcomes", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        updateMany,
        upsert,
      },
    });

    await upsertHostedMemberHomeLinqBindingTx({
      linqChatId: "chat_new",
      memberId: "member_123",
      prisma: prisma as never,
      recipientPhone: "+15550100001",
    });

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      data: {
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqLastInboundAt: null,
        linqRecipientPhoneEncrypted: null,
        linqRecipientPhoneLookupKey: null,
      },
      where: {
        NOT: {
          memberId: "member_123",
        },
        linqChatLookupKey: {
          in: [expect.stringMatching(/^hbidx:linq-chat:v1:/u)],
        },
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      data: {
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        pendingLinqLastInboundAt: null,
      },
      where: {
        NOT: {
          memberId: "member_123",
        },
        pendingLinqChatLookupKey: {
          in: [expect.stringMatching(/^hbidx:linq-chat:v1:/u)],
        },
      },
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      create: {
        linqChatIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        memberId: "member_123",
        pendingLinqChatIdEncrypted: null,
        pendingLinqChatLookupKey: null,
        pendingLinqNewChatReservationKey: null,
        pendingLinqNewChatReservedAt: null,
        pendingLinqParticipantContactEncrypted: null,
        pendingLinqParticipantContactKind: null,
        pendingLinqParticipantContactLookupKey: null,
        pendingLinqParticipantContactObservedAt: null,
        pendingLinqRecipientPhoneEncrypted: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
      update: {
        linqChatIdEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        linqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        linqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
      },
      where: {
        memberId: "member_123",
      },
    });
  });

  it("rejects empty chat ids", async () => {
    const upsert = vi.fn();
    const updateMany = vi.fn();
    const prisma = asRootPrisma({
      $executeRaw: vi.fn(),
      hostedMemberRouting: {
        updateMany,
        upsert,
      },
    });

    await expect(
      upsertHostedMemberHomeLinqBindingTx({
        linqChatId: null as never,
        memberId: "member_123",
        prisma: prisma as never,
        recipientPhone: null,
      }),
    ).rejects.toThrow("Hosted Linq routing requires a non-empty chat id.");
  });

  it("reserves a pending Linq new-chat slot under the member lock", async () => {
    const reservedAt = new Date("2026-06-30T12:00:00.000Z");
    const reservationKey = "ops-onboarding-invite:open:reservation";
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findUnique = vi.fn().mockResolvedValue(null);
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        findUnique,
        upsert,
      },
    });

    await expect(reserveHostedMemberPendingLinqNewChatTx({
      memberId: "member_123",
      prisma: prisma as never,
      recipientPhone: "+15550100001",
      reservationKey,
      reservedAt,
    })).resolves.toBe("reserved");

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      select: {
        linqChatLookupKey: true,
        pendingLinqChatLookupKey: true,
        pendingLinqNewChatReservationKey: true,
      },
      where: {
        memberId: "member_123",
      },
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        memberId: "member_123",
        pendingLinqNewChatReservationKey: reservationKey,
        pendingLinqNewChatReservedAt: reservedAt,
        pendingLinqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550100001"),
      }),
      update: {
        pendingLinqNewChatReservationKey: reservationKey,
        pendingLinqNewChatReservedAt: reservedAt,
        pendingLinqRecipientPhoneEncrypted: expect.stringMatching(/^hsb-test:/u),
        pendingLinqRecipientPhoneLookupKey: createHostedPhoneLookupKey("+15550100001"),
      },
      where: {
        memberId: "member_123",
      },
    }));
  });

  it("treats an existing matching pending Linq new-chat reservation as owned", async () => {
    const reservationKey = "ops-onboarding-invite:open:reservation";
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findUnique = vi.fn().mockResolvedValue({
      linqChatLookupKey: null,
      pendingLinqChatLookupKey: null,
      pendingLinqNewChatReservationKey: reservationKey,
    });
    const upsert = vi.fn();
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        findUnique,
        upsert,
      },
    });

    await expect(reserveHostedMemberPendingLinqNewChatTx({
      memberId: "member_123",
      prisma: prisma as never,
      recipientPhone: "+15550100001",
      reservationKey,
      reservedAt: new Date("2026-06-30T12:00:00.000Z"),
    })).resolves.toBe("already_reserved");

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails a pending Linq new-chat reservation when another send owns the slot", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findUnique = vi.fn().mockResolvedValue({
      linqChatLookupKey: null,
      pendingLinqChatLookupKey: null,
      pendingLinqNewChatReservationKey: "ops-onboarding-invite:open:other",
    });
    const upsert = vi.fn();
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        findUnique,
        upsert,
      },
    });

    await expect(reserveHostedMemberPendingLinqNewChatTx({
      memberId: "member_123",
      prisma: prisma as never,
      recipientPhone: "+15550100001",
      reservationKey: "ops-onboarding-invite:open:reservation",
      reservedAt: new Date("2026-06-30T12:00:00.000Z"),
    })).resolves.toBe("reservation_conflict");

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("clears only the owned pending Linq new-chat reservation", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        updateMany,
      },
    });

    await clearHostedMemberPendingLinqNewChatReservationTx({
      memberId: "member_123",
      prisma: prisma as never,
      reservationKey: "ops-onboarding-invite:open:reservation",
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        pendingLinqNewChatReservationKey: null,
        pendingLinqNewChatReservedAt: null,
      },
      where: {
        memberId: "member_123",
        pendingLinqNewChatReservationKey: "ops-onboarding-invite:open:reservation",
      },
    });
  });

  it("clears a pending Linq new-chat reservation when binding the provider chat", async () => {
    const reservationKey = "ops-onboarding-invite:open:reservation";
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findUnique = vi.fn()
      .mockResolvedValueOnce({
        linqChatLookupKey: null,
        pendingLinqChatLookupKey: null,
        pendingLinqNewChatReservationKey: reservationKey,
      })
      .mockResolvedValueOnce(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        findUnique,
        updateMany,
        upsert,
      },
    });

    await upsertHostedMemberPendingLinqBindingTx({
      existingChatPolicy: "fail",
      expectedNewChatReservationKey: reservationKey,
      linqChatId: "chat_new",
      memberId: "member_123",
      prisma: prisma as never,
      recipientPhone: "+15550100001",
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        pendingLinqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        pendingLinqNewChatReservationKey: null,
        pendingLinqNewChatReservedAt: null,
      }),
      where: {
        memberId: "member_123",
      },
    }));
  });

  it("treats the same pending Linq chat as already owned when conflicts fail closed", async () => {
    const pendingLookupKey = createHostedLinqChatLookupKey("chat_existing");
    if (!pendingLookupKey) {
      throw new Error("Expected test Linq chat id to produce a lookup key.");
    }
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findUnique = vi.fn().mockResolvedValue({
      linqChatLookupKey: null,
      pendingLinqChatLookupKey: pendingLookupKey,
    });
    const updateMany = vi.fn();
    const upsert = vi.fn();
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        findUnique,
        updateMany,
        upsert,
      },
    });

    await upsertHostedMemberPendingLinqBindingTx({
      existingChatPolicy: "fail",
      linqChatId: "chat_existing",
      memberId: "member_123",
      prisma: prisma as never,
      recipientPhone: "+15550100001",
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      select: {
        linqChatLookupKey: true,
        pendingLinqChatLookupKey: true,
        pendingLinqNewChatReservationKey: true,
      },
      where: {
        memberId: "member_123",
      },
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails closed before overwriting a different pending Linq chat", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findUnique = vi.fn().mockResolvedValue({
      linqChatLookupKey: null,
      pendingLinqChatLookupKey: "hbidx:linq-chat:v1:other",
    });
    const updateMany = vi.fn();
    const upsert = vi.fn();
    const prisma = asRootPrisma({
      $executeRaw: executeRaw,
      hostedMemberRouting: {
        findUnique,
        updateMany,
        upsert,
      },
    });

    await expect(upsertHostedMemberPendingLinqBindingTx({
      existingChatPolicy: "fail",
      linqChatId: "chat_new",
      memberId: "member_123",
      prisma: prisma as never,
      recipientPhone: "+15550100001",
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PENDING_CHAT_CONFLICT",
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    billingStatus: "not_started",
    createdAt: NOW,
    id: "member_123",
    pendingActivationTimeZone: null,
    suspendedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeInviteRecord() {
  return {
    expiresAt: new Date("2026-04-08T00:00:00.000Z"),
    inviteCode: "invite-code",
    member: {
      id: "member_123",
      identity: {
        maskedPhoneNumberHint: "*** 4567",
      },
    },
    memberId: "member_123",
  };
}

interface HostedMemberIdentityFindInput {
  include?: Record<string, unknown>;
  where: Record<string, unknown>;
}

interface HostedMemberIdentityTestDelegate {
  createMany?: ReturnType<typeof vi.fn>;
  findFirst?: (input: HostedMemberIdentityFindInput) => Promise<unknown> | unknown;
  findMany?: (input: HostedMemberIdentityFindInput) => Promise<unknown[]> | unknown[];
}

function asRootPrisma<T extends object>(tx: T): T & {
  $executeRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
} {
  const prisma = tx as T & {
    $executeRaw?: ReturnType<typeof vi.fn>;
    hostedMember?: {
      delete?: ReturnType<typeof vi.fn>;
    };
    hostedMemberIdentity?: HostedMemberIdentityTestDelegate;
    hostedMemberRouting?: {
      createMany?: ReturnType<typeof vi.fn>;
    };
  };

  const executeRaw = prisma.$executeRaw ?? vi.fn().mockResolvedValue(0);
  prisma.$executeRaw = executeRaw;
  prisma.hostedMember ??= {};
  prisma.hostedMember.delete ??= vi.fn().mockResolvedValue({});
  if (prisma.hostedMemberIdentity) {
    prisma.hostedMemberIdentity.createMany ??= vi.fn().mockResolvedValue({ count: 1 });
    prisma.hostedMemberIdentity.findMany ??= vi.fn(async (input: HostedMemberIdentityFindInput) => {
      const identity = await prisma.hostedMemberIdentity?.findFirst?.(input);
      return identity ? [identity] : [];
    });
  }
  if (prisma.hostedMemberRouting) {
    prisma.hostedMemberRouting.createMany ??= vi.fn().mockResolvedValue({ count: 1 });
  }

  return {
    ...prisma,
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (callback: (innerTx: T) => Promise<unknown>) => callback(prisma)),
  };
}

async function makeIdentityRecord(input: {
  memberId: string;
  phoneLookupKey?: string;
  phoneNumber?: string | null;
  phoneNumberVerifiedAt?: Date | null;
  privyUserId?: string | null;
  privyUserLookupKey?: string | null;
  signupPhoneCodeSendAttemptId?: string | null;
  signupPhoneCodeSendAttemptStartedAt?: Date | null;
  signupPhoneCodeSentAt?: Date | null;
  signupPhoneNumber?: string | null;
  walletAddress?: string | null;
  walletAddressLookupKey?: string | null;
  walletChainType?: string | null;
  walletCreatedAt?: Date | null;
  walletProvider?: string | null;
}) {
  return {
    maskedPhoneNumberHint: "*** 4567",
    memberId: input.memberId,
    phoneLookupKey: input.phoneLookupKey ?? "hbidx:phone:v1:existing",
    phoneNumberEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId: input.memberId,
      value: input.phoneNumber ?? null,
    }),
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt ?? null,
    privyUserIdEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.privy-user-id",
      memberId: input.memberId,
      value: input.privyUserId ?? null,
    }),
    privyUserLookupKey: input.privyUserLookupKey ?? null,
    signupPhoneCodeSendAttemptId: input.signupPhoneCodeSendAttemptId ?? null,
    signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt ?? null,
    signupPhoneCodeSentAt: input.signupPhoneCodeSentAt ?? null,
    signupPhoneNumberEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.signup-phone-number",
      memberId: input.memberId,
      value: input.signupPhoneNumber ?? null,
    }),
    walletAddressEncrypted: await encryptHostedWebNullableString({
      field: "hosted-member-identity.wallet-address",
      memberId: input.memberId,
      value: input.walletAddress ?? null,
    }),
    walletAddressLookupKey: input.walletAddressLookupKey ?? null,
    walletChainType: input.walletChainType ?? null,
    walletCreatedAt: input.walletCreatedAt ?? null,
    walletProvider: input.walletProvider ?? null,
  };
}
