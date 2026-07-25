import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  AsksGridSection,
  WideFeature,
} from "@/src/components/homepage/asks-section";

test("WideFeature keeps the phone treatment compact and restores the desktop scale", () => {
  const markup = renderToStaticMarkup(
    createElement(WideFeature, {
      artifact: createElement("div", null, "Artifact"),
      artifactSide: "right",
      body: "Body",
      bubble: "Bubble",
      eyebrow: "Eyebrow",
      headline: "Headline",
      tint: "sage",
    }),
  );

  assert.match(markup, /rounded-\[1\.5rem\]/);
  assert.match(markup, /sm:rounded-\[2rem\]/);
  assert.match(markup, /min-h-\[330px\]/);
  assert.match(markup, /sm:min-h-\[440px\]/);
  assert.match(markup, /max-w-\[240px\]/);
  assert.match(markup, /sm:max-w-\[280px\]/);
  assert.match(markup, /text-\[1\.5rem\]/);
  assert.match(markup, /sm:text-\[clamp\(1\.75rem,2\.8vw,2\.625rem\)\]/);
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
  assert.match(markup, /Latest panel · vs March/);
  assert.match(markup, /Best HRV in 2 weeks/);
});
