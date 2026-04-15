import assert from "node:assert/strict";

import { test } from "vitest";

import {
  normalizeRepeatedOption,
  normalizeRepeatableEnumFlagOption,
  normalizeRepeatableFlagOption,
} from "../src/option-utils.ts";

test("normalizeRepeatedOption trims, deduplicates, and drops empty entries", () => {
  assert.equal(normalizeRepeatedOption(undefined), undefined);
  assert.equal(normalizeRepeatedOption([]), undefined);
  assert.deepEqual(normalizeRepeatedOption([" a ", "b", "a", "", "  "]), ["a", "b"]);
});

test("normalizeRepeatableFlagOption rejects comma-delimited values", () => {
  assert.throws(
    () => normalizeRepeatableFlagOption(["goal,condition"], "kind"),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          error instanceof Error &&
          "code" in error &&
          (error as { code?: unknown }).code === "invalid_option" &&
          error.message ===
            "Comma-delimited values are not supported for --kind. Repeat the flag instead.",
      ),
  );
});

test("normalizeRepeatableEnumFlagOption enforces the supported value set", () => {
  assert.equal(
    normalizeRepeatableEnumFlagOption(undefined, "record-type", ["goal", "condition"]),
    undefined,
  );
  assert.deepEqual(
    normalizeRepeatableEnumFlagOption(
      ["goal", "condition", "goal"],
      "record-type",
      ["goal", "condition"],
    ),
    ["goal", "condition"],
  );

  assert.throws(
    () =>
      normalizeRepeatableEnumFlagOption(
        ["goal", "allergy"],
        "record-type",
        ["goal", "condition"],
      ),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          error instanceof Error &&
          "code" in error &&
          (error as { code?: unknown }).code === "invalid_option" &&
          error.message ===
            'Unsupported value for --record-type: "allergy". Supported values: goal, condition.',
      ),
  );
});
