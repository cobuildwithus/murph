#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseSmokeImportPaths = [
  "packages/contracts/dist/index.js",
  "packages/hosted-execution/dist/index.js",
  "packages/runtime-state/dist/index.js",
  "packages/assistant-core/dist/index.js",
  "packages/core/dist/index.js",
  "packages/importers/dist/index.js",
  "packages/importers/dist/core-port.js",
  "packages/device-syncd/dist/index.js",
  "packages/query/dist/index.js",
  "packages/inboxd/dist/index.js",
  "packages/parsers/dist/index.js",
  "packages/cli/dist/index.js",
  "packages/cli/dist/cli-entry.js",
  "packages/cli/dist/setup-cli.js",
].map((relativePath) => path.join(repoRoot, relativePath));
const assistantCoreFacadeSmokeImportPaths = collectAssistantCoreFacadeSmokeImportPaths();
const smokeImportPaths = [
  ...baseSmokeImportPaths,
  ...assistantCoreFacadeSmokeImportPaths,
];

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  return result.status ?? 1;
}

async function hasPreparedArtifacts(importAttempt = 0) {
  for (const artifactPath of smokeImportPaths) {
    if (!existsSync(artifactPath)) {
      return false;
    }
  }

  for (const artifactPath of smokeImportPaths) {
    try {
      const artifactUrl = pathToFileURL(artifactPath);
      artifactUrl.searchParams.set("murph-prepared-check", String(importAttempt));
      await import(artifactUrl.href);
    } catch {
      return false;
    }
  }

  return true;
}

function collectAssistantCoreFacadeSmokeImportPaths() {
  const cliSourceRoot = path.join(repoRoot, "packages/cli/src");
  const distRoot = path.join(repoRoot, "packages/assistant-core/dist");
  const subpaths = new Set();

  for (const filePath of walkTypeScriptFiles(cliSourceRoot)) {
    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(/["'`]@murph\/assistant-core\/([^"'`\s]+)["'`]/g)) {
      const subpath = match[1];
      if (!subpath) {
        continue;
      }
      subpaths.add(subpath);
    }
  }

  return [...subpaths]
    .sort()
    .map((subpath) => path.join(distRoot, `${subpath}.js`));
}

function walkTypeScriptFiles(directoryPath) {
  const entries = readdirSync(directoryPath, {
    withFileTypes: true,
  });
  const filePaths = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...walkTypeScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

function runPreparedBuild(force = false) {
  const args = [
    "exec",
    "tsc",
    "-b",
    "tsconfig.test-runtime.json",
  ];

  if (force) {
    args.push("--force");
  }

  args.push("--pretty", "false");
  return runCommand("pnpm", args);
}

async function sleep(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const preparedStatus = runPreparedBuild();

if (preparedStatus !== 0) {
  process.exit(preparedStatus);
}

if (await hasPreparedArtifacts(0)) {
  process.exit(0);
}

const forcedRetryCount = 3;

for (let attempt = 0; attempt < forcedRetryCount; attempt += 1) {
  const forcedStatus = runPreparedBuild(true);

  if (forcedStatus !== 0) {
    process.exit(forcedStatus);
  }

  if (await hasPreparedArtifacts(attempt + 1)) {
    process.exit(0);
  }

  if (attempt < forcedRetryCount - 1) {
    await sleep(250);
  }
}

console.error(
  "build:test-runtime:prepared completed without producing the expected runtime artifacts.",
);
process.exit(1);
