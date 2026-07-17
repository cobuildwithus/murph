import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { NutritionSection } from "@/src/components/homepage/nutrition-section";

test("NutritionSection renders the static nutrition database copy", () => {
  const markup = renderToStaticMarkup(createElement(NutritionSection));

  assert.match(markup, /Nutrition/);
  assert.match(markup, /Murph reads the label so you don&#x27;t have to\./);
  assert.match(
    markup,
    /Murph carries the nutrition facts for over 2 million foods and 239,000 supplements\./,
  );
  assert.match(
    markup,
    /answers from the actual label, checks it against independent lab tests, and flags what the front of the pack leaves out\./,
  );
  assert.match(markup, /are these protein bars actually healthy\?/);
  assert.match(markup, /Chocolate peanut protein bar/);
  assert.match(markup, /High BPA/);
  assert.match(markup, /plasticlist\.org/);
  assert.match(markup, /href="https:\/\/plasticlist\.org"/);
  assert.match(
    markup,
    /BPA measured at 41 ng\/g, near the top of everything PlasticList has tested\./,
  );
  assert.doesNotMatch(markup, /Murph&#x27;s read/);
  assert.doesNotMatch(markup, /Want the swap\?/);
  assert.match(markup, /Murph Facts/);
  assert.match(markup, /Behind every answer about what you eat/);
  assert.match(markup, /Food labels/);
  assert.match(markup, /2,027,814/);
  assert.match(markup, /Supplement facts/);
  assert.match(markup, /239,365/);
  assert.match(markup, /Product tests/);
  assert.match(markup, /20,697/);
  assert.match(
    markup,
    /Screened against published limits for lead, BPA, and phthalates\./,
  );
  assert.match(markup, /Counted July 2026\. Growing weekly/);
  assert.match(markup, /Search the whole database yourself/);
  assert.match(markup, /href="\/search"/);
  assert.doesNotMatch(markup, /personal health assistant/i);
});
