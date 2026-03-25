import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "vitest";

import {
  allowedDeclarationArtifacts,
  getBlockedWorkingTreeArtifactPath,
  isAllowedDeclarationArtifactContents,
  isBlockedTrackedArtifactPath,
  isBlockedTrackedEnvArtifactPath,
} from "../../../scripts/check-no-js";

test("check-no-js allowlists the current Next.js declaration stub exactly", async () => {
  const nextEnvContents = await readFile("packages/web/next-env.d.ts", "utf8");
  const allowedVariants = allowedDeclarationArtifacts.get("packages/web/next-env.d.ts");

  assert.equal(Array.isArray(allowedVariants), true);
  assert.equal(allowedVariants?.includes(nextEnvContents), true);
  assert.equal(
    isAllowedDeclarationArtifactContents("packages/web/next-env.d.ts", nextEnvContents),
    true,
  );
});

test("check-no-js rejects modified declaration stubs", () => {
  assert.equal(
    isAllowedDeclarationArtifactContents(
      "packages/web/next-env.d.ts",
      '/// <reference types="next" />\n',
    ),
    false,
  );
});

test("check-no-js rejects tracked local env files while allowlisting tracked examples", () => {
  assert.equal(isBlockedTrackedEnvArtifactPath(".env"), true);
  assert.equal(isBlockedTrackedEnvArtifactPath("apps/web/.env"), true);
  assert.equal(isBlockedTrackedEnvArtifactPath("packages/web/.env.local"), true);
  assert.equal(isBlockedTrackedEnvArtifactPath("apps/web/.env.example"), false);
  assert.equal(isBlockedTrackedEnvArtifactPath("packages/web/.env.local.example"), false);
  assert.equal(isBlockedTrackedEnvArtifactPath(".envrc"), false);
});

test("check-no-js flags tracked generated/private artifact paths", () => {
  assert.equal(isBlockedTrackedArtifactPath(".env"), true);
  assert.equal(isBlockedTrackedArtifactPath("apps/web/.env.example"), false);
  assert.equal(isBlockedTrackedArtifactPath("apps/web/.next"), true);
  assert.equal(isBlockedTrackedArtifactPath("packages/web/.next/server/app.js"), true);
  assert.equal(isBlockedTrackedArtifactPath(".next/cache/tsconfig.tsbuildinfo"), true);
  assert.equal(isBlockedTrackedArtifactPath("packages/core/dist/index.js"), true);
  assert.equal(isBlockedTrackedArtifactPath("packages/core/.test-dist/index.js"), true);
  assert.equal(isBlockedTrackedArtifactPath("packages/web/next-env.d.ts"), false);
});

test("check-no-js flags bundle-only working-tree private/build artifacts", () => {
  assert.equal(getBlockedWorkingTreeArtifactPath("apps/web/.env", "file"), "apps/web/.env");
  assert.equal(
    getBlockedWorkingTreeArtifactPath("packages/web/app.tsbuildinfo", "file"),
    "packages/web/app.tsbuildinfo",
  );
  assert.equal(getBlockedWorkingTreeArtifactPath("apps/web/.env.example", "file"), null);
  assert.equal(getBlockedWorkingTreeArtifactPath("apps/web/.next", "directory"), "apps/web/.next/");
  assert.equal(
    getBlockedWorkingTreeArtifactPath("packages/core/.test-dist", "directory"),
    "packages/core/.test-dist/",
  );
  assert.equal(getBlockedWorkingTreeArtifactPath("apps/web/src", "directory"), null);
});
