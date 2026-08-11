import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedEmailUserReplyAliasRoute } from "@murphai/hosted-execution/hosted-email";

const mocks = vi.hoisted(() => ({
  findUniqueHostedMember: vi.fn(),
  getPrisma: vi.fn(),
  projectHostedMemberEmailAuthorizationState: vi.fn(),
  readHostedMemberBillingPrivateState: vi.fn(),
  readHostedMemberIdentityPhoneNumber: vi.fn(),
  readHostedMemberRoutingPrivateState: vi.fn(),
  resolveHostedMemberAssistantModel: vi.fn(),
  runWithHostedDomainRootUnwrapCache: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({
  runWithHostedDomainRootUnwrapCache:
    mocks.runWithHostedDomainRootUnwrapCache,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    projectHostedMemberEmailAuthorizationState:
      mocks.projectHostedMemberEmailAuthorizationState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/assistant-model-preference")
  >("@/src/lib/hosted-onboarding/assistant-model-preference");

  return {
    ...actual,
    resolveHostedMemberAssistantModel:
      mocks.resolveHostedMemberAssistantModel,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-private-codecs", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/member-private-codecs")
  >("@/src/lib/hosted-onboarding/member-private-codecs");

  return {
    ...actual,
    readHostedMemberBillingPrivateState:
      mocks.readHostedMemberBillingPrivateState,
    readHostedMemberIdentityPhoneNumber:
      mocks.readHostedMemberIdentityPhoneNumber,
    readHostedMemberRoutingPrivateState:
      mocks.readHostedMemberRoutingPrivateState,
  };
});

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
    mocks.projectHostedMemberEmailAuthorizationState.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: null,
      verifiedEmail: null,
    });
    mocks.readHostedMemberBillingPrivateState.mockResolvedValue({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionScheduleId: null,
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValue(null);
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: null,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    });
    mocks.resolveHostedMemberAssistantModel.mockReturnValue({
      configurationAvailable: true,
      dormantSolPreference: false,
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
    mocks.runWithHostedDomainRootUnwrapCache.mockImplementation(
      async (run: () => Promise<unknown>) => run(),
    );
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
    mocks.findUniqueHostedMember.mockResolvedValue(makeSettingsMemberRecord({
      emailAuthorization: {
        memberId: "member_123",
        stripeCheckoutEmailAddressEncrypted: "encrypted-checkout-email",
        stripeCheckoutEmailCollectedAt: new Date("2026-05-01T00:00:00.000Z"),
        verifiedEmailAddressEncrypted: null,
        verifiedEmailLookupKey: null,
        verifiedEmailVerifiedAt: null,
      },
    }));
    mocks.projectHostedMemberEmailAuthorizationState.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      stripeCheckoutEmail: {
        address: "payer@example.com",
        collectedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
      verifiedEmail: null,
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
    expect(mocks.projectHostedMemberEmailAuthorizationState).toHaveBeenCalledWith({
      directPublicSenderAddressEncrypted: null,
      directPublicSenderAuthorizedAt: null,
      directPublicSenderLookupKey: null,
      memberId: "member_123",
      stripeCheckoutEmailAddressEncrypted: "encrypted-checkout-email",
      stripeCheckoutEmailCollectedAt: new Date("2026-05-01T00:00:00.000Z"),
      verifiedEmailAddressEncrypted: null,
      verifiedEmailLookupKey: null,
      verifiedEmailVerifiedAt: null,
    }, expect.any(Object));
  });

  it("reuses the member aggregate for the Settings page billing and routing slices", async () => {
    const billingRecord = {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerIdEncrypted: "encrypted-customer",
      stripeSubscriptionIdEncrypted: "encrypted-subscription",
    };
    const routingRecord = {
      linqRecipientPhoneEncrypted: "encrypted-home-line",
      memberId: "member_123",
      pendingLinqRecipientPhoneEncrypted: null,
      replyAliasLookupKey: null,
      telegramUserIdEncrypted: "encrypted-telegram",
    };
    mocks.findUniqueHostedMember.mockResolvedValue(makeSettingsMemberRecord({
      billingRef: billingRecord,
      identity: {
        memberId: "member_123",
        phoneNumberEncrypted: "encrypted-phone",
        phoneNumberVerifiedAt: new Date("2026-07-15T12:00:00.000Z"),
      },
      routing: routingRecord,
    }));
    mocks.readHostedMemberBillingPrivateState.mockResolvedValue({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      stripeSubscriptionScheduleId: null,
    });
    mocks.readHostedMemberIdentityPhoneNumber.mockResolvedValue("+15550100002");
    mocks.readHostedMemberRoutingPrivateState.mockResolvedValue({
      linqChatId: null,
      linqRecipientPhone: "+15550100001",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: "456",
    });
    const prisma = getPrisma();
    mocks.getPrisma.mockClear();

    const result = await readHostedAccountSettingsPageSnapshot({
      memberId: "member_123",
      prisma,
    });

    expect(result.billingRef).toEqual({
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
      scheduledBillingEffectiveAt: null,
      scheduledBillingPlanCode: null,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    expect(result.routing).toEqual({
      linqRecipientPhone: "+15550100001",
      pendingLinqRecipientPhone: null,
    });
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
    expect(mocks.findUniqueHostedMember).toHaveBeenCalledTimes(1);
    const query = mocks.findUniqueHostedMember.mock.calls[0]?.[0];
    expect(query).toEqual({
      select: expect.any(Object),
      where: { id: "member_123" },
    });
    expect(query.select).toHaveProperty("assistantPersona", true);
    expect(query.select).toHaveProperty("assistantDetail", true);
    expect(query.select).toHaveProperty("assistantHumor", true);
    expect(query.select).toHaveProperty("assistantPush", true);
    expect(query.select).toHaveProperty("assistantUnhinged", true);
    expect(query.select.identity.select).toEqual({
      memberId: true,
      phoneNumberEncrypted: true,
      phoneNumberVerifiedAt: true,
    });
    expect(query.select.routing.select).toEqual({
      linqRecipientPhoneEncrypted: true,
      memberId: true,
      pendingLinqRecipientPhoneEncrypted: true,
      replyAliasLookupKey: true,
      telegramUserIdEncrypted: true,
    });
    expect(query.select.emailAuthorization.select).toEqual({
      memberId: true,
      stripeCheckoutEmailAddressEncrypted: true,
      stripeCheckoutEmailCollectedAt: true,
      verifiedEmailAddressEncrypted: true,
      verifiedEmailLookupKey: true,
      verifiedEmailVerifiedAt: true,
    });
    expect(query.select.billingRef.select).toEqual({
      currentBillingPhase: true,
      currentBillingPlanCode: true,
      currentCheckoutOffer: true,
      currentPeriodEnd: true,
      memberId: true,
      scheduledBillingEffectiveAt: true,
      scheduledBillingPlanCode: true,
      stripeCustomerIdEncrypted: true,
      stripeSubscriptionIdEncrypted: true,
    });
    expect(mocks.runWithHostedDomainRootUnwrapCache).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMemberBillingPrivateState).toHaveBeenCalledWith(
      billingRecord,
      prisma,
    );
    expect(mocks.readHostedMemberIdentityPhoneNumber).toHaveBeenCalledWith({
      memberId: "member_123",
      phoneNumberEncrypted: "encrypted-phone",
      phoneNumberVerifiedAt: new Date("2026-07-15T12:00:00.000Z"),
    }, prisma);
    expect(mocks.readHostedMemberRoutingPrivateState).toHaveBeenCalledWith({
      ...routingRecord,
      linqChatIdEncrypted: null,
      pendingLinqChatIdEncrypted: null,
      pendingLinqParticipantContactEncrypted: null,
    }, prisma);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns explicit null Settings slices when the member aggregate is absent", async () => {
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
    expect(mocks.findUniqueHostedMember).toHaveBeenCalledOnce();
    expect(mocks.findUniqueHostedMember).toHaveBeenCalledWith({
      select: expect.any(Object),
      where: { id: "member_missing" },
    });
    expect(mocks.runWithHostedDomainRootUnwrapCache).not.toHaveBeenCalled();
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("prefers the verified email over the Stripe checkout email", async () => {
    const replyAlias = await createHostedEmailUserReplyAliasRoute({
      domain: "mail.example.test",
      localPart: "murph",
      signingSecret: "test-email-signing-secret",
      userId: "member_123",
    });
    mocks.findUniqueHostedMember.mockResolvedValue(makeSettingsMemberRecord({
      emailAuthorization: {
        memberId: "member_123",
        stripeCheckoutEmailAddressEncrypted: "encrypted-checkout-email",
        stripeCheckoutEmailCollectedAt: new Date("2026-05-01T00:00:00.000Z"),
        verifiedEmailAddressEncrypted: "encrypted-verified-email",
        verifiedEmailLookupKey: "lookup_verified",
        verifiedEmailVerifiedAt: new Date("2026-05-02T00:00:00.000Z"),
      },
      routing: {
        linqRecipientPhoneEncrypted: null,
        memberId: "member_123",
        pendingLinqRecipientPhoneEncrypted: null,
        replyAliasLookupKey: replyAlias.aliasKey,
        telegramUserIdEncrypted: null,
      },
    }));
    mocks.projectHostedMemberEmailAuthorizationState.mockResolvedValue({
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

  it("projects web style levels while keeping Unhinged out of Settings", async () => {
    mocks.findUniqueHostedMember.mockResolvedValue(makeSettingsMemberRecord({
      assistantDetail: 8,
      assistantHumor: 7,
      assistantPersona: "scientist-with-classic",
      assistantPush: 6,
      assistantUnhinged: 9,
    }));

    const snapshot = await readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    });

    expect(snapshot.assistant?.persona).toBe("scientist-with-classic");
    expect(snapshot.assistant?.personality).toEqual({
      detail: 8,
      humor: 7,
      push: 6,
    });
    expect(snapshot.assistant?.personality).not.toHaveProperty("unhinged");
  });

  it("normalizes assistant preferences for settings display", async () => {
    mocks.findUniqueHostedMember.mockResolvedValue(makeSettingsMemberRecord({
      assistantPersona: "scientist-with-classic",
      assistantTone: "casual",
      assistantVoice: "warm",
    }));

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      assistant: {
        configurationAvailable: true,
        dormantSolPreference: false,
        model: "gpt-5.6-terra",
        persona: "scientist-with-classic",
        personality: {
          detail: null,
          humor: null,
          push: null,
        },
        provider: "openai",
        solAvailable: false,
        tone: "casual",
        voice: "warm",
      },
    });

    // Roster ids can be retired, so stored values that no longer resolve fall
    // back to the defaults instead of leaking a stale id into the settings UI.
    mocks.findUniqueHostedMember.mockResolvedValue(makeSettingsMemberRecord({
      assistantPersona: "retired-persona",
      assistantTone: "LOUD",
      assistantVoice: "retired-voice",
    }));

    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      assistant: {
        model: "gpt-5.6-terra",
        persona: null,
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
    await expect(readHostedAccountSettingsSnapshot({
      memberId: "member_123",
    })).resolves.toMatchObject({
      assistant: {
        model: "gpt-5.6-terra",
        persona: null,
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
    mocks.findUniqueHostedMember.mockResolvedValue(makeSettingsMemberRecord());
    mocks.resolveHostedMemberAssistantModel.mockReturnValue({
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
    expect(mocks.resolveHostedMemberAssistantModel).toHaveBeenCalledWith(
      expect.objectContaining({ billingStatus: "active" }),
    );
  });

  it("includes canonical configuration availability and dormant Sol state", async () => {
    mocks.findUniqueHostedMember.mockResolvedValue(makeSettingsMemberRecord());
    mocks.resolveHostedMemberAssistantModel.mockReturnValue({
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

function makeSettingsMemberRecord(
  input: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    accountGroupMemberships: [],
    assistantDetail: null,
    assistantHumor: null,
    assistantModelPreference: null,
    assistantPersona: null,
    assistantProviderPreference: null,
    assistantPush: null,
    assistantUnhinged: null,
    assistantReasoningEffortPreference: null,
    assistantTone: null,
    assistantVoice: null,
    billingRef: null,
    billingStatus: "active",
    emailAuthorization: null,
    identity: null,
    routing: null,
    suspendedAt: null,
    threadContainer: null,
    ...input,
  };
}

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
