import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/landing", () => {
  return {
    resolveHostedSignupPhoneNumber: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-onboarding/privy", () => {
  return {
    hasHostedPrivyPhoneAuthConfig: vi.fn(),
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => {
  return {
    HostedPhoneAuth(input: { mode: string }) {
      return createElement("div", { "data-hosted-phone-auth": input.mode }, "Hosted phone auth");
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("HomePage renders the fallback copy when hosted phone auth is not ready", async () => {
  const { default: HomePage } = await import("../app/page");
  const { resolveHostedSignupPhoneNumber } = await import("@/src/lib/hosted-onboarding/landing");
  const { hasHostedPrivyPhoneAuthConfig } = await import("@/src/lib/hosted-onboarding/privy");
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);
  const mockedHasHostedPrivyPhoneAuthConfig = vi.mocked(hasHostedPrivyPhoneAuthConfig);

  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);
  mockedHasHostedPrivyPhoneAuthConfig.mockReturnValue(false);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /Phone signup is not configured for this environment yet\./);
  assert.doesNotMatch(markup, /data-hosted-phone-auth=/);
});

test("HomePage renders the hosted phone auth UI when hosted phone auth is ready", async () => {
  const { default: HomePage } = await import("../app/page");
  const { resolveHostedSignupPhoneNumber } = await import("@/src/lib/hosted-onboarding/landing");
  const { hasHostedPrivyPhoneAuthConfig } = await import("@/src/lib/hosted-onboarding/privy");
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);
  const mockedHasHostedPrivyPhoneAuthConfig = vi.mocked(hasHostedPrivyPhoneAuthConfig);

  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);
  mockedHasHostedPrivyPhoneAuthConfig.mockReturnValue(true);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /data-hosted-phone-auth="public"/);
  assert.match(markup, /Hosted phone auth/);
  assert.doesNotMatch(markup, /Phone signup is not configured for this environment yet\./);
});
