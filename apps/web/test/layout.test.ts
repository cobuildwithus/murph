import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedSidebarAuthSnapshot: vi.fn(async () => ({
    authenticated: false,
    label: null,
  })),
}));

vi.mock("next/font/google", () => ({
  Fraunces(input: { variable?: string }) {
    return {
      variable: input.variable ?? "font-fraunces",
    };
  },
  DM_Sans(input: { variable?: string }) {
    return {
      variable: input.variable ?? "font-sans",
    };
  },
  DM_Mono(input: { variable?: string }) {
    return {
      variable: input.variable ?? "font-mono",
    };
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedSidebarAuthSnapshot: mocks.getHostedSidebarAuthSnapshot,
}));

vi.mock("@/src/components/hosted-onboarding/phone-country-code-provider", () => ({
  PhoneCountryCodeProvider(input: {
    children: ReactNode;
  }) {
    return createElement("div", { "data-phone-country-code": "" }, input.children);
  },
}));

import RootLayout, { metadata } from "../app/layout";

test("RootLayout renders global providers without route-owned footer chrome", async () => {
  const markup = renderToStaticMarkup(
    await RootLayout({
      children: "hosted-shell",
    }),
  );

  assert.match(markup, /hosted-shell/);
  assert.match(markup, /data-phone-country-code=""/);
  assert.doesNotMatch(markup, /data-providers="true"/);
  assert.doesNotMatch(markup, /data-privy-app-id=/);
  assert.doesNotMatch(markup, /data-privy-client-id=/);
  assert.match(markup, /<html lang="en" class="[^"]*--font-serif[^"]*"/u);
  assert.match(markup, /<html lang="en" class="[^"]*--font-sans[^"]*"/u);
  assert.match(markup, /<html lang="en" class="[^"]*--font-mono[^"]*"/u);
  assert.doesNotMatch(markup, /id="site-footer"/u);
  assert.doesNotMatch(markup, /Murph provides educational health information/u);
});

test("footer ownership stays on explicit public surfaces", () => {
  const readAppFile = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const assertOwnsFooter = (
    path: string,
    renderPattern = /<SiteFooter \/>/u,
  ) => {
    const source = readAppFile(path);

    assert.match(
      source,
      /import \{ SiteFooter \} from "@\/src\/components\/homepage\/site-footer";/u,
      `${path} should import SiteFooter directly`,
    );
    assert.match(
      source,
      renderPattern,
      `${path} should render SiteFooter directly`,
    );
  };

  assertOwnsFooter("app/page.tsx");
  assertOwnsFooter("app/security/page.tsx");
  assertOwnsFooter(
    "app/design/page.tsx",
    /<SiteFooter vitalsMode="synthetic" \/>/u,
  );
  assertOwnsFooter("app/not-found.tsx");
  assertOwnsFooter("src/components/legal/legal-policy-page.tsx");

  const rootLayoutSource = readAppFile("app/layout.tsx");
  const designPageSource = readAppFile("app/design/page.tsx");
  const designComponentsSource = readAppFile("app/design/components-content.tsx");
  const inputOtpSource = readAppFile("src/components/ui/input-otp.tsx");
  const subprocessorsPageSource = readAppFile("app/subprocessors/page.tsx");
  assert.doesNotMatch(rootLayoutSource, /SiteFooter/u);
  assert.doesNotMatch(designPageSource, /HostedPrivyBoundary/u);
  assert.match(
    designComponentsSource,
    /acceptScope=\{acceptDesignDashboardConsentScope\}/u,
  );
  assert.match(
    designComponentsSource,
    /onAccepted=\{completeDesignDashboardConsentPreview\}/u,
  );
  assert.doesNotMatch(
    designComponentsSource,
    /requestHostedOnboardingJson|\/api\/legal\/consent\/accept/u,
  );
  const designOtpStart = designComponentsSource.indexOf('id="otp-ds"');
  const designOtpSource = designComponentsSource.slice(
    designOtpStart,
    designComponentsSource.indexOf("</InputOTP>", designOtpStart),
  );
  for (const vendorIgnoreAttribute of [
    "data-1p-ignore",
    'data-bwignore="true"',
    'data-form-type="other"',
    'data-lpignore="true"',
  ]) {
    assert.match(designOtpSource, new RegExp(vendorIgnoreAttribute));
  }
  assert.match(
    designOtpSource,
    /pushPasswordManagerStrategy="none"/u,
  );
  assert.doesNotMatch(inputOtpSource, /pushPasswordManagerStrategy/u);
  assert.doesNotMatch(
    designComponentsSource,
    /Standard, Tiny, And Fallback Bedtime Transition/u,
  );
  const experimentStartStudyOptions = designComponentsSource.slice(
    designComponentsSource.indexOf("const EXPERIMENT_START_CHANNEL_OPTIONS"),
    designComponentsSource.indexOf("const WHOOP_COMPLETION_SETUP_GUIDE"),
  );
  assert.doesNotMatch(
    experimentStartStudyOptions,
    /sms:|mailto:|withmurph|MURPH_TELEGRAM/u,
  );
  assert.match(designComponentsSource, /protocolTitle="Example Evening Routine"/u);
  assert.equal(
    [
      ...designComponentsSource.matchAll(
        /href: "#experiment-start-channel-picker-study"/gu,
      ),
    ].length,
    3,
  );
  assert.match(subprocessorsPageSource, /LegalPolicyPage/u);
  assert.equal(
    existsSync(
      new URL("../src/components/homepage/site-footer-slot.tsx", import.meta.url),
    ),
    false,
  );
  assert.equal(
    existsSync(
      new URL(
        "../app/join/[inviteCode]/success/layout.tsx",
        import.meta.url,
      ),
    ),
    false,
  );

  for (const path of [
    "src/components/dashboard/dashboard-shell.tsx",
    "src/components/hosted-onboarding/join-invite-shell.tsx",
  ]) {
    const source = readAppFile(path);
    assert.doesNotMatch(source, /#site-footer/u);
    assert.doesNotMatch(source, /display: none/u);
    assert.doesNotMatch(source, /SiteFooter/u);
  }
});

test("RootLayout provides default title, description, preview image, and iOS app metadata", () => {
  assert.ok(metadata.metadataBase instanceof URL);
  assert.equal(metadata.title, "Murph — Health is hard. Don’t do it alone.");
  assert.equal(
    metadata.description,
    "Murph figures out what works for you—and gets your friends in on it. A personal health AI that runs experiments with you and challenges with your friends.",
  );
  assert.deepEqual(metadata.itunes, {
    appId: "6786145859",
  });
  assert.deepEqual(metadata.openGraph?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(metadata.twitter?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
});
