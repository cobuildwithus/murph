import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertPrunedRunnerDependenciesAreBundled } from "../scripts/runner-bundle/bundle-shared.js";
import {
  pruneBundledRunnerDependencies,
  rewriteRuntimeBinWrappers,
  rewriteRuntimePackageManifest,
} from "../scripts/runner-bundle/runtime-shape.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("post-bundle dependency pruning", () => {
  it("removes the installed Junction SDK without touching sibling packages", async () => {
    const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-runner-runtime-shape-"));
    const junctionPackageDir = path.join(
      bundleDir,
      "node_modules",
      "@junction-api",
      "sdk",
    );
    const siblingPackageJsonPath = path.join(
      bundleDir,
      "node_modules",
      "@junction-api",
      "retained",
      "package.json",
    );

    temporaryDirectories.push(bundleDir);
    await mkdir(junctionPackageDir, { recursive: true });
    await mkdir(path.dirname(siblingPackageJsonPath), { recursive: true });
    await writeFile(
      path.join(junctionPackageDir, "package.json"),
      JSON.stringify({ name: "@junction-api/sdk", version: "1.2.0" }),
      "utf8",
    );
    await writeFile(
      siblingPackageJsonPath,
      JSON.stringify({ name: "@junction-api/retained", version: "1.0.0" }),
      "utf8",
    );

    await pruneBundledRunnerDependencies(bundleDir);

    await expect(access(junctionPackageDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(siblingPackageJsonPath, "utf8")).resolves.toContain(
      "@junction-api/retained",
    );
  });

  it("rejects an emitted bundle that still resolves the pruned SDK", () => {
    expect(() =>
      assertPrunedRunnerDependenciesAreBundled([
        "./chunk.js",
        "node:fs",
      ]),
    ).not.toThrow();
    expect(() =>
      assertPrunedRunnerDependenciesAreBundled([
        "@junction-api/sdk/serialization",
      ]),
    ).toThrow(/leaves @junction-api\/sdk\/serialization unresolved/);
  });
});

describe("runner bundle runtime manifest rewriting", () => {
  it("keeps installed optional dependencies and drops missing ones from the final bundle manifest", async () => {
    const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-runner-runtime-shape-"));

    temporaryDirectories.push(bundleDir);
    await mkdir(path.join(bundleDir, "node_modules", "jose"), { recursive: true });
    await mkdir(path.join(bundleDir, "node_modules", "optional-installed"), {
      recursive: true,
    });
    await writeFile(
      path.join(bundleDir, "node_modules", "jose", "package.json"),
      JSON.stringify({ name: "jose", version: "6.2.2" }),
      "utf8",
    );
    await writeFile(
      path.join(bundleDir, "node_modules", "optional-installed", "package.json"),
      JSON.stringify({ name: "optional-installed", version: "1.4.0" }),
      "utf8",
    );
    await writeFile(
      path.join(bundleDir, "package.json"),
      `${JSON.stringify(
        {
          dependencies: {
            jose: "^6.0.0",
          },
          exports: {
            ".": {
              default: "./dist/index.js",
              types: "./dist/index.d.ts",
            },
          },
          name: "@murphai/cloudflare-runner",
          optionalDependencies: {
            "optional-installed": "^1.0.0",
            "optional-missing": "^2.0.0",
          },
          version: "1.2.3",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await rewriteRuntimePackageManifest(bundleDir);

    const rewrittenPackageJson = JSON.parse(
      await readFile(path.join(bundleDir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
      optionalDependencies?: Record<string, string>;
    };

    expect(rewrittenPackageJson.dependencies).toEqual({
      jose: "6.2.2",
    });
    expect(rewrittenPackageJson.optionalDependencies).toEqual({
      "optional-installed": "1.4.0",
    });
    expect(rewrittenPackageJson.exports).toEqual({
      ".": {
        default: "./dist/index.js",
      },
    });
  });

  it("rebuilds package bin wrappers even when the bundle has no preexisting .bin directory", async () => {
    const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-runner-runtime-shape-"));

    temporaryDirectories.push(bundleDir);
    await mkdir(
      path.join(bundleDir, "node_modules", "@murphai", "murph", "dist"),
      { recursive: true },
    );
    await writeFile(
      path.join(bundleDir, "node_modules", "@murphai", "murph", "package.json"),
      JSON.stringify({
        bin: {
          murph: "./dist/bin.js",
          "vault-cli": "./dist/bin.js",
        },
        name: "@murphai/murph",
      }),
      "utf8",
    );
    await writeFile(
      path.join(bundleDir, "node_modules", "@murphai", "murph", "dist", "bin.js"),
      "console.log('ok');\n",
      "utf8",
    );

    await rewriteRuntimeBinWrappers(bundleDir);

    expect(
      await readFile(path.join(bundleDir, "node_modules", ".bin", "murph"), "utf8"),
    ).toContain("../@murphai/murph/dist/bin.js");
    expect(
      await readFile(path.join(bundleDir, "node_modules", ".bin", "vault-cli"), "utf8"),
    ).toContain("../@murphai/murph/dist/bin.js");
  });

  it("replaces existing pnpm bin symlinks with portable wrappers", async () => {
    const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-runner-runtime-shape-"));
    const binPath = path.join(bundleDir, "node_modules", ".bin", "vault-cli");

    temporaryDirectories.push(bundleDir);
    await mkdir(
      path.join(bundleDir, "node_modules", "@murphai", "murph", "dist"),
      { recursive: true },
    );
    await mkdir(path.dirname(binPath), { recursive: true });
    await writeFile(
      path.join(bundleDir, "node_modules", "@murphai", "murph", "package.json"),
      JSON.stringify({
        bin: {
          "vault-cli": "./dist/bin.js",
        },
        name: "@murphai/murph",
      }),
      "utf8",
    );
    await writeFile(
      path.join(bundleDir, "node_modules", "@murphai", "murph", "dist", "bin.js"),
      "console.log('ok');\n",
      "utf8",
    );
    await symlink("/host/path/that/must/not-survive", binPath);

    await rewriteRuntimeBinWrappers(bundleDir);

    expect((await lstat(binPath)).isSymbolicLink()).toBe(false);
    expect(await readFile(binPath, "utf8")).toContain(
      "../@murphai/murph/dist/bin.js",
    );
  });
});
