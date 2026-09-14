import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const { validateReleaseContext } = await import(
  new URL("./release-helpers.mjs", import.meta.url).href
) as {
  validateReleaseContext(context: ReturnType<typeof releaseValidationFixture>, options?: { expectVersion?: unknown }): unknown;
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const releaseCheckPath = path.join(repoRoot, "scripts", "release-check.sh");
const releasePlanPath = path.join(
  repoRoot,
  "scripts",
  "release-verification-plan.mjs",
);
const hostedWebVerifyPath = path.join(
  repoRoot,
  "apps",
  "web",
  "scripts",
  "verify-fast.sh",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createHarnessRoot(): string {
  const sharedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedTempRoot) {
    throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  }

  return mkdtempSync(path.join(sharedTempRoot, "release-verification-lanes-"));
}

function writeExecutable(filePath: string, source: string): void {
  writeFileSync(filePath, source, "utf8");
  chmodSync(filePath, 0o755);
}

function createFakeCommandPath(harnessRoot: string): {
  binDir: string;
  logPath: string;
} {
  const binDir = path.join(harnessRoot, "bin");
  const logPath = path.join(harnessRoot, "commands.log");
  mkdirSync(binDir);
  writeFileSync(logPath, "", "utf8");

  writeExecutable(
    path.join(binDir, "bash"),
    "#!/bin/sh\nprintf 'bash %s\\n' \"$*\" >> \"$HARNESS_LOG\"\nexit 0\n",
  );
  writeExecutable(
    path.join(binDir, "node"),
    "#!/bin/sh\nprintf 'node %s\\n' \"$*\" >> \"$HARNESS_LOG\"\nexit 0\n",
  );
  writeExecutable(
    path.join(binDir, "corepack"),
    "#!/bin/sh\nprintf 'corepack %s\\n' \"$*\" >> \"$HARNESS_LOG\"\nexit 0\n",
  );
  writeExecutable(
    path.join(binDir, "pnpm"),
    "#!/bin/sh\nprintf 'pnpm trace=%s %s\\n' \"${MURPH_REQUIRE_HEALTH_COMMONS_ROUTE_TRACES:-}\" \"$*\" >> \"$HARNESS_LOG\"\nexit 0\n",
  );

  return { binDir, logPath };
}

function fakeCommandEnvironment(
  binDir: string,
  logPath: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HARNESS_LOG: logPath,
    PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  };
}

function readCommandLog(logPath: string): string[] {
  return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

function readMatrixShardNames(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.include)) {
    throw new Error("Expected a matrix object with an include array.");
  }

  return value.include.map((entry) => {
    if (!isRecord(entry) || typeof entry.shard !== "string") {
      throw new Error("Expected every matrix entry to contain a string shard.");
    }
    return entry.shard;
  });
}

function discoverCoveragePackageDirs(): string[] {
  const packagesRoot = path.join(repoRoot, "packages");

  return readdirSync(packagesRoot, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isDirectory()) {
        return [];
      }

      const packageJson: unknown = JSON.parse(
        readFileSync(path.join(packagesRoot, entry.name, "package.json"), "utf8"),
      );
      if (!isRecord(packageJson) || !isRecord(packageJson.scripts)) {
        return [];
      }

      const coverageScript = packageJson.scripts["test:coverage"];
      return typeof coverageScript === "string" && coverageScript.trim()
        ? [`packages/${entry.name}`]
        : [];
    })
    .sort();
}

describe("release verification executable lanes", () => {
  it("emits parseable matrices whose package shards form one exact union", () => {
    const harnessRoot = createHarnessRoot();

    try {
      const githubOutputPath = path.join(harnessRoot, "github-output");
      const matrixResult = spawnSync(
        process.execPath,
        [releasePlanPath, "--github-output", githubOutputPath],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(matrixResult.status, matrixResult.stderr).toBe(0);

      const outputEntries = Object.fromEntries(
        readFileSync(githubOutputPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => {
            const separatorIndex = line.indexOf("=");
            if (separatorIndex < 1) {
              throw new Error(`Invalid GitHub output line: ${line}`);
            }
            return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
          }),
      );
      expect(Object.keys(outputEntries).sort()).toEqual([
        "hosted_web_test_matrix",
        "package_matrix",
      ]);

      const packageMatrix: unknown = JSON.parse(outputEntries.package_matrix ?? "");
      const hostedWebMatrix: unknown = JSON.parse(
        outputEntries.hosted_web_test_matrix ?? "",
      );
      const packageShards = readMatrixShardNames(packageMatrix);
      expect(packageShards).toEqual([
        "cli",
        "assistant-engine",
        "platform-a",
        "platform-b",
        "health-commons",
        "hosted-local-harness",
      ]);
      expect(new Set(packageShards).size).toBe(packageShards.length);
      expect(readMatrixShardNames(hostedWebMatrix)).toEqual([
        "1/4",
        "2/4",
        "3/4",
        "4/4",
      ]);

      const packageDirsByShard = Object.fromEntries(packageShards.map((shard) => {
        const result = spawnSync(
          process.execPath,
          [releasePlanPath, "--package-dirs", shard],
          { cwd: repoRoot, encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        return [shard, result.stdout.trim().split("\n").filter(Boolean)];
      }));
      expect(packageDirsByShard).toEqual({
        cli: ["packages/cli"],
        "assistant-engine": ["packages/assistant-engine"],
        "platform-a": [
          "packages/assistant-runtime",
          "packages/cloudflare-hosted-control",
          "packages/exercise-library",
          "packages/gateway-core",
          "packages/health-metrics",
          "packages/hosted-execution",
          "packages/importers",
          "packages/inbox-services",
          "packages/openclaw-plugin",
          "packages/operator-config",
        ],
        "platform-b": [
          "packages/core",
          "packages/setup-cli",
          "packages/assistant-cli",
          "packages/contracts",
          "packages/clinical-records",
          "packages/device-syncd",
          "packages/inboxd",
          "packages/messaging-ingress",
          "packages/parsers",
          "packages/query",
          "packages/runtime-state",
          "packages/vault-usecases",
        ],
        "health-commons": ["packages/health-commons"],
        "hosted-local-harness": ["packages/hosted-local-harness"],
      });

      const packageDirs = Object.values(packageDirsByShard).flat();
      expect(new Set(packageDirs).size).toBe(packageDirs.length);
      expect([...packageDirs].sort()).toEqual(discoverCoveragePackageDirs());
    } finally {
      rmSync(harnessRoot, { force: true, recursive: true });
    }
  });

  it("executes distinct preflight and full release-check tails", () => {
    const harnessRoot = createHarnessRoot();

    try {
      const { binDir, logPath } = createFakeCommandPath(harnessRoot);
      const env = fakeCommandEnvironment(binDir, logPath);
      const preflight = spawnSync("/bin/bash", [releaseCheckPath, "--preflight"], {
        cwd: repoRoot,
        encoding: "utf8",
        env,
      });
      expect(preflight.status, preflight.stderr).toBe(0);
      const preflightLog = readCommandLog(logPath);
      expect(preflightLog).toContain("corepack pnpm build:workspace:clean");
      expect(preflightLog).toContain("corepack pnpm typecheck");
      expect(preflightLog).toContain(
        "bash scripts/doc-gardening.sh --fail-on-issues",
      );
      expect(preflightLog).not.toContain("corepack pnpm verify:acceptance");

      writeFileSync(logPath, "", "utf8");
      const full = spawnSync("/bin/bash", [releaseCheckPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env,
      });
      expect(full.status, full.stderr).toBe(0);
      const fullLog = readCommandLog(logPath);
      expect(fullLog).toContain("corepack pnpm build:workspace:clean");
      expect(fullLog).toContain("corepack pnpm verify:acceptance");
      expect(fullLog).not.toContain("corepack pnpm typecheck");
      expect(fullLog).not.toContain(
        "bash scripts/doc-gardening.sh --fail-on-issues",
      );
    } finally {
      rmSync(harnessRoot, { force: true, recursive: true });
    }
  });

  it("executes isolated hosted-Web shard and build lanes", () => {
    const harnessRoot = createHarnessRoot();

    try {
      const { binDir, logPath } = createFakeCommandPath(harnessRoot);
      const baseEnv: NodeJS.ProcessEnv = {
        ...fakeCommandEnvironment(binDir, logPath),
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
        MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD: "0",
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
        MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK: "1",
        MURPH_VERIFY_SHARED_HOST: "0",
        MURPH_VERIFY_STEP_PARALLEL: "0",
      };
      const testShard = spawnSync("/bin/bash", [hostedWebVerifyPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...baseEnv,
          MURPH_HOSTED_WEB_TEST_SHARD: "2/4",
          MURPH_HOSTED_WEB_VERIFY_LANE: "test-shard",
        },
      });
      expect(testShard.status, testShard.stderr).toBe(0);
      const testShardLog = readCommandLog(logPath);
      expect(testShardLog).toContain(
        "pnpm trace= test:prepared -- --shard=2/4 --passWithNoTests=false",
      );
      expect(testShardLog.some((line) => line.includes("dev:smoke"))).toBe(false);
      expect(testShardLog.some((line) => line.includes("lint"))).toBe(false);
      expect(testShardLog.some((line) => line.includes("next-build"))).toBe(false);

      writeFileSync(logPath, "", "utf8");
      const build = spawnSync("/bin/bash", [hostedWebVerifyPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...baseEnv,
          MURPH_HOSTED_WEB_VERIFY_LANE: "build",
        },
      });
      expect(build.status, build.stderr).toBe(0);
      const buildLog = readCommandLog(logPath);
      const buildIndex = buildLog.findIndex((line) =>
        line.includes("run-production-next-build.sh"),
      );
      const smokeIndex = buildLog.findIndex((line) => line.includes("dev:smoke"));
      const outputTestIndex = buildLog.findIndex((line) =>
        line.includes("trace=1 test:prepared"),
      );
      expect(buildIndex).toBeGreaterThanOrEqual(0);
      expect(smokeIndex).toBeGreaterThan(buildIndex);
      expect(outputTestIndex).toBeGreaterThan(smokeIndex);
      expect(buildLog[outputTestIndex]).toContain(
        "apps/web/test/health-commons-route-bundle-boundary.test.ts",
      );
      expect(buildLog[outputTestIndex]).toContain(
        "apps/web/test/instrumentation.test.ts",
      );

      writeFileSync(logPath, "", "utf8");
      const invalidShard = spawnSync("/bin/bash", [hostedWebVerifyPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...baseEnv,
          MURPH_HOSTED_WEB_TEST_SHARD: "5/4",
          MURPH_HOSTED_WEB_VERIFY_LANE: "test-shard",
        },
      });
      expect(invalidShard.status).not.toBe(0);
      expect(invalidShard.stderr).toContain(
        "MURPH_HOSTED_WEB_TEST_SHARD index must not exceed its count.",
      );
      expect(readCommandLog(logPath)).toEqual([]);
    } finally {
      rmSync(harnessRoot, { force: true, recursive: true });
    }
  });
});

function releaseValidationFixture() {
  const fixtureRoot = path.resolve("synthetic-release");
  const packageJson: Record<string, unknown> = {
    name: "@murphai/example-tool",
    private: false,
    version: "1.2.3",
    repository: "https://example.test/repository",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    exports: { ".": { types: "dist/index.d.ts", default: "dist/index.js" } },
    publishConfig: { access: "public" },
    bin: { murph: "dist/bin.js", "vault-cli": "dist/bin.js" },
    files: ["dist", "CHANGELOG.md"],
  };
  const workspaceDependencies: Array<{ name: string; version: string }> = [];
  const entry = {
    name: "@murphai/example-tool",
    path: "packages/example-tool",
    packageJsonPath: path.join(fixtureRoot, "packages/example-tool/package.json"),
    packageJson,
    isScoped: true,
    workspaceDependencies,
  };
  return {
    repoRoot: fixtureRoot,
    rootPackageJson: { name: "example-workspace" },
    manifest: {
      repositoryUrl: "https://example.test/repository",
      primaryPackage: entry.name,
      releaseArtifacts: { changelogPath: "CHANGELOG.md", releaseNotesDir: "release-notes" },
    },
    orderedPackages: [entry],
    packageByName: new Map([[entry.name, entry]]),
    packages: [entry],
    primaryPackage: entry,
    workspacePackages: [entry],
    workspacePackageByName: new Map([[entry.name, entry]]),
    releasePackageNames: new Set([entry.name]),
  };
}

describe("release context validation contracts", () => {
  it("preserves the complete summary and an explicitly undefined expected version", () => {
    const context = releaseValidationFixture();
    assert.deepEqual(validateReleaseContext(context, { expectVersion: undefined }), {
      changelogPath: "CHANGELOG.md",
      isPrerelease: false,
      npmTag: "",
      primaryPackage: {
        name: "@murphai/example-tool",
        packageJsonPath: "packages/example-tool/package.json",
        path: "packages/example-tool",
      },
      packages: [{
        bundledExternalDependencies: [],
        bundledWorkspaceDependencies: [],
        name: "@murphai/example-tool",
        packageJsonPath: "packages/example-tool/package.json",
        path: "packages/example-tool",
        version: "1.2.3",
        workspaceDependencies: [],
      }],
      releaseNotesPath: "release-notes/v1.2.3.md",
      version: "1.2.3",
    });
  });

  for (const expectVersion of [null, false, ""]) {
    it(`rejects expected version ${JSON.stringify(expectVersion)} before reading manifest fields`, () => {
      const context = releaseValidationFixture();
      Object.defineProperty(context.manifest, "repositoryUrl", {
        get() { throw new Error("manifest must not be inspected"); },
      });
      assert.throws(
        () => validateReleaseContext(context, { expectVersion }),
        (error: unknown) => error instanceof Error
          && error.message.startsWith("Expected release version must match ")
          && error.message.endsWith(`Received: ${expectVersion}`),
      );
    });
  }

  it("preserves aggregate diagnostic order across manifest, package, version, and primary checks", () => {
    const context = releaseValidationFixture();
    context.manifest.repositoryUrl = "";
    Object.defineProperty(context.manifest, "releaseArtifacts", { value: undefined });
    context.rootPackageJson.name = context.manifest.primaryPackage;
    context.primaryPackage.packageJson = {
      name: "@murphai/wrong-name", private: true, version: "1.2",
      repository: "https://example.test/wrong-repository", main: null, types: false, exports: null,
    };
    const packagePath = "packages/example-tool/package.json";
    assert.throws(() => validateReleaseContext(context), {
      message: [
        "scripts/release-manifest.json must declare repositoryUrl.",
        "scripts/release-manifest.json must declare releaseArtifacts.changelogPath and releaseArtifacts.releaseNotesDir.",
        "Root package name @murphai/example-tool conflicts with the published primary package name.",
        `${packagePath} name must be @murphai/example-tool, found @murphai/wrong-name.`,
        `${packagePath} must be publishable (private: false).`,
        `${packagePath} version 1.2 is not supported by the release flow.`,
        `${packagePath} repository must be .`,
        `${packagePath} must declare main and types entrypoints.`,
        `${packagePath} must expose a typed default export for '.'.`,
        `${packagePath} must set publishConfig.access to public.`,
        "Release packages must share one version, found: <missing>.",
        `${packagePath} must publish the primary package name @murphai/example-tool.`,
        `${packagePath} must expose the murph bin from dist/bin.js.`,
        `${packagePath} must expose the vault-cli bin from dist/bin.js.`,
        `${packagePath} files must include CHANGELOG.md.`,
      ].join("\n"),
    });
  });

  it("keeps default-export and entrypoint getter short circuits in order", () => {
    const context = releaseValidationFixture();
    const reads: string[] = [];
    Object.defineProperty(context.primaryPackage.packageJson, "main", {
      get() { reads.push("main"); return "dist/index.js"; },
    });
    Object.defineProperty(context.primaryPackage.packageJson, "types", {
      get() { reads.push("types"); return "dist/index.d.ts"; },
    });
    context.primaryPackage.packageJson.exports = { ".": {
      get types() { reads.push("export.types"); return "dist/index.d.ts"; },
      get default() { reads.push("export.default"); return "dist/index.js"; },
      get import() { throw new Error("import must not be read after a valid default"); },
    } };
    assert.doesNotThrow(() => validateReleaseContext(context));
    assert.deepEqual(reads, ["main", "types", "export.types", "export.default"]);
  });

  it("reports missing private bundles before undeclared bundled and transitive external dependencies", () => {
    const context = releaseValidationFixture();
    const primary = context.primaryPackage;
    const dependency = {
      ...primary,
      name: "@murphai/example-private",
      path: "packages/example-private",
      packageJsonPath: path.join(context.repoRoot, "packages/example-private/package.json"),
      packageJson: { private: true, dependencies: { "example-transitive": "^1.0.0" } },
      workspaceDependencies: [],
    };
    context.workspacePackages.push(dependency);
    context.workspacePackageByName.set(dependency.name, dependency);
    primary.workspaceDependencies.push({ name: dependency.name, version: "workspace:*" });
    primary.packageJson.dependencies = { [dependency.name]: "workspace:*" };
    primary.packageJson.bundleDependencies = ["example-undeclared"];
    const packagePath = "packages/example-tool/package.json";
    assert.throws(() => validateReleaseContext(context), {
      message: [
        `${packagePath} depends on internal workspace package @murphai/example-private, but bundleDependencies must include it so the packed tarball stays installable.`,
        `${packagePath} bundleDependencies includes external package example-undeclared, but it must also be declared in dependencies, optionalDependencies, or peerDependencies so the packed tarball exposes a coherent dependency graph.`,
        `${packagePath} bundles internal workspace packages that depend on external package example-transitive, but example-transitive must also be declared in dependencies, optionalDependencies, or peerDependencies so npm installs it.`,
      ].join("\n"),
    });
  });
});
