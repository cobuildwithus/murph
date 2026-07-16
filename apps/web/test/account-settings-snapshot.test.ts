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

import { getPrisma } from "@/src/lib/prisma";
import {
  readHostedAccountSettingsPageSnapshot,
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

  it("reuses the member aggregate for the Settings page billing and routing slices", async () => {
    const billingRef = {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    };
    const routing = {
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqRecipientPhone: null,
      telegramUserId: "456",
    };
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      billingRef,
      core: {
        billingStatus: "active",
        id: "member_123",
        suspendedAt: null,
      },
      emailAuthorization: null,
      identity: {
        memberId: "member_123",
        phoneLookupKey: "phone_lookup",
        phoneNumber: "+15550100002",
        phoneNumberVerifiedAt: new Date("2026-07-15T12:00:00.000Z"),
        privyUserId: "did:privy:user_123",
      },
      routing,
    });
    const prisma = getPrisma();
    mocks.getPrisma.mockClear();

    const result = await readHostedAccountSettingsPageSnapshot({
      memberId: "member_123",
      prisma,
    });

    expect(result.billingRef).toBe(billingRef);
    expect(result.routing).toBe(routing);
    expect(result.account).toMatchObject({
      assistant: {
        model: "gpt-5.6-terra",
      },
      phone: {
        number: "+15550100002",
        verifiedAt: "2026-07-15T12:00:00.000Z",
      },
      telegram: {
        telegramUserId: "456",
      },
    });
    expect(mocks.readHostedMemberSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(mocks.readHostedMemberAssistantModelPreference).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(mocks.findUniqueHostedMember).toHaveBeenCalledTimes(1);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns explicit null Settings slices when the member aggregate is absent", async () => {
    mocks.readHostedMemberSnapshot.mockResolvedValue(null);
    const prisma = getPrisma();
    mocks.getPrisma.mockClear();

    const result = await readHostedAccountSettingsPageSnapshot({
      memberId: "member_missing",
      prisma,
    });

    expect(result).toMatchObject({
      account: {
        assistant: {
          model: "gpt-5.6-terra",
        },
        email: {
          address: null,
          murphEmailAddress: null,
          verifiedAt: null,
        },
        phone: {
          number: null,
          verifiedAt: null,
        },
        telegram: {
          telegramUserId: null,
        },
      },
      billingRef: null,
      routing: null,
    });
    expect(mocks.readHostedMemberSnapshot).toHaveBeenCalledOnce();
    expect(mocks.readHostedMemberSnapshot).toHaveBeenCalledWith({
      memberId: "member_missing",
      prisma,
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
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
