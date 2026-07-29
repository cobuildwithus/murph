import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { DEFAULT_MURPH_HEADSHOT } from "../src/components/homepage/murph-headshot-avatar";
import { PhoneMock } from "../src/components/homepage/phone-mock";

const PRIOR_MESSAGES = [{ from: "murph", text: "Prior message" }] as const;
const CURRENT_MESSAGES = [
  { from: "user", text: "Current message" },
  { from: "murph", text: "Final current message" },
] as const;
const RESULT = { eyebrow: "Result card" } as const;

function renderPhone(resultPlacement?: "after" | "before") {
  return renderToStaticMarkup(
    createElement(PhoneMock, {
      messages: CURRENT_MESSAGES,
      murphHeadshotSrc: DEFAULT_MURPH_HEADSHOT,
      priorMessages: PRIOR_MESSAGES,
      result: RESULT,
      ...(resultPlacement ? { resultPlacement } : {}),
    }),
  );
}

test("PhoneMock preserves the legacy result-before-current-messages order by default", () => {
  const markup = renderPhone();
  const priorIndex = markup.indexOf("Prior message");
  const resultIndex = markup.indexOf("Result card");
  const currentIndex = markup.indexOf("Current message");
  const finalCurrentIndex = markup.indexOf("Final current message");

  assert.ok(priorIndex >= 0);
  assert.ok(resultIndex > priorIndex);
  assert.ok(currentIndex > resultIndex);
  assert.ok(finalCurrentIndex > currentIndex);
});

test("PhoneMock places the result after the complete current message stream when requested", () => {
  const markup = renderPhone("after");
  const priorIndex = markup.indexOf("Prior message");
  const currentIndex = markup.indexOf("Current message");
  const finalCurrentIndex = markup.indexOf("Final current message");
  const resultIndex = markup.indexOf("Result card");

  assert.ok(priorIndex >= 0);
  assert.ok(currentIndex > priorIndex);
  assert.ok(finalCurrentIndex > currentIndex);
  assert.ok(resultIndex > finalCurrentIndex);
});

test("PhoneMock keeps its decorative composer controls out of the tab order", () => {
  const markup = renderPhone();

  assert.doesNotMatch(markup, /<button\b[^>]*aria-hidden="true"/);
});
