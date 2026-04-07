import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
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
  buildHostedMemberActivationDispatch,
} from "@/src/lib/hosted-onboarding/member-activation";
import {
  ensureHostedMemberForPhone,
  persistHostedMemberLinqChatBinding,
} from "@/src/lib/hosted-onboarding/member-identity-service";

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      encryptionKey: "test-hosted-contact-privacy-key",
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
      telegramBotUsername: null,
      telegramWebhookSecret: null,
    }),
  };
});

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
    const currentIdentity = makeIdentityRecord({
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
    const prisma = {
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(existingMember),
      },
      hostedMemberIdentity: {
        findFirst: identityFindFirst,
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    } as never;

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma,
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
        privyUserIdEncrypted: expect.stringMatching(/^hbds:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: expect.stringMatching(/^hbds:/u),
        walletAddressEncrypted: expect.stringMatching(/^hbds:/u),
        walletAddressLookupKey: expect.stringMatching(/^hbidx:wallet-address:v1:/u),
        walletChainType: "ethereum",
        walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
        walletProvider: "privy",
      }),
      update: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        phoneNumberVerifiedAt: new Date("2026-03-20T12:00:00.000Z"),
        privyUserLookupKey: expect.stringMatching(/^hbidx:privy-user:v1:/u),
        privyUserIdEncrypted: expect.stringMatching(/^hbds:/u),
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumberEncrypted: expect.stringMatching(/^hbds:/u),
        walletAddressEncrypted: expect.stringMatching(/^hbds:/u),
        walletAddressLookupKey: expect.stringMatching(/^hbidx:wallet-address:v1:/u),
        walletChainType: "ethereum",
        walletCreatedAt: new Date("2026-03-20T12:00:00.000Z"),
        walletProvider: "privy",
      }),
    }));
  });

  it("creates new members with blind phone lookup storage plus encrypted signup phone state", async () => {
    const identityUpsert = vi.fn().mockResolvedValue(
      makeIdentityRecord({
        memberId: "member_123",
        phoneLookupKey: "hbidx:phone:v1:new",
        signupPhoneNumber: "+15551234567",
      }),
    );
    const create = vi.fn().mockResolvedValue(makeMember({
      id: "member_123",
      suspendedAt: null,
    }));
    const prisma = {
      hostedMember: {
        create,
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
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
      }),
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        signupPhoneNumberEncrypted: expect.stringMatching(/^hbds:/u),
      }),
      update: expect.objectContaining({
        maskedPhoneNumberHint: "*** 4567",
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        signupPhoneNumberEncrypted: expect.stringMatching(/^hbds:/u),
      }),
      where: {
        memberId: expect.any(String),
      },
    }));
  });

  it("recovers from a concurrent create conflict by refreshing the winning member row", async () => {
    const concurrentMember = makeMember({
      id: "member_123",
      suspendedAt: null,
    });
    const currentIdentity = makeIdentityRecord({
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
        findFirst: identityFindFirst,
        findUnique: identityFindUnique,
        upsert: identityUpsert,
      },
    } as never;

    await ensureHostedMemberForPhone({
      phoneNumber: "+15551234567",
      prisma,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(identityUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberId: "member_123",
      },
      update: expect.objectContaining({
        phoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        signupPhoneNumberEncrypted: expect.stringMatching(/^hbds:/u),
      }),
    }));
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

describe("prepareHostedInvitePhoneCode", () => {
  it("returns the stored signup phone and records only the transient send attempt on the local identity row", async () => {
    const hostedMemberIdentity = {
      findUnique: vi.fn().mockResolvedValue(makeIdentityRecord({
        memberId: "member_123",
        signupPhoneNumber: "+15551234567",
      })),
      update: vi.fn().mockResolvedValue({}),
    };
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity,
    } as never;

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).resolves.toEqual({
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
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(makeIdentityRecord({
          memberId: "member_123",
          signupPhoneNumber: null,
        })),
        update: vi.fn(),
      },
    } as never;

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: NOW,
        prisma,
      }),
    ).rejects.toMatchObject({
      code: "SIGNUP_PHONE_UNAVAILABLE",
      httpStatus: 409,
    });
  });

  it("rate limits repeated invite send-code requests", async () => {
    const update = vi.fn();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(makeIdentityRecord({
          memberId: "member_123",
          signupPhoneCodeSentAt: new Date("2026-04-07T01:00:30.000Z"),
          signupPhoneNumber: "+15551234567",
        })),
        update,
      },
    } as never;

    await expect(
      prepareHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:45.000Z"),
        prisma,
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
      findUnique: vi.fn().mockResolvedValue(makeIdentityRecord({
        memberId: "member_123",
        signupPhoneCodeSendAttemptId: "hbpc_confirm",
        signupPhoneCodeSendAttemptStartedAt: NOW,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: "+15551234567",
      })),
      update: vi.fn().mockResolvedValue({}),
    };
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity,
    } as never;

    await expect(
      confirmHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:08.000Z"),
        prisma,
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
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(makeIdentityRecord({
          memberId: "member_123",
          signupPhoneCodeSendAttemptId: "hbpc_current",
          signupPhoneCodeSendAttemptStartedAt: NOW,
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: "+15551234567",
        })),
        update,
      },
    } as never;

    await expect(
      confirmHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:20.000Z"),
        prisma,
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
      findUnique: vi.fn().mockResolvedValue(makeIdentityRecord({
        memberId: "member_123",
        signupPhoneCodeSendAttemptId: "hbpc_abort",
        signupPhoneCodeSendAttemptStartedAt: NOW,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: "+15551234567",
      })),
      update: vi.fn().mockResolvedValue({}),
    };
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity,
    } as never;

    await expect(
      abortHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:05.000Z"),
        prisma,
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
      },
    });
  });

  it("ignores stale abort requests so they cannot clear a later cooldown", async () => {
    const update = vi.fn();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedInvite: {
        findUnique: vi.fn().mockResolvedValue(makeInviteRecord()),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(makeIdentityRecord({
          memberId: "member_123",
          signupPhoneCodeSendAttemptId: "hbpc_current",
          signupPhoneCodeSendAttemptStartedAt: NOW,
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: "+15551234567",
        })),
        update,
      },
    } as never;

    await expect(
      abortHostedInvitePhoneCode({
        inviteCode: "invite-code",
        now: new Date("2026-04-07T01:00:05.000Z"),
        prisma,
        sendAttemptId: "hbpc_old",
      }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(update).not.toHaveBeenCalled();
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
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
      },
      where: {
        NOT: {
          memberId: "member_123",
        },
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      create: {
        linqChatIdEncrypted: expect.stringMatching(/^hbds:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
        memberId: "member_123",
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      },
      update: {
        linqChatIdEncrypted: expect.stringMatching(/^hbds:/u),
        linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:v1:/u),
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

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    billingStatus: "not_started",
    createdAt: NOW,
    id: "member_123",
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

function makeIdentityRecord(input: {
  memberId: string;
  phoneLookupKey?: string;
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
    phoneNumberVerifiedAt: input.phoneNumberVerifiedAt ?? null,
    privyUserIdEncrypted: encryptHostedWebNullableString({
      field: "hosted-member-identity.privy-user-id",
      memberId: input.memberId,
      value: input.privyUserId ?? null,
    }),
    privyUserLookupKey: input.privyUserLookupKey ?? null,
    signupPhoneCodeSendAttemptId: input.signupPhoneCodeSendAttemptId ?? null,
    signupPhoneCodeSendAttemptStartedAt: input.signupPhoneCodeSendAttemptStartedAt ?? null,
    signupPhoneCodeSentAt: input.signupPhoneCodeSentAt ?? null,
    signupPhoneNumberEncrypted: encryptHostedWebNullableString({
      field: "hosted-member-identity.signup-phone-number",
      memberId: input.memberId,
      value: input.signupPhoneNumber ?? null,
    }),
    walletAddressEncrypted: encryptHostedWebNullableString({
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
