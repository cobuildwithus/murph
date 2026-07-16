import assert from "node:assert/strict";

import { HostedBillingStatus } from "@prisma/client";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getHostedOnboardingEnvironment: vi.fn(),
  getHostedPrivySession: vi.fn(),
  getPrisma: vi.fn(),
  CustomizeMurphSettings: vi.fn((props: {
    assistant?: unknown;
    murphPhoneNumber?: string | null;
    openVoiceLink?: boolean;
    voiceTestContactOption?: unknown;
  }) =>
    React.createElement(
      "div",
      null,
      `Customize murph settings ${String(props.murphPhoneNumber ?? "")}`,
    )),
  HostedAccountSettingsCards: vi.fn((props: {
    account: unknown;
    murphPhoneNumber?: string | null;
    openEmailLink?: boolean;
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted account settings ${String(props.murphPhoneNumber ?? "")}`,
    )),
  resolveMurphContactOptions: vi.fn(() => [{
    href: "sms:+15550100001?body=voice%20test",
    kind: "text",
    label: "Messages",
  }]),
  HostedAssistantModelSettings: vi.fn((props: {
    canUpgradeToEdge: boolean;
    configurationAvailable: boolean;
    initialDormantSolPreference: boolean;
    initialModel: string;
    solAvailable: boolean;
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted assistant model ${props.initialModel} ${String(props.solAvailable)}`,
    )),
  HostedBillingSettings: vi.fn((props: {
    authenticated: boolean;
    canStartFamily?: boolean;
    canStartPaidPulse?: boolean;
    canUpgradeToEdge?: boolean;
    currentBillingPhase?: unknown;
    currentCheckoutOffer?: unknown;
    currentBillingPlanCode?: unknown;
    familyState?: "none" | "owner" | "sponsored";
    usageCreditBalanceUsdMicros?: string | null;
    usageStatus?: unknown;
    usageTopUpInitialOpen?: boolean;
    usageTopUpOffers?: readonly unknown[];
    usageTopUpPurchaseReturn?: unknown;
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted billing settings ${String(props.authenticated)} ${String(props.canUpgradeToEdge ?? false)} ${String(props.currentBillingPlanCode ?? "")}`,
    )),
  HostedDataPrivacySettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted data privacy settings ${String(props.authenticated)}`)),
  HostedFamilySettings: vi.fn(() => React.createElement("div", null, "Hosted family settings")),
  HostedPasskeySettings: vi.fn((props: {
    authenticated: boolean;
    secureApprovalStatus: { status: string };
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted passkey settings ${String(props.authenticated)} ${props.secureApprovalStatus.status}`,
    )),
  routerRefresh: vi.fn(),
  readHostedFamilyAccessForMember: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    hostedCodexAuthConnection: {
      findUnique: vi.fn(async () => null),
    },
  },
  readHostedAccountSettingsPageSnapshot: vi.fn(),
  readHostedPersonalAiUsageStatus: vi.fn(),
  readHostedUsageCreditProjection: vi.fn(),
  readHostedSecureApprovalStatus: vi.fn(),
  withServerApprovedPrivyAccountHints: vi.fn((input: {
    serverApprovedPrivyLinkedAccounts?: unknown;
    snapshot: unknown;
  }) => input.snapshot),
}));

vi.mock("server-only", () => ({}));

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/usage-status", () => ({
  readHostedPersonalAiUsageStatus: mocks.readHostedPersonalAiUsageStatus,
}));

vi.mock("@/src/lib/hosted-execution/usage-credits", () => ({
  readHostedUsageCreditProjection: mocks.readHostedUsageCreditProjection,
}));

vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({
  readHostedAccountSettingsPageSnapshot:
    mocks.readHostedAccountSettingsPageSnapshot,
  withServerApprovedPrivyAccountHints: mocks.withServerApprovedPrivyAccountHints,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  getHostedPrivySession: mocks.getHostedPrivySession,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: mocks.getHostedOnboardingEnvironment,
}));

vi.mock("@/src/components/hosted-onboarding/phone-country-code-provider", () => ({
  PhoneCountryCodeProvider(input: { children: React.ReactNode }) {
    return React.createElement(
      "div",
      {
        "data-phone-country-code": "CA",
      },
      input.children,
    );
  },
}));

vi.mock("@/src/components/hosted-onboarding/privy-provider", () => ({
  HostedPrivyProvider(input: { children: React.ReactNode }) {
    return React.createElement("div", null, input.children);
  },
}));

vi.mock("@/src/components/settings/hosted-billing-settings", () => ({
  HostedBillingSettings: mocks.HostedBillingSettings,
}));

vi.mock("@/src/components/settings/hosted-account-settings-cards", () => ({
  HostedAccountSettingsCards: mocks.HostedAccountSettingsCards,
}));

vi.mock("@/src/components/settings/customize-murph-settings", () => ({
  CustomizeMurphSettings: mocks.CustomizeMurphSettings,
}));

vi.mock("@/src/lib/murph-contact-routing", () => ({
  resolveMurphContactOptions: mocks.resolveMurphContactOptions,
}));

vi.mock("@/src/components/settings/hosted-assistant-model-settings", () => ({
  HostedAssistantModelSettings: mocks.HostedAssistantModelSettings,
}));

vi.mock("@/src/components/settings/hosted-data-privacy-settings", () => ({
  HostedDataPrivacySettings: mocks.HostedDataPrivacySettings,
}));

vi.mock("@/src/components/settings/hosted-family-settings", () => ({
  HostedFamilySettings: mocks.HostedFamilySettings,
}));

vi.mock("@/src/components/settings/hosted-passkey-settings", () => ({
  HostedPasskeySettings: mocks.HostedPasskeySettings,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedFamilyAccessForMember: mocks.readHostedFamilyAccessForMember,
  readHostedFamilyOwnerSnapshotForMember: mocks.readHostedFamilyOwnerSnapshotForMember,
}));

vi.mock("@/src/lib/sensitive-actions/secure-approval-status", () => ({
  readHostedSecureApprovalStatus: mocks.readHostedSecureApprovalStatus,
}));

const EMPTY_ACCOUNT_SETTINGS = {
  email: {
    address: null,
    verifiedAt: null,
  },
  phone: {
    number: null,
    verifiedAt: null,
  },
  telegram: {
    telegramUserId: null,
  },
};

function mockSettingsPageSnapshot(input: {
  account?: unknown;
  billingRef?: unknown;
  routing?: unknown;
} = {}): void {
  mocks.readHostedAccountSettingsPageSnapshot.mockResolvedValue({
    account: input.account ?? EMPTY_ACCOUNT_SETTINGS,
    billingRef: input.billingRef ?? null,
    routing: input.routing ?? null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSettingsPageSnapshot();
  mocks.getHostedOnboardingEnvironment.mockReturnValue({
    stripeUsageCreditPriceIdsByOffer: {
      usage_10_usd: null,
      usage_25_usd: null,
      usage_5_usd: null,
    },
  });
  mocks.readHostedFamilyAccessForMember.mockResolvedValue(null);
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(null);
  mocks.readHostedPersonalAiUsageStatus.mockResolvedValue({
    generatedAt: "2026-07-10T12:00:00.000Z",
    reason: "hosted_access_inactive",
    recommendedAction: null,
    status: "unavailable",
  });
  mocks.readHostedUsageCreditProjection.mockResolvedValue({
    balanceUsdMicros: 0n,
    ledgerVersion: 0n,
  });
  mocks.readHostedSecureApprovalStatus.mockResolvedValue({ status: "unavailable" });
});

test("SettingsPage metadata uses the shared preview image", async () => {
  const { metadata } = await import("../app/(dashboard)/settings/page");

  assert.equal(metadata.title, "Settings — Murph");
  assert.equal(metadata.description, "Manage your Murph account settings.");
  assert.deepEqual(metadata.openGraph?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(metadata.twitter?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
});

test("SettingsDataPrivacyPage redirects signed-in users to the settings privacy section", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    session: {
      privyUserId: "did:privy:user_123",
    },
  });

  const { default: SettingsDataPrivacyPage } =
    await import("../app/(dashboard)/settings/data-privacy/page");

  await expect(SettingsDataPrivacyPage()).rejects.toThrow(
    "NEXT_REDIRECT:/settings#data-privacy",
  );
});

test("SettingsDataPrivacyPage opens the auth-required data privacy handoff for signed-out users", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const { default: SettingsDataPrivacyPage } =
    await import("../app/(dashboard)/settings/data-privacy/page");

  const markup = renderToStaticMarkup(await SettingsDataPrivacyPage());

  assert.match(markup, /Sign in to manage your data/);
  assert.match(markup, /Data &amp; privacy section/);
  assert.match(markup, /After sign-in, this link opens the deletion controls directly in settings\./);
});

test("SettingsPage redirects signed-out visitors before reading member settings", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT:/");

  expect(mocks.getPrisma).not.toHaveBeenCalled();
  expect(mocks.readHostedAccountSettingsPageSnapshot).not.toHaveBeenCalled();
  expect(mocks.readHostedFamilyAccessForMember).not.toHaveBeenCalled();
  expect(mocks.readHostedFamilyOwnerSnapshotForMember).not.toHaveBeenCalled();
  expect(mocks.readHostedPersonalAiUsageStatus).not.toHaveBeenCalled();
  expect(mocks.readHostedUsageCreditProjection).not.toHaveBeenCalled();
  expect(mocks.readHostedSecureApprovalStatus).not.toHaveBeenCalled();
  expect(mocks.getHostedPrivySession).not.toHaveBeenCalled();
});

test("SettingsPage reads the app session and persisted account settings into the settings tree", async () => {
  const originalPrivyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "cm_app_settings_test";
  mocks.getHostedOnboardingEnvironment.mockReturnValue({
    stripeUsageCreditPriceIdsByOffer: {
      usage_10_usd: "price_usage_10",
      usage_25_usd: "price_usage_25",
      usage_5_usd: "price_usage_5",
    },
  });
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue({
    identity: {
      userId: "did:privy:user_123",
    },
    linkedAccounts: [
      {
        id: 456,
        type: "telegram",
        username: "sample_user",
      },
    ],
  });
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [
      {
        address: "verified@example.com",
        latest_verified_at: 1741194420,
        type: "email",
      },
    ],
    memberLookup: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  const accountSnapshot = {
    assistant: {
      configurationAvailable: true,
      dormantSolPreference: false,
      model: "gpt-5.6-sol",
      solAvailable: true,
    },
    email: {
      address: "verified@example.com",
      verifiedAt: "2025-03-27T08:30:00.000Z",
    },
    phone: {
      number: "+15550100002",
      verifiedAt: "2025-03-27T08:00:00.000Z",
    },
    telegram: {
      telegramUserId: "456",
    },
  };
  mockSettingsPageSnapshot({
    account: accountSnapshot,
    billingRef: {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
    routing: {
      linqChatId: null,
      linqRecipientPhone: "+15550100001",
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    },
  });
  mocks.readHostedSecureApprovalStatus.mockResolvedValue({ status: "configured" });
  const usageStatus = {
    accessKind: "paid",
    forecast: null,
    generatedAt: "2026-07-10T12:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    periodKind: "monthly",
    periodStart: "2026-07-01T00:00:00.000Z",
    planCode: "launch_monthly",
    planName: "Pulse",
    recommendedAction: null,
    remainingPercent: 68,
    status: "active",
    usedPercent: 32,
  } as const;
  mocks.readHostedPersonalAiUsageStatus.mockResolvedValue(usageStatus);
  mocks.readHostedUsageCreditProjection.mockResolvedValue({
    balanceUsdMicros: 8_429_999n,
    ledgerVersion: 4n,
  });

  try {
    const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

    const markup = renderToStaticMarkup(await SettingsPage({
      searchParams: Promise.resolve({
        addEmail: "true",
        addUsage: "true",
        usageCheckout: "success",
        usagePurchase: "hucp_abcdefghijklmnop",
        voice: "true",
      }),
    }));

    assert.match(markup, /Hosted billing settings/);
    assert.match(markup, /Hosted assistant model gpt-5\.6-sol true/);
    assert.match(markup, /Hosted account settings \+15550100001/);
    assert.match(markup, /Manage wearables/);
    assert.match(markup, /href="\/connect"/);
    assert.match(markup, /Hosted passkey settings true configured/);
    assert.match(markup, /Hosted data privacy settings/);
    assert.match(markup, /Your account/);
    assert.match(markup, /Plan, model, connected accounts, and data privacy\./);
    assert.match(markup, /id="subscription"/);
    assert.doesNotMatch(markup, /ChatGPT/);
    assert.doesNotMatch(markup, /Data sources/);
    for (const removedCopy of [
      ["vault", "sync"].join(" "),
      ["Sync", "local", "vault"].join(" "),
      ["Local", "to-hosted import"].join("-"),
    ]) {
      assert.equal(markup.includes(removedCopy), false);
    }
    expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.hostedCodexAuthConnection.findUnique).not.toHaveBeenCalled();
    expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
      authenticated: true,
      canStartFamily: true,
      canStartPaidPulse: false,
      canUpgradeToEdge: true,
      currentBillingPhase: "paid",
      currentCheckoutOffer: "standard",
      currentBillingPlanCode: "launch_monthly",
      usageCreditBalanceUsdMicros: "8429999",
      usageStatus,
      usageTopUpInitialOpen: true,
      usageTopUpOffers: [
        {
          amountLabel: "$5",
          amountUsdCents: 500,
          offerCode: "usage_5_usd",
        },
        {
          amountLabel: "$10",
          amountUsdCents: 1_000,
          offerCode: "usage_10_usd",
        },
        {
          amountLabel: "$25",
          amountUsdCents: 2_500,
          offerCode: "usage_25_usd",
        },
      ],
      usageTopUpPurchaseReturn: {
        kind: "success",
        purchaseId: "hucp_abcdefghijklmnop",
      },
    }), undefined);
    expect(mocks.HostedAssistantModelSettings).toHaveBeenCalledWith({
      canUpgradeToEdge: true,
      configurationAvailable: true,
      initialDormantSolPreference: false,
      initialModel: "gpt-5.6-sol",
      solAvailable: true,
    }, undefined);
    expect(mocks.readHostedAccountSettingsPageSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.readHostedPersonalAiUsageStatus).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.readHostedUsageCreditProjection).toHaveBeenCalledWith({
      beneficiaryMemberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.readHostedSecureApprovalStatus).toHaveBeenCalledWith({
      privyUserId: "did:privy:user_123",
    });
    expect(mocks.getHostedPrivySession).toHaveBeenCalledTimes(1);
    expect(mocks.withServerApprovedPrivyAccountHints).toHaveBeenCalledWith({
      snapshot: accountSnapshot,
      serverApprovedPrivyLinkedAccounts: [
        {
          id: 456,
          type: "telegram",
          username: "sample_user",
        },
      ],
    });
    expect(mocks.HostedAccountSettingsCards).toHaveBeenCalledWith(expect.objectContaining({
      account: accountSnapshot,
      murphPhoneNumber: "+15550100001",
      openEmailLink: true,
    }), undefined);
    expect(mocks.CustomizeMurphSettings).toHaveBeenCalledWith(expect.objectContaining({
      murphPhoneNumber: "+15550100001",
      openVoiceLink: true,
      voiceTestContactOption: {
        href: "sms:+15550100001?body=voice%20test",
        kind: "text",
        label: "Messages",
      },
    }), undefined);
    expect(mocks.resolveMurphContactOptions).toHaveBeenCalledWith({
      contactChannels: {
        email: false,
        telegram: true,
        text: true,
      },
      message: {
        body: "just picked a new voice for you! send me a voice memo so I can hear it",
      },
      murphEmailAddress: null,
      murphPhoneNumber: "+15550100001",
      preferredKind: "text",
      userEmailAddress: "verified@example.com",
    });
    expect(mocks.HostedPasskeySettings).toHaveBeenCalledWith(expect.objectContaining({
      authenticated: true,
      secureApprovalStatus: { status: "configured" },
    }), undefined);
    expect(mocks.HostedDataPrivacySettings).toHaveBeenCalledWith(expect.objectContaining({
      authenticated: true,
    }), undefined);
  } finally {
    if (originalPrivyAppId === undefined) {
      delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    } else {
      process.env.NEXT_PUBLIC_PRIVY_APP_ID = originalPrivyAppId;
    }
  }
});

test("SettingsPage rejects repeated or malformed usage top-up query state", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    memberLookup: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({
      addUsage: ["true", "true"],
      usageCheckout: "success",
      usagePurchase: "hucp_not-valid",
    }),
  }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpInitialOpen: false,
      usageTopUpPurchaseReturn: null,
    }),
    undefined,
  );
});

test.each([
  {
    billingStatus: HostedBillingStatus.canceled,
    label: "canceled",
    suspendedAt: null,
  },
  {
    billingStatus: HostedBillingStatus.past_due,
    label: "inactive",
    suspendedAt: null,
  },
  {
    billingStatus: HostedBillingStatus.active,
    label: "suspended",
    suspendedAt: new Date("2026-07-10T12:00:00.000Z"),
  },
])("SettingsPage hides Edge upgrade actions for an $label paid Pulse member", async ({
  billingStatus,
  suspendedAt,
}) => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus,
      id: "member_123",
      suspendedAt,
    },
    linkedAccounts: [],
    memberLookup: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mockSettingsPageSnapshot({
    billingRef: {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({
      usageCheckout: "cancel",
      usagePurchase: "hucp_abcdefghijklmnop",
    }),
  }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      canUpgradeToEdge: false,
      usageTopUpOffers: [],
      usageTopUpPurchaseReturn: {
        kind: "cancel",
        purchaseId: "hucp_abcdefghijklmnop",
      },
    }),
    undefined,
  );
  expect(mocks.HostedAssistantModelSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      canUpgradeToEdge: false,
      configurationAvailable: false,
      initialDormantSolPreference: false,
    }),
    undefined,
  );
});

test("SettingsPage passes a pending Murph text line to account settings", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    memberLookup: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  const accountSnapshot = {
    email: {
      address: null,
      verifiedAt: null,
    },
    phone: {
      number: "+15550100002",
      verifiedAt: "2025-03-27T08:00:00.000Z",
    },
    telegram: {
      telegramUserId: null,
    },
  };
  mockSettingsPageSnapshot({
    account: accountSnapshot,
    routing: {
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqRecipientPhone: "+15550100003",
      telegramThreadId: null,
      telegramUserId: null,
      telegramUserLookupKey: null,
    },
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage());

  assert.match(markup, /Hosted account settings \+15550100003/);
  expect(mocks.HostedAccountSettingsCards).toHaveBeenCalledWith(expect.objectContaining({
    account: accountSnapshot,
    murphPhoneNumber: "+15550100003",
  }), undefined);
});

test("SettingsPage drops the voice-test chat link for an email-only member", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    memberLookup: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mockSettingsPageSnapshot({
    account: {
      email: {
        address: "member@example.com",
        verifiedAt: "2025-03-27T08:30:00.000Z",
      },
      phone: {
        number: null,
        verifiedAt: null,
      },
      telegram: {
        telegramUserId: null,
      },
    },
  });
  mocks.resolveMurphContactOptions.mockReturnValueOnce([{
    href: "mailto:murph@mail.withmurph.ai?body=test",
    kind: "email",
    label: "Email",
  }]);

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage());

  expect(mocks.CustomizeMurphSettings).toHaveBeenCalledWith(expect.objectContaining({
    voiceTestContactOption: null,
  }), undefined);
});

test("SettingsPage exposes Start Pulse recovery for a paused Pulse Trial subscription", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "paused",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    memberLookup: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mockSettingsPageSnapshot({
    billingRef: {
      currentBillingPhase: null,
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage());

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
    canStartPaidPulse: true,
    canSwitchToPulse: false,
    canUpgradeToEdge: false,
    currentBillingPhase: null,
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "pulse_trial_7d",
  }), undefined);
});

test("SettingsPage does not mark an unpaid family owner group as the current plan", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    memberLookup: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
    billingActive: false,
    billingStatus: "not_started",
    displayName: null,
    groupId: "group_123",
    invites: [],
    members: [
      {
        isOwner: true,
        joinedAt: new Date("2026-06-24T12:00:00.000Z"),
        label: null,
        memberId: "member_123",
        role: "owner",
        status: "active",
      },
    ],
    ownerMemberId: "member_123",
    seats: {
      active: 1,
      billed: 2,
      invited: 0,
      max: 6,
      min: 2,
      remaining: 1,
      used: 1,
    },
    suspendedAt: null,
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage());

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
    canStartFamily: true,
    familyState: "none",
  }), undefined);
  expect(mocks.HostedFamilySettings).toHaveBeenCalledTimes(1);
});

test("SettingsPage ignores Privy Telegram display hints from a stale Privy session identity", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue({
    identity: {
      userId: "did:privy:user_other",
    },
    linkedAccounts: [
      {
        id: 456,
        type: "telegram",
        username: "sample_user",
      },
    ],
  });
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    memberLookup: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  const accountSnapshot = {
    email: {
      address: null,
      verifiedAt: null,
    },
    phone: {
      number: null,
      verifiedAt: null,
    },
    telegram: {
      telegramUserId: "456",
    },
  };
  mockSettingsPageSnapshot({ account: accountSnapshot });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage());

  expect(mocks.withServerApprovedPrivyAccountHints).toHaveBeenCalledWith({
    snapshot: accountSnapshot,
    serverApprovedPrivyLinkedAccounts: null,
  });
});
