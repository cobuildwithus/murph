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
      authLabel: string;
      signupLabel?: string;
      splitUnauthenticated?: boolean;
    }) =>
      createElement(
        "div",
        {
          "data-root-landing-auth-actions-authenticated": String(
            props.authenticated
          ),
          "data-root-landing-auth-actions-context": props.context,
          "data-root-landing-auth-actions-label": props.authLabel,
          "data-root-landing-auth-actions-signup-label":
            props.signupLabel ?? "",
          "data-root-landing-auth-actions-split": String(
            props.splitUnauthenticated ?? false,
          ),
        },
        "Landing auth actions"
      )
  ),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/image", () => ({
  default: (props: {
    alt?: string;
    className?: string;
    src: string;
  }) =>
    createElement("img", {
      alt: props.alt ?? "",
      className: props.className,
      src: props.src,
    }),
}));

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
      authLabel: "Log in or sign up",
      splitUnauthenticated: true,
    },
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    2,
    {
      authenticated: false,
      context: "hero",
      authLabel: "See what works for your body",
    },
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    3,
    {
      authenticated: false,
      context: "footer",
      authLabel: "Get started",
      signupLabel: "Get started",
    },
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    4,
    {
      authenticated: false,
      context: "footer",
      authLabel: "Start your first experiment",
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
    /class="block text-\[#d4b87a\] lg:whitespace-nowrap">Now let(?:'|&#x27;)s experiment with it\./
  );
  assert.match(markup, /data-root-landing-auth-actions-label="Log in or sign up"/);
  assert.match(
    markup,
    /data-root-landing-auth-actions-label="See what works for your body"/
  );
  assert.match(markup, /Discover what actually makes you healthier\./);
  assert.match(markup, /data-root-landing-auth-actions-label="Get started"/);
  assert.match(markup, /data-root-landing-auth-actions-split="true"/);
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
  assert.match(markup, /Murph uses AI-assisted review of published studies/);
  assert.match(markup, /Research may be incomplete, mixed, or not applicable to your situation/);
  assert.doesNotMatch(markup, /GPT-5\.5 Pro/);
  assert.match(markup, /Wearable apps show status/);
  assert.match(markup, /Murph provides educational health information/);
  assert.match(markup, /not a substitute for professional medical advice/);
  assert.match(markup, /Privacy Policy/);
  assert.match(markup, /\/legal\/privacy/u);
  assert.match(markup, /Subprocessors/);
  assert.match(markup, /\/subprocessors/u);
  assert.doesNotMatch(markup, /Perplexity Health/);
  assert.doesNotMatch(markup, /Your wearable shows data/);
});

test("SecurityPage keeps the shared sticky nav on one auth button", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
  });

  const { default: SecurityPage } = await import("../app/security/page");

  renderToStaticMarkup(await SecurityPage());

  expect(mocks.LandingAuthActions).toHaveBeenCalled();
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    1,
    {
      authenticated: false,
      context: "nav",
      authLabel: "Log in or sign up",
      splitUnauthenticated: false,
    },
    undefined
  );
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
      authLabel: "Open settings",
      signupLabel: "Open settings",
    },
    undefined
  );
  assert.match(markup, /You’re already set up\./);
  assert.doesNotMatch(markup, /Discover what actually makes you healthier\./);
});
