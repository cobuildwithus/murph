import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

test("@murphai/device-syncd package manifest exposes local-secret-codec and omits the removed crypto subpath", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    exports?: Record<string, { default?: string; types?: string } | undefined>;
  };

  assert.equal(packageManifest.exports?.["./crypto"], undefined);
  assert.deepEqual(packageManifest.exports?.["./local-secret-codec"], {
    default: "./dist/local-secret-codec.js",
    types: "./dist/local-secret-codec.d.ts",
  });
});

test("@murphai/device-syncd root barrel re-exports the local secret codec seam", async () => {
  const rootBarrel = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(rootBarrel, /from "\.\/local-secret-codec\.ts"/u);
  assert.doesNotMatch(rootBarrel, /from "\.\/crypto\.ts"/u);
});
