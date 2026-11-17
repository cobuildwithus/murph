#!/usr/bin/env node
// @ts-check
// Which Host Support jobs a pull request's diff can reach. Main pushes, and
// any diff this can't place inside one workspace package or app, run
// everything; the main push after merge always runs everything anyway.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Each app's tests read the other's files (Prisma schema, route contracts),
// so they are reached together.
export const COUPLED_APPS = Object.freeze(["apps/cloudflare", "apps/web"]);
const APP_REFERENCE = /\bapps\/(?:web|cloudflare)\b/u;

/** @param {string} root */
function workspaceDirs(root) {
  return ["apps", "packages"].flatMap((parent) =>
    readdirSync(path.join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()
        && existsSync(path.join(root, parent, entry.name, "package.json")))
      .map((entry) => `${parent}/${entry.name}`))
    .sort();
}

/**
 * Test files under `directory` that name an app path outside a comment: they
 * read that app's files, so they run whenever an app is reached.
 * @param {string} root @param {string} directory
 */
function appReferencingTests(root, directory) {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  const files = [];
  for (const entry of readdirSync(absolute, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.test\.[cm]?[jt]sx?$/u.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const code = readFileSync(file, "utf8").split("\n")
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line));
    if (code.some((line) => APP_REFERENCE.test(line))) {
      files.push(path.relative(root, file).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

/**
 * The workspace: package dirs, who depends on each, and the package test
 * files that read an app's files.
 * @param {string} root
 */
export function readWorkspace(root = repoRoot) {
  const dirs = workspaceDirs(root);
  const byName = new Map();
  const manifests = new Map();
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8"));
    manifests.set(dir, manifest);
    byName.set(manifest.name, dir);
  }
  /** @type {Map<string, string[]>} */
  const dependents = new Map(dirs.map((dir) => [dir, []]));
  for (const dir of dirs) {
    const manifest = manifests.get(dir);
    const names = new Set(Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    }));
    for (const name of names) {
      const dependency = byName.get(name);
      if (dependency && dependency !== dir) dependents.get(dependency)?.push(dir);
    }
  }
  /** @type {Map<string, string[]>} */
  const appTests = new Map();
  for (const dir of dirs.filter((candidate) => candidate.startsWith("packages/"))) {
    const files = appReferencingTests(root, path.posix.join(dir, "test"));
    if (files.length > 0) appTests.set(dir, files);
  }
  return { dirs, dependents, appTests };
}

/**
 * `changed` is every workspace dir whose code the diff changes, directly or
 * through a dependency. Both apps run when either is in it; then each other
 * package's tests that read app files run too (`appTests`, by package).
 * @param {string[]} changedFiles
 * @param {ReturnType<typeof readWorkspace>} workspace
 * @returns {{ full: boolean, changed: string[], apps: boolean, appTests: Record<string, string[]> }}
 */
export function diffReach(changedFiles, workspace) {
  const everything = { full: true, changed: [...workspace.dirs], apps: true, appTests: {} };
  if (changedFiles.length === 0) return everything;
  const changed = new Set();
  for (const file of changedFiles) {
    const dir = workspace.dirs.find((candidate) => file.startsWith(`${candidate}/`));
    if (!dir) return everything;
    changed.add(dir);
  }
  const queue = [...changed];
  while (queue.length > 0) {
    const dir = /** @type {string} */ (queue.pop());
    for (const dependent of workspace.dependents.get(dir) ?? []) {
      if (!changed.has(dependent)) {
        changed.add(dependent);
        queue.push(dependent);
      }
    }
  }
  const apps = COUPLED_APPS.some((app) => changed.has(app));
  /** @type {Record<string, string[]>} */
  const appTests = {};
  if (apps) {
    for (const [dir, files] of workspace.appTests) {
      if (!changed.has(dir)) appTests[dir] = files;
    }
  }
  return { full: false, changed: [...changed].sort(), apps, appTests };
}

/**
 * The files a pull request's merge commit changes against its base, or null
 * when they can't be read exactly (then everything runs).
 * @param {string} root
 */
function mergeCommitChanges(root) {
  try {
    const parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", "HEAD"],
      { cwd: root, encoding: "utf8" }).trim().split(" ");
    if (parents.length !== 3) return null;
    const output = execFileSync("git", ["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"],
      { cwd: root, encoding: "utf8" });
    return output.split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

/** @param {NodeJS.ProcessEnv} env @param {string} root */
export function currentReach(env = process.env, root = repoRoot) {
  const workspace = readWorkspace(root);
  const changed = env.GITHUB_EVENT_NAME === "pull_request" ? mergeCommitChanges(root) : null;
  return changed === null ? diffReach([], workspace) : diffReach(changed, workspace);
}

/** @param {ReturnType<typeof diffReach>} reach */
export function reachOutputs(reach) {
  return {
    full: String(reach.full),
    // Both apps, and so the Web and Cloudflare jobs, run together.
    apps: String(reach.apps),
    // The runner bundle is built from Cloudflare's own dependency closure.
    runner_bundle: String(reach.changed.includes("apps/cloudflare")),
    cli: String(reach.changed.includes("packages/cli")),
    packages: JSON.stringify(reach.changed.filter((dir) => dir.startsWith("packages/"))),
    app_tests: JSON.stringify(reach.appTests),
  };
}

/**
 * Runs each reached package's app-file tests through that package's own
 * `test` script, without coverage. Returns the exit code.
 * @param {ReturnType<typeof diffReach>} reach
 */
function runAppTests(reach) {
  for (const [dir, files] of Object.entries(reach.appTests)) {
    const relative = files.map((file) => file.slice(dir.length + 1));
    console.log(`[ci-diff-reach] ${dir}: ${relative.join(" ")}`);
    const result = spawnSync("pnpm", ["--dir", dir, "test", ...relative],
      { cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"] });
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

/** @param {string[]} argv */
function main(argv) {
  if (argv.length === 1 && argv[0] === "--run-app-tests") {
    process.exitCode = runAppTests(currentReach());
    return;
  }
  const outputIndex = argv.indexOf("--github-output");
  const output = outputIndex === -1 ? undefined : argv[outputIndex + 1];
  const reach = currentReach();
  const outputs = reachOutputs(reach);
  console.log(`[ci-diff-reach] ${reach.full ? "full run" : `changed: ${reach.changed.join(", ") || "none"}; apps: ${reach.apps}`}`);
  if (output) {
    appendFileSync(output, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Diff reach failed.");
    process.exitCode = 1;
  }
}
