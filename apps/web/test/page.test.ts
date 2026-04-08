import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/landing", () => {
  return {
    resolveHostedInstallScriptUrl: vi.fn(),
    resolveHostedSignupPhoneNumber: vi.fn(),
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => {
  return {
    HostedPhoneAuth(input: { intent?: string; mode: string }) {
      return createElement(
        "div",
        {
          "data-hosted-phone-auth-intent": input.intent ?? "signup",
          "data-hosted-phone-auth": input.mode,
        },
        "Hosted phone auth",
      );
    },
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog", () => {
  return {
    HostedExistingAccountSignInDialog() {
      return createElement(
        "div",
        {
          "data-existing-account-sign-in-dialog": "true",
        },
        "Existing account sign in",
      );
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test("HomePage keeps the hosted auth entrypoints visible in the shared app shell", async () => {
  const { default: HomePage } = await import("../app/page");
  const {
    resolveHostedInstallScriptUrl,
    resolveHostedSignupPhoneNumber,
  } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );
  const mockedResolveHostedInstallScriptUrl = vi.mocked(resolveHostedInstallScriptUrl);
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);

  mockedResolveHostedInstallScriptUrl.mockReturnValue(null);
  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);

  const markup = renderToStaticMarkup(HomePage());

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
  assert.match(markup, /data-hosted-phone-auth="public"/);
  assert.match(markup, /data-existing-account-sign-in-dialog="true"/);
});

test("HomePage renders the hosted phone auth UI in the shared app shell", async () => {
  const { default: HomePage } = await import("../app/page");
  const {
    resolveHostedInstallScriptUrl,
    resolveHostedSignupPhoneNumber,
  } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );
  const mockedResolveHostedInstallScriptUrl = vi.mocked(resolveHostedInstallScriptUrl);
  const mockedResolveHostedSignupPhoneNumber = vi.mocked(resolveHostedSignupPhoneNumber);

  mockedResolveHostedInstallScriptUrl.mockReturnValue("https://murph.example.test/install.sh");
  mockedResolveHostedSignupPhoneNumber.mockReturnValue(null);

  const markup = renderToStaticMarkup(HomePage());

  assert.match(markup, /Open source — Apache 2\.0/u);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
  assert.match(markup, /data-hosted-phone-auth="public"/);
  assert.match(markup, /data-hosted-phone-auth-intent="signup"/);
  assert.match(markup, /Hosted phone auth/);
  assert.match(markup, /data-existing-account-sign-in-dialog="true"/);
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
});
