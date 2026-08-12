import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { HostedBillingStatus } from "@prisma/client";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getHostedPrivySession: vi.fn(),
  isHostedBillingPlanSelectionAvailable: vi.fn(),
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
  resolveMurphContactOptions: vi.fn((input?: {
    contactChannels?: {
      email?: boolean;
      telegram?: boolean;
      text?: boolean;
    } | null;
    message?: { body?: string | null } | null;
  }) => {
    if (input?.message?.body === "Hey Murph, I just added more usage.") {
      return [{
        href: "sms:+15550100001?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage.",
        kind: "text",
        label: "Messages",
      }];
    }
    if (
      input?.message?.body
        === "Hey Murph, what referral options can I choose from?"
    ) {
      return [{
        href: "sms:+15550100001?body=Hey%20Murph%2C%20what%20referral%20options%20can%20I%20choose%20from%3F",
        kind: "text",
        label: "Messages",
      }];
    }
    return [{
      href: "sms:+15550100001?body=voice%20test",
      kind: "text",
      label: "Messages",
    }];
  }),
  HostedAiUsageActivity: vi.fn(() =>
    React.createElement("div", null, "Hosted AI usage activity")
  ),
  HostedAssistantModelSettings: vi.fn((props: {
    canUpgradeToEdge: boolean;
    configurationAvailable: boolean;
    customInferenceAvailable: boolean;
    initialDormantSolPreference: boolean;
    initialModel: string;
    initialProvider: string;
    solAvailable: boolean;
    veniceAvailable: boolean;
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted assistant model ${props.initialModel} ${String(props.solAvailable)}`,
    )),
  HostedBillingSettings: vi.fn((props: {
    authenticated: boolean;
    canStartFamily?: boolean;
    canSwitchToGroup?: boolean;
    canUpgradeToPulse?: boolean;
    canUpgradeToEdge?: boolean;
    currentBillingPhase?: unknown;
    currentBillingPlanCode?: unknown;
    familyBillingOwner?: boolean;
    familyState?: "none" | "owner" | "sponsored";
    groupPaymentMethodSaved?: boolean;
    payerMemberId?: string | null;
    planChangePending?: boolean;
    showGroupPlan?: boolean;
    usageActivityDetail?: React.ReactNode;
    usageStatus?: unknown;
    usageTopUpActivePurchase?: unknown;
    usageTopUpCheckoutUrl?: string;
    usageTopUpInitialOpen?: boolean;
    usageTopUpOffers?: readonly unknown[];
    usageTopUpPurchaseReturn?: unknown;
    usageTopUpScope?: "family" | "personal";
    usageTopUpTargetLabel?: string;
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted billing settings ${String(props.authenticated)} ${String(props.canUpgradeToEdge ?? false)} ${String(props.currentBillingPlanCode ?? "")}`,
      props.usageActivityDetail,
    )),
  HostedDataPrivacySettings: vi.fn((props: {
    accountDeletionRetry?: boolean;
    authenticated: boolean;
  }) =>
    React.createElement("div", null, `Hosted data privacy settings ${String(props.authenticated)}`)),
  HostedHealthDataConsentSettings: vi.fn((props: {
    authenticated: boolean;
    initialStatus: unknown;
  }) =>
    React.createElement("div", null, `Hosted health data consent ${String(props.authenticated)}`)),
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
  HostedPrivyProvider: vi.fn((input: { children: React.ReactNode }) =>
    React.createElement("div", null, input.children)),
  routerRefresh: vi.fn(),
  readHostedFamilyAccessForMember: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    hostedCodexAuthConnection: {
      findUnique: vi.fn(async () => null),
    },
    hostedGroupMember: {
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
    },
  },
  readHostedAccountSettingsPageSnapshot: vi.fn(),
  readHostedConsentStatus: vi.fn(),
  readHostedActiveUsageCreditPurchaseForPayer: vi.fn(),
  readHostedAiUsageActivity: vi.fn(),
  readHostedPersonalAiUsageStatus: vi.fn(),
  readHostedConfiguredUsageCreditOfferCodes: vi.fn(),
  readHostedPersonalUsageCreditOfferCodes: vi.fn(),
  readHostedUsageCreditPurchaseTargetForPayer: vi.fn(),
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

vi.mock("@/src/lib/hosted-execution/usage-activity", () => ({
  readHostedAiUsageActivity: mocks.readHostedAiUsageActivity,
}));

vi.mock("@/src/lib/hosted-execution/usage-status", () => ({
  readHostedPersonalAiUsageStatus: mocks.readHostedPersonalAiUsageStatus,
}));

vi.mock("@/src/lib/hosted-onboarding/usage-credit-purchase-service", () => ({
  readHostedActiveUsageCreditPurchaseForPayer:
    mocks.readHostedActiveUsageCreditPurchaseForPayer,
  readHostedUsageCreditPurchaseTargetForPayer:
    mocks.readHostedUsageCreditPurchaseTargetForPayer,
}));

vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({
  readHostedAccountSettingsPageSnapshot:
    mocks.readHostedAccountSettingsPageSnapshot,
  withServerApprovedPrivyAccountHints: mocks.withServerApprovedPrivyAccountHints,
}));

vi.mock("@/src/lib/legal/consent", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/legal/consent")>(
    "@/src/lib/legal/consent",
  );
  return {
    ...actual,
    readHostedConsentStatus: mocks.readHostedConsentStatus,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  getHostedPrivySession: mocks.getHostedPrivySession,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  isHostedBillingPlanSelectionAvailable:
    mocks.isHostedBillingPlanSelectionAvailable,
}));

vi.mock("@/src/lib/hosted-onboarding/personal-usage-credit-eligibility", () => ({
  readHostedConfiguredUsageCreditOfferCodes:
    mocks.readHostedConfiguredUsageCreditOfferCodes,
  readHostedPersonalUsageCreditOfferCodes:
    mocks.readHostedPersonalUsageCreditOfferCodes,
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
  HostedPrivyProvider: mocks.HostedPrivyProvider,
}));

vi.mock("@/src/components/settings/hosted-ai-usage-activity", () => ({
  HostedAiUsageActivity: mocks.HostedAiUsageActivity,
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

vi.mock("@/src/components/settings/hosted-health-data-consent-settings", () => ({
  HostedHealthDataConsentSettings: mocks.HostedHealthDataConsentSettings,
}));

vi.mock("@/src/components/settings/hosted-family-settings", () => ({
  HostedFamilySettings: mocks.HostedFamilySettings,
}));

vi.mock("@/src/components/settings/hosted-passkey-settings", () => ({
  HostedPasskeySettings: mocks.HostedPasskeySettings,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  isHostedFamilyBillingPortalManageable: (billingStatus: string) =>
    ["active", "incomplete", "past_due", "paused", "unpaid"].includes(
      billingStatus,
    ),
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

const GRANTED_HEALTH_DATA_CONSENT_STATUS = {
  documents: [],
  generatedAt: "2026-07-30T12:00:00.000Z",
  launchGranted: true,
  launchScopes: [],
  ok: true,
  schema: "murph.hosted-consent-status.v1",
  scopes: [{
    grant: {
      scope: "launch.health-data",
      status: "granted",
    },
    scope: "launch.health-data",
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isHostedBillingPlanSelectionAvailable.mockResolvedValue(true);
  mockSettingsPageSnapshot();
  mocks.readHostedFamilyAccessForMember.mockResolvedValue(null);
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(null);
  mocks.readHostedConsentStatus.mockResolvedValue(
    GRANTED_HEALTH_DATA_CONSENT_STATUS,
  );
  mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(null);
  mocks.readHostedConfiguredUsageCreditOfferCodes.mockReturnValue([
    "usage_5_usd",
    "usage_10_usd",
    "usage_25_usd",
  ]);
  mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValue([]);
  mocks.readHostedAiUsageActivity.mockResolvedValue({
    credits: [],
    missions: [],
    missionsEnabled: false,
  });
  mocks.readHostedUsageCreditPurchaseTargetForPayer.mockResolvedValue({
    beneficiaryMemberId: "member_123",
    kind: "personal",
  });
  mocks.readHostedPersonalAiUsageStatus.mockResolvedValue({
    generatedAt: "2026-07-10T12:00:00.000Z",
    reason: "hosted_access_inactive",
    recommendedAction: null,
    status: "unavailable",
  });
  mocks.readHostedSecureApprovalStatus.mockResolvedValue({ status: "unavailable" });
  mocks.prisma.hostedGroupMember.findFirst.mockResolvedValue(null);
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

test("SettingsPage suppresses plan actions while a completed update awaits webhook projection", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
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

  const { default: SettingsPage } = await import(
    "../app/(dashboard)/settings/page"
  );
  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({
      planUpdate: "launch_edge_monthly",
    }),
  }));

  assert.match(markup, /Activating Edge/);
  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      canUpgradeToEdge: true,
      currentBillingPlanCode: "launch_monthly",
      planChangePending: true,
    }),
    undefined,
  );
  expect(mocks.HostedAssistantModelSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      canUpgradeToEdge: false,
    }),
    undefined,
  );
});

test("SettingsPage completes a return only from an active paid exact projection", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      suspendedAt: null,
    },
    session: { privyUserId: "did:privy:user_123" },
  });
  mockSettingsPageSnapshot({
    billingRef: {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
  });

  const { default: SettingsPage } = await import(
    "../app/(dashboard)/settings/page"
  );
  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({ planUpdate: "launch_edge_monthly" }),
  }));

  assert.match(markup, /Edge is active/);
  assert.doesNotMatch(markup, /Activating Edge/);
  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({ planChangePending: false }),
    undefined,
  );
});

test("SettingsPage keeps an inactive same-plan return in recoverable pending state", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: HostedBillingStatus.past_due,
      id: "member_123",
      suspendedAt: null,
    },
    session: { privyUserId: "did:privy:user_123" },
  });
  mockSettingsPageSnapshot({
    billingRef: {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    },
  });

  const { default: SettingsPage } = await import(
    "../app/(dashboard)/settings/page"
  );
  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({ planUpdate: "launch_edge_monthly" }),
  }));

  assert.match(markup, /Activating Edge/);
  assert.doesNotMatch(markup, /Edge is active/);
  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({ planChangePending: true }),
    undefined,
  );
});

test("SettingsPage suppresses a personal plan return for a sponsored member", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      suspendedAt: null,
    },
    session: { privyUserId: "did:privy:user_123" },
  });
  mocks.readHostedFamilyAccessForMember.mockResolvedValue({ groupId: "family_123" });
  mockSettingsPageSnapshot({
    billingRef: {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      currentCheckoutOffer: "standard",
      memberId: "member_123",
      stripeCustomerId: "cus_personal",
      stripeSubscriptionId: "sub_personal",
    },
  });

  const { default: SettingsPage } = await import(
    "../app/(dashboard)/settings/page"
  );
  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({ planUpdate: "launch_edge_monthly" }),
  }));

  assert.doesNotMatch(markup, /Activating Edge|Edge is active/);
  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      familyState: "sponsored",
      planChangePending: false,
    }),
    undefined,
  );
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

test("SettingsDataPrivacyPage preserves account deletion retry guidance", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "canceled",
      id: "member_123",
      suspendedAt: new Date("2026-08-12T08:00:00.000Z"),
    },
    session: {
      privyUserId: "did:privy:user_123",
    },
  });

  const { default: SettingsDataPrivacyPage } =
    await import("../app/(dashboard)/settings/data-privacy/page");

  await expect(SettingsDataPrivacyPage({
    searchParams: Promise.resolve({ accountDeletion: "retry" }),
  })).rejects.toThrow(
    "NEXT_REDIRECT:/settings?accountDeletion=retry#data-privacy",
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

  await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/");

  expect(mocks.getPrisma).not.toHaveBeenCalled();
  expect(mocks.readHostedAccountSettingsPageSnapshot).not.toHaveBeenCalled();
  expect(mocks.readHostedFamilyAccessForMember).not.toHaveBeenCalled();
  expect(mocks.readHostedFamilyOwnerSnapshotForMember).not.toHaveBeenCalled();
  expect(mocks.readHostedActiveUsageCreditPurchaseForPayer).not.toHaveBeenCalled();
  expect(mocks.readHostedAiUsageActivity).not.toHaveBeenCalled();
  expect(mocks.readHostedPersonalAiUsageStatus).not.toHaveBeenCalled();
  expect(mocks.readHostedPersonalUsageCreditOfferCodes).not.toHaveBeenCalled();
  expect(mocks.readHostedSecureApprovalStatus).not.toHaveBeenCalled();
  expect(mocks.getHostedPrivySession).not.toHaveBeenCalled();
});


test("SettingsPage keeps a signed-out Core payment return recoverable", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({
      startGroup: "payment_method_saved",
    }),
  }));

  assert.match(markup, /One more step/);
  assert.doesNotMatch(markup, /Payment method saved/);
  assert.doesNotMatch(markup, /Core has not started/);
  expect(mocks.getPrisma).not.toHaveBeenCalled();
});

test("SettingsPage keeps a signed-out usage-credit return recoverable", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({
      usageCheckout: "success",
      usagePurchase: "hucp_abcdefghijklmnop",
    }),
  }));

  assert.match(markup, /One more step/);
  assert.match(markup, /Sign in to verify and finish your billing update\./);
  expect(mocks.getPrisma).not.toHaveBeenCalled();
});

test.each([
  "launch_edge_monthly",
  "launch_monthly",
  "canceled",
])("SettingsPage keeps a signed-out plan-change return recoverable: %s", async (planUpdate) => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");
  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({ planUpdate }),
  }));

  assert.match(markup, /One more step/);
  assert.match(markup, /Sign in to verify and finish your billing update\./);
  assert.doesNotMatch(markup, /Activating|is active|still syncing/);
  expect(mocks.getPrisma).not.toHaveBeenCalled();
  expect(mocks.readHostedAccountSettingsPageSnapshot).not.toHaveBeenCalled();
});

test.each([
  ["unsupported", "launch_group_monthly"],
  ["malformed", "edge"],
  ["repeated", ["launch_edge_monthly", "canceled"]],
])("SettingsPage rejects a signed-out %s plan-change return", async (_label, planUpdate) => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  await expect(SettingsPage({
    searchParams: Promise.resolve({ planUpdate }),
  })).rejects.toThrow("NEXT_REDIRECT:/");
  expect(mocks.getPrisma).not.toHaveBeenCalled();
});

test("SettingsPage strips an authenticated plan-change cancellation return", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      suspendedAt: null,
    },
    session: { privyUserId: "did:privy:1", sessionId: "hws_session_123" },
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  await expect(SettingsPage({
    searchParams: Promise.resolve({ planUpdate: "canceled" }),
  })).rejects.toThrow("NEXT_REDIRECT:/settings#subscription");
  expect(mocks.getPrisma).not.toHaveBeenCalled();
});






test("SettingsPage reads the app session and persisted account settings into the settings tree", async () => {
  const originalPrivyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "cm_app_settings_test";
  mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValue([
    "usage_5_usd",
    "usage_10_usd",
    "usage_25_usd",
  ]);
  mocks.prisma.hostedGroupMember.findFirst.mockResolvedValue({
    id: "group_member_123",
  });
  mocks.isHostedBillingPlanSelectionAvailable.mockResolvedValue(false);
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
  const usageActivity = {
    credits: [
      {
        addedLabel: "$10.00",
        dateLabel: "Jul 24, 2026",
        id: "credit_1",
        sourceLabel: "Purchased by you",
      },
    ],
    missions: [
      {
        destinationLabel: "the group",
        id: "mission_1",
        requirementsLabel: "Start a fresh group and get people talking.",
        rewardLabel: "About 14 more days of Murph usage",
        selectedLabel: "Jul 27, 2026",
        status: "in_progress",
        statusLabel: "In progress",
        timingLabel: "Ends Aug 3, 2026",
        title: "Start a group conversation",
      },
    ],
    missionsEnabled: true,
  } as const;
  mocks.readHostedAiUsageActivity.mockResolvedValue(usageActivity);

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
    assert.match(markup, /Hosted AI usage activity/);
    assert.match(markup, /Hosted assistant model gpt-5\.6-sol true/);
    assert.match(markup, /Hosted account settings \+15550100001/);
    assert.match(markup, /Manage wearables/);
    assert.match(markup, /href="\/connect"/);
    assert.match(markup, /Hosted passkey settings true configured/);
    assert.match(markup, /Hosted data privacy settings/);
    assert.match(markup, /<h1[^>]*>Your account<\/h1>/);
    assert.match(markup, /Plan, AI usage, model, connected accounts, and data privacy\./);
    assert.match(markup, /id="subscription"/);
    assert.match(markup, /id="ai-usage"/);
    assert.match(markup, /<h2[^>]*>AI usage<\/h2>/);
    assert.ok(markup.indexOf("Hosted billing settings") < markup.indexOf("id=\"ai-usage\""));
    assert.ok(markup.indexOf("id=\"ai-usage\"") < markup.indexOf("Hosted assistant model"));
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
      canUpgradeToEdge: true,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      payerMemberId: "member_123",
      showGroupPlan: false,
      usageStatus,
      usageTopUpActivePurchase: null,
      usageTopUpInitialOpen: true,
      usageTopUpOffers: [
        {
          amountLabel: "$5",
          offerCode: "usage_5_usd",
        },
        {
          amountLabel: "$10",
          offerCode: "usage_10_usd",
        },
        {
          amountLabel: "$25",
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
      chatCompletionsAvailable: false,
      configurationAvailable: true,
      customInferenceAvailable: false,
      expectedCurrentPlanCode: "launch_monthly",
      initialConnection: null,
      initialDormantSolPreference: false,
      initialModel: "gpt-5.6-sol",
      initialProvider: "openai",
      solAvailable: true,
      veniceAvailable: false,
    }, undefined);
    expect(mocks.readHostedAccountSettingsPageSnapshot).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.readHostedConsentStatus).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.readHostedPersonalAiUsageStatus).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
      publicBaseUrl: null,
    });
    expect(mocks.isHostedBillingPlanSelectionAvailable).toHaveBeenCalledTimes(1);
    expect(mocks.isHostedBillingPlanSelectionAvailable).toHaveBeenCalledWith({
      billingPlanCode: "launch_group_monthly",
    });
    expect(mocks.readHostedAiUsageActivity).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.readHostedActiveUsageCreditPurchaseForPayer).toHaveBeenCalledWith({
      serverApprovedPayableTargets: [{
        beneficiaryMemberId: "member_123",
        kind: "personal",
      }],
      payerMemberId: "member_123",
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
    expect(mocks.resolveMurphContactOptions).toHaveBeenNthCalledWith(1, {
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
    expect(mocks.resolveMurphContactOptions).toHaveBeenNthCalledWith(2, {
      contactChannels: {
        email: false,
        telegram: true,
        text: true,
      },
      message: {
        body: "Hey Murph, I just added more usage.",
      },
      murphEmailAddress: null,
      murphPhoneNumber: "+15550100001",
      userEmailAddress: "verified@example.com",
    });
    expect(mocks.resolveMurphContactOptions).toHaveBeenNthCalledWith(3, {
      contactChannels: {
        email: false,
        telegram: true,
        text: true,
      },
      message: {
        body: "Hey Murph, what referral options can I choose from?",
      },
      murphEmailAddress: null,
      murphPhoneNumber: "+15550100001",
      preferredKind: "text",
      userEmailAddress: "verified@example.com",
    });
    expect(mocks.HostedAiUsageActivity).toHaveBeenCalledWith({
      activity: usageActivity,
      missionContactOption: {
        href: "sms:+15550100001?body=Hey%20Murph%2C%20what%20referral%20options%20can%20I%20choose%20from%3F",
        kind: "text",
        label: "Messages",
      },
    }, undefined);
    expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        usageTopUpContactOptions: [{
          href: "sms:+15550100001?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage.",
          kind: "text",
          label: "Messages",
        }],
      }),
      undefined,
    );
    expect(mocks.HostedPasskeySettings).toHaveBeenCalledWith(expect.objectContaining({
      authenticated: true,
      secureApprovalStatus: { status: "configured" },
    }), undefined);
    expect(mocks.HostedPrivyProvider).toHaveBeenCalledTimes(1);
    expect(mocks.HostedDataPrivacySettings).toHaveBeenCalledWith(expect.objectContaining({
      authenticated: true,
    }), undefined);
    expect(mocks.HostedHealthDataConsentSettings).toHaveBeenCalledWith({
      authenticated: true,
      initialStatus: GRANTED_HEALTH_DATA_CONSENT_STATUS,
    }, undefined);

    mocks.HostedDataPrivacySettings.mockClear();
    mocks.HostedHealthDataConsentSettings.mockClear();
    mocks.readHostedConsentStatus.mockRejectedValueOnce(new Error("consent read unavailable"));
    renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.HostedHealthDataConsentSettings).toHaveBeenCalledWith({
      authenticated: true,
      initialStatus: null,
    }, undefined);
    expect(mocks.HostedDataPrivacySettings).toHaveBeenCalledWith({
      accountDeletionRetry: false,
      authenticated: true,
      authorizationEnabled: true,
    }, undefined);
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

test("SettingsPage surfaces and opens the authenticated active Family owner's own usage picker", async () => {
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
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  const ownerMember = {
    isOwner: true,
    joinedAt: new Date("2026-07-01T12:00:00.000Z"),
    label: "Account owner",
    memberId: "member_123",
    pendingPlanCode: null,
    planCode: "launch_monthly",
    role: "owner",
    status: "active",
  };
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
    billingActive: true,
    billingStatus: "active",
    displayName: null,
    groupId: "hbag_abcdefghijklmnop",
    invites: [],
    members: [ownerMember],
    ownerMemberId: "member_123",
    plans: {},
    seats: {},
    suspendedAt: null,
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");
  renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({}),
  }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpInitialOpen: false,
      usageTopUpOffers: expect.arrayContaining([
        expect.objectContaining({ amountLabel: "$5" }),
      ]),
      usageTopUpScope: "family",
      usageTopUpTargetLabel: "you",
    }),
    undefined,
  );

  mocks.HostedBillingSettings.mockClear();
  renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({ addUsage: "family" }),
  }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActivePurchase: null,
      usageTopUpCheckoutUrl:
        "/api/settings/billing/family/members/member_123/usage-credit/checkout",
      usageTopUpInitialOpen: true,
      usageTopUpOffers: [
        {
          amountLabel: "$5",
          offerCode: "usage_5_usd",
        },
        {
          amountLabel: "$10",
          offerCode: "usage_10_usd",
        },
        {
          amountLabel: "$25",
          offerCode: "usage_25_usd",
        },
      ],
      usageTopUpPurchaseReturn: null,
      usageTopUpScope: "family",
      usageTopUpTargetLabel: "you",
    }),
    undefined,
  );

  mocks.HostedBillingSettings.mockClear();
  renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({ addUsage: "true" }),
  }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpCheckoutUrl:
        "/api/settings/billing/family/members/member_123/usage-credit/checkout",
      usageTopUpInitialOpen: true,
      usageTopUpScope: "family",
      usageTopUpTargetLabel: "you",
    }),
    undefined,
  );
});

test.each([
  {
    beneficiaryMemberId: "member_123",
    checkoutKind: "success",
    label: "successful owner-seat return",
    ownerSurfaceOwnsReturn: true,
  },
  {
    beneficiaryMemberId: "member_123",
    checkoutKind: "cancel",
    label: "canceled owner-seat return",
    ownerSurfaceOwnsReturn: true,
  },
  {
    beneficiaryMemberId: "member_family",
    checkoutKind: "success",
    label: "successful active-member return",
    ownerSurfaceOwnsReturn: false,
  },
  {
    beneficiaryMemberId: "member_family",
    checkoutKind: "cancel",
    label: "canceled active-member return",
    ownerSurfaceOwnsReturn: false,
  },
  {
    beneficiaryMemberId: "member_former",
    checkoutKind: "success",
    label: "successful former-member return",
    ownerSurfaceOwnsReturn: false,
  },
  {
    beneficiaryMemberId: "member_former",
    checkoutKind: "cancel",
    label: "canceled former-member return",
    ownerSurfaceOwnsReturn: false,
  },
] as const)(
  "SettingsPage gives one exact Family surface the $label",
  async ({
    beneficiaryMemberId,
    checkoutKind,
    ownerSurfaceOwnsReturn,
  }) => {
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
      session: {
        privyUserId: "did:privy:user_123",
      },
    });
    const familyOwner = {
      billingActive: true,
      billingStatus: "active",
      displayName: null,
      groupId: "hbag_abcdefghijklmnop",
      invites: [],
      members: [
        {
          isOwner: true,
          label: null,
          memberId: "member_123",
          status: "active",
        },
        {
          isOwner: false,
          label: "Alex",
          memberId: "member_family",
          status: "active",
        },
      ],
      ownerMemberId: "member_123",
      plans: {},
      seats: {},
      suspendedAt: null,
    };
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(familyOwner);
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(null);
    mocks.readHostedUsageCreditPurchaseTargetForPayer.mockResolvedValue({
      beneficiaryMemberId,
      familyGroupId: familyOwner.groupId,
      kind: "family",
    });

    const { default: SettingsPage } = await import(
      "../app/(dashboard)/settings/page"
    );
    renderToStaticMarkup(await SettingsPage({
      searchParams: Promise.resolve({
        usageCheckout: checkoutKind,
        usageFamily: familyOwner.groupId,
        usageMember: beneficiaryMemberId,
        usagePurchase: "hucp_abcdefghijklmnop",
      }),
    }));
    const expectedReturn = {
      kind: checkoutKind,
      purchaseId: "hucp_abcdefghijklmnop",
    };

    expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        usageTopUpPurchaseReturn: ownerSurfaceOwnsReturn
          ? expectedReturn
          : null,
        usageTopUpScope: "family",
        usageTopUpTargetLabel: "you",
      }),
      undefined,
    );
    expect(mocks.HostedFamilySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        usageTopUpPurchaseReturn: ownerSurfaceOwnsReturn
          ? null
          : expectedReturn,
        usageTopUpReturnMemberId: ownerSurfaceOwnsReturn
          ? null
          : beneficiaryMemberId,
      }),
      undefined,
    );
  },
);

test("SettingsPage keeps a delayed owner return separate from a newer member purchase", async () => {
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
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  const familyOwner = {
    billingActive: true,
    billingStatus: "active",
    displayName: null,
    groupId: "hbag_abcdefghijklmnop",
    invites: [],
    members: [
      {
        isOwner: true,
        label: null,
        memberId: "member_123",
        status: "active",
      },
      {
        isOwner: false,
        label: "Family member",
        memberId: "member_family",
        status: "active",
      },
    ],
    ownerMemberId: "member_123",
    plans: {},
    seats: {},
    suspendedAt: null,
  };
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(familyOwner);
  const newerMemberPurchase = {
    offerCode: "usage_10_usd",
    purchaseId: "hucp_memberactive0000",
    retryAllowed: true,
    status: "checkout_open",
    target: {
      beneficiaryMemberId: "member_family",
      familyGroupId: familyOwner.groupId,
      kind: "family",
    },
    url: "https://checkout.stripe.test/newer-member",
  } as const;
  mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(
    newerMemberPurchase,
  );
  mocks.readHostedUsageCreditPurchaseTargetForPayer.mockResolvedValue({
    beneficiaryMemberId: "member_123",
    familyGroupId: familyOwner.groupId,
    kind: "family",
  });

  const { default: SettingsPage } = await import(
    "../app/(dashboard)/settings/page"
  );
  renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({
      usageCheckout: "success",
      usageFamily: familyOwner.groupId,
      usageMember: "member_123",
      usagePurchase: "hucp_ownerreturn00000",
    }),
  }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActivePurchase: null,
      usageTopUpPurchaseReturn: {
        kind: "success",
        purchaseId: "hucp_ownerreturn00000",
      },
      usageTopUpScope: "family",
      usageTopUpTargetLabel: "you",
    }),
    undefined,
  );
  expect(mocks.HostedFamilySettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActiveMemberId: "member_family",
      usageTopUpActivePurchase: newerMemberPurchase,
      usageTopUpPurchaseReturn: null,
      usageTopUpReturnMemberId: null,
    }),
    undefined,
  );
});

test.each(["success", "cancel"] as const)(
  "SettingsPage preserves an exact personal $1 return after the payer becomes a Family owner",
  async (checkoutKind) => {
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
      session: {
        privyUserId: "did:privy:user_123",
      },
    });
    mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
      billingActive: true,
      billingStatus: "active",
      displayName: null,
      groupId: "hbag_abcdefghijklmnop",
      invites: [],
      members: [
        {
          isOwner: true,
          label: "Account owner",
          memberId: "member_123",
          status: "active",
        },
      ],
      ownerMemberId: "member_123",
      plans: {},
      seats: {},
      suspendedAt: null,
    });
    mocks.readHostedUsageCreditPurchaseTargetForPayer.mockResolvedValue({
      beneficiaryMemberId: "member_123",
      kind: "personal",
    });
    const activePurchase = {
      offerCode: "usage_5_usd",
      purchaseId: "hucp_abcdefghijklmnop",
      retryAllowed: true,
      status: "checkout_open",
      target: {
        beneficiaryMemberId: "member_123",
        kind: "personal",
      },
      url: "https://checkout.stripe.test/session",
    } as const;
    mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(
      activePurchase,
    );

    const { default: SettingsPage } = await import(
      "../app/(dashboard)/settings/page"
    );
    renderToStaticMarkup(await SettingsPage({
      searchParams: Promise.resolve({
        usageCheckout: checkoutKind,
        usagePurchase: "hucp_abcdefghijklmnop",
      }),
    }));

    expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        usageTopUpActivePurchase: null,
        usageTopUpCheckoutUrl: undefined,
        usageTopUpPurchaseReturn: {
          kind: checkoutKind,
          purchaseId: "hucp_abcdefghijklmnop",
        },
        usageTopUpScope: "personal",
        usageTopUpTargetLabel: undefined,
      }),
      undefined,
    );
    expect(mocks.HostedFamilySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        usageTopUpPurchaseReturn: null,
        usageTopUpReturnMemberId: null,
      }),
      undefined,
    );
  },
);

test.each([
  {
    addUsage: ["family", "family"],
    label: "repeated selector",
    member: {
      isOwner: true,
      memberId: "member_123",
      status: "active",
    },
  },
  {
    addUsage: "family",
    label: "non-owner row",
    member: {
      isOwner: false,
      memberId: "member_123",
      status: "active",
    },
  },
  {
    addUsage: "family",
    label: "inactive owner row",
    member: {
      isOwner: true,
      memberId: "member_123",
      status: "inactive",
    },
  },
])("SettingsPage ignores a $label for the Family owner picker", async ({
  addUsage,
  member,
}) => {
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
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
    billingActive: true,
    billingStatus: "active",
    displayName: null,
    groupId: "hbag_abcdefghijklmnop",
    invites: [],
    members: [member],
    ownerMemberId: "member_123",
    plans: {},
    seats: {},
    suspendedAt: null,
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");
  renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({ addUsage }),
  }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({ usageTopUpInitialOpen: false }),
    undefined,
  );
});

test("SettingsPage keeps a frozen active purchase visible when current offers are unavailable", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "past_due",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValue([]);
  const activePurchase = {
    offerCode: "usage_10_usd",
    purchaseId: "hucp_abcdefghijklmnop",
    retryAllowed: false,
    status: "checkout_open",
    target: {
      beneficiaryMemberId: "member_123",
      kind: "personal",
    },
    url: "https://checkout.stripe.test/session",
  } as const;
  mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(
    activePurchase,
  );

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");
  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActivePurchase: activePurchase,
      usageTopUpOffers: [],
    }),
    undefined,
  );
});

test("SettingsPage keeps a frozen personal purchase recoverable after Family activation", async () => {
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
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
    billingActive: true,
    billingStatus: "active",
    displayName: null,
    groupId: "hbag_abcdefghijklmnop",
    invites: [],
    members: [
      {
        isOwner: true,
        label: null,
        memberId: "member_123",
        status: "active",
      },
    ],
    ownerMemberId: "member_123",
    plans: {},
    seats: {},
    suspendedAt: null,
  });
  const activePurchase = {
    offerCode: "usage_10_usd",
    purchaseId: "hucp_abcdefghijklmnop",
    retryAllowed: true,
    status: "checkout_open",
    target: {
      beneficiaryMemberId: "member_123",
      kind: "personal",
    },
    url: "https://checkout.stripe.test/session",
  } as const;
  mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(
    activePurchase,
  );

  const { default: SettingsPage } = await import(
    "../app/(dashboard)/settings/page"
  );
  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActivePurchase: activePurchase,
      usageTopUpCheckoutUrl: undefined,
      usageTopUpOffers: [],
      usageTopUpPurchaseReturn: null,
      usageTopUpScope: "personal",
      usageTopUpTargetLabel: undefined,
    }),
    undefined,
  );
});

test.each([
  {
    label: "hosted-group",
    target: {
      beneficiaryMemberId: "member_group",
      groupJoinCode: "group_join_code_1234",
      kind: "group" as const,
    },
  },
  {
    label: "another Family group",
    target: {
      beneficiaryMemberId: "member_family",
      familyGroupId: "hbag_otherfamilygroup",
      kind: "family" as const,
    },
  },
])("SettingsPage keeps a $label purchase available for status and cancellation", async ({ target }) => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
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
  const familyOwner = {
    billingActive: true,
    billingStatus: "active",
    displayName: null,
    groupId: "hbag_currentfamilygrp",
    invites: [],
    members: [{ label: null, memberId: "member_123" }],
    ownerMemberId: "member_123",
    plans: {},
    seats: {},
    suspendedAt: null,
  };
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(familyOwner);
  const activePurchase = {
    offerCode: "usage_10_usd",
    purchaseId: "hucp_abcdefghijklmnop",
    retryAllowed: false,
    status: "checkout_open",
    target,
    url: "https://checkout.stripe.test/session",
  } as const;
  mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(
    activePurchase,
  );

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");
  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActivePurchase: {
        ...activePurchase,
        retryAllowed: false,
        targetConflict: true,
        url: undefined,
      },
      usageTopUpOffers: [],
    }),
    undefined,
  );
  expect(mocks.HostedFamilySettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActiveMemberId: null,
      usageTopUpActivePurchase: null,
      usageTopUpOffers: [],
    }),
    undefined,
  );
});

test("SettingsPage keeps a former Family purchase status-only despite duplicate roster labels", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
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
  const familyOwner = {
    billingActive: true,
    billingStatus: "active",
    displayName: null,
    groupId: "hbag_abcdefghijklmnop",
    invites: [],
    members: [
      {
        isOwner: true,
        label: null,
        memberId: "member_123",
        status: "active",
      },
      {
        isOwner: false,
        label: "Alex",
        memberId: "member_current_a",
        status: "active",
      },
      {
        isOwner: false,
        label: "Alex",
        memberId: "member_current_b",
        status: "active",
      },
    ],
    ownerMemberId: "member_123",
    plans: {},
    seats: {},
    suspendedAt: null,
  };
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(familyOwner);
  const activePurchase = {
    offerCode: "usage_25_usd",
    purchaseId: "hucp_abcdefghijklmnop",
    retryAllowed: false,
    status: "checkout_open",
    target: {
      beneficiaryMemberId: "member_family",
      familyGroupId: "hbag_abcdefghijklmnop",
      kind: "family",
    },
  } as const;
  mocks.readHostedActiveUsageCreditPurchaseForPayer.mockResolvedValue(activePurchase);
  mocks.readHostedUsageCreditPurchaseTargetForPayer.mockResolvedValue(
    activePurchase.target,
  );

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");
  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({
      usageCheckout: "success",
      usageFamily: "hbag_abcdefghijklmnop",
      usageMember: "member_family",
      usagePurchase: "hucp_abcdefghijklmnop",
    }),
  }));
  assert.match(markup, /id="family"/);

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActivePurchase: expect.objectContaining({
        purchaseId: "hucp_abcdefghijklmnop",
        retryAllowed: false,
        targetConflict: true,
      }),
      usageTopUpOffers: [],
      usageTopUpPurchaseReturn: null,
    }),
    undefined,
  );
  expect(mocks.HostedFamilySettings).toHaveBeenCalledWith({
    ownerSnapshot: familyOwner,
    payerMemberId: "member_123",
    usageTopUpActiveMemberId: "member_family",
    usageTopUpActivePurchase: activePurchase,
    usageTopUpContactOptions: [{
      href: "sms:+15550100001?body=Hey%20Murph%2C%20I%20just%20added%20more%20usage.",
      kind: "text",
      label: "Messages",
    }],
    usageTopUpOffers: [],
    usageTopUpPurchaseReturn: {
      kind: "success",
      purchaseId: "hucp_abcdefghijklmnop",
    },
    usageTopUpReturnMemberId: "member_family",
  }, undefined);
  expect(mocks.readHostedUsageCreditPurchaseTargetForPayer).toHaveBeenCalledWith({
    payerMemberId: "member_123",
    prisma: mocks.prisma,
    purchaseId: "hucp_abcdefghijklmnop",
  });
  expect(mocks.readHostedActiveUsageCreditPurchaseForPayer).toHaveBeenCalledWith({
    serverApprovedPayableTargets: [
      {
        beneficiaryMemberId: "member_123",
        kind: "personal",
      },
      {
        beneficiaryMemberId: "member_123",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      },
      {
        beneficiaryMemberId: "member_current_a",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      },
      {
        beneficiaryMemberId: "member_current_b",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      },
    ],
    payerMemberId: "member_123",
    prisma: mocks.prisma,
  });
  expect(mocks.readHostedConfiguredUsageCreditOfferCodes).not.toHaveBeenCalled();
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

  const markup = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  assert.match(markup, /Hosted account settings \+15550100003/);
  expect(mocks.HostedAccountSettingsCards).toHaveBeenCalledWith(expect.objectContaining({
    account: accountSnapshot,
    murphPhoneNumber: "+15550100003",
  }), undefined);
});

test("SettingsPage omits an empty email-only invitation but preserves activity history", async () => {
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
  mocks.readHostedAiUsageActivity.mockResolvedValue({
    credits: [],
    missions: [],
    missionsEnabled: true,
  });
  mocks.resolveMurphContactOptions.mockImplementation((input) =>
    input?.contactChannels?.email === true
      ? [{
          href: "mailto:murph@mail.withmurph.ai?body=test",
          kind: "email",
          label: "Email",
        }]
      : []
  );

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  expect(mocks.CustomizeMurphSettings).toHaveBeenCalledWith(expect.objectContaining({
    voiceTestContactOption: null,
  }), undefined);
  expect(mocks.HostedAiUsageActivity).not.toHaveBeenCalled();
  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageActivityDetail: null,
    }),
    undefined,
  );
  expect(mocks.resolveMurphContactOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      contactChannels: {
        email: false,
        telegram: false,
        text: false,
      },
      message: {
        body: "Hey Murph, what referral options can I choose from?",
      },
    }),
  );

  mocks.HostedAiUsageActivity.mockClear();
  mocks.readHostedAiUsageActivity.mockResolvedValue({
    credits: [{
      addedLabel: "$5.00",
      dateLabel: "Jul 29, 2026",
      id: "credit_email_history",
      sourceLabel: "Added for you",
    }],
    missions: [],
    missionsEnabled: true,
  });
  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(mocks.HostedAiUsageActivity).toHaveBeenCalledWith(
    expect.objectContaining({
      activity: expect.objectContaining({
        credits: [expect.objectContaining({ id: "credit_email_history" })],
      }),
      missionContactOption: null,
    }),
    undefined,
  );

  mocks.HostedAiUsageActivity.mockClear();
  mocks.readHostedAiUsageActivity.mockResolvedValue({
    credits: [],
    missions: [{
      destinationLabel: "your Murph",
      id: "mission_email_history",
      requirementsLabel: "Complete the selected mission.",
      rewardLabel: "About 10 more days of Murph usage",
      selectedLabel: "Jul 20, 2026",
      status: "completed",
      statusLabel: "Completed",
      timingLabel: "Earned Jul 27, 2026",
      title: "Completed mission",
    }],
    missionsEnabled: true,
  });
  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(mocks.HostedAiUsageActivity).toHaveBeenCalledWith(
    expect.objectContaining({
      activity: expect.objectContaining({
        missions: [expect.objectContaining({ id: "mission_email_history" })],
      }),
      missionContactOption: null,
    }),
    undefined,
  );
});


test("SettingsPage preserves the Group payment-method receipt and fresh start action", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.prisma.hostedGroupMember.findFirst.mockResolvedValue({ id: "membership_123" });
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "paused",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mockSettingsPageSnapshot({
    billingRef: {
      currentBillingPhase: null,
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
      startGroup: "payment_method_saved",
    }),
  }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
    groupPaymentMethodSaved: true,
    showGroupPlan: true,
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

  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
    canStartFamily: true,
    familyBillingOwner: false,
    familyState: "none",
  }), undefined);
  expect(mocks.HostedFamilySettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpOffers: [],
    }),
    undefined,
  );
});

test.each([
  HostedBillingStatus.incomplete,
  HostedBillingStatus.past_due,
  HostedBillingStatus.paused,
  HostedBillingStatus.unpaid,
])("SettingsPage keeps %s Family billing recoverable from Subscription", async (billingStatus) => {
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
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
    billingActive: false,
    billingStatus,
    displayName: null,
    groupId: "group_123",
    invites: [],
    members: [],
    ownerMemberId: "member_123",
    plans: {
      edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
      pulse: { active: 1, billed: 2, invited: 0, remaining: 1, used: 1 },
    },
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

  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      canStartFamily: false,
      familyBillingOwner: true,
      familyState: "none",
    }),
    undefined,
  );
});

test("SettingsPage keeps Family settings available when the top-up catalog is unavailable", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPrivySession.mockResolvedValue(null);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    session: { privyUserId: "did:privy:user_123" },
  });
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
    billingActive: true,
    billingStatus: "active",
    displayName: null,
    groupId: "hbag_abcdefghijklmnop",
    invites: [],
    members: [{ isOwner: true, label: null, memberId: "member_123" }],
    ownerMemberId: "member_123",
    plans: {},
    seats: {},
    suspendedAt: null,
  });
  mocks.readHostedConfiguredUsageCreditOfferCodes.mockImplementation(() => {
    throw new Error("catalog unavailable");
  });

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(mocks.HostedFamilySettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpOffers: [],
    }),
    undefined,
  );
});

test("SettingsPage awaits database-backed settings reads one at a time", async () => {
  const originalPrivyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "cm_app_settings_test";
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    session: {
      privyUserId: "did:privy:user_123",
    },
  });

  let databaseReadsInFlight = 0;
  let maxDatabaseReadsInFlight = 0;
  const databaseReadOrder: string[] = [];

  function trackDatabaseRead<T>(name: string, value: T): () => Promise<T> {
    return async () => {
      databaseReadOrder.push(name);
      databaseReadsInFlight += 1;
      maxDatabaseReadsInFlight = Math.max(
        maxDatabaseReadsInFlight,
        databaseReadsInFlight,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      databaseReadsInFlight -= 1;
      return value;
    };
  }

  mocks.readHostedAccountSettingsPageSnapshot.mockImplementation(
    trackDatabaseRead("settingsSnapshot", {
      account: EMPTY_ACCOUNT_SETTINGS,
      billingRef: null,
      routing: null,
    }),
  );
  mocks.readHostedFamilyOwnerSnapshotForMember.mockImplementation(
    trackDatabaseRead("familyOwner", null),
  );
  mocks.readHostedFamilyAccessForMember.mockImplementation(
    trackDatabaseRead("familyAccess", null),
  );
  mocks.readHostedPersonalAiUsageStatus.mockImplementation(
    trackDatabaseRead("usageStatus", {
      generatedAt: "2026-07-10T12:00:00.000Z",
      reason: "hosted_access_inactive",
      recommendedAction: null,
      status: "unavailable",
    }),
  );
  mocks.readHostedAiUsageActivity.mockImplementation(
    trackDatabaseRead("usageActivity", {
      credits: [],
      missions: [],
      missionsEnabled: false,
    }),
  );
  mocks.readHostedPersonalUsageCreditOfferCodes.mockImplementation(
    trackDatabaseRead("usageTopUpOfferCodes", []),
  );
  mocks.readHostedActiveUsageCreditPurchaseForPayer.mockImplementation(
    trackDatabaseRead("usageTopUpActivePurchase", null),
  );
  // Privy network reads resolve after every database read so the render
  // proves the page still waits for their values.
  mocks.getHostedPrivySession.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return null;
  });
  mocks.readHostedSecureApprovalStatus.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { status: "configured" };
  });

  try {
    const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

    renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(maxDatabaseReadsInFlight).toBe(1);
    expect(databaseReadOrder).toEqual([
      "settingsSnapshot",
      "familyOwner",
      "familyAccess",
      "usageStatus",
      "usageActivity",
      "usageTopUpOfferCodes",
      "usageTopUpActivePurchase",
    ]);
    expect(mocks.readHostedFamilyOwnerSnapshotForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.readHostedFamilyAccessForMember).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
    expect(mocks.HostedPasskeySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        secureApprovalStatus: { status: "configured" },
      }),
      undefined,
    );
  } finally {
    if (originalPrivyAppId === undefined) {
      delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    } else {
      process.env.NEXT_PUBLIC_PRIVY_APP_ID = originalPrivyAppId;
    }
  }
});

test("SettingsPage preserves billing when optional usage and Privy reads fail", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
    linkedAccounts: [],
    session: {
      privyUserId: "did:privy:user_123",
    },
  });
  mocks.getHostedPrivySession.mockRejectedValue(new Error("privy unavailable"));
  mocks.readHostedPersonalUsageCreditOfferCodes.mockRejectedValue(
    new Error("offer codes unavailable"),
  );
  mocks.readHostedActiveUsageCreditPurchaseForPayer.mockRejectedValue(
    new Error("purchase lookup failed"),
  );
  mocks.readHostedAiUsageActivity.mockRejectedValue(
    new Error("usage activity unavailable"),
  );

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
    expect.objectContaining({
      usageTopUpActivePurchase: null,
      usageTopUpOffers: [],
    }),
    undefined,
  );
  expect(mocks.withServerApprovedPrivyAccountHints).toHaveBeenCalledWith({
    snapshot: EMPTY_ACCOUNT_SETTINGS,
    serverApprovedPrivyLinkedAccounts: null,
  });
  expect(mocks.HostedAiUsageActivity).not.toHaveBeenCalled();
});

test("SettingsPage renders fallback values without reading settings data when the session has no member", async () => {
  const originalPrivyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = "cm_app_settings_test";
  mocks.getPrisma.mockReturnValue(mocks.prisma);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: null,
    session: {
      privyUserId: "did:privy:user_123",
    },
  });

  try {
    const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

    renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.readHostedAccountSettingsPageSnapshot).not.toHaveBeenCalled();
    expect(mocks.readHostedFamilyOwnerSnapshotForMember).not.toHaveBeenCalled();
    expect(mocks.readHostedFamilyAccessForMember).not.toHaveBeenCalled();
    expect(mocks.readHostedPersonalAiUsageStatus).not.toHaveBeenCalled();
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).not.toHaveBeenCalled();
    expect(mocks.readHostedActiveUsageCreditPurchaseForPayer).not.toHaveBeenCalled();
    expect(mocks.readHostedSecureApprovalStatus).not.toHaveBeenCalled();
    expect(mocks.getHostedPrivySession).not.toHaveBeenCalled();
    expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticated: true,
        usageStatus: null,
        usageTopUpActivePurchase: null,
        usageTopUpOffers: [],
      }),
      undefined,
    );
    expect(mocks.HostedPasskeySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        secureApprovalStatus: { status: "unavailable" },
      }),
      undefined,
    );
    expect(mocks.HostedAccountSettingsCards).not.toHaveBeenCalled();
    expect(mocks.HostedFamilySettings).not.toHaveBeenCalled();
  } finally {
    if (originalPrivyAppId === undefined) {
      delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    } else {
      process.env.NEXT_PUBLIC_PRIVY_APP_ID = originalPrivyAppId;
    }
  }
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

  renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

  expect(mocks.withServerApprovedPrivyAccountHints).toHaveBeenCalledWith({
    snapshot: accountSnapshot,
    serverApprovedPrivyLinkedAccounts: null,
  });
});

describe("settings subscription composition", () => {
  const settingsPage = new URL(
    "../app/(dashboard)/settings/page.tsx",
    import.meta.url,
  );

  test("keeps acquisition separate from existing-billing recovery", async () => {
    const source = await readFile(settingsPage, "utf8");

    assert.match(source, /hasHostedMemberOwnPaidBilling/);
    assert.match(source, /hasHostedRecoverableBilling/);
    assert.match(source, /const hasRecoverableBilling/);
    assert.match(source, /const canStartDirectPlan/);
    assert.match(source, /!hasRecoverableBilling/);
    assert.match(source, /ownPaidBillingActive \|\| hasRecoverableBilling/);
    assert.match(source, /canStartDirectPlan=\{canStartDirectPlan\}/);
  });

  test("contains no timed-trial continuation surface", async () => {
    const source = await readFile(settingsPage, "utf8");

    assert.doesNotMatch(source, /PulseTrialBillingContinuation/);
    assert.doesNotMatch(source, /readHostedPulseTrialContinuationCookie/);
    assert.doesNotMatch(source, /StartPaidPulseButton/);
    assert.doesNotMatch(source, /trial end|days left|expires/i);
  });
});
