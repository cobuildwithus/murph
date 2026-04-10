import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  HostedBillingSettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted billing settings ${String(props.authenticated)}`)),
  HostedDeviceSyncSettings: vi.fn((props: { authenticated: boolean }) =>
    React.createElement("div", null, `Hosted device sync settings ${String(props.authenticated)}`)),
  HostedEmailSettings: vi.fn((props: { authenticated: boolean; initialLinkedAccounts: unknown[] }) =>
    React.createElement(
      "div",
      null,
      `Hosted email settings ${String(props.authenticated)} ${String(props.initialLinkedAccounts.length)}`,
    )),
  HostedTelegramSettings: vi.fn((props: { authenticated: boolean; initialLinkedAccounts: unknown[] }) =>
    React.createElement(
      "div",
      null,
      `Hosted Telegram settings ${String(props.authenticated)} ${String(props.initialLinkedAccounts.length)}`,
    )),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/components/settings/hosted-email-settings", () => ({
  HostedEmailSettings: mocks.HostedEmailSettings,
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

test("SettingsPage reads the server-side Privy session and threads it into the settings tree", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      id: "member_123",
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

  const { default: SettingsPage } = await import("../app/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage());

  assert.match(markup, /Hosted billing settings/);
  assert.match(markup, /Hosted email settings/);
  assert.match(markup, /Hosted Telegram settings/);
  assert.match(markup, /Hosted device sync settings/);
  assert.match(markup, /Your account/);
  assert.match(markup, /Subscription, connected accounts, and wearables\./);
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
  expect(mocks.HostedDeviceSyncSettings).toHaveBeenCalledWith(expect.objectContaining({
    authenticated: true,
  }), undefined);
});
