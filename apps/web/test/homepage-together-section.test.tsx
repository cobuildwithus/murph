import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { TogetherSection } from "@/src/components/homepage/together-section";

test("TogetherSection renders the static social feature reframe", () => {
  const markup = renderToStaticMarkup(createElement(TogetherSection));

  assert.doesNotMatch(markup, /Better together/);
  assert.match(markup, /Do it with your people\./);
  assert.doesNotMatch(markup, /Group challenges/);
  assert.match(markup, /I referee health challenges with your friends\./);
  assert.match(markup, /no shot you guys are keeping up with me this week/);
  assert.match(
    markup,
    /Theo, bold words for a man who logged 11 minutes yesterday\./,
  );
  assert.match(
    markup,
    /I send the whole family a weekly health newsletter\./,
  );
  assert.match(markup, /so proud of you kids/);
  assert.match(markup, /Grandpa/);
  assert.match(markup, /pt-20 pb-10/);
  assert.match(markup, /sm:pb-20/);
  assert.match(markup, /lg:pb-28/);
  assert.ok(markup.indexOf("I send the whole family") < markup.indexOf("can you send grandpa"));
  assert.doesNotMatch(markup, /leaderboard/i);
});
