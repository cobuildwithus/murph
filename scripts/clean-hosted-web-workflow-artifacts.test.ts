import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cleanHostedWebWorkflowGeneratedArtifacts,
  HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR,
  HOSTED_WEB_WORKFLOW_GENERATED_CACHE_PATHS,
  HOSTED_WEB_WORKFLOW_GENERATED_CONFIG_PATH,
  HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME,
} from "./clean-hosted-web-workflow-artifacts.js";

describe("cleanHostedWebWorkflowGeneratedArtifacts", () => {
  it("removes ignored generated Workflow source, cache, socket, and source-map artifacts", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-workflow-clean-"));
    const artifactDir = path.join(tempRoot, HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR);
    const generatedFile = path.join(
      artifactDir,
      "v1",
      "step",
      "__workflow_step_files__",
      "step.ts",
    );
    const markerMap = path.join(
      tempRoot,
      "apps/web/.next/server/chunks/workflow-step.js.map",
    );
    const unrelatedMap = path.join(
      tempRoot,
      "apps/web/.next/server/chunks/unrelated.js.map",
    );

    try {
      await mkdir(path.dirname(generatedFile), { recursive: true });
      await writeFile(generatedFile, "// WORKFLOW_STEP_SOURCE_B64:example\n", "utf8");
      for (const relativePath of HOSTED_WEB_WORKFLOW_GENERATED_CACHE_PATHS) {
        const cachePath = path.join(tempRoot, relativePath);
        if (relativePath.endsWith("workflow-generated-manifest")) {
          await mkdir(cachePath, { recursive: true });
          await writeFile(path.join(cachePath, "manifest.json"), "{}", "utf8");
          continue;
        }

        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, "{}", "utf8");
      }
      await mkdir(path.dirname(markerMap), { recursive: true });
      await writeFile(markerMap, '{"sources":["__workflow_step_files__/step.ts"]}', "utf8");
      await writeFile(unrelatedMap, '{"sources":["src/index.ts"]}', "utf8");

      const removedPaths = await cleanHostedWebWorkflowGeneratedArtifacts({
        repoRoot: tempRoot,
      });

      expect(removedPaths).toEqual([
        HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR,
        ...HOSTED_WEB_WORKFLOW_GENERATED_CACHE_PATHS,
        "apps/web/.next/server/chunks/workflow-step.js.map",
      ].sort());
      await expect(readFile(generatedFile, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(markerMap, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(unrelatedMap, "utf8")).resolves.toContain("src/index.ts");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("captures the exact SDK config before removing generated Workflow source", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "hosted-web-workflow-prebuilt-source-"),
    );
    const captureRoot = await mkdtemp(
      path.join(os.tmpdir(), "hosted-web-workflow-prebuilt-capture-"),
    );
    const generatedConfigPath = path.join(
      tempRoot,
      HOSTED_WEB_WORKFLOW_GENERATED_CONFIG_PATH,
    );
    const capturePath = path.join(
      captureRoot,
      HOSTED_WEB_WORKFLOW_PREBUILT_CONFIG_CAPTURE_FILE_NAME,
    );
    const generatedConfig = `${JSON.stringify({
      steps: { experimentalTriggers: [{ type: "queue/v2beta" }] },
      version: "0",
      workflows: { experimentalTriggers: [{ type: "queue/v2beta" }] },
    }, null, 2)}\n`;

    try {
      await mkdir(path.dirname(generatedConfigPath), { recursive: true });
      await writeFile(generatedConfigPath, generatedConfig, "utf8");

      const removedPaths = await cleanHostedWebWorkflowGeneratedArtifacts({
        prebuiltConfigCapturePath: capturePath,
        repoRoot: tempRoot,
      });

      expect(removedPaths).toContain(HOSTED_WEB_WORKFLOW_GENERATED_ARTIFACT_DIR);
      await expect(readFile(capturePath, "utf8")).resolves.toBe(generatedConfig);
      await expect(readFile(generatedConfigPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      await rm(captureRoot, { force: true, recursive: true });
    }
  });
});
