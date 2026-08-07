import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
  it("removes unused Zod variants while retaining the live root and v4 runtimes", async () => {
    const bundleDir = await mkdtemp(
      path.join(tmpdir(), "murph-runner-runtime-shape-"),
    );
    const zodPackageDir = path.join(bundleDir, "node_modules", "zod");
    const siblingSourcePath = path.join(
      bundleDir,
      "node_modules",
      "another-package",
      "src",
      "index.js",
    );

    temporaryDirectories.push(bundleDir);
    const retainedZodPaths = [
      path.join(zodPackageDir, "index.js"),
      path.join(zodPackageDir, "v4", "classic", "index.js"),
      path.join(zodPackageDir, "v4", "core", "index.js"),
      path.join(zodPackageDir, "v4", "locales", "en.js"),
    ];
    const removedZodPaths = [
      path.join(zodPackageDir, "src", "index.ts"),
      path.join(zodPackageDir, "v3", "index.js"),
      path.join(zodPackageDir, "mini", "index.js"),
      path.join(zodPackageDir, "v4-mini", "index.js"),
      path.join(zodPackageDir, "v4", "mini", "index.js"),
    ];

    await Promise.all(
      [...retainedZodPaths, ...removedZodPaths].map(async (filePath) => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, "export const retained = true\n", "utf8");
      }),
    );
    await mkdir(path.dirname(siblingSourcePath), { recursive: true });
    await mkdir(path.join(bundleDir, "dist"), { recursive: true });
    await writeFile(
      path.join(zodPackageDir, "package.json"),
      JSON.stringify({ name: "zod", version: "4.4.3" }),
      "utf8",
    );
    await writeFile(siblingSourcePath, "retained when required\n", "utf8");
    const zodPackageName = ["zo", "d"].join("");
    await writeFile(
      path.join(bundleDir, "dist", "consumer.js"),
      [
        `import "${zodPackageName}"`,
        `import "${zodPackageName}/v4"`,
        `import "${zodPackageName}/v4/core"`,
        "",
      ].join("\n"),
      "utf8",
    );

    await pruneBundledRunnerDependencies(bundleDir);

    await expect(access(zodPackageDir)).resolves.toBeUndefined();
    for (const retainedPath of retainedZodPaths) {
      await expect(access(retainedPath)).resolves.toBeUndefined();
    }
    for (const removedPath of removedZodPaths) {
      await expect(access(removedPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(readFile(siblingSourcePath, "utf8")).resolves.toBe(
      "retained when required\n",
    );
  });

  it("rejects imports of a Zod surface selected for removal", async () => {
    const bundleDir = await mkdtemp(
      path.join(tmpdir(), "murph-runner-runtime-shape-"),
    );

    temporaryDirectories.push(bundleDir);
    await mkdir(path.join(bundleDir, "node_modules", "zod", "v3"), {
      recursive: true,
    });
    await mkdir(path.join(bundleDir, "dist"), { recursive: true });
    const zodPackageName = ["zo", "d"].join("");
    await writeFile(
      path.join(bundleDir, "dist", "consumer.js"),
      `import "${zodPackageName}/v3"\n`,
      "utf8",
    );

    await expect(
      pruneBundledRunnerDependencies(bundleDir),
    ).rejects.toThrow(/imports zod\/v3/);
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
