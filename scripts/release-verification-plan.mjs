#!/usr/bin/env node

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "..");

export const PACKAGE_COVERAGE_EXCLUSIONS = Object.freeze({});

export const PACKAGE_COVERAGE_PLAN = Object.freeze([
  // Release shards keep CLI and contracts on separate checkouts because contracts coverage
  // rewrites dist files imported by CLI built-runtime tests.
  { dir: "packages/cli", shard: "cli-runtime" },
  { dir: "packages/assistant-engine", shard: "assistant-engine" },
  { dir: "packages/assistant-runtime", shard: "cli-runtime" },
  // The two owner shards use the corrected v1.3.1 timings and are balanced
  // at roughly 317 seconds each before per-job setup.
  { dir: "packages/core", shard: "owners-a" },
  { dir: "packages/setup-cli", shard: "owners-a" },
  { dir: "packages/assistant-cli", shard: "owners-a" },
  { dir: "packages/assistantd", shard: "owners-b" },
  { dir: "packages/cloudflare-hosted-control", shard: "owners-b" },
  { dir: "packages/contracts", shard: "owners-a" },
  { dir: "packages/clinical-records", shard: "owners-a" },
  { dir: "packages/device-syncd", shard: "owners-b" },
  { dir: "packages/exercise-library", shard: "owners-b" },
  { dir: "packages/gateway-core", shard: "owners-b" },
  // These suites were absent from the old gate. Give each a dedicated shard
  // until release telemetry supplies a truthful cost for later rebalancing.
  { dir: "packages/health-commons", shard: "health-commons" },
  { dir: "packages/health-metrics", shard: "owners-b" },
  { dir: "packages/hosted-execution", shard: "owners-b" },
  { dir: "packages/hosted-local-harness", shard: "hosted-local-harness" },
  { dir: "packages/importers", shard: "owners-b" },
  { dir: "packages/inbox-services", shard: "owners-b" },
  { dir: "packages/inboxd", shard: "owners-a" },
  { dir: "packages/messaging-ingress", shard: "owners-a" },
  { dir: "packages/openclaw-plugin", shard: "owners-b" },
  { dir: "packages/operator-config", shard: "owners-b" },
  { dir: "packages/parsers", shard: "owners-a" },
  { dir: "packages/query", shard: "owners-a" },
  { dir: "packages/runtime-state", shard: "owners-a" },
  { dir: "packages/vault-usecases", shard: "owners-b" },
]);

export const HOSTED_WEB_TEST_SHARD_COUNT = 4;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function discoverWorkspacePackages(repoRoot) {
  const packagesRoot = path.join(repoRoot, "packages");
  const discovered = [];

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = path.posix.join("packages", entry.name);
    const packageJson = readJson(path.join(packagesRoot, entry.name, "package.json"));
    const coverageScript = packageJson.scripts?.["test:coverage"];
    discovered.push({
      dir,
      hasCoverageScript:
        typeof coverageScript === "string" && coverageScript.trim().length > 0,
    });
  }

  return discovered.sort((left, right) => left.dir.localeCompare(right.dir));
}

function discoverHostedWebTestFiles(repoRoot) {
  const testRoot = path.join(repoRoot, "apps", "web", "test");
  const discovered = [];
  const pendingDirs = [testRoot];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pendingDirs.push(entryPath);
        continue;
      }

      if (
        /\.test\.(?:ts|tsx)$/u.test(entry.name)
        && !/\.db\.test\.(?:ts|tsx)$/u.test(entry.name)
      ) {
        discovered.push(path.relative(repoRoot, entryPath).split(path.sep).join("/"));
      }
    }
  }

  return discovered.sort();
}

function setDifference(expected, actual) {
  return [...expected].filter((value) => !actual.has(value)).sort();
}

function selectPackageCoverageEntries(shard) {
  const selected = shard === "all"
    ? PACKAGE_COVERAGE_PLAN
    : PACKAGE_COVERAGE_PLAN.filter((entry) => entry.shard === shard);

  if (selected.length === 0) {
    throw new Error(`Package coverage shard '${shard}' matched zero packages.`);
  }

  return selected;
}

function packageCoverageMatrixFromPlan() {
  const shardNames = [];
  const seenShards = new Set();

  for (const { shard } of PACKAGE_COVERAGE_PLAN) {
    if (!seenShards.has(shard)) {
      seenShards.add(shard);
      shardNames.push(shard);
    }
  }

  return {
    include: shardNames.map((shard) => ({ shard })),
  };
}

function hostedWebTestMatrixFromPlan() {
  return {
    include: Array.from({ length: HOSTED_WEB_TEST_SHARD_COUNT }, (_, index) => ({
      shard: `${index + 1}/${HOSTED_WEB_TEST_SHARD_COUNT}`,
    })),
  };
}

export function validateReleaseVerificationPlan(repoRoot = defaultRepoRoot) {
  const errors = [];
  const plannedDirs = new Set();
  const shardCounts = new Map();

  for (const entry of PACKAGE_COVERAGE_PLAN) {
    if (!/^packages\/[a-z0-9][a-z0-9-]*$/u.test(entry.dir)) {
      errors.push(`invalid package coverage directory '${entry.dir}'`);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(entry.shard)) {
      errors.push(`invalid package coverage shard '${entry.shard}' for ${entry.dir}`);
    }
    if (plannedDirs.has(entry.dir)) {
      errors.push(`duplicate package coverage assignment for ${entry.dir}`);
    }
    plannedDirs.add(entry.dir);
    shardCounts.set(entry.shard, (shardCounts.get(entry.shard) ?? 0) + 1);
  }

  const exclusionEntries = Object.entries(PACKAGE_COVERAGE_EXCLUSIONS);
  const excludedDirs = new Set();
  for (const [packageDir, reason] of exclusionEntries) {
    excludedDirs.add(packageDir);
    if (!/^packages\/[a-z0-9][a-z0-9-]*$/u.test(packageDir)) {
      errors.push(`invalid package coverage exclusion '${packageDir}'`);
    }
    if (plannedDirs.has(packageDir)) {
      errors.push(`${packageDir} is both assigned and excluded`);
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      errors.push(`${packageDir} has an empty package coverage exclusion reason`);
    }
  }

  const cliEntry = PACKAGE_COVERAGE_PLAN.find(({ dir }) => dir === "packages/cli");
  const contractsEntry = PACKAGE_COVERAGE_PLAN.find(
    ({ dir }) => dir === "packages/contracts",
  );
  if (cliEntry?.shard === contractsEntry?.shard) {
    errors.push("packages/cli and packages/contracts must use isolated release shards");
  }

  const assistantEngineEntry = PACKAGE_COVERAGE_PLAN.find(
    ({ dir }) => dir === "packages/assistant-engine",
  );
  if (
    assistantEngineEntry
    && shardCounts.get(assistantEngineEntry.shard) !== 1
  ) {
    errors.push("packages/assistant-engine must remain the only package in its release shard");
  }

  const workspacePackages = discoverWorkspacePackages(repoRoot);
  const workspaceDirs = new Set(workspacePackages.map(({ dir }) => dir));
  const discoveredCoverageDirs = new Set(
    workspacePackages
      .filter(({ hasCoverageScript }) => hasCoverageScript)
      .map(({ dir }) => dir),
  );
  const classifiedDirs = new Set([...plannedDirs, ...excludedDirs]);
  const unassignedDirs = setDifference(workspaceDirs, classifiedDirs);
  const staleAssignments = setDifference(plannedDirs, discoveredCoverageDirs);
  const staleExclusions = setDifference(excludedDirs, workspaceDirs);

  if (unassignedDirs.length > 0) {
    errors.push(`unassigned workspace packages: ${unassignedDirs.join(", ")}`);
  }
  if (staleAssignments.length > 0) {
    errors.push(`assigned packages without test:coverage: ${staleAssignments.join(", ")}`);
  }
  if (staleExclusions.length > 0) {
    errors.push(`excluded packages that do not exist: ${staleExclusions.join(", ")}`);
  }
  if (PACKAGE_COVERAGE_PLAN.length === 0) {
    errors.push("package coverage plan must not be empty");
  }

  const hostedWebTestFiles = discoverHostedWebTestFiles(repoRoot);
  if (hostedWebTestFiles.length < HOSTED_WEB_TEST_SHARD_COUNT) {
    errors.push(
      `hosted-web test sharding needs at least ${HOSTED_WEB_TEST_SHARD_COUNT} admitted files; found ${hostedWebTestFiles.length}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid release verification plan:\n- ${errors.join("\n- ")}`);
  }

  return {
    discoveredPackageCoverageDirs: [...discoveredCoverageDirs].sort(),
    discoveredWorkspacePackageDirs: [...workspaceDirs].sort(),
    hostedWebTestFileCount: hostedWebTestFiles.length,
    packageCoverageShardNames: [...shardCounts.keys()],
  };
}

export function packageCoverageDirsForShard(shard, repoRoot = defaultRepoRoot) {
  validateReleaseVerificationPlan(repoRoot);
  return selectPackageCoverageEntries(shard).map((entry) => entry.dir);
}

export function packageCoverageMatrix(repoRoot = defaultRepoRoot) {
  validateReleaseVerificationPlan(repoRoot);
  return packageCoverageMatrixFromPlan();
}

export function hostedWebTestMatrix(repoRoot = defaultRepoRoot) {
  validateReleaseVerificationPlan(repoRoot);
  return hostedWebTestMatrixFromPlan();
}

function parseArgs(argv) {
  const parsed = {
    check: false,
    githubOutput: undefined,
    packageDirs: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--check":
        parsed.check = true;
        break;
      case "--github-output": {
        const outputPath = argv[index + 1];
        if (outputPath === undefined) {
          throw new Error("--github-output requires a path.");
        }
        parsed.githubOutput = outputPath;
        index += 1;
        break;
      }
      case "--package-dirs": {
        const shard = argv[index + 1];
        if (shard === undefined) {
          throw new Error("--package-dirs requires a shard name.");
        }
        parsed.packageDirs = shard;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const validation = validateReleaseVerificationPlan(defaultRepoRoot);

  if (args.packageDirs !== undefined) {
    for (const { dir } of selectPackageCoverageEntries(args.packageDirs)) {
      process.stdout.write(`${dir}\n`);
    }
  }

  if (args.githubOutput !== undefined) {
    if (args.githubOutput.length === 0) {
      throw new Error("--github-output requires a path.");
    }
    appendFileSync(
      args.githubOutput,
      `package_matrix=${JSON.stringify(packageCoverageMatrixFromPlan())}\n`,
    );
    appendFileSync(
      args.githubOutput,
      `hosted_web_test_matrix=${JSON.stringify(hostedWebTestMatrixFromPlan())}\n`,
    );
  }

  if (args.check || (args.packageDirs === undefined && args.githubOutput === undefined)) {
    process.stdout.write(
      `release verification plan ok: packages=${validation.discoveredPackageCoverageDirs.length} package_shards=${validation.packageCoverageShardNames.length} hosted_web_test_files=${validation.hostedWebTestFileCount}\n`,
    );
  }
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[release-verification-plan] ${message}`);
    process.exitCode = 1;
  }
}
