import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TogetherSection } from "@/src/components/homepage/together-section";

test("TogetherSection renders the static social feature reframe", () => {
  const markup = renderToStaticMarkup(createElement(TogetherSection));

  assert.match(markup, /Better together/);
  assert.match(markup, /Do it with your people\./);
  assert.match(
    markup,
    /Habits stick when someone else is watching\. Start a challenge with friends/,
  );
  assert.match(markup, /Group challenges/);
  assert.match(markup, /Walk challenge · Day 5 of 7/);
  assert.match(
    markup,
    /Theo, bold words for a man who logged 11 minutes yesterday\./,
  );
  assert.match(
    markup,
    /Murph is the referee\. It sets fair baselines across different devices/,
  );
  assert.match(markup, /The weekly newsletter/);
  assert.match(markup, /Weekly newsletter · Sunday 8:02 AM/);
  assert.match(
    markup,
    /Every Sunday the group gets an email recap of the week\. Wins, trends, and gentle callouts\. Grandparents included\./,
  );
  assert.match(
    markup,
    /Everyone opts in when they join\. Scores are adherence and change against your own baseline, never raw body stats\./,
  );
  assert.doesNotMatch(markup, /leaderboard/i);
  assert.doesNotMatch(markup, /raw body stats.*rank/i);
});
