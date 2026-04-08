import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { loadWorkspacePackages } from "./check-workspace-package-cycles.mjs";

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_FAST_PATH_FILES = new Set([
  "AGENTS.md",
  "ARCHITECTURE.md",
  "README.md",
  "package.json",
  "tsconfig.json",
  "vitest.config.ts",
]);
const ROOT_FAST_PATH_DIRS = new Set([
  "agent-docs",
  "config",
  "docs",
  "scripts",
]);
const ROOT_GLOBAL_FILES = new Set([
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

function isRepoInternalFastPathFile(filePath) {
  if (ROOT_FAST_PATH_FILES.has(filePath)) {
    return true;
  }

  if (ROOT_FAST_PATH_DIRS.has(filePath)) {
    return true;
  }

  if (/^tsconfig\.[^.]+\.json$/u.test(path.posix.basename(filePath))) {
    return true;
  }

  return (
    filePath.startsWith("agent-docs/")
    || filePath.startsWith("config/")
    || filePath.startsWith("docs/")
    || filePath.startsWith("scripts/")
  );
}

function workspaceDirFromFile(filePath) {
  const normalizedPath = filePath.replaceAll(path.sep, path.posix.sep);
  const match = /^(packages|apps)\/[^/]+/u.exec(normalizedPath);
  return match?.[0] ?? null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function printShellScalar(name, value) {
  process.stdout.write(`${name}=${shellQuote(value)}\n`);
}

function printShellArray(name, values) {
  process.stdout.write(`${name}=(\n`);
  for (const value of values) {
    process.stdout.write(`  ${shellQuote(value)}\n`);
  }
  process.stdout.write(`)\n`);
}

async function collectGitDiffFiles() {
  const commands = [
    ["diff", "--name-only", "--relative", "HEAD", "--"],
    ["ls-files", "--others", "--exclude-standard"],
  ];
  const changedFiles = new Set();

  for (const args of commands) {
    try {
      const { stdout } = await execFile("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
      });

      for (const filePath of stdout.split(/\r?\n/u)) {
        const trimmedPath = filePath.trim();
        if (trimmedPath.length > 0) {
          changedFiles.add(trimmedPath);
        }
      }
    } catch {
      // Fall through so the caller still gets whatever diff state was available.
    }
  }

  return [...changedFiles].sort();
}

async function loadWorkspaceMetadata() {
  const workspacePackages = await loadWorkspacePackages(repoRoot);
  const metadataByDir = new Map();
  const metadataByName = new Map();

  for (const workspacePackage of workspacePackages) {
    const packageJson = JSON.parse(await readFile(workspacePackage.packageJsonPath, "utf8"));
    const workspaceDir = path
      .relative(repoRoot, path.dirname(workspacePackage.packageJsonPath))
      .replaceAll(path.sep, path.posix.sep);
    const metadata = {
      dir: workspaceDir,
      internalDependencies: workspacePackage.internalDependencies.map((dependency) => dependency.name),
      kind: workspaceDir.startsWith("apps/") ? "app" : "package",
      name: workspacePackage.name,
      scripts: packageJson.scripts ?? {},
    };

    metadataByDir.set(metadata.dir, metadata);
    metadataByName.set(metadata.name, metadata);
  }

  return { metadataByDir, metadataByName };
}

function buildReverseDependents(metadataByName) {
  const reverseDependents = new Map();

  for (const metadata of metadataByName.values()) {
    reverseDependents.set(metadata.name, []);
  }

  for (const metadata of metadataByName.values()) {
    for (const dependencyName of metadata.internalDependencies) {
      const dependents = reverseDependents.get(dependencyName);

      if (dependents) {
        dependents.push(metadata.name);
      }
    }
  }

  for (const dependentNames of reverseDependents.values()) {
    dependentNames.sort();
  }

  return reverseDependents;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

async function buildDiffScopeSummary(explicitChangedFiles) {
  const changedFiles = explicitChangedFiles.length > 0
    ? uniqueSorted(explicitChangedFiles)
    : await collectGitDiffFiles();
  const { metadataByDir, metadataByName } = await loadWorkspaceMetadata();
  const reverseDependents = buildReverseDependents(metadataByName);
  const touchedWorkspaceDirs = new Set();
  const nonWorkspaceFiles = [];
  let globalRootChange = false;

  for (const filePath of changedFiles) {
    const workspaceDir = workspaceDirFromFile(filePath);

    if (workspaceDir && metadataByDir.has(workspaceDir)) {
      touchedWorkspaceDirs.add(workspaceDir);
      continue;
    }

    nonWorkspaceFiles.push(filePath);

    if (ROOT_GLOBAL_FILES.has(filePath)) {
      globalRootChange = true;
    }
  }

  const repoInternalFastPath = (
    changedFiles.length > 0
    && !globalRootChange
    && touchedWorkspaceDirs.size === 0
    && nonWorkspaceFiles.every((filePath) => isRepoInternalFastPathFile(filePath))
  );
  const affectedWorkspaceDirs = new Set(
    globalRootChange ? [...metadataByDir.keys()] : [...touchedWorkspaceDirs],
  );
  const queue = [...affectedWorkspaceDirs]
    .map((workspaceDir) => metadataByDir.get(workspaceDir)?.name ?? null)
    .filter((workspaceName) => typeof workspaceName === "string");
  const seenWorkspaceNames = new Set(queue);

  while (queue.length > 0) {
    const workspaceName = queue.shift();
    const dependentNames = reverseDependents.get(workspaceName) ?? [];

    for (const dependentName of dependentNames) {
      if (seenWorkspaceNames.has(dependentName)) {
        continue;
      }

      seenWorkspaceNames.add(dependentName);
      queue.push(dependentName);
      const dependentMetadata = metadataByName.get(dependentName);

      if (dependentMetadata) {
        affectedWorkspaceDirs.add(dependentMetadata.dir);
      }
    }
  }

  const affectedMetadata = [...affectedWorkspaceDirs]
    .map((workspaceDir) => metadataByDir.get(workspaceDir))
    .filter((metadata) => metadata !== undefined)
    .sort((left, right) => left.dir.localeCompare(right.dir));
  const runVerifyCli = affectedWorkspaceDirs.has("packages/cli");
  const typecheckDirs = [];
  const testDirs = [];
  const verifyAppDirs = [];

  for (const metadata of affectedMetadata) {
    if (metadata.kind === "app") {
      if (typeof metadata.scripts.verify === "string") {
        verifyAppDirs.push(metadata.dir);
      }
      continue;
    }

    if (metadata.dir === "packages/cli") {
      continue;
    }

    const verifyCliTypecheckCovered = runVerifyCli
      && (metadata.dir === "packages/assistant-cli" || metadata.dir === "packages/setup-cli");

    if (typeof metadata.scripts.typecheck === "string" && !verifyCliTypecheckCovered) {
      typecheckDirs.push(metadata.dir);
    }

    if (typeof metadata.scripts.test === "string") {
      testDirs.push(metadata.dir);
    }
  }

  const summary = {
    affectedAppDirs: verifyAppDirs,
    affectedPackageDirs: affectedMetadata
      .filter((metadata) => metadata.kind === "package")
      .map((metadata) => metadata.dir),
    affectedWorkspaceDirs: affectedMetadata.map((metadata) => metadata.dir),
    changedFiles,
    globalRootChange,
    hasNonWorkspaceFiles: nonWorkspaceFiles.length > 0,
    noChanges: changedFiles.length === 0,
    nonWorkspaceFiles: uniqueSorted(nonWorkspaceFiles),
    repoInternalFastPath,
    runVerifyCli,
    testDirs: uniqueSorted(testDirs),
    touchedWorkspaceDirs: uniqueSorted([...touchedWorkspaceDirs]),
    typecheckDirs: uniqueSorted(typecheckDirs),
  };

  summary.summary = summary.noChanges
    ? "no changed files detected"
    : [
      summary.repoInternalFastPath
        ? "repo-internal fast path"
        : summary.globalRootChange
          ? "global root change"
          : "workspace-targeted diff",
      summary.touchedWorkspaceDirs.length > 0
        ? `owners=${summary.touchedWorkspaceDirs.join(",")}`
        : "owners=<none>",
      summary.affectedWorkspaceDirs.length > 0
        ? `affected=${summary.affectedWorkspaceDirs.join(",")}`
        : "affected=<none>",
    ].join(" | ");

  return summary;
}

function printShellSummary(summary) {
  printShellScalar("diff_summary", summary.summary);
  printShellScalar("diff_no_changes", summary.noChanges ? "1" : "0");
  printShellScalar("diff_repo_internal_fast_path", summary.repoInternalFastPath ? "1" : "0");
  printShellScalar("diff_global_root_change", summary.globalRootChange ? "1" : "0");
  printShellScalar("diff_has_non_workspace_files", summary.hasNonWorkspaceFiles ? "1" : "0");
  printShellScalar("diff_run_verify_cli", summary.runVerifyCli ? "1" : "0");
  printShellArray("diff_changed_files", summary.changedFiles);
  printShellArray("diff_non_workspace_files", summary.nonWorkspaceFiles);
  printShellArray("diff_touched_workspace_dirs", summary.touchedWorkspaceDirs);
  printShellArray("diff_affected_workspace_dirs", summary.affectedWorkspaceDirs);
  printShellArray("diff_affected_package_dirs", summary.affectedPackageDirs);
  printShellArray("diff_affected_app_dirs", summary.affectedAppDirs);
  printShellArray("diff_typecheck_dirs", summary.typecheckDirs);
  printShellArray("diff_test_dirs", summary.testDirs);
}

async function main() {
  const args = process.argv.slice(2);
  let format = "json";
  const explicitChangedFiles = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--format") {
      format = args[index + 1] ?? format;
      index += 1;
      continue;
    }

    explicitChangedFiles.push(arg.replaceAll(path.sep, path.posix.sep));
  }

  const summary = await buildDiffScopeSummary(explicitChangedFiles);

  if (format === "shell") {
    printShellSummary(summary);
    return;
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
