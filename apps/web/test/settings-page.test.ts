import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  resolveHostedPrivyClientAppId: vi.fn(),
  resolveHostedPrivyClientId: vi.fn(),
  resolveHostedSessionFromCookieStore: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/src/components/settings/hosted-email-settings", () => ({
  HostedEmailSettings(input: { expectedPrivyUserId: string }) {
    return createElement(
      "div",
      {
        "data-expected-privy-user-id": input.expectedPrivyUserId,
      },
      "Hosted email settings",
    );
  },
}));

vi.mock("@/src/components/settings/hosted-telegram-settings", () => ({
  HostedTelegramSettings(input: { expectedPrivyUserId: string }) {
    return createElement(
      "div",
      {
        "data-telegram-expected-privy-user-id": input.expectedPrivyUserId,
      },
      "Hosted Telegram settings",
    );
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

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  resolveHostedSessionFromCookieStore: mocks.resolveHostedSessionFromCookieStore,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: vi.fn() });
  mocks.resolveHostedPrivyClientAppId.mockReturnValue("cm_app_123");
  mocks.resolveHostedPrivyClientId.mockReturnValue("client_123");
  mocks.resolveHostedSessionFromCookieStore.mockResolvedValue({
    member: {
      normalizedPhoneNumber: "+14155552671",
      privyUserId: "did:privy:user_123",
    },
  });
});

test("SettingsPage passes the hosted session's Privy user id into the client email settings tree", async () => {
  const { default: SettingsPage } = await import("../app/settings/page");

  const markup = renderToStaticMarkup(await SettingsPage());

  expect(mocks.resolveHostedSessionFromCookieStore).toHaveBeenCalledWith({ get: expect.any(Function) });
  assert.match(markup, /data-expected-privy-user-id="did:privy:user_123"/);
  assert.match(markup, /Hosted email settings/);
  assert.match(markup, /data-telegram-expected-privy-user-id="did:privy:user_123"/);
  assert.match(markup, /Hosted Telegram settings/);
  assert.match(markup, /data-privy-provider="true"/);
});

test("SettingsPage renders a sign-in requirement when there is no hosted session", async () => {
  mocks.resolveHostedSessionFromCookieStore.mockResolvedValue(null);

  const { default: SettingsPage } = await import("../app/settings/page");
  const markup = renderToStaticMarkup(await SettingsPage());

  assert.match(markup, /Sign in to manage settings/);
  assert.ok(markup.includes('href="/"'));
  assert.doesNotMatch(markup, /Hosted email settings/);
  assert.doesNotMatch(markup, /Hosted Telegram settings/);
});
