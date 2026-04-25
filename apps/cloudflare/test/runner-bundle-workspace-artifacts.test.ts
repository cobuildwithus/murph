import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildHostedRunnerWorkspaceBuildArgs,
  buildWorkspacePackagePackPreflightArgs,
  mapWithConcurrency,
  packWorkspacePackageArtifacts,
  stageHostedRunnerRuntimeArtifact,
} from "../scripts/runner-bundle/workspace-artifacts.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const temporaryDirectories: string[] = [];
const finnishDrySaunaProtocolKey = "protocol_variant:dry-sauna/murph-finnish-standard-3x-week";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("runner bundle runtime artifact staging", () => {
  it("builds the workspace closure through pnpm's bounded parallel workspace runner", () => {
    expect(
      buildHostedRunnerWorkspaceBuildArgs(
        ["@murphai/contracts", "@murphai/runtime-state"],
        { MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY: "6" },
      ),
    ).toEqual([
      "--workspace-concurrency=6",
      "--filter",
      "@murphai/contracts",
      "--filter",
      "@murphai/runtime-state",
      "run",
      "build",
    ]);
  });

  it("rejects invalid runner bundle build concurrency", () => {
    expect(() =>
      buildHostedRunnerWorkspaceBuildArgs(["@murphai/contracts"], {
        MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY: "0",
      }),
    ).toThrow("MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY must be a positive integer.");
  });

  it("generates Health Commons before scriptless runner package packing", () => {
    expect(buildWorkspacePackagePackPreflightArgs("@murphai/health-commons")).toEqual([
      "health-commons:generate",
    ]);
    expect(buildWorkspacePackagePackPreflightArgs("@murphai/runtime-state")).toBeNull();
  });

  it("waits for active bounded-concurrency work before rethrowing the first failure", async () => {
    const events: string[] = [];

    await expect(
      mapWithConcurrency(["slow", "fail", "blocked"], 2, async (item) => {
        events.push(`start:${item}`);

        if (item === "slow") {
          await new Promise((resolve) => setTimeout(resolve, 10));
          events.push(`finish:${item}`);
          return item;
        }

        if (item === "fail") {
          events.push(`fail:${item}`);
          throw new Error("pack failed");
        }

        events.push(`finish:${item}`);
        return item;
      }),
    ).rejects.toThrow("pack failed");

    expect(events).toEqual([
      "start:slow",
      "start:fail",
      "fail:fail",
      "finish:slow",
    ]);
  });

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

  it("can stage the runtime artifact without bundle-only workspace dependencies", async () => {
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
          name: "@murphai/cloudflare-runner",
          version: "1.2.3",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await stageHostedRunnerRuntimeArtifact(bundleDir, {
      appDir,
      bundleOnlyDependencyNames: [],
    });

    const stagedPackageJson = JSON.parse(
      await readFile(path.join(bundleDir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };

    expect(stagedPackageJson.dependencies).toEqual({
      "@murphai/runtime-state": "workspace:*",
      jose: "^6.2.2",
    });
  });

  it("packs the Health Commons runtime and generated catalog for hosted runner installs", async () => {
    const tarballsDir = await mkdtemp(path.join(tmpdir(), "murph-runner-pack-"));

    temporaryDirectories.push(tarballsDir);

    const tarballs = await packWorkspacePackageArtifacts(
      ["@murphai/health-commons"],
      tarballsDir,
      { repoRoot },
    );
    const healthCommonsTarball = tarballs.get("@murphai/health-commons");

    if (!healthCommonsTarball) {
      throw new Error("Health Commons tarball was not packed.");
    }

    const { stdout } = await execFileAsync(
      "tar",
      ["-tzf", healthCommonsTarball],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    const entries = stdout.split("\n");

    expect(entries).toContain("package/dist/index.js");
    expect(entries).toContain("package/dist/runtime.js");
    expect(entries).toContain("package/generated/catalog.json");
    expect(entries).toContain("package/package.json");

    const { stdout: catalogRaw } = await execFileAsync(
      "tar",
      ["-xOf", healthCommonsTarball, "package/generated/catalog.json"],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const catalog: unknown = JSON.parse(catalogRaw);

    expect(findCatalogEntity(catalog, finnishDrySaunaProtocolKey)).toMatchObject({
      entityType: "protocol_variant",
      key: finnishDrySaunaProtocolKey,
      slug: "protocols/dry-sauna/murph-finnish-standard-3x-week",
      title: "Finnish Dry Sauna",
    });
  });
});

function findCatalogEntity(catalog: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(catalog) || !Array.isArray(catalog.entities)) {
    return null;
  }

  return catalog.entities.find((entity) =>
    isRecord(entity) &&
      entity.key === key
  ) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
