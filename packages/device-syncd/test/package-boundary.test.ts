import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

import * as rootExports from "../src/index.ts";
import { createSecretCodec } from "../src/local-secret-codec.ts";

test("@murphai/device-syncd package manifest exposes narrow public subpaths", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    exports?: Record<string, { default?: string; types?: string } | undefined>;
  };

  assert.deepEqual(Object.keys(packageManifest.exports ?? {}).sort(), [
    ".",
    "./callback-redirect",
    "./client",
    "./config",
    "./connect-config",
    "./errors",
    "./hosted-hints",
    "./hosted-runtime",
    "./http",
    "./local-secret-codec",
    "./provider-label",
    "./providers/junction-client",
    "./providers/oura",
    "./providers/strava",
    "./providers/whoop",
    "./public-ingress",
    "./registry",
    "./runtime-config",
    "./service",
    "./types",
  ]);
  assert.equal(packageManifest.exports?.["./crypto"], undefined);
  assert.deepEqual(packageManifest.exports?.["./connect-config"], {
    default: "./dist/connect-config.js",
    types: "./dist/connect-config.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./errors"], {
    default: "./dist/errors.js",
    types: "./dist/errors.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./local-secret-codec"], {
    default: "./dist/local-secret-codec.js",
    types: "./dist/local-secret-codec.d.ts",
  });
  assert.deepEqual(packageManifest.exports?.["./providers/junction-client"], {
    default: "./dist/providers/junction-client.js",
    types: "./dist/providers/junction-client.d.ts",
  });
});

test("@murphai/device-syncd root barrel exposes the local secret codec API", () => {
  assert.equal(rootExports.createSecretCodec, createSecretCodec);
  assert.equal("buildDeviceSyncSecretAad" in rootExports, false);
  assert.equal("buildDeviceSyncTokenCipherOptions" in rootExports, false);
});
