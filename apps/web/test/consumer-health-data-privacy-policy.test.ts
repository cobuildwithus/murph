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
    "apps/web/legal/consumer-health-data-privacy-policy.md",
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

test("ConsumerHealthDataPrivacyPolicyPage exposes canonical metadata and renders the authored policy source", async () => {
  const {
    default: ConsumerHealthDataPrivacyPolicyPage,
    metadata: consumerHealthMetadata,
  } = await import("../app/consumer-health-data-privacy-policy/page");

  assert.equal(
    consumerHealthMetadata.title,
    "Murph Consumer Health Data Privacy Policy",
  );
  assert.equal(
    consumerHealthMetadata.alternates?.canonical,
    "/consumer-health-data-privacy-policy",
  );
  assert.equal(
    consumerHealthMetadata.description,
    "Murph's separate Consumer Health Data Privacy Policy covering consumer health data categories, sources, purposes, sharing, rights, deletion, appeals, and sale/no-sale.",
  );

  const markup = renderToStaticMarkup(await ConsumerHealthDataPrivacyPolicyPage());

  assert.match(markup, /Murph Consumer Health Data Privacy Policy/);
  assert.match(markup, /Effective Date:<\/strong> April 29, 2026/);
  assert.match(
    markup,
    /Murph may collect Consumer Health Data from the following sources:/,
  );
  assert.match(markup, /href="\/legal\/consumer-health-data-privacy\.pdf"/u);
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

test("SiteFooter exposes the consumer health data privacy link with wrapping-friendly legal nav styling", () => {
  const markup = renderToStaticMarkup(
    createElement(SiteFooter, {
      authenticated: false,
    }),
  );

  assert.match(markup, /aria-label="Legal and project links"/);
  assert.match(markup, /href="\/consumer-health-data-privacy-policy"/u);
  assert.match(
    markup,
    /font-semibold text-\[#f5f0e8\]\/70 underline underline-offset-4 transition-colors hover:text-\[#f5f0e8\]/u,
  );
  assert.match(markup, /flex flex-wrap items-center gap-x-4 gap-y-2/u);
  assert.match(markup, /data-landing-auth-actions-context="footer"/);
  assert.match(markup, /Murph starts at \$0/);
});
