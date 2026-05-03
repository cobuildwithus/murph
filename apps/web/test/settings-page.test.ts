import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(),
  HostedAccountSettingsCards: vi.fn((props: {
    account: unknown;
    murphPhoneNumber?: string | null;
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted account settings ${String(props.murphPhoneNumber ?? "")}`,
    )),
  HostedBillingSettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted billing settings ${String(props.authenticated)}`)),
  HostedDataPrivacySettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted data privacy settings ${String(props.authenticated)}`)),
  prisma: {},
  readHostedAccountSettingsSnapshot: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
}));

vi.mock("server-only", () => ({}));

const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/hosted-onboarding/account-settings-snapshot", () => ({
  readHostedAccountSettingsSnapshot: mocks.readHostedAccountSettingsSnapshot,
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

test("SettingsPage reads the app session and persisted account settings into the settings tree", async () => {
  mocks.getPrisma.mockReturnValue(mocks.prisma);
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
    session: null,
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

  const markup = renderToStaticMarkup(await SettingsPage());

  assert.match(markup, /Hosted billing settings/);
  assert.match(markup, /Hosted account settings \+15550100001/);
  assert.match(markup, /Hosted data privacy settings/);
  assert.match(markup, /Your account/);
  assert.match(markup, /Subscription, connected accounts, data sources, and data privacy\./);
  assert.match(markup, /Data sources/);
  assert.match(markup, /href="\/connect"[^>]*>Connect devices/);
  assert.equal(markup.includes("Wearables"), false);
  assert.equal(markup.includes("Hosted device sync settings"), false);
  for (const removedCopy of [
    ["vault", "sync"].join(" "),
    ["Sync", "local", "vault"].join(" "),
    ["Local", "to-hosted import"].join("-"),
  ]) {
    assert.equal(markup.includes(removedCopy), false);
  }
  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
  }), undefined);
  expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: mocks.prisma,
  });
  expect(mocks.readHostedAccountSettingsSnapshot).toHaveBeenCalledWith({
    memberId: "member_123",
  });
  expect(mocks.HostedAccountSettingsCards).toHaveBeenCalledWith(expect.objectContaining({
    account: accountSnapshot,
    murphPhoneNumber: "+15550100001",
  }), undefined);
  expect(mocks.HostedDataPrivacySettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
  }), undefined);
});
