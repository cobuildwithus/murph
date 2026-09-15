import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { test } from "vitest";

import * as healthMetrics from "@murphai/health-metrics";
import * as queryRoot from "@murphai/query";
import * as queryBrowser from "@murphai/query/browser";
import * as queryBrowserBiomarkers from "@murphai/query/browser-biomarkers";

test("@murphai/query keeps browser-vault-only helpers on the browser subpath", () => {
  for (const exportName of [
    "BROWSER_VAULT_REPLICA_SCHEMA",
    "createBrowserVaultQueryClient",
    "createBrowserVaultReplica",
    "parseBrowserVaultReplica",
    "selectBrowserVaultBiomarkerPanel",
    "selectBrowserVaultExperimentResults",
  ]) {
    assert.equal(exportName in queryRoot, false);
    assert.equal(exportName in queryBrowser, true);
  }
});

test("@murphai/query exposes measured lab selectors through the biomarker browser subpath", () => {
  for (const exportName of [
    "selectBrowserVaultLabBiomarkerDetail",
    "selectBrowserVaultMeasuredBiomarkers",
  ]) {
    assert.equal(exportName in queryRoot, false);
    assert.equal(exportName in queryBrowserBiomarkers, true);
  }
});

test("Murph Age entrypoints are absent from package exports and source aliases", async () => {
  const require = createRequire(import.meta.url);
  for (const specifier of [
    "@murphai/health-metrics/murph-age",
    "@murphai/health-metrics/murph-age-source-routes",
    "@murphai/query/murph-age",
    "@murphai/query/browser-murph-age",
  ]) {
    assert.throws(
      () => require.resolve(specifier),
      { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
      specifier,
    );
  }

  const config = JSON.parse(
    await readFile(new URL("../../../tsconfig.base.json", import.meta.url), "utf8"),
  ) as { compilerOptions: { paths: Record<string, string[]> } };
  assert.equal(Object.hasOwn(config.compilerOptions.paths, "@murphai/query/murph-age"), false);
  assert.equal(Object.hasOwn(config.compilerOptions.paths, "@murphai/query/browser-murph-age"), false);
  assert.deepEqual(config.compilerOptions.paths["@murphai/health-metrics/*"], [
    "./packages/health-metrics/src/*.ts",
  ]);

  for (const surface of [healthMetrics, queryRoot, queryBrowser, queryBrowserBiomarkers]) {
    assert.deepEqual(
      Object.keys(surface).filter((name) => /[Mm]urphAge(?:[A-Z]|$)|^MURPH_AGE_/u.test(name)),
      [],
    );
  }
});
