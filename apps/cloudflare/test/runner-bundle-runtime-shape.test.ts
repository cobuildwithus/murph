import { execFileSync } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  pruneBundledRunnerDependencies,
  pruneRunnerBundle,
  rewriteRuntimeBinWrappers,
  rewriteRuntimePackageManifest,
} from "../scripts/runner-bundle/runtime-shape.js";

import { materializeFinalRunnerBundle } from "../scripts/runner-bundle/final-bundle.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("post-bundle dependency pruning", () => {
  it("removes unused Zod variants while retaining the live root, v3, and v4 runtimes", async () => {
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
      path.join(zodPackageDir, "v3", "index.js"),
      path.join(zodPackageDir, "v4", "classic", "index.js"),
      path.join(zodPackageDir, "v4", "core", "index.js"),
      path.join(zodPackageDir, "v4", "locales", "en.js"),
    ];
    const removedZodPaths = [
      path.join(zodPackageDir, "src", "index.ts"),
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
        `import "${zodPackageName}/v3"`,
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
    await mkdir(path.join(bundleDir, "node_modules", "zod", "mini"), {
      recursive: true,
    });
    await mkdir(path.join(bundleDir, "dist"), { recursive: true });
    const zodPackageName = ["zo", "d"].join("");
    await writeFile(
      path.join(bundleDir, "dist", "consumer.js"),
      `import "${zodPackageName}/mini"\n`,
      "utf8",
    );

    await expect(
      pruneBundledRunnerDependencies(bundleDir),
    ).rejects.toThrow(/imports zod\/mini/);
  });
});

describe("runner bundle publication", () => {
  it("publishes a relocatable runtime, replaces it, and preserves it after failed preparation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-runner-publication-"));
    temporaryDirectories.push(root);
    const final = path.join(root, "published", "runner-bundle");
    const cliRelative = "node_modules/@murphai/murph";
    const removed = [
      "README.md", "DEPLOY.md", "LICENSE", "pnpm-lock.yaml",
      "node_modules/.pnpm-workspace-state-v1.json", "node_modules/.modules.yaml",
      `${cliRelative}/dist/bin.d.ts`, `${cliRelative}/dist/bin.js.map`,
      `${cliRelative}/dist/build.tsbuildinfo`,
    ];

    for (const version of ["1.0.0", "2.0.0"]) {
      const staging = path.join(root, `staging-${version}`);
      const files: Record<string, string> = {
        "package.json": JSON.stringify({
          name: "@murphai/cloudflare-runner", version, type: "module",
          dependencies: { "@murphai/murph": "workspace:*" },
          optionalDependencies: { "optional-installed": "^1", "optional-missing": "^1" },
          exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
          scripts: { build: "must-not-ship" },
          devDependencies: { "build-only": "1.0.0" },
        }),
        [`${cliRelative}/package.json`]: JSON.stringify({
          name: "@murphai/murph", version, type: "module",
          bin: { murph: "./dist/bin.js", "vault-cli": "./dist/bin.js" },
        }),
        [`${cliRelative}/dist/bin.js`]:
          'import { readFileSync } from "node:fs";\n' +
          'console.log(readFileSync(new URL("../data/value.txt", import.meta.url), "utf8") + ":" + process.argv[2]);\n',
        [`${cliRelative}/data/value.txt`]: version,
        "node_modules/optional-installed/package.json": JSON.stringify({
          name: "optional-installed", version: "1.4.0",
        }),
        ...Object.fromEntries(removed.map((name) => [name, "build metadata"])),
      };
      for (const [name, content] of Object.entries(files)) {
        const target = path.join(staging, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      // Exercise both absent .bin creation and replacement of a stale pnpm link.
      if (version === "2.0.0") {
        await mkdir(path.join(staging, "node_modules/.bin"));
        await symlink("/nonexistent/stale-cli", path.join(staging, "node_modules/.bin/vault-cli"));
      }

      await pruneRunnerBundle(staging);
      await rewriteRuntimePackageManifest(staging);
      await rewriteRuntimeBinWrappers(staging);
      await pruneBundledRunnerDependencies(staging);
      await materializeFinalRunnerBundle(staging, final);

      const manifest = JSON.parse(await readFile(path.join(final, "package.json"), "utf8"));
      expect(manifest).toMatchObject({
        dependencies: { "@murphai/murph": version },
        optionalDependencies: { "optional-installed": "1.4.0" },
        exports: { ".": { default: "./dist/index.js" } },
      });
      expect(manifest.optionalDependencies).not.toHaveProperty("optional-missing");
      expect(manifest).not.toHaveProperty("scripts");
      expect(manifest).not.toHaveProperty("devDependencies");
      for (const name of removed) {
        await expect(access(path.join(final, name))).rejects.toMatchObject({ code: "ENOENT" });
      }
      for (const command of ["murph", "vault-cli"]) {
        const executable = path.join(final, "node_modules/.bin", command);
        expect((await lstat(executable)).isSymbolicLink()).toBe(false);
        expect(execFileSync(executable, ["roundtrip"], { cwd: root, encoding: "utf8" }).trim())
          .toBe(`${version}:roundtrip`);
      }
      await expect(access(staging)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(`${final}.previous`)).rejects.toMatchObject({ code: "ENOENT" });
    }

    await expect(materializeFinalRunnerBundle(path.join(root, "missing"), final))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(execFileSync(path.join(final, "node_modules/.bin/vault-cli"), ["recovered"], {
      cwd: root, encoding: "utf8",
    }).trim()).toBe("2.0.0:recovered");
  });
});
