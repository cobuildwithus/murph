import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
const packagesRoot = path.join(repoRoot, "packages");

type MinimalTsConfig = {
  compilerOptions?: {
    tsBuildInfoFile?: string;
  };
  extends?: string;
};

function readMergedTsConfig(configPath: string, seen = new Set<string>()): MinimalTsConfig {
  if (seen.has(configPath)) {
    throw new Error(`Circular tsconfig extends chain at ${path.relative(repoRoot, configPath)}`);
  }
  seen.add(configPath);

  const tsConfig = JSON.parse(readFileSync(configPath, "utf8")) as MinimalTsConfig;
  if (typeof tsConfig.extends !== "string") {
    return tsConfig;
  }

  const extendedConfigPath = path.resolve(
    path.dirname(configPath),
    tsConfig.extends.endsWith(".json") ? tsConfig.extends : `${tsConfig.extends}.json`,
  );
  const baseConfig = readMergedTsConfig(extendedConfigPath, seen);
  return {
    ...baseConfig,
    ...tsConfig,
    compilerOptions: {
      ...baseConfig.compilerOptions,
      ...tsConfig.compilerOptions,
    },
  };
}

test("package manifest exposes only focused importer subpaths", async () => {
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
  assert.deepEqual(packageManifest.exports?.["./clinical-records"], {
    types: "./dist/clinical-records/index.d.ts",
    import: "./dist/clinical-records/index.js",
    default: "./dist/clinical-records/index.js",
  });
  assert.deepEqual(packageManifest.exports?.["./device-providers/junction"], {
    types: "./dist/device-providers/junction.d.ts",
    import: "./dist/device-providers/junction.js",
    default: "./dist/device-providers/junction.js",
  });
  assert.doesNotMatch(readFileSync(path.join(packageDir, "src", "index.ts"), "utf8"), /clinical-records/u);
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
  const importersSafeBuildTsConfig = JSON.parse(
    readFileSync(path.join(packageDir, "tsconfig.safe-build.json"), "utf8"),
  ) as {
    compilerOptions?: {
      outDir?: string;
      tsBuildInfoFile?: string;
    };
    extends?: string;
  };
  const tsConfigPathsWithImporterReferences = [
    "tsconfig.json",
    "tsconfig.test-runtime.json",
    "packages/cli/tsconfig.json",
    "packages/device-syncd/tsconfig.json",
    "packages/query/tsconfig.json",
    "packages/query/tsconfig.test.json",
    "packages/vault-usecases/tsconfig.json",
  ];

  assert.doesNotMatch(cleanTargets, /^packages\/importers\/dist$/mu);
  assert.match(cleanTargets, /^packages\/importers\/\.tsbuildinfo$/mu);
  assert.match(cleanTargets, /^packages\/importers\/\.dist-next$/mu);
  assert.match(cleanTargets, /^packages\/importers\/\.dist-next\.tsbuildinfo$/mu);
  assert.match(cleanTargets, /^packages\/importers\/\.dist-publish-\*$/mu);
  assert.match(cleanTargets, /^packages\/importers\/\.dist-backup-\*$/mu);
  assert.match(cleanTargets, /^packages\/importers\/\.tsconfig\.build-next\.json$/mu);
  for (const scriptName of ["build:workspace:clean", "build:workspace:incremental", "build:test-runtime"]) {
    assert.match(
      rootPackageManifest.scripts?.[scriptName] ?? "",
      /&& pnpm --dir packages\/importers build'$/u,
    );
  }
  assert.equal(importersTsConfig.compilerOptions?.outDir, "./dist");
  assert.equal(importersTsConfig.compilerOptions?.tsBuildInfoFile, ".tsbuildinfo");
  assert.equal(importersSafeBuildTsConfig.extends, "./tsconfig.json");
  assert.equal(importersSafeBuildTsConfig.compilerOptions?.outDir, "./.dist-next");
  assert.equal(
    importersSafeBuildTsConfig.compilerOptions?.tsBuildInfoFile,
    "./.dist-next.tsbuildinfo",
  );
  for (const tsConfigPath of tsConfigPathsWithImporterReferences) {
    const tsConfig = JSON.parse(readFileSync(path.join(repoRoot, tsConfigPath), "utf8")) as {
      references?: Array<{ path?: string }>;
    };
    const referencePaths = (tsConfig.references ?? []).map((reference) => reference.path ?? "");
    assert.equal(
      referencePaths.some((referencePath) => referencePath.includes("tsconfig.safe-build")),
      false,
      `${tsConfigPath} must keep importers safe-build staging private to the importers package build`,
    );
  }
});

test("non-forced package TypeScript builds clean matching build info", () => {
  const packageNames = readdirSync(packagesRoot).sort();
  let checkedBuildCount = 0;

  for (const packageName of packageNames) {
    const packageRoot = path.join(packagesRoot, packageName);
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageManifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string | undefined>;
    };
    const buildScript = packageManifest.scripts?.build ?? "";
    const tsConfigMatch = buildScript.match(
      /run-typescript\.mjs\s+package\s+-b\s+([^&\s]+)/u,
    );
    if (
      !/rm-paths\.mjs\s+dist\b/u.test(buildScript) ||
      !tsConfigMatch ||
      /\b--force\b/u.test(buildScript)
    ) {
      continue;
    }

    checkedBuildCount += 1;
    const tsConfigPath = path.join(packageRoot, tsConfigMatch?.[1] ?? "tsconfig.json");
    const tsConfig = readMergedTsConfig(tsConfigPath);
    const tsBuildInfoFile = tsConfig.compilerOptions?.tsBuildInfoFile;

    if (typeof tsBuildInfoFile !== "string") {
      assert.fail(
        `${path.relative(repoRoot, tsConfigPath)} must define tsBuildInfoFile for non-forced package builds`,
      );
    }
    assert.ok(
      (buildScript.split("&&", 1)[0] ?? "").split(/\s+/u).includes(tsBuildInfoFile),
      `${path.relative(repoRoot, packageJsonPath)} build must clean ${tsBuildInfoFile} with dist`,
    );
  }

  assert.ok(checkedBuildCount > 0, "expected routed package TypeScript builds to be audited");
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
    assert.equal(existsSync(path.join(packageRoot, ".dist-next.tsbuildinfo")), false);
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
    assert.equal(existsSync(path.join(packageRoot, ".dist-next.tsbuildinfo")), false);
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
    assert.equal(existsSync(path.join(packageRoot, ".dist-next.tsbuildinfo")), false);
    assert.equal(existsSync(path.join(packageRoot, ".tsconfig.build-next.json")), false);
  } finally {
    rmSync(packageRoot, { force: true, recursive: true });
  }
});
