import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  HostedBillingSettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted billing settings ${String(props.authenticated)}`)),
  HostedDeviceSyncSettings: vi.fn((props: {
    authenticated: boolean;
    member: { billingStatus: string; id: string; suspendedAt: Date | null } | null;
  }) =>
    React.createElement("div", null, `Hosted device sync settings ${String(props.authenticated)} ${String(props.member?.id ?? "")}`)),
  HostedEmailSettings: vi.fn((props: { authenticated: boolean; initialLinkedAccounts: unknown[] }) =>
    React.createElement(
      "div",
      null,
      `Hosted email settings ${String(props.authenticated)} ${String(props.initialLinkedAccounts.length)}`,
    )),
  HostedPhoneSettings: vi.fn((props: { authenticated: boolean; initialLinkedAccounts: unknown[] }) =>
    React.createElement(
      "div",
      null,
      `Hosted phone settings ${String(props.authenticated)} ${String(props.initialLinkedAccounts.length)}`,
    )),
  HostedTelegramSettings: vi.fn((props: { authenticated: boolean; initialLinkedAccounts: unknown[] }) =>
    React.createElement(
      "div",
      null,
      `Hosted Telegram settings ${String(props.authenticated)} ${String(props.initialLinkedAccounts.length)}`,
    )),
  HostedVaultSyncSettings: vi.fn((props: {
    authenticated: boolean;
    member: { billingStatus: string; id: string; suspendedAt: Date | null } | null;
  }) =>
    React.createElement("div", null, `Hosted vault sync settings ${String(props.authenticated)} ${String(props.member?.id ?? "")}`)),
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

vi.mock("@/src/components/settings/hosted-telegram-settings", () => ({
  HostedTelegramSettings: mocks.HostedTelegramSettings,
}));

vi.mock("@/src/components/settings/hosted-device-sync-settings", () => ({
  HostedDeviceSyncSettings: mocks.HostedDeviceSyncSettings,
}));

vi.mock("@/src/components/settings/hosted-vault-sync-settings", () => ({
  HostedVaultSyncSettings: mocks.HostedVaultSyncSettings,
}));

test("SettingsPage reads the server-side Privy session and threads it into the settings tree", async () => {
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

  const { default: SettingsPage } = await import("../app/(dashboard)/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage());

  assert.match(markup, /Hosted billing settings/);
  assert.match(markup, /Hosted phone settings/);
  assert.match(markup, /Hosted email settings/);
  assert.match(markup, /Hosted Telegram settings/);
  assert.match(markup, /Hosted vault sync settings/);
  assert.match(markup, /Hosted device sync settings/);
  assert.match(markup, /Your account/);
  assert.match(markup, /Subscription, connected accounts, vault sync, and wearables\./);
  assert.match(markup, /data-phone-country-code="CA"/);
  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.HostedBillingSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
  }), undefined);
  expect(mocks.HostedEmailSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
    initialLinkedAccounts: expect.any(Array),
  }), undefined);
  expect(mocks.HostedTelegramSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
    initialLinkedAccounts: expect.any(Array),
  }), undefined);
  expect(mocks.HostedVaultSyncSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
    member: expect.objectContaining({
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    }),
  }), undefined);
  expect(mocks.HostedDeviceSyncSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
    member: expect.objectContaining({
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    }),
  }), undefined);
});
