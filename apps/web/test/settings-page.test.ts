import assert from "node:assert/strict";

import { HostedBillingStatus } from "@prisma/client";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getHostedPrivySession: vi.fn(),
  getPrisma: vi.fn(),
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
  HostedBillingSettings: vi.fn((props: {
    authenticated: boolean;
    canStartFamily?: boolean;
    canStartPaidPulse?: boolean;
    canUpgradeToEdge?: boolean;
    currentBillingPhase?: unknown;
    currentCheckoutOffer?: unknown;
    currentBillingPlanCode?: unknown;
    familyState?: "none" | "owner" | "sponsored";
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted billing settings ${String(props.authenticated)} ${String(props.canUpgradeToEdge ?? false)} ${String(props.currentBillingPlanCode ?? "")}`,
    )),
  HostedDataPrivacySettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted data privacy settings ${String(props.authenticated)}`)),
  HostedFamilySettings: vi.fn(() => React.createElement("div", null, "Hosted family settings")),
  routerRefresh: vi.fn(),
  readHostedFamilyAccessForMember: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
  prisma: {
    hostedCodexAuthConnection: {
      findUnique: vi.fn(async () => null),
    },
  },
  readHostedAccountSettingsSnapshot: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({
  readHostedAccountSettingsSnapshot: mocks.readHostedAccountSettingsSnapshot,
  withServerApprovedPrivyAccountHints: mocks.withServerApprovedPrivyAccountHints,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-session", () => ({
  getHostedPrivySession: mocks.getHostedPrivySession,
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

vi.mock("@/src/components/settings/hosted-billing-settings", () => ({
  HostedBillingSettings: mocks.HostedBillingSettings,
}));

vi.mock("@/src/components/settings/hosted-account-settings-cards", () => ({
  HostedAccountSettingsCards: mocks.HostedAccountSettingsCards,
}));

vi.mock("@/src/components/settings/hosted-data-privacy-settings", () => ({
  HostedDataPrivacySettings: mocks.HostedDataPrivacySettings,
}));

vi.mock("@/src/components/settings/hosted-family-settings", () => ({
  HostedFamilySettings: mocks.HostedFamilySettings,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedFamilyAccessForMember: mocks.readHostedFamilyAccessForMember,
  readHostedFamilyOwnerSnapshotForMember: mocks.readHostedFamilyOwnerSnapshotForMember,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readHostedFamilyAccessForMember.mockResolvedValue(null);
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue(null);
});

test("HostedFamilySettings explains family member privacy without enumerating data categories", async () => {
  const { HostedFamilySettings } = await vi.importActual<
    typeof import("@/src/components/settings/hosted-family-settings")
  >("@/src/components/settings/hosted-family-settings");

  const ownerSnapshot = {
    billingActive: true,
    billingStatus: HostedBillingStatus.active,
    displayName: "Family",
    groupId: "hbag_family",
    invites: [],
    members: [
      {
        isOwner: true,
        joinedAt: new Date("2026-06-18T12:00:00.000Z"),
        label: "You",
        memberId: "member_owner",
        role: "owner",
        status: "active",
      },
    ],
    ownerMemberId: "member_owner",
    seats: {
      active: 1,
      billed: 2,
      invited: 0,
      max: 4,
      min: 2,
      remaining: 3,
      used: 1,
    },
    suspendedAt: null,
  } satisfies Parameters<typeof HostedFamilySettings>[0]["ownerSnapshot"];

  const markup = renderToStaticMarkup(React.createElement(HostedFamilySettings, {
    ownerSnapshot,
  }));

  assert.match(
    markup,
    /You pay for your family&#x27;s access, but what they share with Murph stays private to them\./,
  );
});

test("SettingsPage metadata uses the shared preview image", async () => {
  const { metadata } = await import("../app/(dashboard)/settings/page");

  assert.equal(metadata.title, "Settings — Murph");
  assert.equal(metadata.description, "Manage your Murph account settings.");
  assert.deepEqual(metadata.openGraph?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(metadata.twitter?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
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

test("SettingsPage reads the app session and persisted account settings into the settings tree", async () => {
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
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: "+15550100001",
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
    currentBillingPhase: "paid",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "standard",
    memberId: "member_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  });
  const accountSnapshot = {
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
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue(accountSnapshot);

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage({
    searchParams: Promise.resolve({ addEmail: "true" }),
  }));

  assert.match(markup, /Hosted billing settings/);
  assert.match(markup, /Hosted account settings \+15550100001/);
  assert.match(markup, /Manage wearables/);
  assert.match(markup, /href="\/connect"/);
  assert.match(markup, /Hosted data privacy settings/);
  assert.match(markup, /Your account/);
  assert.match(markup, /Subscription, connected accounts, and data privacy\./);
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
  }), undefined);
  expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: mocks.prisma,
  });
  expect(mocks.readHostedMemberStripeBillingRef).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: mocks.prisma,
  });
  expect(mocks.readHostedAccountSettingsSnapshot).toHaveBeenCalledWith({
    memberId: "member_123",
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
  expect(mocks.HostedDataPrivacySettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
  }), undefined);
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
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: "+15550100003",
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue(null);
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
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue(accountSnapshot);

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage());

  assert.match(markup, /Hosted account settings \+15550100003/);
  expect(mocks.HostedAccountSettingsCards).toHaveBeenCalledWith(expect.objectContaining({
    account: accountSnapshot,
    murphPhoneNumber: "+15550100003",
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
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
    currentBillingPhase: null,
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "pulse_trial_7d",
    memberId: "member_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  });
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue(null);

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
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue(null);
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue(null);
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
  mocks.readHostedMemberRoutingState.mockResolvedValue({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: "member_123",
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramThreadId: null,
    telegramUserId: null,
    telegramUserLookupKey: null,
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue(null);
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
  mocks.readHostedAccountSettingsSnapshot.mockResolvedValue(accountSnapshot);

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  renderToStaticMarkup(await SettingsPage());

  expect(mocks.withServerApprovedPrivyAccountHints).toHaveBeenCalledWith({
    snapshot: accountSnapshot,
    serverApprovedPrivyLinkedAccounts: null,
  });
});
