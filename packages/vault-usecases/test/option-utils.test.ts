import assert from "node:assert/strict";

import { test } from "vitest";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import {
  normalizeRepeatedOption,
  normalizeRepeatableEnumFlagOption,
  normalizeRepeatableFlagOption,
  normalizeRepeatableTextFlagOption,
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

test("rejections carry only a hidden, read-only CLI timing class", () => {
  for (const [rejection, run] of [
    ["comma_delimited", () => normalizeRepeatableFlagOption(["goal,condition"], "kind")],
    ["unsupported_value", () => normalizeRepeatableEnumFlagOption(["allergy"], "record-type", ["goal"])],
  ] as const) {
    assert.throws(run, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.deepEqual(Object.getOwnPropertyDescriptor(error, "cliTimingRejection"),
        { value: rejection, writable: false, enumerable: false, configurable: false });
      const bare = new VaultCliError("invalid_option", error.message);
      assert.deepEqual(Object.keys(error), Object.keys(bare));
      assert.equal(JSON.stringify(error), JSON.stringify(bare));
      return true;
    });
  }
});

test("normalizeRepeatableTextFlagOption preserves commas inside prose values", () => {
  assert.deepEqual(
    normalizeRepeatableTextFlagOption([
      " Stop during driving, cycling, cooking, tools, or sleep. ",
      "Stop during driving, cycling, cooking, tools, or sleep.",
    ]),
    ["Stop during driving, cycling, cooking, tools, or sleep."],
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
