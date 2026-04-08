import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveHostedPrivyClientAppId: vi.fn(),
  resolveHostedPrivyClientId: vi.fn(),
}));

vi.mock("@/src/components/settings/hosted-email-settings", () => ({
  HostedEmailSettings() {
    return createElement("div", null, "Hosted email settings");
  },
}));

vi.mock("@/src/components/settings/hosted-billing-settings", () => ({
  HostedBillingSettings() {
    return createElement("div", null, "Hosted billing settings");
  },
}));

vi.mock("@/src/components/settings/hosted-telegram-settings", () => ({
  HostedTelegramSettings() {
    return createElement("div", null, "Hosted Telegram settings");
  },
}));

vi.mock("@/src/components/settings/hosted-device-sync-settings", () => ({
  HostedDeviceSyncSettings() {
    return createElement("div", null, "Hosted device sync settings");
  },
}));

vi.mock("@/src/components/hosted-onboarding/privy-provider", () => ({
  HostedPrivyProvider(input: { children: React.ReactNode }) {
    return createElement("div", { "data-privy-provider": "true" }, input.children);
  },
}));

vi.mock("@/src/lib/hosted-onboarding/landing", () => ({
  resolveHostedPrivyClientAppId: mocks.resolveHostedPrivyClientAppId,
  resolveHostedPrivyClientId: mocks.resolveHostedPrivyClientId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveHostedPrivyClientAppId.mockReturnValue("cm_app_123");
  mocks.resolveHostedPrivyClientId.mockReturnValue("client_123");
});

test("SettingsPage renders the Privy-backed settings tree when client auth is configured", async () => {
  const { default: SettingsPage } = await import("../app/settings/page");

  const markup = renderToStaticMarkup(SettingsPage());

  assert.match(markup, /Hosted billing settings/);
  assert.match(markup, /Hosted email settings/);
  assert.match(markup, /Hosted Telegram settings/);
  assert.match(markup, /Hosted device sync settings/);
  assert.match(markup, /data-privy-provider="true"/);
  assert.match(markup, /Sign in with the same phone-backed Privy account you use for Murph/);
});

test("SettingsPage renders a config warning when Privy client auth is unavailable", async () => {
  mocks.resolveHostedPrivyClientAppId.mockReturnValue(null);

  const { default: SettingsPage } = await import("../app/settings/page");
  const markup = renderToStaticMarkup(SettingsPage());

    assert.match(markup, /Privy client auth is not configured/);
    assert.match(markup, /NEXT_PUBLIC_PRIVY_APP_ID/);
    assert.doesNotMatch(markup, /Hosted billing settings/);
    assert.doesNotMatch(markup, /Hosted email settings/);
    assert.doesNotMatch(markup, /Hosted Telegram settings/);
    assert.doesNotMatch(markup, /Hosted device sync settings/);
});
