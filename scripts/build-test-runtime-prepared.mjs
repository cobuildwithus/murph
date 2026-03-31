#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const smokeImportPaths = [
  "packages/contracts/dist/index.js",
  "packages/hosted-execution/dist/index.js",
  "packages/runtime-state/dist/index.js",
  "packages/core/dist/index.js",
  "packages/importers/dist/index.js",
  "packages/importers/dist/core-port.js",
  "packages/device-syncd/dist/index.js",
  "packages/query/dist/index.js",
  "packages/inboxd/dist/index.js",
  "packages/parsers/dist/index.js",
  "packages/cli/dist/index.js",
  "packages/cli/dist/vault-cli-contracts.js",
  "packages/cli/dist/inbox-cli-contracts.js",
  "packages/cli/dist/operator-config.js",
  "packages/cli/dist/setup-cli.js",
  "packages/cli/dist/setup-runtime-env.js",
].map((relativePath) => path.join(repoRoot, relativePath));

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  return result.status ?? 1;
}

async function hasPreparedArtifacts() {
  for (const artifactPath of smokeImportPaths) {
    if (!existsSync(artifactPath)) {
      return false;
    }
  }

  for (const artifactPath of smokeImportPaths) {
    try {
      await import(pathToFileURL(artifactPath).href);
    } catch {
      return false;
    }
  }

  return true;
}

const preparedStatus = runCommand("pnpm", [
  "exec",
  "tsc",
  "-b",
  "tsconfig.test-runtime.json",
  "--force",
  "--pretty",
  "false",
]);

if (preparedStatus !== 0) {
  process.exit(preparedStatus);
}

if (await hasPreparedArtifacts()) {
  process.exit(0);
}

console.error(
  "build:test-runtime:prepared completed without producing the expected runtime artifacts.",
);
process.exit(1);
