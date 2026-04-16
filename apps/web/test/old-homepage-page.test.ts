import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

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

vi.mock("@/src/components/hosted-onboarding/hosted-auth-panel", () => {
  return {
    HostedAuthPanel(input: {
      intent?: string;
      methods: string[];
      showLegalNotice?: boolean;
    }) {
      return createElement(
        "div",
        {
          "data-hosted-auth-panel-intent": input.intent ?? "signup",
          "data-hosted-auth-panel-methods": input.methods.join(","),
          "data-hosted-auth-panel-legal":
            input.showLegalNotice === true ? "shown" : "hidden",
        },
        "Hosted auth panel",
        input.methods.includes("phone")
          ? createElement(
              "span",
              {
                "data-hosted-phone-auth-passive-consent": "hidden",
              },
              "Hosted phone auth",
            )
          : null,
        input.methods.includes("telegram")
          ? createElement("span", null, "OR")
          : null,
        input.methods.includes("telegram")
          ? createElement(
              "span",
              {
                "data-hosted-telegram-auth-button": "true",
              },
              "Hosted Telegram auth",
            )
          : null,
        input.methods.includes("email")
          ? createElement(
              "span",
              {
                "data-hosted-email-auth-button": "true",
              },
              "Hosted Email auth",
            )
          : null,
        input.showLegalNotice === true
          ? createElement(
              "span",
              null,
              "By signing up, you agree to our ",
              createElement(
                "a",
                {
                  href: "/legal/terms.pdf",
                },
                "Terms",
              ),
              " and ",
              createElement(
                "a",
                {
                  href: "/legal/privacy.pdf",
                },
                "Privacy Policy",
              ),
              ".",
            )
          : null,
      );
    },
  };
});

vi.mock(
  "@/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog",
  () => {
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
  },
);

test("OldHomepagePage keeps the hosted auth entrypoints visible when no hosted session exists", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });
  const { default: OldHomepagePage } = await import(
    "../app/old-homepage/page"
  );
  const { resolveHostedInstallScriptUrl } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );

  vi.mocked(resolveHostedInstallScriptUrl).mockReturnValue(null);

  const markup = renderToStaticMarkup(await OldHomepagePage());

  assert.match(markup, /Open source — Apache 2\.0/u);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
  assert.match(markup, /Zero Data Retention/);
  assert.match(markup, /Your data does not train AI models/u);
  assert.match(markup, /restricted system access/u);
  assert.match(markup, /Signup/);
  assert.match(markup, /Hosted auth panel/);
  assert.match(markup, /Hosted Telegram auth/);
  assert.match(markup, /Hosted Email auth/);
  assert.match(markup, /data-hosted-auth-panel-methods="phone,telegram,email"/);
  assert.match(markup, /data-hosted-telegram-auth-button="true"/);
  assert.match(markup, /data-hosted-email-auth-button="true"/);
  assert.match(markup, /Hosted phone auth/);
  assert.match(markup, /data-hosted-phone-auth-passive-consent="hidden"/);
  assert.match(markup, /OR/u);
  assert.match(markup, /data-existing-account-sign-in-dialog="true"/);
  assert.match(markup, /By signing up, you agree to our/);
  assert.match(markup, /\/legal\/terms\.pdf/);
  assert.match(markup, /\/legal\/privacy\.pdf/);
  assert.equal(
    markup.match(/By signing up, you agree to our/g)?.length ?? 0,
    1,
  );
  assert.ok(
    markup.indexOf('data-hosted-telegram-auth-button="true"') <
      markup.indexOf("By signing up, you agree to our"),
  );
  assert.match(markup, /Get started free/);
  assert.match(markup, /href="#signup-title"/);
});

test("OldHomepagePage renders the hosted phone auth UI in the shared app shell", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    linkedAccounts: [],
    memberLookup: null,
    session: null,
  });
  const { default: OldHomepagePage } = await import(
    "../app/old-homepage/page"
  );
  const { resolveHostedInstallScriptUrl } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );

  vi.mocked(resolveHostedInstallScriptUrl).mockReturnValue(
    "https://murph.example.test/install.sh",
  );

  const markup = renderToStaticMarkup(await OldHomepagePage());

  assert.match(markup, /Open source — Apache 2\.0/u);
  assert.match(markup, /https:\/\/github\.com\/cobuildwithus\/murph/u);
  assert.match(markup, /Signup/);
  assert.match(markup, /Hosted auth panel/);
  assert.match(markup, /Hosted Telegram auth/);
  assert.match(markup, /Hosted Email auth/);
  assert.match(markup, /Hosted phone auth/);
  assert.match(markup, /data-hosted-phone-auth-passive-consent="hidden"/);
  assert.match(markup, /data-hosted-auth-panel-methods="phone,telegram,email"/);
  assert.match(markup, /OR/u);
  assert.match(markup, /data-existing-account-sign-in-dialog="true"/);
  assert.match(markup, /Existing account sign in/);
  assert.match(markup, /By signing up, you agree to our/);
  assert.match(markup, /\/legal\/terms\.pdf/);
  assert.match(markup, /\/legal\/privacy\.pdf/);
  assert.equal(
    markup.match(/By signing up, you agree to our/g)?.length ?? 0,
    1,
  );
  assert.match(
    markup,
    /curl -fsSL https:\/\/murph\.example\.test\/install\.sh \| bash/u,
  );
  assert.match(markup, /Get started free/);
  assert.match(markup, /href="#signup-title"/);
});

test("OldHomepagePage hides homepage auth entrypoints once the hosted session is authenticated", async () => {
  vi.clearAllMocks();
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

  const { default: OldHomepagePage } = await import(
    "../app/old-homepage/page"
  );
  const { resolveHostedInstallScriptUrl } = await import(
    "@/src/lib/hosted-onboarding/landing"
  );

  vi.mocked(resolveHostedInstallScriptUrl).mockReturnValue(
    "https://murph.example.test/install.sh",
  );

  const markup = renderToStaticMarkup(await OldHomepagePage());

  assert.match(markup, /You&#x27;re already signed in\./);
  assert.match(markup, /You&#x27;re already in\./);
  assert.match(markup, /Open settings/);
  assert.match(markup, /href="\/settings"/);
  assert.doesNotMatch(markup, /Hosted phone auth/);
  assert.doesNotMatch(markup, /data-existing-account-sign-in-dialog="true"/);
  assert.doesNotMatch(markup, /By signing up, you agree to our/);
  assert.doesNotMatch(markup, /Get started free/);
});
