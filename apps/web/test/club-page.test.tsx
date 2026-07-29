import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  getMurphGithubStarCount: vi.fn(),
  LandingAuthActions: vi.fn(
    (props: { authenticated: boolean; authLabel: string; context: string }) =>
      createElement(
        "div",
        {
          "data-club-authenticated": String(props.authenticated),
          "data-club-auth-label": props.authLabel,
          "data-club-auth-context": props.context,
        },
        "Landing auth actions",
      ),
  ),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
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

vi.mock("../app/auth-controls", () => ({
  LandingAuthActions: mocks.LandingAuthActions,
  LandingAuthDialog: () => null,
}));

test("ClubPage presents the pilot clearly without pretending it is self-serve", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({ authenticated: false });
  mocks.getMurphGithubStarCount.mockResolvedValue(null);

  const { default: ClubPage } = await import("../app/clubs/page");
  const markup = renderToStaticMarkup(await ClubPage());

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.getMurphGithubStarCount).toHaveBeenCalledTimes(1);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /You run the club\./);
  assert.match(markup, /Murph runs the challenge\./);
  assert.match(markup, /Plan a pilot/);
  assert.match(markup, /href="\/clubs"/);
  assert.match(markup, /mailto:clubs@withmurph\.ai\?/);
  assert.match(markup, /ATL moves together/);
  assert.match(markup, /Pick the energy that fits your people\./);
  assert.match(markup, /All together/);
  assert.match(markup, /Team vs\. team/);
  assert.match(markup, /Head to head/);
  assert.match(markup, /One sentence\. One link\. Everyone&#x27;s in\./);
  assert.match(markup, /Keep the energy\. Lose the admin\./);
  assert.match(markup, /One challenge\. Personal support for everyone in it\./);
  assert.match(markup, /Share the score\. Keep the rest private\./);
  assert.match(markup, /Illustrative early-access flow/);
  assert.doesNotMatch(markup, /Create your challenge/);
  assert.doesNotMatch(markup, /trusted by/i);
});
