import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TogetherSection } from "@/src/components/homepage/together-section";

test("TogetherSection renders the static social feature reframe", () => {
  const markup = renderToStaticMarkup(createElement(TogetherSection));

  assert.match(markup, /Private by default/);
  assert.match(markup, /Bring in your people when it helps\./);
  assert.match(
    markup,
    /Some goals get easier with company\. When you want that support/,
  );
  assert.match(markup, /Group challenges/);
  assert.match(markup, /I referee health challenges with your friends\./);
  assert.match(markup, /no shot you guys are keeping up with me this week/);
  assert.match(markup, /Walk challenge · Day 5 of 7/);
  assert.match(
    markup,
    /Theo, bold words for a man who logged 11 minutes yesterday\./,
  );
  assert.match(
    markup,
    /Murph sets fair baselines across different devices, keeps the group moving with the tone you choose/,
  );
  assert.match(markup, /The weekly newsletter/);
  assert.match(
    markup,
    /I send the whole family a weekly health newsletter\./,
  );
  assert.match(markup, /Weekly newsletter · Sunday 8:02 AM/);
  assert.match(
    markup,
    /Every Sunday the group gets an email recap of the week\. Wins, trends, and gentle callouts\. Grandparents included\./,
  );
  assert.match(markup, /so proud of you kids/);
  assert.match(markup, /Grandpa/);
  assert.doesNotMatch(markup, /leaderboard/i);
  assert.doesNotMatch(markup, /slackers/i);
});
