import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import { runSafeBuild } from "../scripts/safe-build.ts";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "..", "..");

test("package manifest exposes the sample-series summary subpath used by query", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    scripts?: Record<string, string | undefined>;
    exports?: Record<string, { default?: string; import?: string; types?: string } | undefined>;
  };

  assert.deepEqual(packageManifest.exports?.["./sample-series-summary"], {
    types: "./dist/sample-series-summary.d.ts",
    import: "./dist/sample-series-summary.js",
    default: "./dist/sample-series-summary.js",
  });
});

test("build script preserves the last good dist until TypeScript succeeds", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    scripts?: Record<string, string | undefined>;
  };

  const buildScript = packageManifest.scripts?.build ?? "";
  assert.match(buildScript, /scripts\/safe-build\.ts\b/u);
  assert.doesNotMatch(buildScript, /rm-paths\.mjs\s+dist\b/u);
});

test("workspace clean build preserves importers dist until the safe build refreshes it", () => {
  const cleanTargets = execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "clean-build-artifacts.mjs"), "workspace", "--print"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  const rootPackageManifest = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as {
    scripts?: Record<string, string | undefined>;
  };
  const importersTsConfig = JSON.parse(
    readFileSync(path.join(packageDir, "tsconfig.json"), "utf8"),
  ) as {
    compilerOptions?: {
      outDir?: string;
      tsBuildInfoFile?: string;
    };
  };

  assert.doesNotMatch(cleanTargets, /^packages\/importers\/dist$/mu);
  assert.match(cleanTargets, /^packages\/importers\/\.tsbuildinfo$/mu);
  assert.match(cleanTargets, /^packages\/importers\/\.dist-next$/mu);
  for (const scriptName of ["build:workspace:clean", "build:workspace:incremental", "build:test-runtime"]) {
    assert.match(
      rootPackageManifest.scripts?.[scriptName] ?? "",
      /&& pnpm --dir packages\/importers build$/u,
    );
  }
  assert.equal(importersTsConfig.compilerOptions?.outDir, "./.dist-next");
  assert.equal(importersTsConfig.compilerOptions?.tsBuildInfoFile, "./.dist-next/.tsbuildinfo");
});

test("safe build publishes temp dist only after TypeScript succeeds", () => {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-build-"));
  try {
    mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    writeFileSync(path.join(packageRoot, "dist", "index.js"), "old");
    writeFileSync(path.join(packageRoot, "dist", "stale.js"), "stale");
    writeFileSync(path.join(packageRoot, "tsconfig.json"), "{}");

    const status = runSafeBuild({
      packageRoot,
      runBuildCommand: ({ tempDistPath }) => {
        mkdirSync(path.join(tempDistPath, "nested"), { recursive: true });
        writeFileSync(path.join(tempDistPath, "index.js"), "new");
        writeFileSync(path.join(tempDistPath, "nested", "entry.js"), "nested");
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.equal(readFileSync(path.join(packageRoot, "dist", "index.js"), "utf8"), "new");
    assert.equal(
      readFileSync(path.join(packageRoot, "dist", "nested", "entry.js"), "utf8"),
      "nested",
    );
    assert.equal(existsSync(path.join(packageRoot, "dist", "stale.js")), false);
    assert.equal(existsSync(path.join(packageRoot, ".dist-next")), false);
    assert.equal(existsSync(path.join(packageRoot, ".tsconfig.build-next.json")), false);
  } finally {
    rmSync(packageRoot, { force: true, recursive: true });
  }
});

test("safe build replaces stale dist symlink directories without following them", () => {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-build-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-outside-"));
  try {
    mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    writeFileSync(path.join(outsideRoot, "keep.js"), "outside");
    symlinkSync(outsideRoot, path.join(packageRoot, "dist", "nested"), "dir");
    writeFileSync(path.join(packageRoot, "tsconfig.json"), "{}");

    const status = runSafeBuild({
      packageRoot,
      runBuildCommand: ({ tempDistPath }) => {
        mkdirSync(path.join(tempDistPath, "nested"), { recursive: true });
        writeFileSync(path.join(tempDistPath, "nested", "entry.js"), "nested");
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.equal(readFileSync(path.join(outsideRoot, "keep.js"), "utf8"), "outside");
    assert.equal(existsSync(path.join(outsideRoot, "entry.js")), false);
    assert.equal(
      readFileSync(path.join(packageRoot, "dist", "nested", "entry.js"), "utf8"),
      "nested",
    );
  } finally {
    rmSync(packageRoot, { force: true, recursive: true });
    rmSync(outsideRoot, { force: true, recursive: true });
  }
});

test("safe build replaces matching stale dist file symlinks without following them", () => {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-build-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-outside-"));
  try {
    mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    writeFileSync(path.join(outsideRoot, "keep.js"), "outside");
    symlinkSync(path.join(outsideRoot, "keep.js"), path.join(packageRoot, "dist", "index.js"));
    writeFileSync(path.join(packageRoot, "tsconfig.json"), "{}");

    const status = runSafeBuild({
      packageRoot,
      runBuildCommand: ({ tempDistPath }) => {
        mkdirSync(tempDistPath, { recursive: true });
        writeFileSync(path.join(tempDistPath, "index.js"), "new");
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.equal(readFileSync(path.join(outsideRoot, "keep.js"), "utf8"), "outside");
    assert.equal(lstatSync(path.join(packageRoot, "dist", "index.js")).isSymbolicLink(), false);
    assert.equal(readFileSync(path.join(packageRoot, "dist", "index.js"), "utf8"), "new");
  } finally {
    rmSync(packageRoot, { force: true, recursive: true });
    rmSync(outsideRoot, { force: true, recursive: true });
  }
});

test("safe build does not write through stale dist temp symlinks", () => {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-build-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-outside-"));
  try {
    mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    const outsideFile = path.join(outsideRoot, "keep.js");
    const staleTempSymlink = path.join(packageRoot, "dist", `index.js.tmp-${process.pid}`);
    writeFileSync(outsideFile, "outside");
    symlinkSync(outsideFile, staleTempSymlink);
    writeFileSync(path.join(packageRoot, "tsconfig.json"), "{}");

    const status = runSafeBuild({
      packageRoot,
      runBuildCommand: ({ tempDistPath }) => {
        mkdirSync(tempDistPath, { recursive: true });
        writeFileSync(path.join(tempDistPath, "index.js"), "new");
        return { status: 0 };
      },
    });

    assert.equal(status, 0);
    assert.equal(readFileSync(outsideFile, "utf8"), "outside");
    assert.equal(existsSync(staleTempSymlink), false);
    assert.equal(readFileSync(path.join(packageRoot, "dist", "index.js"), "utf8"), "new");
  } finally {
    rmSync(packageRoot, { force: true, recursive: true });
    rmSync(outsideRoot, { force: true, recursive: true });
  }
});

test("safe build refuses staged output symlinks and keeps the previous dist", () => {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-build-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-outside-"));
  try {
    mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    writeFileSync(path.join(packageRoot, "dist", "index.js"), "old");
    writeFileSync(path.join(outsideRoot, "generated.js"), "outside");
    writeFileSync(path.join(packageRoot, "tsconfig.json"), "{}");

    assert.throws(
      () =>
        runSafeBuild({
          packageRoot,
          runBuildCommand: ({ tempDistPath }) => {
            mkdirSync(tempDistPath, { recursive: true });
            symlinkSync(path.join(outsideRoot, "generated.js"), path.join(tempDistPath, "index.js"));
            return { status: 0 };
          },
        }),
      /Refusing to publish symlink from TypeScript output/u,
    );

    assert.equal(readFileSync(path.join(packageRoot, "dist", "index.js"), "utf8"), "old");
    assert.equal(readFileSync(path.join(outsideRoot, "generated.js"), "utf8"), "outside");
    assert.equal(existsSync(path.join(packageRoot, ".dist-next")), false);
    assert.equal(existsSync(path.join(packageRoot, ".tsconfig.build-next.json")), false);
  } finally {
    rmSync(packageRoot, { force: true, recursive: true });
    rmSync(outsideRoot, { force: true, recursive: true });
  }
});

test("safe build keeps the previous dist when TypeScript fails", () => {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "murph-importers-build-"));
  try {
    mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    writeFileSync(path.join(packageRoot, "dist", "index.js"), "old");
    writeFileSync(path.join(packageRoot, "tsconfig.json"), "{}");

    const status = runSafeBuild({
      packageRoot,
      runBuildCommand: () => ({ status: 1 }),
    });

    assert.equal(status, 1);
    assert.equal(readFileSync(path.join(packageRoot, "dist", "index.js"), "utf8"), "old");
    assert.equal(existsSync(path.join(packageRoot, ".dist-next")), false);
    assert.equal(existsSync(path.join(packageRoot, ".tsconfig.build-next.json")), false);
  } finally {
    rmSync(packageRoot, { force: true, recursive: true });
  }
});
