import { describe, expect, it } from "vitest";

import { shouldSkipSourceArtifactDirectory } from "./check-no-js.ts";
import { generatedArtifactDirectories } from "./prune-generated-source-sidecars.ts";

describe("check-no-js hygiene guards", () => {
  it("skips generated deploy output directories during source scans", () => {
    expect(shouldSkipSourceArtifactDirectory(".deploy")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory(".wrangler")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory("dist")).toBe(true);
    expect(shouldSkipSourceArtifactDirectory("src")).toBe(false);
  });

  it("prunes Cloudflare dry-run artifact directories before source hygiene checks", () => {
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/.deploy");
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/dry-run");
    expect(generatedArtifactDirectories).toContain("apps/cloudflare/.deploy/smoke-dist");
  });
});
