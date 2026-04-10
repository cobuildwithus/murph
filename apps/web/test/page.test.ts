import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/landing", () => {
  return {
    resolveHostedInstallScriptUrl: vi.fn(),
    resolveHostedSignupPhoneNumber: vi.fn(),
  };
});

vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth", () => {
  return {
    HostedPhoneAuth(input: { intent?: string }) {
      return createElement(
        "div",
        {
          "data-hosted-phone-auth-intent": input.intent ?? "signup",
          "data-hosted-phone-auth": "public",
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
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });
});

test("HomePage keeps the hosted auth entrypoints visible when no hosted session exists", async () => {
  const { default: HomePage } = await import("../app/page");
  const { resolveHostedInstallScriptUrl } = await import("@/src/lib/hosted-onboarding/landing");

  vi.mocked(resolveHostedInstallScriptUrl).mockReturnValue(null);

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Open source — Apache 2\.0/u);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
  assert.match(markup, /Sign up with your phone\./);
  assert.match(markup, /Hosted phone auth/);
  assert.match(markup, /data-existing-account-sign-in-dialog="true"/);
  assert.match(markup, /Get started free/);
  assert.match(markup, /href="#signup-title"/);
});

test("HomePage renders the hosted phone auth UI in the shared app shell", async () => {
  const { default: HomePage } = await import("../app/page");
  const { resolveHostedInstallScriptUrl } = await import("@/src/lib/hosted-onboarding/landing");

  vi.mocked(resolveHostedInstallScriptUrl).mockReturnValue("https://murph.example.test/install.sh");

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Open source — Apache 2\.0/u);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
  assert.match(markup, /Sign up with your phone\./);
  assert.match(markup, /Hosted phone auth/);
  assert.match(markup, /data-existing-account-sign-in-dialog="true"/);
  assert.match(markup, /Existing account sign in/);
  assert.match(markup, /curl -fsSL https:\/\/murph\.example\.test\/install\.sh \| bash/u);
  assert.match(markup, /Get started free/);
  assert.match(markup, /href="#signup-title"/);
});

test("HomePage hides homepage auth entrypoints once the hosted session is authenticated", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {
      billingStatus: "active",
      createdAt: new Date("2025-03-27T08:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2025-03-27T08:00:00.000Z"),
    },
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });

  const { default: HomePage } = await import("../app/page");
  const { resolveHostedInstallScriptUrl } = await import("@/src/lib/hosted-onboarding/landing");

  vi.mocked(resolveHostedInstallScriptUrl).mockReturnValue("https://murph.example.test/install.sh");

  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /You&#x27;re already signed in\./);
  assert.match(markup, /You&#x27;re already in\./);
  assert.match(markup, /Open settings/);
  assert.match(markup, /href="\/settings"/);
  assert.doesNotMatch(markup, /Hosted phone auth/);
  assert.doesNotMatch(markup, /data-existing-account-sign-in-dialog="true"/);
  assert.doesNotMatch(markup, /Get started free/);
});
