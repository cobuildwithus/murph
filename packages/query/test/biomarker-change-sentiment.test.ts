import assert from "node:assert/strict";

import { test } from "vitest";

import { resolveBiomarkerChangeSentiment } from "../src/biomarker-change-sentiment.ts";

test("resolveBiomarkerChangeSentiment covers every desired-direction class", () => {
  for (const desiredDirection of ["higher", "higher_or_stable"] as const) {
    assert.equal(resolveBiomarkerChangeSentiment("up", desiredDirection), "positive");
    assert.equal(resolveBiomarkerChangeSentiment("down", desiredDirection), "negative");
  }

  for (const desiredDirection of ["lower", "lower_or_stable"] as const) {
    assert.equal(resolveBiomarkerChangeSentiment("down", desiredDirection), "positive");
    assert.equal(resolveBiomarkerChangeSentiment("up", desiredDirection), "negative");
  }

  for (const desiredDirection of ["stable", "mixed_or_contextual"] as const) {
    assert.equal(resolveBiomarkerChangeSentiment("up", desiredDirection), "neutral");
    assert.equal(resolveBiomarkerChangeSentiment("down", desiredDirection), "neutral");
  }

  assert.equal(resolveBiomarkerChangeSentiment("up", null), "neutral");
  assert.equal(resolveBiomarkerChangeSentiment("neutral", "higher"), "neutral");
  assert.equal(resolveBiomarkerChangeSentiment("neutral", "lower"), "neutral");
});
