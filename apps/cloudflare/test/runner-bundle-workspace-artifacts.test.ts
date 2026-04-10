import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { stageHostedRunnerRuntimeArtifact } from "../scripts/runner-bundle/workspace-artifacts.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("runner bundle runtime artifact staging", () => {
  it("preserves the runtime package dependency groups and adds the bundled murph shell", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "murph-runner-stage-"));
    const appDir = path.join(rootDir, "app");
    const bundleDir = path.join(rootDir, "bundle");

    temporaryDirectories.push(rootDir);
    await mkdir(path.join(appDir, "dist"), { recursive: true });
    await writeFile(path.join(appDir, "dist", "index.js"), "export const ok = true;\n");
    await writeFile(
      path.join(appDir, "package.json"),
      `${JSON.stringify(
        {
          dependencies: {
            "@murphai/runtime-state": "workspace:*",
            jose: "^6.2.2",
          },
          engines: {
            node: ">=24.14.1",
          },
          exports: {
            ".": {
              default: "./dist/index.js",
              types: "./dist/index.d.ts",
            },
          },
          license: "Apache-2.0",
          main: "./dist/index.js",
          name: "@murphai/cloudflare-runner",
          optionalDependencies: {
            "optional-external": "^1.0.0",
          },
          private: true,
          type: "module",
          version: "1.2.3",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await stageHostedRunnerRuntimeArtifact(bundleDir, { appDir });

    const stagedPackageJson = JSON.parse(
      await readFile(path.join(bundleDir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    expect(stagedPackageJson.dependencies).toEqual({
      "@murphai/runtime-state": "workspace:*",
      "@murphai/murph": "workspace:*",
      jose: "^6.2.2",
    });
    expect(stagedPackageJson.optionalDependencies).toEqual({
      "optional-external": "^1.0.0",
    });
    expect(await readFile(path.join(bundleDir, "dist", "index.js"), "utf8")).toBe(
      "export const ok = true;\n",
    );
  });
});
