import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildAuditManifestPaths,
  getBlockedSourceBundleArtifactPath,
  parseScanSpec,
} from "../../../scripts/package-audit-context";

test("package-audit-context excludes blocked bundle residue while keeping useful visible files", () => {
  const manifest = buildAuditManifestPaths({
    visibleFiles: [
      "AGENTS.md",
      "apps/web/.env",
      "apps/web/.env.example",
      "apps/web/.next/types/routes.d.ts",
      "docs/device-sync-hosted-control-plane.md",
      "packages/core/.tsbuildinfo",
      "packages/core/dist/index.js",
      "packages/core/src/mutations.ts",
      "packages/query/.test-dist/index.js",
      "scripts/package-audit-context.ts",
      "e2e/smoke/verify-fixtures.ts",
    ],
    alwaysPaths: ["AGENTS.md"],
    scanSpecs: [
      parseScanSpec("packages"),
      parseScanSpec("scripts"),
      parseScanSpec("docs"),
      parseScanSpec("apps"),
    ],
    testScanSpecs: [parseScanSpec("e2e")],
    docScanSpecs: [parseScanSpec("agent-docs:*.md")],
    ciScanSpecs: [],
    includeTests: true,
    includeDocs: true,
    includeCi: false,
  });

  assert.deepEqual(manifest, [
    "AGENTS.md",
    "apps/web/.env.example",
    "docs/device-sync-hosted-control-plane.md",
    "e2e/smoke/verify-fixtures.ts",
    "packages/core/src/mutations.ts",
    "scripts/package-audit-context.ts",
  ]);
});

test("package-audit-context flags blocked source-bundle paths by file or ancestor directory", () => {
  assert.equal(getBlockedSourceBundleArtifactPath("apps/web/.env"), "apps/web/.env");
  assert.equal(
    getBlockedSourceBundleArtifactPath("packages/web/.next/types/routes.d.ts"),
    "packages/web/.next/",
  );
  assert.equal(
    getBlockedSourceBundleArtifactPath("packages/query/.test-dist/index.js"),
    "packages/query/.test-dist/",
  );
  assert.equal(getBlockedSourceBundleArtifactPath("apps/web/.env.example"), null);
  assert.equal(getBlockedSourceBundleArtifactPath("packages/core/src/mutations.ts"), null);
});
