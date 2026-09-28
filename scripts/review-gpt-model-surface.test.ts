import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const review = require("../node_modules/@cobuild/review-gpt/src/prepare-chatgpt-draft.js");
const target = { desiredVersion: "6", wantsPro: true };

describe("installed ReviewGPT accessible model controls", () => {
  it.each([
    ["Select model 6Pro", true],
    ["Select model 6Thinking", false],
    ["Select model GPT-5.6 Sol", false],
    ["Select ChatGPT model Thinking effortPro", false],
    ["Pro", false],
    ["Latest", false],
  ])("requires concrete model evidence from %s", (label, expected) => {
    expect(review.modelPickerControlSelectionProof({ visible: true, label }, target))
      .toBe(expected);
  });

  it.each([{ disabled: true }, { ariaDisabled: "true" }, { inert: true }, { visible: false }])(
    "rejects unavailable model controls (%j)", (state) => {
      expect(review.modelPickerControlSelectionProof({
        visible: true, label: "Select model 6Pro", ...state,
      }, target)).toBe(false);
    },
  );
});
