import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/landing", () => {
  return {
    resolveHostedInstallScriptUrl: vi.fn(),
    resolveHostedPrivyClientAppId: vi.fn(),
    resolveHostedPrivyClientId: vi.fn(),
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
    HostedPhoneAuth(input: { intent?: string; mode: string; privyAppId: string | null; privyClientId?: string | null }) {
      return createElement(
        "div",
        {
          "data-hosted-phone-auth-intent": input.intent ?? "signup",
          "data-hosted-phone-auth": input.mode,
          "data-privy-app-id": input.privyAppId ?? "",
          "data-privy-client-id": input.privyClientId ?? "",
        },
        "Hosted phone auth",
      );
    },
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog", () => {
  return {
    HostedExistingAccountSignInDialog(input: { privyAppId: string; privyClientId?: string | null }) {
      return createElement(
        "div",
        {
          "data-existing-account-sign-in-dialog": "true",
          "data-existing-account-privy-app-id": input.privyAppId,
          "data-existing-account-privy-client-id": input.privyClientId ?? "",
        },
        "Existing account sign in",
      );
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("HomePage renders the fallback copy when hosted phone auth is not ready", async () => {
  const { default: HomePage } = await import("../app/page");
  const {
    resolveHostedInstallScriptUrl,
    resolveHostedPrivyClientAppId,
    resolveHostedPrivyClientId,
    resolveHostedSignupPhoneNumber,
  } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );
  const { hasHostedPrivyPhoneAuthConfig } = await import("@/src/lib/hosted-onboarding/privy");
  const mockedResolveHostedInstallScriptUrl = vi.mocked(resolveHostedInstallScriptUrl);
  const mockedResolveHostedPrivyClientAppId = vi.mocked(resolveHostedPrivyClientAppId);
  const mockedResolveHostedPrivyClientId = vi.mocked(resolveHostedPrivyClientId);
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);
  const mockedHasHostedPrivyPhoneAuthConfig = vi.mocked(hasHostedPrivyPhoneAuthConfig);

  mockedResolveHostedInstallScriptUrl.mockReturnValue(null);
  mockedResolveHostedPrivyClientAppId.mockReturnValue(null);
  mockedResolveHostedPrivyClientId.mockReturnValue(null);
  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);
  mockedHasHostedPrivyPhoneAuthConfig.mockReturnValue(false);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /Phone signup is not configured for this environment yet\./);
  assert.match(markup, /Open source — Apache 2\.0/u);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
  assert.match(markup, /Syncs with Garmin, Oura, and WHOOP/);
  assert.match(markup, /Local mode keeps your data on your device\. Hosted runs use encrypted cloud snapshots\./);
  assert.match(markup, /Local mode keeps your data on your device, and hosted runs use encrypted cloud snapshots\./);
  assert.match(markup, /Encrypted cloud snapshots for hosted runs/);
  assert.match(markup, /curl -fsSL https:\/\/YOUR_DOMAIN\/install\.sh \| bash/u);
  assert.match(markup, /Your health data stays yours\./);
  assert.match(markup, /local-first processing where possible, encrypted infrastructure for hosted runs, and privacy-first defaults\./i);
  assert.match(markup, /No data sales/);
  assert.doesNotMatch(markup, /Zero data retention/);
  assert.doesNotMatch(markup, /--no-onboard/u);
  assert.doesNotMatch(markup, /data-hosted-phone-auth=/);
  assert.doesNotMatch(markup, /data-existing-account-sign-in-dialog=/);
});

test("HomePage renders the hosted phone auth UI when hosted phone auth is ready", async () => {
  const { default: HomePage } = await import("../app/page");
  const {
    resolveHostedInstallScriptUrl,
    resolveHostedPrivyClientAppId,
    resolveHostedPrivyClientId,
    resolveHostedSignupPhoneNumber,
  } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );
  const { hasHostedPrivyPhoneAuthConfig } = await import("@/src/lib/hosted-onboarding/privy");
  const mockedResolveHostedInstallScriptUrl = vi.mocked(resolveHostedInstallScriptUrl);
  const mockedResolveHostedPrivyClientAppId = vi.mocked(resolveHostedPrivyClientAppId);
  const mockedResolveHostedPrivyClientId = vi.mocked(resolveHostedPrivyClientId);
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);
  const mockedHasHostedPrivyPhoneAuthConfig = vi.mocked(hasHostedPrivyPhoneAuthConfig);

  mockedResolveHostedInstallScriptUrl.mockReturnValue("https://murph.example.test/install.sh");
  mockedResolveHostedPrivyClientAppId.mockReturnValue("cm_app_123");
  mockedResolveHostedPrivyClientId.mockReturnValue("client_123");
  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);
  mockedHasHostedPrivyPhoneAuthConfig.mockReturnValue(true);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /Open source — Apache 2\.0/u);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
  assert.match(markup, /data-hosted-phone-auth="public"/);
  assert.match(markup, /data-hosted-phone-auth-intent="signup"/);
  assert.match(markup, /data-privy-app-id="cm_app_123"/);
  assert.match(markup, /data-privy-client-id="client_123"/);
  assert.match(markup, /Hosted phone auth/);
  assert.match(markup, /data-existing-account-sign-in-dialog="true"/);
  assert.match(markup, /data-existing-account-privy-app-id="cm_app_123"/);
  assert.match(markup, /data-existing-account-privy-client-id="client_123"/);
  assert.match(markup, /Existing account sign in/);
  assert.match(markup, /Local mode keeps your data on your device\. Hosted runs use encrypted cloud snapshots\./);
  assert.match(markup, /Local mode keeps your data on your device, and hosted runs use encrypted cloud snapshots\./);
  assert.match(markup, /Encrypted cloud snapshots for hosted runs/);
  assert.match(markup, /curl -fsSL https:\/\/murph\.example\.test\/install\.sh \| bash/u);
  assert.match(markup, /Your health data stays yours\./);
  assert.match(markup, /local-first processing where possible, encrypted infrastructure for hosted runs, and privacy-first defaults\./i);
  assert.match(markup, /No data sales/);
  assert.doesNotMatch(markup, /Zero data retention/);
  assert.doesNotMatch(markup, /--no-onboard/u);
  assert.doesNotMatch(markup, /Phone signup is not configured for this environment yet\./);
});

test("HomePage keeps the fallback copy when the server auth config is ready but the public app id is missing", async () => {
  const { default: HomePage } = await import("../app/page");
  const {
    resolveHostedInstallScriptUrl,
    resolveHostedPrivyClientAppId,
    resolveHostedPrivyClientId,
    resolveHostedSignupPhoneNumber,
  } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );
  const { hasHostedPrivyPhoneAuthConfig } = await import("@/src/lib/hosted-onboarding/privy");
  const mockedResolveHostedInstallScriptUrl = vi.mocked(resolveHostedInstallScriptUrl);
  const mockedResolveHostedPrivyClientAppId = vi.mocked(resolveHostedPrivyClientAppId);
  const mockedResolveHostedPrivyClientId = vi.mocked(resolveHostedPrivyClientId);
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);
  const mockedHasHostedPrivyPhoneAuthConfig = vi.mocked(hasHostedPrivyPhoneAuthConfig);

  mockedResolveHostedInstallScriptUrl.mockReturnValue("https://murph.example.test/install.sh");
  mockedResolveHostedPrivyClientAppId.mockReturnValue(null);
  mockedResolveHostedPrivyClientId.mockReturnValue(null);
  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);
  mockedHasHostedPrivyPhoneAuthConfig.mockReturnValue(true);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /Phone signup is not configured for this environment yet\./);
  assert.match(markup, /Open source — Apache 2\.0/u);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
  assert.match(markup, /Local mode keeps your data on your device\. Hosted runs use encrypted cloud snapshots\./);
  assert.match(markup, /Local mode keeps your data on your device, and hosted runs use encrypted cloud snapshots\./);
  assert.match(markup, /Encrypted cloud snapshots for hosted runs/);
  assert.match(markup, /https:\/\/murph\.example\.test\/install\.sh/u);
  assert.match(markup, /Your health data stays yours\./);
  assert.match(markup, /local-first processing where possible, encrypted infrastructure for hosted runs, and privacy-first defaults\./i);
  assert.match(markup, /No data sales/);
  assert.doesNotMatch(markup, /Zero data retention/);
  assert.doesNotMatch(markup, /--no-onboard/u);
  assert.doesNotMatch(markup, /data-hosted-phone-auth=/);
  assert.doesNotMatch(markup, /data-existing-account-sign-in-dialog=/);
});
