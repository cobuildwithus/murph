import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import {
  dmSans400FontPath,
  dmSans600FontPath,
  fraunces400FontPath,
  fraunces600FontPath,
  logoSvgPath,
  murphMarkSvgPath,
  ogAssetCandidatePaths,
} from "../app/font-files";

// These tests intentionally use the real filesystem: the failure they guard
// against is OG routes 500ing with ENOENT because an asset path does not exist
// where the code looks for it, and a mocked fs asserts only that some string
// was passed to readFile. They cover path construction against the real repo
// layout; `scripts/check-og-emitted-runtime.ts` covers the emitted bundle in
// the deployed layout, which is the boundary that actually failed.

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");

test("resolved OG asset paths point at real files", () => {
  for (const assetPath of [
    fraunces400FontPath,
    fraunces600FontPath,
    dmSans400FontPath,
    dmSans600FontPath,
    logoSvgPath,
    murphMarkSvgPath,
  ]) {
    expect(existsSync(assetPath), `expected ${assetPath} to exist`).toBe(true);
  }
});

test("candidate resolution covers the apps/web and repo-root runtime layouts", () => {
  for (const relativePath of [
    "app/fonts/Fraunces-400.ttf",
    "app/fonts/Fraunces-600.ttf",
    "app/fonts/DMSans-400.ttf",
    "app/fonts/DMSans-600.ttf",
    "public/logo.svg",
    "public/icons/murph-mark.svg",
  ]) {
    // Local dev, tests, and `next build` run with cwd at apps/web; the
    // deployed serverless function runs with a repo-root-shaped filesystem.
    const fromAppDir = ogAssetCandidatePaths(relativePath, appRoot);
    const fromRepoRoot = ogAssetCandidatePaths(relativePath, repoRoot);

    expect(fromRepoRoot[0]).toBe(path.join(repoRoot, "apps/web", relativePath));
    expect(fromAppDir[1]).toBe(path.join(appRoot, relativePath));
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
