import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/landing", () => {
  return {
    resolveHostedPrivyClientAppId: vi.fn(),
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
    HostedPhoneAuth(input: { mode: string; privyAppId: string | null }) {
      return createElement(
        "div",
        {
          "data-hosted-phone-auth": input.mode,
          "data-privy-app-id": input.privyAppId ?? "",
        },
        "Hosted phone auth",
      );
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("HomePage renders the fallback copy when hosted phone auth is not ready", async () => {
  const { default: HomePage } = await import("../app/page");
  const { resolveHostedPrivyClientAppId, resolveHostedSignupPhoneNumber } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );
  const { hasHostedPrivyPhoneAuthConfig } = await import("@/src/lib/hosted-onboarding/privy");
  const mockedResolveHostedPrivyClientAppId = vi.mocked(resolveHostedPrivyClientAppId);
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);
  const mockedHasHostedPrivyPhoneAuthConfig = vi.mocked(hasHostedPrivyPhoneAuthConfig);

  mockedResolveHostedPrivyClientAppId.mockReturnValue(null);
  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);
  mockedHasHostedPrivyPhoneAuthConfig.mockReturnValue(false);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /Phone signup is not configured for this environment yet\./);
  assert.doesNotMatch(markup, /data-hosted-phone-auth=/);
});

test("HomePage renders the hosted phone auth UI when hosted phone auth is ready", async () => {
  const { default: HomePage } = await import("../app/page");
  const { resolveHostedPrivyClientAppId, resolveHostedSignupPhoneNumber } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );
  const { hasHostedPrivyPhoneAuthConfig } = await import("@/src/lib/hosted-onboarding/privy");
  const mockedResolveHostedPrivyClientAppId = vi.mocked(resolveHostedPrivyClientAppId);
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);
  const mockedHasHostedPrivyPhoneAuthConfig = vi.mocked(hasHostedPrivyPhoneAuthConfig);

  mockedResolveHostedPrivyClientAppId.mockReturnValue("cm_app_123");
  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);
  mockedHasHostedPrivyPhoneAuthConfig.mockReturnValue(true);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /data-hosted-phone-auth="public"/);
  assert.match(markup, /data-privy-app-id="cm_app_123"/);
  assert.match(markup, /Hosted phone auth/);
  assert.doesNotMatch(markup, /Phone signup is not configured for this environment yet\./);
});

test("HomePage keeps the fallback copy when the server auth config is ready but the public app id is missing", async () => {
  const { default: HomePage } = await import("../app/page");
  const { resolveHostedPrivyClientAppId, resolveHostedSignupPhoneNumber } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );
  const { hasHostedPrivyPhoneAuthConfig } = await import("@/src/lib/hosted-onboarding/privy");
  const mockedResolveHostedPrivyClientAppId = vi.mocked(resolveHostedPrivyClientAppId);
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);
  const mockedHasHostedPrivyPhoneAuthConfig = vi.mocked(hasHostedPrivyPhoneAuthConfig);

  mockedResolveHostedPrivyClientAppId.mockReturnValue(null);
  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);
  mockedHasHostedPrivyPhoneAuthConfig.mockReturnValue(true);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /Phone signup is not configured for this environment yet\./);
  assert.doesNotMatch(markup, /data-hosted-phone-auth=/);
});
