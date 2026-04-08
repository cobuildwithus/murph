import assert from "node:assert/strict";

import { test } from "vitest";

import { normalizeNullableString } from "../src/shared.js";

test("normalizeNullableString trims whitespace and drops blank values", () => {
  assert.equal(normalizeNullableString(undefined), null);
  assert.equal(normalizeNullableString(null), null);
  assert.equal(normalizeNullableString("   "), null);
  assert.equal(normalizeNullableString("  gateway-local  "), "gateway-local");
});
