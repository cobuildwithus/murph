import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildNextEnvDeclarationArtifact,
  isBlockedTrackedArtifactPath,
  isAllowedDeclarationArtifactContents,
  shouldSkipSourceArtifactDirectory,
} from "./check-no-js.ts";
import {
  generatedArtifactDirectories,
  pruneKnownGeneratedArtifactDirectory,
} from "./prune-generated-source-sidecars.ts";

describe("check-no-js hygiene guards", () => {
  it("skips generated deploy and smoke output directories during source scans", () => {
    expect(shouldSkipSourceArtifactDirectory(".deploy")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory(".wrangler")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory("dist")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory(".next-smoke")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory(".next-smoke-e2e-123")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory("src")).toBe(false);
  });

  it("treats ephemeral next smoke directories as blocked tracked artifacts", () => {
    expect(
      isBlockedTrackedArtifactPath("apps/web/.next-smoke/dev/static/chunks/runtime.js"),
    ).toBe(true);
    expect(
      isBlockedTrackedArtifactPath("apps/web/.next-smoke-e2e-123/dev/static/chunks/runtime.js"),
    ).toBe(true);
    expect(isBlockedTrackedArtifactPath("apps/web/src/runtime.ts")).toBe(false);
  });

  it("prunes Cloudflare dry-run artifact directories before source hygiene checks", () => {
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/.deploy");
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/dry-run");
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/smoke-dist");
  });

  it("keeps large git file-list scans on an explicit buffer", async () => {
    const [checkNoJsSource, pruneSource] = await Promise.all([
      readFile(new URL("./check-no-js.ts", import.meta.url), "utf8"),
      readFile(new URL("./prune-generated-source-sidecars.ts", import.meta.url), "utf8"),
    ]);

    for (const source of [checkNoJsSource, pruneSource]) {
      expect(source).toContain("const gitListMaxBuffer = 16 * 1024 * 1024;");
      expect(source).toMatch(/execFileAsync\("git",[\s\S]*?maxBuffer: gitListMaxBuffer,/u);
    }
  });

  it("refuses to prune through symlinked generated artifact parents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-prune-test-"));
    const outside = await mkdtemp(path.join(tmpdir(), "murph-prune-target-"));

    try {
      await mkdir(path.join(root, "apps/cloudflare"), { recursive: true });
      await mkdir(path.join(outside, "dry-run"), { recursive: true });
      await writeFile(path.join(outside, "dry-run/keep.txt"), "keep");
      await symlink(outside, path.join(root, "apps/cloudflare/.deploy"), "dir");

      await expect(
        pruneKnownGeneratedArtifactDirectory(root, "apps/cloudflare/.deploy/dry-run"),
      ).rejects.toThrow("symlinked parent");
      await expect(access(path.join(outside, "dry-run/keep.txt"))).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("allows generated next-env.d.ts variants for stable and suffixed Next output directories", () => {
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next/types/routes.d.ts"),
      ),
    ).toBe(true);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next-smoke/dev/types/routes.d.ts"),
      ),
    ).toBe(true);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next-smoke-e2e-run/dev/types/routes.d.ts"),
      ),
    ).toBe(true);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next-dev-e2e-run/types/routes.d.ts"),
      ),
    ).toBe(true);
  });

  it("rejects next-env.d.ts variants that point outside allowed Next output directories", () => {
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./src/types/routes.d.ts"),
      ),
    ).toBe(false);
    expect(
      isAllowedDeclarationArtifactContents(
        "apps/web/next-env.d.ts",
        buildNextEnvDeclarationArtifact("./.next-random/types/routes.d.ts"),
      ),
    ).toBe(false);
  });
});
