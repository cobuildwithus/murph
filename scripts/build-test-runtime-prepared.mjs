#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliSourceRoot = path.join(repoRoot, "packages/cli/src");
const workspaceSmokePackages = [
  {
    packageName: "operator-config",
    requiredSubpaths: [
      "command-helpers",
      "vault-cli-contracts",
      "vault-cli-errors",
    ],
  },
  {
    packageName: "assistant-engine",
    requiredSubpaths: [
      "assistant-cron",
      "inbox-model-contracts",
      "inbox-model-harness",
      "knowledge",
    ],
  },
  {
    packageName: "vault-usecases",
    requiredSubpaths: [
      "helpers",
      "records",
      "runtime",
      "workouts",
    ],
  },
  {
    packageName: "assistant-cli",
    requiredSubpaths: [
      "commands/assistant",
      "run-terminal-logging",
    ],
  },
  {
    packageName: "setup-cli",
    requiredSubpaths: [
      "setup-cli",
    ],
  },
  {
    packageName: "inbox-services",
    requiredSubpaths: [],
    allowRootOnly: true,
  },
];
const baseSmokeImportPaths = [
  "packages/contracts/dist/index.js",
  "packages/hosted-execution/dist/index.js",
  "packages/messaging-ingress/dist/index.js",
  "packages/runtime-state/dist/index.js",
  "packages/operator-config/dist/index.js",
  "packages/assistant-engine/dist/index.js",
  "packages/assistant-cli/dist/index.js",
  "packages/setup-cli/dist/index.js",
  "packages/core/dist/index.js",
  "packages/importers/dist/index.js",
  "packages/importers/dist/core-port.js",
  "packages/device-syncd/dist/index.js",
  "packages/query/dist/index.js",
  "packages/inboxd/dist/index.js",
  "packages/parsers/dist/index.js",
  "packages/cli/dist/index.js",
  "packages/cli/dist/cli-entry.js",
].map((relativePath) => path.join(repoRoot, relativePath));
const ownerPackageSmokeImports = workspaceSmokePackages.map((input) =>
  collectWorkspacePackageSmokeImports({
    sourceRoot: cliSourceRoot,
    ...input,
  }),
);
const ownerPackageSmokeImportPaths = ownerPackageSmokeImports.flatMap(
  (ownerPackageSmokeImport) => ownerPackageSmokeImport.distImportPaths,
);
const publishedWorkspaceSmokeImportSpecifiers = ownerPackageSmokeImports.flatMap(
  (ownerPackageSmokeImport) => ownerPackageSmokeImport.publishedImportSpecifiers,
);
const smokeImportPaths = [
  ...baseSmokeImportPaths,
  ...ownerPackageSmokeImportPaths,
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

  if (!hasPublishedWorkspaceSmokeImports()) {
    return false;
  }

  return true;
}

function hasPublishedWorkspaceSmokeImports() {
  const smokeScript = `
    const specifiers = ${JSON.stringify(publishedWorkspaceSmokeImportSpecifiers)};
    for (const specifier of specifiers) {
      await import(specifier);
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", smokeScript], {
    cwd: path.join(repoRoot, "packages/cli"),
    stdio: "pipe",
  });

  return result.status === 0;
}

function collectWorkspacePackageSmokeImports(input) {
  const distRoot = path.join(repoRoot, "packages", input.packageName, "dist");
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "packages", input.packageName, "package.json"), "utf8"),
  );
  const subpaths = new Set();
  const importPattern = new RegExp(
    `["'\`]@murph(?:ai)?/${input.packageName}/([^"'\\\`\\s]+)["'\`]`,
    "g",
  );

  for (const filePath of walkTypeScriptFiles(input.sourceRoot)) {
    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const subpath = match[1];
      if (!subpath) {
        continue;
      }
      subpaths.add(subpath);
    }
  }

  if (subpaths.size === 0) {
    if (input.allowRootOnly === true && workspacePackageAllowsRootSpecifier(packageJson)) {
      return {
        distImportPaths: [path.join(distRoot, "index.js")],
        publishedImportSpecifiers: [`@murphai/${input.packageName}`],
      };
    }
    throw new Error(
      `Expected packages/cli/src to import at least one @murphai/${input.packageName} subpath.`,
    );
  }

  const missingRequiredSubpaths = input.requiredSubpaths.filter(
    (subpath) => !subpaths.has(subpath),
  );

  if (missingRequiredSubpaths.length > 0) {
    throw new Error(
      `Expected packages/cli/src to import required @murphai/${input.packageName} subpaths: ${missingRequiredSubpaths.join(", ")}.`,
    );
  }

  const discoveredSubpaths = [...subpaths].sort();
  const publishedImportSpecifiers = discoveredSubpaths.map(
    (subpath) => `@murphai/${input.packageName}/${subpath}`,
  );

  if (workspacePackageAllowsRootSpecifier(packageJson)) {
    publishedImportSpecifiers.unshift(`@murphai/${input.packageName}`);
  }

  return {
    distImportPaths: discoveredSubpaths.map((subpath) =>
      path.join(distRoot, `${subpath}.js`),
    ),
    publishedImportSpecifiers,
  };
}

function workspacePackageAllowsRootSpecifier(packageJson) {
  if (!("exports" in packageJson)) {
    return true;
  }

  const exportsField = packageJson.exports;
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return true;
  }

  if (!exportsField || typeof exportsField !== "object") {
    return false;
  }

  const exportKeys = Object.keys(exportsField);
  if (exportKeys.some((key) => !key.startsWith("."))) {
    return true;
  }

  return Object.hasOwn(exportsField, ".");
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
