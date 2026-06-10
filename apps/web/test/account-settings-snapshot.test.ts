import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedEmailUserReplyAliasRoute } from "@murphai/hosted-execution/hosted-email";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
  };
});

import {
  readHostedAccountSettingsSnapshot,
  withServerApprovedPrivyAccountHints,
  type HostedAccountSettingsSnapshot,
} from "@/src/lib/hosted-onboarding/account-settings-snapshot";

const originalHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
const originalHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
const originalHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;

describe("hosted account settings snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_LOCAL_PART = "murph";
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "test-email-signing-secret";
    mocks.getPrisma.mockReturnValue({
      readonly: true,
    });
  });

  afterEach(() => {
    restoreEnv("HOSTED_EMAIL_DOMAIN", originalHostedEmailDomain);
    restoreEnv("HOSTED_EMAIL_LOCAL_PART", originalHostedEmailLocalPart);
    restoreEnv("HOSTED_EMAIL_SIGNING_SECRET", originalHostedEmailSigningSecret);
  });

  it("prefills settings from the unverified Stripe checkout email when no verified email exists", async () => {
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      emailAuthorization: {
        directPublicSender: null,
        memberId: "member_123",
        stripeCheckoutEmail: {
          address: "payer@example.com",
          collectedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
        verifiedEmail: null,
      },
      identity: null,
      routing: null,
    });

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      email: {
        address: "payer@example.com",
        murphEmailAddress: null,
        verifiedAt: null,
      },
    });
  });

  it("prefers the verified email over the Stripe checkout email", async () => {
    const replyAlias = await createHostedEmailUserReplyAliasRoute({
      domain: "mail.example.test",
      localPart: "murph",
      signingSecret: "test-email-signing-secret",
      userId: "member_123",
    });
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      emailAuthorization: {
        directPublicSender: null,
        memberId: "member_123",
        stripeCheckoutEmail: {
          address: "payer@example.com",
          collectedAt: new Date("2026-05-01T00:00:00.000Z"),
        },
        verifiedEmail: {
          address: "verified@example.com",
          lookupKey: "lookup_verified",
          verifiedAt: new Date("2026-05-02T00:00:00.000Z"),
        },
      },
      identity: null,
      routing: {
        replyAliasLookupKey: replyAlias.aliasKey,
      },
    });

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      email: {
        address: "verified@example.com",
        murphEmailAddress: replyAlias.address,
        verifiedAt: "2026-05-02T00:00:00.000Z",
      },
    });
  });

  it("adds a server-approved Privy Telegram username only when it matches the stored Telegram id", () => {
    expect(withServerApprovedPrivyAccountHints({
      snapshot: makeAccountSettingsSnapshot({ telegramUserId: "456" }),
      serverApprovedPrivyLinkedAccounts: [
        {
          id: 456,
          type: "telegram",
          username: "sample_user",
        },
      ],
    })).toMatchObject({
      telegram: {
        telegramUserId: "456",
        username: "sample_user",
      },
    });
  });

  it("does not add a server-approved Privy Telegram username from a different Telegram id", () => {
    expect(withServerApprovedPrivyAccountHints({
      snapshot: makeAccountSettingsSnapshot({ telegramUserId: "456" }),
      serverApprovedPrivyLinkedAccounts: [
        {
          id: 789,
          type: "telegram",
          username: "sample_user",
        },
      ],
    })).toMatchObject({
      telegram: {
        telegramUserId: "456",
        username: null,
      },
    });
  });

  it("marks whether the server-approved Privy session has an email linked", () => {
    expect(withServerApprovedPrivyAccountHints({
      snapshot: makeAccountSettingsSnapshot({ telegramUserId: null }),
      serverApprovedPrivyLinkedAccounts: [
        {
          address: "member@example.com",
          type: "email",
        },
      ],
    })).toMatchObject({
      email: {
        privyEmailLinked: true,
      },
    });

    expect(withServerApprovedPrivyAccountHints({
      snapshot: makeAccountSettingsSnapshot({ telegramUserId: null }),
      serverApprovedPrivyLinkedAccounts: [],
    })).toMatchObject({
      email: {
        privyEmailLinked: false,
      },
    });

    expect(withServerApprovedPrivyAccountHints({
      snapshot: makeAccountSettingsSnapshot({ telegramUserId: null }),
      serverApprovedPrivyLinkedAccounts: null,
    })).toMatchObject({
      email: {
        privyEmailLinked: null,
      },
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function makeAccountSettingsSnapshot(input: {
  telegramUserId: string | null;
}): HostedAccountSettingsSnapshot {
  return {
    email: {
      address: null,
      verifiedAt: null,
    },
    phone: {
      number: null,
      verifiedAt: null,
    },
    telegram: {
      telegramUserId: input.telegramUserId,
    },
  };
}
