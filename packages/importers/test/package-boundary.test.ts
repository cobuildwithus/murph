import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

test("package manifest exposes the sample-series summary subpath used by query", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    exports?: Record<string, { default?: string; import?: string; types?: string } | undefined>;
  };

  assert.deepEqual(packageManifest.exports?.["./sample-series-summary"], {
    types: "./dist/sample-series-summary.d.ts",
    import: "./dist/sample-series-summary.js",
    default: "./dist/sample-series-summary.js",
  });
});
