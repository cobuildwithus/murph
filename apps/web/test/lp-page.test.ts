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
      signupLabel: string;
    }) =>
      createElement(
        "div",
        {
          "data-landing-auth-actions-authenticated": String(
            props.authenticated,
          ),
          "data-landing-auth-actions-context": props.context,
          "data-landing-auth-actions-label": props.signupLabel,
        },
        "Landing auth actions",
      ),
  ),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

vi.mock("../app/lp/auth-controls", () => ({
  LandingAuthActions: mocks.LandingAuthActions,
}));

test("LandingPage threads the server-side auth snapshot into the nav, hero, and footer auth entrypoints", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
  });

  const { default: LandingPage } = await import("../app/lp/page");

  const markup = renderToStaticMarkup(await LandingPage());

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.LandingAuthActions).toHaveBeenCalledTimes(3);
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
      signupLabel: "See what works for your body",
    },
    undefined,
  );
  expect(mocks.LandingAuthActions).toHaveBeenNthCalledWith(
    3,
    {
      authenticated: false,
      context: "footer",
      signupLabel: "Start your first experiment",
    },
    undefined,
  );
  assert.match(markup, /data-landing-auth-actions-context="nav"/);
  assert.match(markup, /data-landing-auth-actions-context="hero"/);
  assert.match(markup, /data-landing-auth-actions-context="footer"/);
  assert.match(markup, /data-landing-auth-actions-label="Sign up"/);
  assert.match(
    markup,
    /data-landing-auth-actions-label="See what works for your body"/,
  );
  assert.match(
    markup,
    /data-landing-auth-actions-label="Start your first experiment"/,
  );
});
