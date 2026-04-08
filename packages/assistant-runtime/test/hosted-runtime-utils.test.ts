import assert from "node:assert/strict";

import { test } from "vitest";

import { assertNever } from "../src/hosted-runtime/utils.ts";

test("assertNever throws with the unexpected hosted execution payload", () => {
  assert.throws(
    () => assertNever({ kind: "unexpected" } as never),
    /Unexpected hosted execution event/u,
  );
});
