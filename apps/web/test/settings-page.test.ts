import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock("@/src/components/settings/hosted-email-settings", () => ({
  HostedEmailSettings() {
    return React.createElement("div", null, "Hosted email settings");
  },
}));

vi.mock("@/src/components/settings/hosted-billing-settings", () => ({
  HostedBillingSettings() {
    return React.createElement("div", null, "Hosted billing settings");
  },
}));

vi.mock("@/src/components/settings/hosted-telegram-settings", () => ({
  HostedTelegramSettings() {
    return React.createElement("div", null, "Hosted Telegram settings");
  },
}));

vi.mock("@/src/components/settings/hosted-device-sync-settings", () => ({
  HostedDeviceSyncSettings() {
    return React.createElement("div", null, "Hosted device sync settings");
  },
}));

test("SettingsPage renders the Privy-backed settings tree in the shared app shell", async () => {
  const { default: SettingsPage } = await import("../app/settings/page");

  const markup = renderToStaticMarkup(SettingsPage());

  assert.match(markup, /Hosted billing settings/);
  assert.match(markup, /Hosted email settings/);
  assert.match(markup, /Hosted Telegram settings/);
  assert.match(markup, /Hosted device sync settings/);
  assert.match(markup, /Sign in with the same phone-backed Privy account you use for Murph/);
});
