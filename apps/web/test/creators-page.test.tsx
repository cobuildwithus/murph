import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
          "data-creators-authenticated": String(props.authenticated),
          "data-creators-auth-label": props.authLabel,
          "data-creators-auth-context": props.context,
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

import { metadata } from "../app/creators/page";
import { CreatorsPageStudy } from "../app/design/creators-page-study";
import {
  buildCreatorProgramMailto,
  MURPH_CREATOR_CONTACT_EMAIL,
} from "@/src/lib/creator-program-contact";

test("creator contact handoff asks for the minimum useful health partnership context", () => {
  const mailto = buildCreatorProgramMailto();
  const url = new URL(mailto);

  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, MURPH_CREATOR_CONTACT_EMAIL);
  assert.equal(
    url.searchParams.get("subject"),
    "Explore a Murph health partnership",
  );
  assert.equal(
    url.searchParams.get("body"),
    [
      "Name, role, or health brand:",
      "Link to your work:",
      "What health topic or outcome does your audience trust you for?",
      "Which podcast, protocol, course, book, or coaching method should Murph bring to life?",
      "What should each participant be able to do or understand?",
      "What could the community work toward together?",
      "Approximate audience or member size:",
    ].join("\n"),
  );
});

test("Creators page metadata names the health outcome and canonical route", () => {
  assert.equal(
    metadata.title,
    "Murph for Health Creators · Put your expertise into practice",
  );
  assert.equal(
    metadata.description,
    "Turn podcasts, protocols, courses, and coaching into reviewed, personalized health guidance your community can follow together.",
  );
  assert.equal(metadata.alternates?.canonical, "/creators");
});

test("the sections catalog renders the real creator page as an inert synthetic study", () => {
  const registrySource = readFileSync(
    new URL("../app/design/sections-content.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    registrySource,
    /import \{ CreatorsPageStudy \} from "\.\/creators-page-study";/u,
  );
  assert.match(registrySource, /<CreatorsPageStudy \/>/u);

  const markup = renderToStaticMarkup(createElement(CreatorsPageStudy));
  assert.match(markup, /data-design-study="creators-marketing-page"/u);
  assert.match(markup, /data-design-state="founding-creator-partnership"/u);
  assert.match(markup, /Illustrative health program/u);
  assert.match(markup, /inert=""/u);
});

test("CreatorsPage sells a health-specific founding partnership without inventing a marketplace", async () => {
  vi.clearAllMocks();
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({ authenticated: false });
  mocks.getMurphGithubStarCount.mockResolvedValue(null);

  const { default: CreatorsPage } = await import("../app/creators/page");
  const markup = renderToStaticMarkup(await CreatorsPage());

  expect(mocks.getHostedPageAuthSnapshot).toHaveBeenCalledTimes(1);
  expect(mocks.getMurphGithubStarCount).toHaveBeenCalledTimes(1);
  assert.equal((markup.match(/<h1\b/gu) ?? []).length, 1);
  assert.match(
    markup,
    /Give every member a personal health guide grounded in your work\./u,
  );
  assert.match(markup, /Explore a partnership/u);
  assert.match(markup, /No code/u);
  assert.match(markup, /Your content stays yours/u);
  assert.match(markup, /href="mailto:support@withmurph\.ai\?/u);
  assert.match(markup, /Illustrative health program/u);
  assert.match(
    markup,
    /Turn years of health knowledge into guidance people can actually follow\./u,
  );
  assert.match(
    markup,
    /The same health program, adapted to each person’s life\./u,
  );
  assert.match(
    markup,
    /Bring your community together around a shared health program\./u,
  );
  assert.match(markup, /Private member support/u);
  assert.match(markup, /Community-wide progress/u);
  assert.match(markup, /Scale the work without watering it down\./u);
  assert.match(markup, /Your sources, standards, and name stay intact\./u);
  assert.match(
    markup,
    /You approve the member-facing health guidance before launch\./u,
  );
  assert.match(markup, /aggregate program reporting only/u);
  assert.match(markup, /Referral reward/u);
  assert.match(markup, /Creator reward/u);
  assert.match(
    markup,
    /Earn when your health program creates real participation\./u,
  );
  assert.match(markup, /qualified, retained participation/u);
  assert.match(markup, /no amount of income is guaranteed/u);
  assert.match(markup, /Founding health partnerships/u);
  assert.match(
    markup,
    /Bring us the health work your audience already trusts\./u,
  );
  assert.match(markup, /data-design-section="creators-marketing-page"/u);
  assert.doesNotMatch(markup, /Turn what you teach/iu);
  assert.doesNotMatch(markup, /personalized AI experience/iu);
  assert.doesNotMatch(markup, /Huberman/u);
  assert.doesNotMatch(markup, /marketplace/iu);
  assert.doesNotMatch(markup, /anyone can publish/iu);
  assert.doesNotMatch(markup, /recipe/iu);
});
