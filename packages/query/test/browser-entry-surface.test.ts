import assert from "node:assert/strict";

import { test } from "vitest";

import * as queryRoot from "@murphai/query";
import * as queryBrowser from "@murphai/query/browser";

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
