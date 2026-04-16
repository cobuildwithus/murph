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
            props.authenticated,
          ),
          "data-root-landing-auth-actions-context": props.context,
          "data-root-landing-auth-actions-label": props.signupLabel,
        },
        "Landing auth actions",
      ),
  ),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

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
    undefined,
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    2,
    {
      authenticated: false,
      context: "hero",
      showSignIn: false,
      signupLabel: "See what works for your body",
    },
    undefined,
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    3,
    {
      authenticated: false,
      context: "footer",
      showSignIn: false,
      signupLabel: "Create your account",
    },
    undefined,
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    4,
    {
      authenticated: false,
      context: "footer",
      signupLabel: "Start your first experiment",
    },
    undefined,
  );
  assert.match(markup, /#global-footer \{ display: none; \}/);
  assert.match(markup, /data-root-landing-auth-actions-context="nav"/);
  assert.match(markup, /data-root-landing-auth-actions-context="hero"/);
  assert.match(markup, /data-root-landing-auth-actions-context="footer"/);
  assert.match(markup, /data-root-landing-auth-actions-label="Sign up"/);
  assert.match(
    markup,
    /data-root-landing-auth-actions-label="See what works for your body"/,
  );
  assert.match(markup, /Figure out what actually makes you healthier\./);
  assert.match(markup, /data-root-landing-auth-actions-label="Create your account"/);
  assert.match(
    markup,
    /data-root-landing-auth-actions-label="Start your first experiment"/,
  );
  assert.match(markup, /Quick start/);
  assert.match(
    markup,
    /curl -fsSL https:\/\/www\.withmurph\.ai\/install\.sh \| bash/,
  );
  assert.match(markup, /murph chat/);
});

test("HomePage metadata keeps the root route as the canonical landing URL", async () => {
  const { metadata } = await import("../app/page");

  expect(metadata.alternates?.canonical).toBe("/");
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
    undefined,
  );
  assert.match(markup, /You’re already set up\./);
  assert.doesNotMatch(markup, /Figure out what actually makes you healthier\./);
});
