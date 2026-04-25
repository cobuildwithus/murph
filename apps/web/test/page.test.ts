import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  LandingAuthActions: vi.fn(
    (props: {
      authenticated: boolean;
      context: "nav" | "hero" | "footer";
      showSignIn?: boolean;
      signupLabel: string;
    }) =>
      createElement(
        "div",
        {
          "data-root-landing-auth-actions-authenticated": String(
            props.authenticated
          ),
          "data-root-landing-auth-actions-context": props.context,
          "data-root-landing-auth-actions-label": props.signupLabel,
        },
        "Landing auth actions"
      )
  ),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock(
  "@/src/components/hosted-onboarding/hosted-phone-country-code-boundary",
  () => ({
    HostedPhoneCountryCodeBoundary(input: { children: React.ReactNode }) {
      return createElement(
        "div",
        {
          "data-phone-country-code": "GB",
        },
        input.children
      );
    },
  })
);

vi.mock("@/src/lib/hosted-onboarding/landing", () => ({
  resolveHostedInstallScriptUrl: () => "https://www.withmurph.ai/install.sh",
}));

vi.mock("../app/auth-controls", () => ({
  LandingAuthActions: mocks.LandingAuthActions,
}));

test("HomePage renders the canonical landing page at the root route", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
  });

  const { default: HomePage } = await import("../app/page");

  const markup = renderToStaticMarkup(await HomePage());

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.LandingAuthActions).toHaveBeenCalledTimes(4);
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    1,
    {
      authenticated: false,
      context: "nav",
      signupLabel: "Sign up",
    },
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    2,
    {
      authenticated: false,
      context: "hero",
      showSignIn: false,
      signupLabel: "See what works for your body",
    },
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    3,
    {
      authenticated: false,
      context: "footer",
      showSignIn: false,
      signupLabel: "Get started",
    },
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    4,
    {
      authenticated: false,
      context: "footer",
      signupLabel: "Start your first experiment",
    },
    undefined
  );
  assert.match(markup, /#global-footer \{ display: none; \}/);
  assert.match(markup, /data-phone-country-code="GB"/);
  assert.match(markup, /data-root-landing-auth-actions-context="nav"/);
  assert.match(markup, /data-root-landing-auth-actions-context="hero"/);
  assert.match(markup, /data-root-landing-auth-actions-context="footer"/);
  assert.match(markup, /font-serif text-\[clamp\(2\.5rem,5\.2vw,4\.5rem\)\][^"]* lg:text-balance/);
  assert.match(markup, /class="block lg:whitespace-nowrap">You measure your health\./);
  assert.match(
    markup,
    /class="block text-\[#d4b87a\] lg:whitespace-nowrap">Now experiment with it\./
  );
  assert.match(markup, /data-root-landing-auth-actions-label="Sign up"/);
  assert.match(
    markup,
    /data-root-landing-auth-actions-label="See what works for your body"/
  );
  assert.match(markup, /Discover what actually makes you healthier\./);
  assert.match(markup, /data-root-landing-auth-actions-label="Get started"/);
  assert.match(
    markup,
    /data-root-landing-auth-actions-label="Start your first experiment"/
  );
  assert.match(markup, /You can also install it locally\./);
  assert.match(
    markup,
    /curl -fsSL https:\/\/www\.withmurph\.ai\/install\.sh \| bash/
  );
  assert.match(markup, /murph chat/);
  assert.match(markup, /Do I need a wearable\?/);
  assert.match(markup, /No\. A wearable can add useful signals/);
  assert.match(markup, /Wearable apps show status/);
  assert.doesNotMatch(markup, /Your wearable shows data/);
});

test("HomePage metadata keeps the root route as the canonical landing URL", async () => {
  const { metadata } = await import("../app/page");

  expect(metadata.title).toBe("Murph — Discover what actually makes you healthier");
  expect(metadata.description).toBe(
    "Your personal health assistant. Connect your data, pick a protocol, see what actually makes you healthier.",
  );
  expect(metadata.alternates?.canonical).toBe("/");
  expect(metadata.openGraph?.images).toEqual([
    expect.objectContaining({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
  expect(metadata.twitter?.images).toEqual([
    expect.objectContaining({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
    }),
  ]);
});

test("HomePage keeps the mid-page CTA consistent for authenticated sessions", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
  });

  const { default: HomePage } = await import("../app/page");

  const markup = renderToStaticMarkup(await HomePage());

  expect(mocks.LandingAuthActions).toHaveBeenCalledTimes(4);
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    3,
    {
      authenticated: true,
      context: "footer",
      showSignIn: false,
      signupLabel: "Open settings",
    },
    undefined
  );
  assert.match(markup, /You’re already set up\./);
  assert.doesNotMatch(markup, /Discover what actually makes you healthier\./);
});
