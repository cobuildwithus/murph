import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import {
  dmSans400FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
  logoSvgPath,
  ogAssetCandidatePaths,
} from "../app/font-files";

// These tests intentionally use the real filesystem: the production bug this
// guards against was OG routes 500ing with ENOENT because the bundled asset
// paths pointed at the build machine's directory layout. A mocked fs cannot
// catch that class of failure.

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");

test("resolved OG asset paths point at real files", () => {
  for (const assetPath of [
    fraunces400FontPath,
    fraunces600FontPath,
    dmSans400FontPath,
    logoSvgPath,
  ]) {
    expect(existsSync(assetPath), `expected ${assetPath} to exist`).toBe(true);
  }
});

test("candidate resolution covers the apps/web and repo-root runtime layouts", () => {
  for (const relativePath of [
    "app/fonts/Fraunces-400.ttf",
    "app/fonts/Fraunces-600.ttf",
    "app/fonts/DMSans-400.ttf",
    "public/logo.svg",
  ]) {
    // Local dev, tests, and `next build` run with cwd at apps/web; the
    // deployed serverless function runs with a repo-root-shaped filesystem.
    const fromAppDir = ogAssetCandidatePaths(relativePath, appRoot);
    const fromRepoRoot = ogAssetCandidatePaths(relativePath, repoRoot);

    expect(fromRepoRoot).toContain(path.join(repoRoot, "apps/web", relativePath));
    expect(
      fromAppDir.some((candidate) => existsSync(candidate)),
      `expected a real file among ${fromAppDir.join(", ")}`,
    ).toBe(true);
    expect(
      fromRepoRoot.some((candidate) => existsSync(candidate)),
      `expected a real file among ${fromRepoRoot.join(", ")}`,
    ).toBe(true);
  }
});
