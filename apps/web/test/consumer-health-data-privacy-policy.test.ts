import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  LandingAuthActions: vi.fn(
    (props: {
      authenticated: boolean;
      authLabel: string;
      context: "nav" | "hero" | "footer";
      signupLabel?: string;
      splitUnauthenticated?: boolean;
    }) =>
      createElement(
        "div",
        {
          "data-landing-auth-actions-authenticated": String(props.authenticated),
          "data-landing-auth-actions-auth-label": props.authLabel,
          "data-landing-auth-actions-context": props.context,
          "data-landing-auth-actions-signup-label": props.signupLabel ?? "",
          "data-landing-auth-actions-split": String(
            props.splitUnauthenticated ?? false,
          ),
        },
        "Landing auth actions",
      ),
  ),
  formatHostedLandingPricingLongSummary: vi.fn(() => "Murph starts at $0"),
}));

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
);

const policyMarkdown = readFileSync(
  path.resolve(
    process.cwd(),
    "apps/web/legal/consumer-health-data-notice.md",
  ),
  "utf8",
);

vi.mock("../app/auth-controls", () => ({
  LandingAuthActions: mocks.LandingAuthActions,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-plans", () => ({
  formatHostedLandingPricingLongSummary:
    mocks.formatHostedLandingPricingLongSummary,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(async () => policyMarkdown),
  },
  readFile: vi.fn(async () => policyMarkdown),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { SiteFooter } from "../src/components/homepage/site-footer";

test("ConsumerHealthDataPrivacyPolicyPage exposes canonical metadata and renders the authored notice source", async () => {
  const {
    default: ConsumerHealthDataPrivacyPolicyPage,
    metadata: consumerHealthMetadata,
  } = await import("../app/consumer-health-data-privacy-policy/page");

  assert.equal(
    consumerHealthMetadata.title,
    "Murph Consumer Health Data Notice",
  );
  assert.equal(
    consumerHealthMetadata.alternates?.canonical,
    "/consumer-health-data-privacy-policy",
  );
  assert.equal(
    consumerHealthMetadata.description,
    "Murph's Consumer Health Data Notice covering consumer health data categories, sources, purposes, sharing, rights, deletion, appeals, and sale/no-sale.",
  );

  const markup = renderToStaticMarkup(await ConsumerHealthDataPrivacyPolicyPage());

  assert.match(markup, /Murph Consumer Health Data Notice/);
  assert.match(markup, /Effective Date:<\/strong> April 29, 2026/);
  assert.match(
    markup,
    /Murph may collect Consumer Health Data from:/,
  );
  assert.match(markup, /href="\/legal\/consumer-health-data-notice\.pdf"/u);
  assert.match(markup, /Download PDF/);
});

test("legacy Consumer Health Data Privacy Policy route redirects to the canonical notice", async () => {
  const { default: LegacyConsumerHealthDataPrivacyPolicyPage } = await import(
    "../app/legal/consumer-health-data-privacy-policy/page",
  );

  assert.throws(
    () => LegacyConsumerHealthDataPrivacyPolicyPage(),
    /NEXT_REDIRECT:\/consumer-health-data-privacy-policy/,
  );
  assert.equal(
    redirectMock.mock.calls.at(-1)?.[0],
    "/consumer-health-data-privacy-policy",
  );
});

test("SiteFooter exposes the consumer health data notice link in the legal nav column", () => {
  const markup = renderToStaticMarkup(createElement(SiteFooter));

  assert.match(markup, /aria-label="Legal links"/);
  assert.match(markup, /href="\/consumer-health-data-privacy-policy"/u);
  assert.match(markup, /Consumer Health Data/u);
});

test("SiteFooter exposes the public status page in the product nav column", () => {
  const markup = renderToStaticMarkup(createElement(SiteFooter));

  assert.match(markup, /aria-label="Product links"/u);
  assert.match(markup, /href="https:\/\/status\.withmurph\.ai"/u);
  assert.match(markup, />Status<\/a>/u);
  assert.match(markup, /href="https:\/\/status\.withmurph\.ai" target="_blank" rel="noreferrer"/u);
});

test("SiteFooter links to the Murph iOS app in the product nav column", () => {
  const markup = renderToStaticMarkup(createElement(SiteFooter));

  assert.match(markup, /aria-label="Product links"/u);
  assert.match(
    markup,
    /href="https:\/\/apps\.apple\.com\/us\/app\/murph-ai\/id6786145859" target="_blank" rel="noreferrer"/u,
  );
  assert.match(markup, />iOS app<\/a>/u);
});

test("SiteFooter exposes referrals only while a reward path is available", () => {
  const availableMarkup = renderToStaticMarkup(
    createElement(SiteFooter, { referralsAvailable: true }),
  );
  const unavailableMarkup = renderToStaticMarkup(
    createElement(SiteFooter, { referralsAvailable: false }),
  );

  assert.match(availableMarkup, /href="\/refer"/u);
  assert.match(availableMarkup, />Referrals<\/a>/u);
  assert.doesNotMatch(unavailableMarkup, /href="\/refer"/u);
  assert.doesNotMatch(unavailableMarkup, />Referrals<\/a>/u);
});
