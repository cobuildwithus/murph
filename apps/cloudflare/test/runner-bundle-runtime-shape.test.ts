import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
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
        bin: "./dist/bin.js",
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
  });
});
