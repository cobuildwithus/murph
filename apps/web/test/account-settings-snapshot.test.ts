import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedEmailUserReplyAliasRoute } from "@murphai/hosted-execution/hosted-email";

const mocks = vi.hoisted(() => ({
  findUniqueHostedMember: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberAssistantModelPreference: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  readHostedMemberAssistantModelPreference:
    mocks.readHostedMemberAssistantModelPreference,
}));

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
    mocks.findUniqueHostedMember.mockResolvedValue(null);
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      configurationAvailable: true,
      dormantSolPreference: false,
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
    mocks.getPrisma.mockReturnValue({
      hostedMember: {
        findUnique: mocks.findUniqueHostedMember,
      },
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

  it("normalizes assistant preferences for settings display", async () => {
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      core: null,
      emailAuthorization: null,
      identity: null,
      routing: null,
    });
    mocks.findUniqueHostedMember.mockResolvedValue({
      assistantDetail: 8,
      assistantHumor: 7,
      assistantPush: 6,
      assistantTone: "casual",
      assistantVoice: "warm",
    });

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      assistant: {
        configurationAvailable: true,
        dormantSolPreference: false,
        model: "gpt-5.6-terra",
        personality: {
          detail: 8,
          humor: 7,
          push: 6,
        },
        solAvailable: false,
        tone: "casual",
        voice: "warm",
      },
    });

    // Roster ids can be retired, so stored values that no longer resolve fall
    // back to the defaults instead of leaking a stale id into the settings UI.
    mocks.findUniqueHostedMember.mockResolvedValue({
      assistantDetail: 12,
      assistantHumor: -1,
      assistantPush: 2.5,
      assistantTone: "stale-tone",
      assistantVoice: "stale-voice",
    });

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      assistant: {
        model: "gpt-5.6-terra",
        personality: {
          detail: null,
          humor: null,
          push: null,
        },
        solAvailable: false,
        tone: null,
        voice: null,
      },
    });
  });

  it("returns empty assistant preferences when the member row is missing", async () => {
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      core: null,
      emailAuthorization: null,
      identity: null,
      routing: null,
    });
    mocks.findUniqueHostedMember.mockResolvedValue(null);

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      assistant: {
        model: "gpt-5.6-terra",
        personality: {
          detail: null,
          humor: null,
          push: null,
        },
        solAvailable: false,
        tone: null,
        voice: null,
      },
    });
  });

  it("includes the canonical effective model and Sol availability", async () => {
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      core: null,
      emailAuthorization: null,
      identity: null,
      routing: null,
    });
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      configurationAvailable: true,
      dormantSolPreference: false,
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      solAvailable: true,
    });

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      assistant: {
        configurationAvailable: true,
        dormantSolPreference: false,
        model: "gpt-5.6-sol",
        solAvailable: true,
      },
    });
    expect(mocks.readHostedMemberAssistantModelPreference).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.objectContaining({ readonly: true }),
    });
  });

  it("includes canonical configuration availability and dormant Sol state", async () => {
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      core: null,
      emailAuthorization: null,
      identity: null,
      routing: null,
    });
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      configurationAvailable: true,
      dormantSolPreference: true,
      model: "gpt-5.6-terra",
      solAvailable: false,
    });

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      assistant: {
        configurationAvailable: true,
        dormantSolPreference: true,
        model: "gpt-5.6-terra",
        solAvailable: false,
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
          latest_verified_at: 1771891200,
          type: "email",
        },
      ],
    })).toMatchObject({
      email: {
        privyEmailLinked: true,
        privyEmailSyncRequired: true,
      },
    });

    expect(withServerApprovedPrivyAccountHints({
      snapshot: makeAccountSettingsSnapshot({ telegramUserId: null }),
      serverApprovedPrivyLinkedAccounts: [],
    })).toMatchObject({
      email: {
        privyEmailLinked: false,
        privyEmailSyncRequired: false,
      },
    });

    expect(withServerApprovedPrivyAccountHints({
      snapshot: makeAccountSettingsSnapshot({ telegramUserId: null }),
      serverApprovedPrivyLinkedAccounts: null,
    })).toMatchObject({
      email: {
        privyEmailLinked: null,
        privyEmailSyncRequired: null,
      },
    });
  });

  it("detects when the fresh verified Privy email differs from canonical authorization", () => {
    const snapshot = {
      ...makeAccountSettingsSnapshot({ telegramUserId: null }),
      email: {
        address: "canonical@example.com",
        verifiedAt: "2026-07-01T00:00:00.000Z",
      },
    };

    expect(withServerApprovedPrivyAccountHints({
      snapshot,
      serverApprovedPrivyLinkedAccounts: [
        {
          address: "canonical@example.com",
          latest_verified_at: 1771891200,
          type: "email",
        },
      ],
    }).email.privyEmailSyncRequired).toBe(false);

    expect(withServerApprovedPrivyAccountHints({
      snapshot,
      serverApprovedPrivyLinkedAccounts: [
        {
          address: "replacement@example.com",
          latest_verified_at: 1771891200,
          type: "email",
        },
      ],
    }).email.privyEmailSyncRequired).toBe(true);
  });

  it("uses the same newest verified Privy email selection regardless of provider order", () => {
    const snapshot = {
      ...makeAccountSettingsSnapshot({ telegramUserId: null }),
      email: {
        address: "canonical@example.com",
        verifiedAt: "2026-07-01T00:00:00.000Z",
      },
    };
    const variants = [
      [
        { address: "unverified@example.com", type: "email" },
        { address: "replacement@example.com", latest_verified_at: 1771891200, type: "email" },
      ],
      [
        { address: "canonical@example.com", latest_verified_at: 1771804800, type: "email" },
        { address: "replacement@example.com", latest_verified_at: 1771891200, type: "email" },
      ],
    ];

    for (const linkedAccounts of variants) {
      for (const orderedAccounts of [linkedAccounts, [...linkedAccounts].reverse()]) {
        expect(withServerApprovedPrivyAccountHints({
          snapshot,
          serverApprovedPrivyLinkedAccounts: orderedAccounts,
        }).email).toMatchObject({
          privyEmailLinked: true,
          privyEmailSyncRequired: true,
        });
      }
    }
  });

  it("fails closed when equally recent verified Privy emails conflict", () => {
    const snapshot = {
      ...makeAccountSettingsSnapshot({ telegramUserId: null }),
      email: {
        address: "canonical@example.com",
        verifiedAt: "2026-07-01T00:00:00.000Z",
      },
    };
    const linkedAccounts = [
      { address: "canonical@example.com", latest_verified_at: 1771891200, type: "email" },
      { address: "replacement@example.com", latest_verified_at: 1771891200, type: "email" },
    ];

    for (const orderedAccounts of [linkedAccounts, [...linkedAccounts].reverse()]) {
      expect(withServerApprovedPrivyAccountHints({
        snapshot,
        serverApprovedPrivyLinkedAccounts: orderedAccounts,
      }).email).toMatchObject({
        privyEmailLinked: true,
        privyEmailSyncRequired: false,
      });
    }
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
