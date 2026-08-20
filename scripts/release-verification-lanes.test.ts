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
      expect(packageShards).toHaveLength(6);
      expect(new Set(packageShards).size).toBe(packageShards.length);
      expect(readMatrixShardNames(hostedWebMatrix)).toEqual([
        "1/4",
        "2/4",
        "3/4",
        "4/4",
      ]);

      const packageDirs = packageShards.flatMap((shard) => {
        const result = spawnSync(
          process.execPath,
          [releasePlanPath, "--package-dirs", shard],
          { cwd: repoRoot, encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        return result.stdout.trim().split("\n").filter(Boolean);
      });
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
        MURPH_WORKSPACE_ARTIFACT_LOCK_HELD: "1",
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
