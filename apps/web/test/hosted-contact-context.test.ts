import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findUnique = vi.fn();

  return {
    createHostedMemberReplyAliasRouteFromLookupKey: vi.fn(),
    findUnique,
    getHostedPageAuthSnapshot: vi.fn(),
    getPrisma: vi.fn(),
    prisma: {
      hostedMember: {
        findUnique,
      },
    },
    readHostedLinqLinePhoneNumberByLookupKey: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-email-reply-alias", () => ({
  createHostedMemberReplyAliasRouteFromLookupKey:
    mocks.createHostedMemberReplyAliasRouteFromLookupKey,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-phone-resolver", () => ({
  readHostedLinqLinePhoneNumberByLookupKey:
    mocks.readHostedLinqLinePhoneNumberByLookupKey,
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
    mocks.readHostedLinqLinePhoneNumberByLookupKey.mockResolvedValue(
      "+15550000002",
    );
    mocks.createHostedMemberReplyAliasRouteFromLookupKey.mockResolvedValue({
      address: "assistant+reply@example.test",
      replyAliasLookupKey: "reply-alias-key",
    });
    mocks.findUnique.mockResolvedValue(createContactRecord());
  });

  it("returns anonymous defaults without reading member data", async () => {
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
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(
      mocks.readHostedLinqLinePhoneNumberByLookupKey,
    ).not.toHaveBeenCalled();
  });

  it("uses opaque channel markers and the local Linq line without member-root decrypts", async () => {
    await expect(readHostedMurphContactContext()).resolves.toEqual({
      initialContactChannels: {
        email: true,
        telegram: true,
        text: true,
      },
      murphEmailAddress: "assistant+reply@example.test",
      murphPhoneNumber: "+15550000002",
    });

    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      select: {
        emailAuthorization: {
          select: {
            verifiedEmailAddressEncrypted: true,
            verifiedEmailLookupKey: true,
            verifiedEmailVerifiedAt: true,
          },
        },
        identity: {
          select: {
            phoneLookupKey: true,
            phoneNumberEncrypted: true,
            phoneNumberVerifiedAt: true,
          },
        },
        routing: {
          select: {
            linqRecipientPhoneLookupKey: true,
            replyAliasLookupKey: true,
            telegramUserLookupKey: true,
            telegramUserIdEncrypted: true,
          },
        },
      },
      where: { id: "member-1" },
    });
    expect(
      mocks.readHostedLinqLinePhoneNumberByLookupKey,
    ).toHaveBeenCalledWith({
      phoneNumberLookupKey: "linq-phone-key",
      prisma: mocks.prisma,
    });
    expect(mocks.createHostedMemberReplyAliasRouteFromLookupKey).toHaveBeenCalledWith({
      replyAliasLookupKey: "reply-alias-key",
    });
  });

  it("returns defaults when the authenticated member no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(readHostedMurphContactContext()).resolves.toEqual({
      initialContactChannels: {
        email: false,
        telegram: false,
        text: false,
      },
      murphEmailAddress: null,
      murphPhoneNumber: null,
    });
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(
      mocks.readHostedLinqLinePhoneNumberByLookupKey,
    ).not.toHaveBeenCalled();
    expect(
      mocks.createHostedMemberReplyAliasRouteFromLookupKey,
    ).not.toHaveBeenCalled();
  });

  it("skips optional resolution for absent private-state relations", async () => {
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
    });
    expect(
      mocks.readHostedLinqLinePhoneNumberByLookupKey,
    ).not.toHaveBeenCalled();
    expect(
      mocks.createHostedMemberReplyAliasRouteFromLookupKey,
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      channel: "email",
      record: createContactRecord({
        emailAuthorization: { verifiedEmailAddressEncrypted: null },
      }),
    },
    {
      channel: "email",
      record: createContactRecord({
        emailAuthorization: { verifiedEmailLookupKey: null },
      }),
    },
    {
      channel: "email",
      record: createContactRecord({
        emailAuthorization: { verifiedEmailVerifiedAt: null },
      }),
    },
    {
      channel: "text",
      record: createContactRecord({ identity: { phoneLookupKey: null } }),
    },
    {
      channel: "text",
      record: createContactRecord({ identity: { phoneNumberEncrypted: null } }),
    },
    {
      channel: "text",
      record: createContactRecord({ identity: { phoneNumberVerifiedAt: null } }),
    },
    {
      channel: "telegram",
      record: createContactRecord({
        routing: { telegramUserLookupKey: null },
      }),
    },
    {
      channel: "telegram",
      record: createContactRecord({
        routing: { telegramUserIdEncrypted: null },
      }),
    },
  ] as const)(
    "fails $channel closed when one required opaque marker is absent",
    async ({ channel, record }) => {
      mocks.findUnique.mockResolvedValue(record);

      const context = await readHostedMurphContactContext();

      expect(context.initialContactChannels).toEqual({
        email: channel !== "email",
        telegram: channel !== "telegram",
        text: channel !== "text",
      });
      expect(context.murphEmailAddress).toBe(
        channel === "email" ? null : "assistant+reply@example.test",
      );
      expect(context.murphPhoneNumber).toBe("+15550000002");
      if (channel === "email") {
        expect(
          mocks.createHostedMemberReplyAliasRouteFromLookupKey,
        ).not.toHaveBeenCalled();
      }
    },
  );

  it("fails email closed when the signed reply alias cannot be resolved", async () => {
    mocks.createHostedMemberReplyAliasRouteFromLookupKey.mockResolvedValue(null);

    const context = await readHostedMurphContactContext();

    expect(context.initialContactChannels.email).toBe(false);
    expect(context.murphEmailAddress).toBeNull();
  });

  it.each([
    {
      failure: "missing",
      reject: false,
    },
    {
      failure: "malformed",
      reject: true,
    },
  ])(
    "keeps email and Telegram available when the local Linq line is $failure",
    async ({ reject }) => {
      if (reject) {
        mocks.readHostedLinqLinePhoneNumberByLookupKey.mockRejectedValueOnce(
          new Error("Malformed local Linq line envelope."),
        );
      } else {
        mocks.readHostedLinqLinePhoneNumberByLookupKey.mockResolvedValueOnce(null);
      }

      await expect(readHostedMurphContactContext()).resolves.toEqual({
        initialContactChannels: {
          email: true,
          telegram: true,
          text: true,
        },
        murphEmailAddress: "assistant+reply@example.test",
        murphPhoneNumber: null,
      });
    },
  );

  it("keeps private member contact decryptors outside the generic projection", async () => {
    const [contextSource, wrapperSource] = await Promise.all([
      readFile(
        new URL(
          "../src/lib/hosted-onboarding/hosted-contact-context.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/components/murph/hosted-murph-contact-action.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    const genericContactSource = `${contextSource}\n${wrapperSource}`;

    expect(genericContactSource).not.toMatch(
      /domain-root-unwrap-cache|hosted-web\/encryption|member-private-codecs/u,
    );
    expect(genericContactSource).not.toContain("stripeCheckoutEmail");
    expect(genericContactSource).not.toContain("userEmailAddress");
  });
});

function createContactRecord(input: {
  emailAuthorization?: null | Partial<{
    verifiedEmailAddressEncrypted: string | null;
    verifiedEmailLookupKey: string | null;
    verifiedEmailVerifiedAt: Date | null;
  }>;
  identity?: null | Partial<{
    phoneLookupKey: string | null;
    phoneNumberEncrypted: string | null;
    phoneNumberVerifiedAt: Date | null;
  }>;
  routing?: null | Partial<{
    linqRecipientPhoneLookupKey: string | null;
    replyAliasLookupKey: string | null;
    telegramUserIdEncrypted: string | null;
    telegramUserLookupKey: string | null;
  }>;
} = {}) {
  return {
    emailAuthorization: input.emailAuthorization === null
      ? null
      : {
          verifiedEmailAddressEncrypted: "verified-email-ciphertext",
          verifiedEmailLookupKey: "verified-email-key",
          verifiedEmailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
          ...input.emailAuthorization,
        },
    identity: input.identity === null
      ? null
      : {
          phoneLookupKey: "member-phone-key",
          phoneNumberEncrypted: "phone-ciphertext",
          phoneNumberVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
          ...input.identity,
        },
    routing: input.routing === null
      ? null
      : {
          linqRecipientPhoneLookupKey: "linq-phone-key",
          replyAliasLookupKey: "reply-alias-key",
          telegramUserIdEncrypted: "telegram-ciphertext",
          telegramUserLookupKey: "telegram-user-key",
          ...input.routing,
        },
  };
}
