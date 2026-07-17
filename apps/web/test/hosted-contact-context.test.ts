import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findUnique = vi.fn();

  return {
    createHostedMemberReplyAliasRouteFromLookupKey: vi.fn(),
    decryptHostedWebNullableString: vi.fn(),
    findUnique,
    getHostedPageAuthSnapshot: vi.fn(),
    getPrisma: vi.fn(),
    prisma: {
      hostedMember: {
        findUnique,
      },
    },
    readHostedMemberIdentityPhoneNumber: vi.fn(),
    readHostedMemberRoutingTelegramPrivateState: vi.fn(),
    runWithHostedDomainRootUnwrapCache: vi.fn(
      async (run: () => Promise<unknown>) => await run(),
    ),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  runWithHostedDomainRootUnwrapCache:
    mocks.runWithHostedDomainRootUnwrapCache,
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: mocks.decryptHostedWebNullableString,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-email-reply-alias", () => ({
  createHostedMemberReplyAliasRouteFromLookupKey:
    mocks.createHostedMemberReplyAliasRouteFromLookupKey,
}));

vi.mock("@/src/lib/hosted-onboarding/member-private-codecs", () => ({
  readHostedMemberIdentityPhoneNumber:
    mocks.readHostedMemberIdentityPhoneNumber,
  readHostedMemberRoutingTelegramPrivateState:
    mocks.readHostedMemberRoutingTelegramPrivateState,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

type HostedContactContextModule = typeof import(
  "@/src/lib/hosted-onboarding/hosted-contact-context"
);

let readHostedMurphContactContext:
  HostedContactContextModule["readHostedMurphContactContext"];

describe("hosted contact context", () => {
  beforeAll(async () => {
    ({ readHostedMurphContactContext } = await import(
      "@/src/lib/hosted-onboarding/hosted-contact-context"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticatedMember: { id: "member-1" },
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValue("+15550000001");
    mocks.readHostedMemberRoutingTelegramPrivateState.mockResolvedValue({
      telegramThreadId: "direct:telegram-1",
      telegramUserId: "telegram-1",
    });
    mocks.decryptHostedWebNullableString.mockImplementation(
      async ({ value }: { value: string | null | undefined }) => {
        const decryptedByCiphertext = new Map([
          ["linq-phone-ciphertext", "+15550000002"],
          ["stripe-email-ciphertext", "checkout@example.test"],
          ["verified-email-ciphertext", "verified@example.test"],
        ]);
        return value ? decryptedByCiphertext.get(value) ?? null : null;
      },
    );
    mocks.createHostedMemberReplyAliasRouteFromLookupKey.mockResolvedValue({
      address: "assistant+reply@example.test",
      replyAliasLookupKey: "reply-alias-key",
    });
    mocks.findUnique.mockResolvedValue(createContactRecord());
  });

  it("returns anonymous defaults without reading or decrypting member data", async () => {
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticatedMember: null,
    });

    await expect(readHostedMurphContactContext()).resolves.toEqual({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: false,
      },
      murphEmailAddress: null,
      murphPhoneNumber: null,
      userEmailAddress: null,
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.runWithHostedDomainRootUnwrapCache).not.toHaveBeenCalled();
  });

  it("uses one narrow member read and one unwrap-cache scope for contact options", async () => {
    await expect(readHostedMurphContactContext()).resolves.toEqual({
      initialContactChannels: {
        email: true,
        telegram: true,
        text: true,
      },
      murphEmailAddress: "assistant+reply@example.test",
      murphPhoneNumber: "+15550000002",
      userEmailAddress: "verified@example.test",
    });

    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      select: {
        emailAuthorization: {
          select: {
            memberId: true,
            stripeCheckoutEmailAddressEncrypted: true,
            stripeCheckoutEmailCollectedAt: true,
            verifiedEmailAddressEncrypted: true,
            verifiedEmailLookupKey: true,
            verifiedEmailVerifiedAt: true,
          },
        },
        identity: {
          select: {
            memberId: true,
            phoneNumberEncrypted: true,
          },
        },
        routing: {
          select: {
            linqRecipientPhoneEncrypted: true,
            memberId: true,
            replyAliasLookupKey: true,
            telegramUserIdEncrypted: true,
          },
        },
      },
      where: { id: "member-1" },
    });
    expect(mocks.runWithHostedDomainRootUnwrapCache).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberIdentityPhoneNumber).toHaveBeenCalledWith(
      {
        memberId: "member-1",
        phoneNumberEncrypted: "phone-ciphertext",
      },
      mocks.prisma,
    );
    expect(mocks.readHostedMemberRoutingTelegramPrivateState).toHaveBeenCalledWith(
      {
        linqRecipientPhoneEncrypted: "linq-phone-ciphertext",
        memberId: "member-1",
        replyAliasLookupKey: "reply-alias-key",
        telegramUserIdEncrypted: "telegram-ciphertext",
      },
      mocks.prisma,
    );
    expect(mocks.decryptHostedWebNullableString).toHaveBeenNthCalledWith(1, {
      field: "hosted-member-routing.home-linq-recipient-phone",
      memberId: "member-1",
      prisma: mocks.prisma,
      value: "linq-phone-ciphertext",
    });
    expect(mocks.decryptHostedWebNullableString).toHaveBeenNthCalledWith(2, {
      field: "hosted-member-email-authorization.verified-email",
      memberId: "member-1",
      prisma: mocks.prisma,
      value: "verified-email-ciphertext",
    });
    expect(mocks.decryptHostedWebNullableString).toHaveBeenNthCalledWith(3, {
      field: "hosted-member-email-authorization.stripe-checkout-email",
      memberId: "member-1",
      prisma: mocks.prisma,
      value: "stripe-email-ciphertext",
    });
    expect(mocks.createHostedMemberReplyAliasRouteFromLookupKey).toHaveBeenCalledWith({
      replyAliasLookupKey: "reply-alias-key",
    });
  });

  it("returns defaults without decrypting when the authenticated member no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(readHostedMurphContactContext()).resolves.toEqual({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: false,
      },
      murphEmailAddress: null,
      murphPhoneNumber: null,
      userEmailAddress: null,
    });
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.runWithHostedDomainRootUnwrapCache).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberIdentityPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingTelegramPrivateState).not.toHaveBeenCalled();
    expect(mocks.decryptHostedWebNullableString).not.toHaveBeenCalled();
  });

  it("skips decrypts for absent optional private-state relations", async () => {
    mocks.findUnique.mockResolvedValue({
      emailAuthorization: null,
      identity: null,
      routing: null,
    });

    await expect(readHostedMurphContactContext()).resolves.toEqual({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: false,
      },
      murphEmailAddress: null,
      murphPhoneNumber: null,
      userEmailAddress: null,
    });
    expect(mocks.readHostedMemberIdentityPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingTelegramPrivateState).not.toHaveBeenCalled();
    expect(mocks.decryptHostedWebNullableString).not.toHaveBeenCalled();
    expect(mocks.createHostedMemberReplyAliasRouteFromLookupKey).not.toHaveBeenCalled();
  });

  it("uses the checkout email fallback unless the verified email fact is complete", async () => {
    mocks.findUnique.mockResolvedValue(createContactRecord({
      verifiedEmailLookupKey: null,
      verifiedEmailVerifiedAt: null,
    }));

    await expect(readHostedMurphContactContext()).resolves.toEqual({
      initialContactChannels: {
        email: false,
        telegram: true,
        text: true,
      },
      murphEmailAddress: null,
      murphPhoneNumber: "+15550000002",
      userEmailAddress: "checkout@example.test",
    });
    expect(mocks.createHostedMemberReplyAliasRouteFromLookupKey).not.toHaveBeenCalled();
  });

  it("does not expose a checkout email without its collection timestamp", async () => {
    mocks.findUnique.mockResolvedValue(createContactRecord({
      stripeCheckoutEmailCollectedAt: null,
      verifiedEmailLookupKey: null,
      verifiedEmailVerifiedAt: null,
    }));

    const context = await readHostedMurphContactContext();

    expect(context.initialContactChannels.email).toBe(false);
    expect(context.murphEmailAddress).toBeNull();
    expect(context.userEmailAddress).toBeNull();
    expect(mocks.createHostedMemberReplyAliasRouteFromLookupKey).not.toHaveBeenCalled();
  });
});

function createContactRecord(emailOverrides: {
  stripeCheckoutEmailCollectedAt?: Date | null;
  verifiedEmailLookupKey?: string | null;
  verifiedEmailVerifiedAt?: Date | null;
} = {}) {
  return {
    emailAuthorization: {
      memberId: "member-1",
      stripeCheckoutEmailAddressEncrypted: "stripe-email-ciphertext",
      stripeCheckoutEmailCollectedAt:
        emailOverrides.stripeCheckoutEmailCollectedAt === undefined
          ? new Date("2026-01-02T00:00:00.000Z")
          : emailOverrides.stripeCheckoutEmailCollectedAt,
      verifiedEmailAddressEncrypted: "verified-email-ciphertext",
      verifiedEmailLookupKey:
        emailOverrides.verifiedEmailLookupKey === undefined
          ? "verified-email-key"
          : emailOverrides.verifiedEmailLookupKey,
      verifiedEmailVerifiedAt:
        emailOverrides.verifiedEmailVerifiedAt === undefined
          ? new Date("2026-01-01T00:00:00.000Z")
          : emailOverrides.verifiedEmailVerifiedAt,
    },
    identity: {
      memberId: "member-1",
      phoneNumberEncrypted: "phone-ciphertext",
    },
    routing: {
      linqRecipientPhoneEncrypted: "linq-phone-ciphertext",
      memberId: "member-1",
      replyAliasLookupKey: "reply-alias-key",
      telegramUserIdEncrypted: "telegram-ciphertext",
    },
  };
}
