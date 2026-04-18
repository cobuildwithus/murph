import { describe, expect, it } from "vitest";

import {
  isBlockedTrackedArtifactPath,
  shouldSkipSourceArtifactDirectory,
} from "./check-no-js.ts";
import { generatedArtifactDirectories } from "./prune-generated-source-sidecars.ts";

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
});
