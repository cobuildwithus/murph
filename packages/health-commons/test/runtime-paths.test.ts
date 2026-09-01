import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  generatedWebArtifactUrl,
  isSafeGeneratedWebArtifactPath,
  readGeneratedWebArtifact,
} from "../src/runtime-paths.ts";

describe("Health Commons generated web runtime paths", () => {
  it.each([
    "routes/index.json",
    "browse/goals.json",
    "bundles/goal_template/lower-resting-heart-rate.json",
    "pages/goals/caf%C3%A9.json",
  ])("accepts a normal generated artifact path: %s", (artifactPath) => {
    expect(isSafeGeneratedWebArtifactPath(artifactPath)).toBe(true);
  });

  it.each([
    "../outside.json",
    "%2e%2e/outside.json",
    "%252e%252e/outside.json",
    "routes/%2e%2e/outside.json",
    "routes%2findex.json",
    "routes%252findex.json",
    "routes%5cindex.json",
    "routes%255cindex.json",
    "routes/index.json?source=outside",
    "routes/index.json#outside",
    "routes/index.json%3fsource=outside",
    "routes/index.json%253fsource=outside",
    "routes/index.json%23outside",
    "routes/index.json%2523outside",
  ])("rejects an encoded or component-bearing artifact path: %s", (artifactPath) => {
    expect(isSafeGeneratedWebArtifactPath(artifactPath)).toBe(false);
    expect(() => generatedWebArtifactUrl(
      artifactPath,
      path.join(os.tmpdir(), "generated-web"),
    ))
      .toThrow("Unsafe Health Commons generated web artifact path");
  });

  it("normalizes valid artifact paths beneath the generated root", async () => {
    const generatedWebRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-runtime-paths-"),
    );
    try {
      expect(fileURLToPath(generatedWebArtifactUrl(
        "pages/goals/caf%C3%A9.json",
        generatedWebRoot,
      ))).toBe(path.join(generatedWebRoot, "pages/goals/café.json"));
    } finally {
      await rm(generatedWebRoot, { force: true, recursive: true });
    }
  });

  it("rejects query and hash components on generated-root URLs", async () => {
    const generatedWebRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-runtime-root-"),
    );
    try {
      for (const component of ["search", "hash"] as const) {
        const rootUrl = pathToFileURL(generatedWebRoot);
        rootUrl[component] = component === "search" ? "?outside" : "#outside";
        expect(() => generatedWebArtifactUrl("routes/index.json", rootUrl))
          .toThrow("without query or hash components");
      }
    } finally {
      await rm(generatedWebRoot, { force: true, recursive: true });
    }
  });

  it("reads normal artifacts and rejects symlink escapes outside the generated root", async () => {
    const generatedWebRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-runtime-root-"),
    );
    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-runtime-outside-"),
    );
    try {
      await mkdir(path.join(generatedWebRoot, "routes"), { recursive: true });
      await writeFile(
        path.join(generatedWebRoot, "routes/index.json"),
        "{\"inside\":true}\n",
        "utf8",
      );
      const outsideArtifactPath = path.join(outsideRoot, "outside.json");
      await writeFile(outsideArtifactPath, "{\"outside\":true}\n", "utf8");
      await symlink(
        outsideArtifactPath,
        path.join(generatedWebRoot, "routes/escape.json"),
      );

      expect(readGeneratedWebArtifact("routes/index.json", generatedWebRoot))
        .toBe("{\"inside\":true}\n");
      expect(() => readGeneratedWebArtifact("routes/escape.json", generatedWebRoot))
        .toThrow("outside its generated root");
    } finally {
      await Promise.all([
        rm(generatedWebRoot, { force: true, recursive: true }),
        rm(outsideRoot, { force: true, recursive: true }),
      ]);
    }
  });
});
