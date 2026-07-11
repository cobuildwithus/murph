import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMurphGithubStarCount: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
  headers: vi.fn(
    async () =>
      new Headers({
        "x-vercel-ip-country": "US",
      }),
  ),
  LandingAuthActions: vi.fn(
    (props: {
      authenticated: boolean;
      context: "nav" | "hero" | "footer";
      authLabel: string;
      signupLabel?: string;
      leadingIcon?: React.ReactNode;
      splitUnauthenticated?: boolean;
      preloadAuthPanel?: boolean;
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

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

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
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("@/src/lib/github-stars", async () => {
  const actual =
    await vi.importActual<typeof import("@/src/lib/github-stars")>(
      "@/src/lib/github-stars",
    );

  return {
    ...actual,
    getMurphGithubStarCount: mocks.getMurphGithubStarCount,
  };
});

vi.mock(
  "@/src/components/hosted-onboarding/phone-country-code-provider",
  () => ({
    PhoneCountryCodeProvider(input: { children: React.ReactNode }) {
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
  LandingAuthDialog: () => null,
}));

test("HomePage renders the canonical landing page at the root route", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
  });
  mocks.getMurphGithubStarCount.mockResolvedValue(null);
  mocks.headers.mockResolvedValue(new Headers({
    "x-vercel-ip-country": "US",
  }));

  const { default: HomePage } = await import("../app/page");

  const markup = renderToStaticMarkup(await HomePage());

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.getMurphGithubStarCount).toHaveBeenCalledTimes(1);
  expect(mocks.headers).toHaveBeenCalledTimes(1);
  expect(mocks.LandingAuthActions).toHaveBeenCalledTimes(5);
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    1,
    {
      authenticated: false,
      context: "nav",
      authLabel: "Dashboard",
      preloadAuthPanel: true,
      splitUnauthenticated: true,
    },
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      authenticated: false,
      context: "hero",
      authLabel: "Meet Murph",
      leadingIcon: expect.anything(),
      preloadAuthPanel: true,
    }),
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({
      authenticated: false,
      context: "hero",
      authLabel: "Meet Murph",
      leadingIcon: expect.anything(),
    }),
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    4,
    {
      authenticated: false,
      context: "footer",
      authLabel: "Get started",
      preloadAuthPanel: true,
      signupLabel: "Get started",
    },
    undefined
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    5,
    {
      authenticated: false,
      context: "footer",
      authLabel: "Get started",
      preloadAuthPanel: true,
      signupLabel: "Get started",
    },
    undefined
  );
  assert.match(markup, /aria-label="Open menu"/);
  assert.match(markup, /data-root-landing-auth-actions-context="nav"/);
  assert.match(markup, /data-root-landing-auth-actions-context="hero"/);
  assert.match(markup, /data-root-landing-auth-actions-context="footer"/);
  assert.match(
    markup,
    /font-serif text-\[clamp\(2rem,4vw,3\.25rem\)\][^"]* text-black/,
  );
  assert.match(markup, /<span class="block">Health is hard\.<\/span>/);
  assert.match(markup, /Don’t do it alone\./);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(
    markup,
    /<h1 class="sr-only">Health is hard\. Don’t do it alone\.<\/h1>/,
  );
  assert.match(
    markup,
    /Wearables, bloodwork, doctor visits, supplements, blood pressure, sleep\. Murph reads it all/,
  );
  assert.match(markup, /Start a health challenge with your friends/);
  assert.match(markup, /referees the week/);
  assert.match(markup, /Better together/);
  assert.match(markup, /Do it with your people\./);
  assert.match(markup, /Walk challenge · Day 5 of 7/);
  assert.match(markup, /Weekly newsletter · Sunday 8:02 AM/);
  assert.match(markup, /No group\? You’re still not doing this alone\./);
  assert.match(markup, /data-root-landing-auth-actions-label="Dashboard"/);
  assert.match(
    markup,
    /data-root-landing-auth-actions-label="Meet Murph"/
  );
  assert.match(markup, /Everyone’s working on something\./);
  assert.match(markup, /Whatever your goal, you don’t have to hit it alone\./);
  assert.match(markup, /Do I need friends on Murph\?/);
  assert.doesNotMatch(markup, /personal health assistant/);
  assert.doesNotMatch(markup, /Discover what actually makes you healthier/);
  assert.match(markup, /data-root-landing-auth-actions-label="Get started"/);
  assert.match(markup, /You can also install it locally\./);
  assert.match(
    markup,
    /curl -fsSL https:\/\/www\.withmurph\.ai\/install\.sh \| bash/
  );
  assert.match(markup, /murph chat/);
  assert.match(markup, /Do I need a wearable\?/);
  assert.match(markup, /No\. A wearable can add useful signals/);
  assert.match(markup, /Can I do challenges with friends and family\?/);
  assert.match(
    markup,
    /Scoring is adherence and change against your own baseline, never raw body stats\./,
  );
  assert.match(markup, /What does the group actually see\?/);
  assert.match(markup, /Everything else stays private by default\./);
  assert.match(markup, /Murph uses AI-assisted review of published studies/);
  assert.match(markup, /Research may be incomplete, mixed, or not applicable to your situation/);
  assert.doesNotMatch(markup, /GPT-5\.5 Pro/);
  assert.match(markup, /Wearable apps show status/);
  assert.doesNotMatch(markup, /Perplexity Health/);
  assert.doesNotMatch(markup, /Your wearable shows data/);
});

test("SecurityPage splits the shared sticky nav into Log in + Signup when logged out", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
  });
  mocks.getMurphGithubStarCount.mockResolvedValue(null);

  const { default: SecurityPage } = await import("../app/security/page");

  const markup = renderToStaticMarkup(await SecurityPage());

  expect(mocks.LandingAuthActions).toHaveBeenCalled();
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    1,
    {
      authenticated: false,
      context: "nav",
      authLabel: "Dashboard",
      splitUnauthenticated: true,
      onDarkSurface: true,
    },
    undefined
  );
  assert.match(
    markup,
    /curl -fsSL https:\/\/www\.withmurph\.ai\/install\.sh \| bash/
  );
  assert.doesNotMatch(markup, /curl -sSL withmurph\.ai\/install\.sh \| bash/);
});

test("HomePage metadata keeps the root route as the canonical landing URL", async () => {
  const { metadata } = await import("../app/page");

  const {
    MURPH_DEFAULT_METADATA_DESCRIPTION,
    MURPH_DEFAULT_METADATA_TITLE,
    MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
  } = await import("../src/lib/site-metadata");

  expect(metadata.title).toBe(MURPH_DEFAULT_METADATA_TITLE);
  expect(metadata.description).toBe(MURPH_DEFAULT_METADATA_DESCRIPTION);
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
  expect(metadata.openGraph?.description).toBe(
    MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
  );
  expect(metadata.twitter?.description).toBe(
    MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
  );
});

test("HomePage keeps the final CTA consistent for authenticated sessions", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
  });
  mocks.getMurphGithubStarCount.mockResolvedValue(null);
  mocks.headers.mockResolvedValue(new Headers({
    "x-vercel-ip-country": "US",
  }));

  const { default: HomePage } = await import("../app/page");

  const markup = renderToStaticMarkup(await HomePage());

  expect(mocks.headers).toHaveBeenCalledTimes(1);
  expect(mocks.LandingAuthActions).toHaveBeenCalledTimes(5);
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    5,
    {
      authenticated: true,
      context: "footer",
      authLabel: "Go to dashboard",
      preloadAuthPanel: true,
      signupLabel: "Go to dashboard",
    },
    undefined
  );
  assert.match(markup, /You’re already set up\./);
  assert.match(markup, /data-root-landing-auth-actions-label="Go to dashboard"/);
  assert.match(markup, /Manage billing and connected wearables from one place\./);
});
