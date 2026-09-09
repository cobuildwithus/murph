import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  AsksGridSection,
  FeatureCard,
} from "@/src/components/homepage/asks-section";

test("FeatureCard keeps the heading before the message and demo", () => {
  const markup = renderToStaticMarkup(
    createElement(FeatureCard, {
      artifact: createElement("div", null, "Artifact"),
      bubble: "Bubble",
      headline: "Headline",
      tint: "sage",
    }),
  );

  assert.ok(markup.indexOf("Headline") < markup.indexOf("Bubble"));
  assert.ok(markup.indexOf("Bubble") < markup.indexOf("Artifact"));
});

test("AsksGridSection stacks dense health findings at iPhone Mini widths", () => {
  const markup = renderToStaticMarkup(createElement(AsksGridSection));

  assert.match(markup, /pt-10 pb-20/);
  assert.match(markup, /sm:pt-20/);
  assert.match(markup, /lg:pt-28/);
  assert.match(markup, /min-\[400px\]:grid-cols-3/);
  assert.match(markup, /min-\[420px\]:flex/);
  assert.match(markup, /text-\[0\.875rem\]/);
  assert.match(markup, /text-\[9px\]/);
  assert.match(markup, /Magnesium for Sleep/);
  assert.match(markup, /Recovery is above your recent baseline/);
  assert.doesNotMatch(markup, /Latest panel · vs March/);
  assert.doesNotMatch(markup, /Self-experiments/);
});
