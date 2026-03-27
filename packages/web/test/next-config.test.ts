import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import {
  WORKSPACE_SOURCE_PACKAGE_NAMES,
  resolveWorkspaceSourceEntries,
} from "../next.config";
import nextConfig from "../next.config";

test("resolveWorkspaceSourceEntries points at source package entries", () => {
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/packages/web")["@murph/query"],
    path.resolve("/repo/packages/query/src/index.ts"),
  );
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/packages/web")["@murph/contracts"],
    path.resolve("/repo/packages/contracts/src/index.ts"),
  );
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/packages/web")["@murph/hosted-execution"],
    path.resolve("/repo/packages/hosted-execution/src/index.ts"),
  );
});

test("next.config transpiles workspace source packages instead of pinning dist aliases", () => {
  assert.deepEqual(nextConfig.transpilePackages, [...WORKSPACE_SOURCE_PACKAGE_NAMES]);
});

test("next.config keeps Turbopack focused on the repo root without custom workspace rewrite rules", () => {
  assert.deepEqual(nextConfig.turbopack, {
    root: process.cwd(),
  });
});
