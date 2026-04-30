import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(),
  HostedBillingSettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted billing settings ${String(props.authenticated)}`)),
  HostedDataPrivacySettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted data privacy settings ${String(props.authenticated)}`)),
  HostedEmailSettings: vi.fn((props: { authenticated: boolean; initialLinkedAccounts: unknown[] }) =>
    React.createElement(
      "div",
      null,
      `Hosted email settings ${String(props.authenticated)} ${String(props.initialLinkedAccounts.length)}`,
    )),
  HostedPhoneSettings: vi.fn((props: {
    authenticated: boolean;
    initialLinkedAccounts: unknown[];
    murphPhoneNumber?: string | null;
  }) =>
    React.createElement(
      "div",
      null,
      `Hosted phone settings ${String(props.authenticated)} ${String(props.initialLinkedAccounts.length)} ${String(props.murphPhoneNumber ?? "")}`,
    )),
  HostedTelegramCardSettings: vi.fn((props: { authenticated: boolean; initialLinkedAccounts: unknown[] }) =>
    React.createElement(
      "div",
      null,
      `Hosted Telegram settings ${String(props.authenticated)} ${String(props.initialLinkedAccounts.length)}`,
    )),
  prisma: {},
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

vi.mock("@/src/components/hosted-onboarding/hosted-phone-country-code-boundary", () => ({
  HostedPhoneCountryCodeBoundary(input: { children: React.ReactNode }) {
    return React.createElement(
      "div",
      {
        "data-phone-country-code": "CA",
      },
      input.children,
    );
  },
}));

vi.mock("@/src/components/settings/hosted-email-settings", () => ({
  HostedEmailSettings: mocks.HostedEmailSettings,
}));

vi.mock("@/src/components/settings/hosted-phone-settings", () => ({
  HostedPhoneSettings: mocks.HostedPhoneSettings,
}));

vi.mock("@/src/components/settings/hosted-billing-settings", () => ({
  HostedBillingSettings: mocks.HostedBillingSettings,
}));

vi.mock("@/src/components/settings/hosted-telegram-card-settings", () => ({
  HostedTelegramCardSettings: mocks.HostedTelegramCardSettings,
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

test("SettingsPage reads the server-side Privy session and threads it into the settings tree", async () => {
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

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage());

  assert.match(markup, /Hosted billing settings/);
  assert.match(markup, /Hosted phone settings true 1 \+15550100001/);
  assert.match(markup, /Hosted email settings/);
  assert.match(markup, /Hosted Telegram settings/);
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
  assert.match(markup, /data-phone-country-code="CA"/);
  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
  }), undefined);
  expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: mocks.prisma,
  });
  expect(mocks.HostedPhoneSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
    initialLinkedAccounts: expect.any(Array),
    murphPhoneNumber: "+15550100001",
  }), undefined);
  expect(mocks.HostedEmailSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
    initialLinkedAccounts: expect.any(Array),
  }), undefined);
  expect(mocks.HostedTelegramCardSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
    initialLinkedAccounts: expect.any(Array),
  }), undefined);
  expect(mocks.HostedDataPrivacySettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
  }), undefined);
});
