import assert from "node:assert/strict";

import { test } from "vitest";

import * as queryRoot from "@murphai/query";
import * as queryBrowser from "@murphai/query/browser";
import * as queryBrowserMurphAge from "@murphai/query/browser-murph-age";

test("@murphai/query keeps browser-vault-only helpers on the browser subpath", () => {
  for (const exportName of [
    "BROWSER_VAULT_REPLICA_SCHEMA",
    "createBrowserVaultQueryClient",
    "createBrowserVaultReplica",
    "parseBrowserVaultReplica",
    "selectBrowserVaultBiomarkerPanel",
    "selectBrowserVaultExperimentResults",
    "selectBrowserVaultOverview",
  ]) {
    assert.equal(exportName in queryRoot, false);
    assert.equal(exportName in queryBrowser, true);
  }
});

test("@murphai/query exposes Murph Age readiness through a narrow browser subpath", () => {
  assert.equal("selectBrowserVaultMurphAgeReadiness" in queryRoot, false);
  assert.equal("selectBrowserVaultMurphAgeReadiness" in queryBrowser, false);
  assert.equal("selectBrowserVaultMurphAgeReadiness" in queryBrowserMurphAge, true);
  assert.equal("createBrowserVaultQueryClient" in queryBrowserMurphAge, false);
});
