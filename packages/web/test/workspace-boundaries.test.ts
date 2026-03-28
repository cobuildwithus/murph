import assert from "node:assert/strict";

import { test } from "vitest";

type VerifyWorkspaceBoundaryHelpers = {
  isSiblingBuildArtifactPath: (
    configMember: string | null,
    targetMember: string | null,
    resolvedTarget: string,
  ) => boolean;
  isWorkspaceBuildArtifactPath: (filePath: string) => boolean;
  shouldSkipDirectory: (name: string) => boolean;
};

async function loadVerifyWorkspaceBoundaryHelpers(): Promise<VerifyWorkspaceBoundaryHelpers> {
  // @ts-expect-error The script under test is a repo-local .mjs entrypoint without emitted declarations.
  return (await import("../../../scripts/verify-workspace-boundaries.mjs")) as VerifyWorkspaceBoundaryHelpers;
}

test("workspace boundary helpers treat hosted Next artifact dirs as build outputs", async () => {
  const { isWorkspaceBuildArtifactPath } = await loadVerifyWorkspaceBoundaryHelpers();

  assert.equal(isWorkspaceBuildArtifactPath("/repo/apps/web/.next/server/app/page.js"), true);
  assert.equal(isWorkspaceBuildArtifactPath("/repo/apps/web/.next-dev/cache/manifest.json"), true);
  assert.equal(
    isWorkspaceBuildArtifactPath("/repo/apps/web/.next-smoke/server/app/page.js"),
    true,
  );
  assert.equal(isWorkspaceBuildArtifactPath("/repo/packages/core/src/index.ts"), false);
});

test("workspace boundary helpers reject sibling path mappings into hosted Next artifact dirs", async () => {
  const { isSiblingBuildArtifactPath } = await loadVerifyWorkspaceBoundaryHelpers();

  assert.equal(
    isSiblingBuildArtifactPath("packages/web", "apps/web", "/repo/apps/web/.next/server/app/page.js"),
    true,
  );
  assert.equal(
    isSiblingBuildArtifactPath(
      "packages/web",
      "apps/web",
      "/repo/apps/web/.next-dev/cache/manifest.json",
    ),
    true,
  );
  assert.equal(
    isSiblingBuildArtifactPath(
      "packages/web",
      "apps/web",
      "/repo/apps/web/.next-smoke/server/app/page.js",
    ),
    true,
  );
  assert.equal(
    isSiblingBuildArtifactPath("apps/web", "apps/web", "/repo/apps/web/.next-dev/cache"),
    false,
  );
});

test("workspace boundary directory skipping includes hosted Next artifact dirs", async () => {
  const { shouldSkipDirectory } = await loadVerifyWorkspaceBoundaryHelpers();

  assert.equal(shouldSkipDirectory(".next-dev"), true);
  assert.equal(shouldSkipDirectory(".next-smoke"), true);
  assert.equal(shouldSkipDirectory(".next"), true);
  assert.equal(shouldSkipDirectory("src"), false);
});
