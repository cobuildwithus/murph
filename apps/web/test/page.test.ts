import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

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

afterEach(() => {
  vi.unstubAllEnvs();
});

test("HomePage renders the canonical landing page at the root route", async () => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_VENICE_ENABLED", "");
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
  assert.equal((markup.match(/href="\/knowledge"/g) ?? []).length, 1);
  assert.equal((markup.match(/href="\/blog"/g) ?? []).length, 2);
  assert.match(
    markup,
    /href="\/knowledge"[^>]*>Knowledge<\/a>.*href="\/blog"[^>]*>Blog<\/a>.*href="\/security"[^>]*>Security<\/a>/s,
  );
  assert.match(markup, /data-root-landing-auth-actions-context="nav"/);
  assert.match(markup, /data-root-landing-auth-actions-context="hero"/);
  assert.match(markup, /data-root-landing-auth-actions-context="footer"/);
  assert.match(
    markup,
    /font-serif text-\[clamp\(2\.5rem,5vw,4rem\)\][^"]* text-black/,
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
  const pricingStart = markup.indexOf('<section id="pricing"');
  assert.ok(pricingStart >= 0, "signup pricing section missing");
  const pricingSection = markup.slice(
    pricingStart,
    markup.indexOf("</section>", pricingStart),
  );
  assert.match(pricingSection, /\$8\/mo/);
  assert.match(pricingSection, /Open source/);
  assert.match(pricingSection, /Cancel anytime\./);
  assert.doesNotMatch(pricingSection, /free trial/i);
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
  assert.match(
    markup,
    /See how we protect your data.*href="\/consumer-health-data-privacy-policy"[^>]*>Consumer Health Data Privacy Notice<span aria-hidden="true">→<\/span><\/a>/s,
  );
  assert.equal(
    (
      markup.match(
        /Illustrative examples\. Changes in personal data can have many causes and do not establish that an intervention produced the result\./g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(markup, /Murph uses AI-assisted review of published studies/);
  assert.match(markup, /Research may be incomplete, mixed, or not applicable to your situation/);
  assert.doesNotMatch(markup, /GPT-5\.5 Pro/);
  assert.match(markup, /Wearable apps show status/);
  assert.doesNotMatch(markup, /Strava/);
  assert.doesNotMatch(markup, /Perplexity Health/);
  assert.doesNotMatch(markup, /Can I choose which AI provider Murph uses\?/);
  assert.doesNotMatch(markup, /Your wearable shows data/);
});

test("HomePage keeps the technical runtime section in order and honors both provider flags", async () => {
  const combos = [
    { custom: "", expectEndpoint: false, expectVenice: false, venice: "" },
    { custom: "", expectEndpoint: false, expectVenice: true, venice: "1" },
    { custom: "1", expectEndpoint: true, expectVenice: false, venice: "" },
    { custom: "1", expectEndpoint: true, expectVenice: true, venice: "1" },
  ] as const;

  for (const combo of combos) {
    vi.clearAllMocks();
    vi.stubEnv("HOSTED_VENICE_ENABLED", combo.venice);
    vi.stubEnv("HOSTED_CUSTOM_INFERENCE_ENABLED", combo.custom);
    mocks.getHostedPageAuthSnapshot.mockResolvedValue({
      authenticated: false,
    });
    mocks.getMurphGithubStarCount.mockResolvedValue(null);
    mocks.headers.mockResolvedValue(new Headers({
      "x-vercel-ip-country": "US",
    }));

    const { default: HomePage } = await import("../app/page");
    const markup = renderToStaticMarkup(await HomePage());

    // Present, and ordered between "How it works" and the security teaser.
    // Anchors on "Built on Codex," because the rest of the headline is glued
    // with non-breaking spaces, whose encoding differs across transforms.
    assert.match(
      markup,
      /Improve your health, one experiment at a time\.[\s\S]*Built on Codex,[\s\S]*Your health data/,
    );
    // "Privacy choice" and "privacy model fits you better" are unique to the
    // section's provider matrix and inference card, unlike bare "Venice",
    // which the FAQ also mentions when the flag is on.
    if (combo.expectVenice) {
      assert.match(markup, /Privacy choice/);
      assert.match(markup, /privacy model fits you better/);
    } else {
      assert.doesNotMatch(markup, /Privacy choice/);
      assert.doesNotMatch(markup, /privacy model fits you better/);
    }
    if (combo.expectEndpoint) {
      assert.match(markup, /Endpoint \+ key/);
      assert.match(markup, /compatible model endpoint and key/);
    } else {
      assert.doesNotMatch(markup, /Endpoint \+ key/);
      assert.doesNotMatch(markup, /compatible model endpoint and key/);
    }
    // The managed and self-hosted paths are never gated.
    assert.match(markup, /Managed[\s\S]{0,200}OpenAI/);
    assert.match(markup, /Run it yourself[\s\S]{0,200}Local OSS/);
  }
});

test("HomePage shows the provider FAQ only when Venice is available", async () => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_VENICE_ENABLED", "1");
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
  });
  mocks.getMurphGithubStarCount.mockResolvedValue(null);
  mocks.headers.mockResolvedValue(new Headers({
    "x-vercel-ip-country": "US",
  }));

  const { default: HomePage } = await import("../app/page");
  const markup = renderToStaticMarkup(await HomePage());

  assert.match(markup, /Can I choose which AI provider Murph uses\?/);
  assert.match(markup, /choose OpenAI or Venice/);
});

test("SecurityPage splits the shared sticky nav into Log in + Signup when logged out", async () => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_VENICE_ENABLED", "");
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
  assert.doesNotMatch(markup, /security-model-provider-title/);
});

test("SecurityPage shows provider security guidance only when Venice is available", async () => {
  vi.clearAllMocks();
  vi.stubEnv("HOSTED_VENICE_ENABLED", "true");
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
  });
  mocks.getMurphGithubStarCount.mockResolvedValue(null);

  const { default: SecurityPage } = await import("../app/security/page");
  const markup = renderToStaticMarkup(await SecurityPage());

  assert.match(markup, /security-model-provider-title/);
  assert.match(markup, /OpenAI remains the default/);
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
