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

test("ClubPage presents the live challenge flow clearly", async () => {
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
  assert.match(markup, /Works in iMessage/);
  assert.match(markup, /Create and run the whole challenge in iMessage\./);
  assert.match(markup, /connect the supported wearables they already use/);
  assert.match(markup, /Start a challenge/);
  assert.doesNotMatch(markup, /early access/i);
  assert.doesNotMatch(markup, /pilot/i);
  assert.match(markup, /href="\/clubs"/);
  assert.match(markup, /mailto:clubs@withmurph\.ai\?/);
  assert.match(markup, /ATL moves together/);
  assert.match(markup, /Pick the energy that fits your people\./);
  assert.match(markup, /All together/);
  assert.match(markup, /Team vs\. team/);
  assert.match(markup, /Head to head/);
  assert.match(markup, /One sentence\. One link\. Everyone&#x27;s in\./);
  assert.match(
    markup,
    /Murph turns the idea into a challenge members can understand and join\./,
  );
  assert.doesNotMatch(markup, /Start in plain language/);
  assert.match(markup, /max-w-\[284px\]/);
  assert.match(markup, /data-club-wearables-surface="sources"/);
  assert.match(markup, /data-club-wearables-surface="inputs"/);
  assert.match(markup, /data-challenge-input-group="move"/);
  assert.match(markup, /data-challenge-input-group="nourish"/);
  assert.match(markup, /Different wearables\. One live challenge\./);
  assert.match(markup, /No spreadsheets required/);
  assert.match(markup, /Automatically tracked/);
  assert.match(markup, /Availability depends on the connected source/);
  assert.match(markup, /Heart-rate zones/);
  assert.match(markup, /Logged protein/);
  assert.match(markup, /Keep the energy\. Lose the admin\./);
  assert.match(markup, /One challenge\. Personal support for everyone in it\./);
  assert.match(markup, /Share the score\. Keep the rest private\./);
  assert.match(markup, /How much does it cost\?/);
  assert.match(markup, /Organizers buy AI usage as needed/);
  assert.match(markup, /no platform fee/);
  assert.match(markup, /free for two weeks/);
  assert.match(markup, /Group plan for \$3\.50\/month/);
  assert.ok(
    markup.indexOf("ATL moves together")
      > markup.indexOf("can we see if the whole club"),
  );
  assert.doesNotMatch(markup, /Illustrative/);
  assert.doesNotMatch(markup, /Create your challenge/);
  assert.doesNotMatch(markup, /trusted by/i);
});
