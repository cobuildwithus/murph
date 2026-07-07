import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  ChallengeCard,
  GROUP_MEMBERS,
  NewsletterCard,
} from "@/src/components/homepage/group-chat-cards";

test("group chat cards render the challenge and newsletter copy", () => {
  const challengeMarkup = renderToStaticMarkup(createElement(ChallengeCard));
  const newsletterMarkup = renderToStaticMarkup(createElement(NewsletterCard));

  assert.equal(GROUP_MEMBERS.map((member) => member.name).join(", "), "Theo, Maya, Sam");

  assert.match(challengeMarkup, /Walk challenge · Day 5 of 7/);
  assert.match(challengeMarkup, /You/);
  assert.match(challengeMarkup, /5\/5 days/);
  assert.match(challengeMarkup, /\+31% steps vs baseline/);
  assert.match(challengeMarkup, /Maya/);
  assert.match(challengeMarkup, /4\/5 days/);
  assert.match(challengeMarkup, /\+22 min avg walk/);
  assert.match(challengeMarkup, /Sam/);
  assert.match(challengeMarkup, /\+12% steps vs baseline/);
  assert.match(challengeMarkup, /Theo/);
  assert.match(challengeMarkup, /3\/5 days/);
  assert.match(challengeMarkup, /\+4% steps vs baseline/);
  assert.match(
    challengeMarkup,
    /Scored on adherence and change vs your own baseline/,
  );
  assert.doesNotMatch(challengeMarkup, /leaderboard/i);
  assert.doesNotMatch(challengeMarkup, /best HRV/i);

  assert.match(newsletterMarkup, /Weekly newsletter · Sunday 8:02 AM/);
  assert.match(newsletterMarkup, /The Crew: week 3 in health/);
  assert.match(newsletterMarkup, /Theo · best sleep week since May/);
  assert.match(newsletterMarkup, /Maya · 4 sunrise walks logged/);
  assert.match(newsletterMarkup, /Sam · steps up 12% on baseline/);
  assert.match(newsletterMarkup, /Emailed to everyone who opted in/);
});
