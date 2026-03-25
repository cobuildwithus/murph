import assert from "node:assert/strict";

import { test } from "vitest";

import {
  getExpectedSourceSibling,
  isWithinScanRoots,
} from "../../../scripts/clean-generated-source-artifacts";

test("clean-generated-source-artifacts maps generated sidecars back to TS source siblings", () => {
  assert.equal(
    getExpectedSourceSibling("packages/contracts/src/index.js"),
    "packages/contracts/src/index.ts",
  );
  assert.equal(
    getExpectedSourceSibling("packages/contracts/src/index.d.ts"),
    "packages/contracts/src/index.ts",
  );
  assert.equal(
    getExpectedSourceSibling("packages/contracts/src/index.js.map"),
    "packages/contracts/src/index.ts",
  );
  assert.equal(
    getExpectedSourceSibling("packages/contracts/src/index.d.ts.map"),
    "packages/contracts/src/index.ts",
  );
  assert.equal(getExpectedSourceSibling("packages/web/postcss.config.mjs"), null);
});

test("clean-generated-source-artifacts limits cleanup to package/app/e2e trees", () => {
  assert.equal(isWithinScanRoots("packages/contracts/src/index.js"), true);
  assert.equal(isWithinScanRoots("apps/web/src/lib/foo.js"), true);
  assert.equal(isWithinScanRoots("e2e/smoke/generated.js"), true);
  assert.equal(isWithinScanRoots("scripts/package-audit-context.js"), false);
});
