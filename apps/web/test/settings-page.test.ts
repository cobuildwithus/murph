import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  resolveHostedPrivyClientAppId: vi.fn(),
  resolveHostedSessionFromCookieStore: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/src/components/settings/hosted-email-settings", () => ({
  HostedEmailSettings(input: { expectedPrivyUserId: string; privyAppId: string }) {
    return createElement(
      "div",
      {
        "data-expected-privy-user-id": input.expectedPrivyUserId,
        "data-privy-app-id": input.privyAppId,
      },
      "Hosted email settings",
    );
  },
}));

vi.mock("@/src/lib/hosted-onboarding/landing", () => ({
  resolveHostedPrivyClientAppId: mocks.resolveHostedPrivyClientAppId,
}));

vi.mock("@/src/lib/hosted-onboarding/session", () => ({
  resolveHostedSessionFromCookieStore: mocks.resolveHostedSessionFromCookieStore,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: vi.fn() });
  mocks.resolveHostedPrivyClientAppId.mockReturnValue("cm_app_123");
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
  assert.match(markup, /data-privy-app-id="cm_app_123"/);
  assert.match(markup, /Hosted email settings/);
});

test("SettingsPage renders a sign-in requirement when there is no hosted session", async () => {
  mocks.resolveHostedSessionFromCookieStore.mockResolvedValue(null);

  const { default: SettingsPage } = await import("../app/settings/page");
  const markup = renderToStaticMarkup(await SettingsPage());

  assert.match(markup, /Sign in to manage settings/);
  assert.doesNotMatch(markup, /Hosted email settings/);
});
