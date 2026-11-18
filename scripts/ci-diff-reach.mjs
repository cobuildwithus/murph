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

// The hosted runner bundle also ships the CLI, which Cloudflare's manifest
// doesn't list (hostedRunnerBundleOnlyDependencyNames in
// apps/cloudflare/scripts/runner-bundle-contract.ts; its test checks this).
export const BUNDLE_ONLY_DEPENDENCIES = Object.freeze({
  "apps/cloudflare": Object.freeze(["@murphai/murph"]),
});

const SOURCE_FILE = /\.[cm]?[jt]sx?$/u;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/u;
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/u;
// "packages/cli/src", path.join(root, "packages", "cli"), "../../cli/src".
const WORKSPACE_PATH = /\b((?:apps|packages)\/[\w.-]+)/gu;
const JOINED_PATH = /["'](apps|packages)["']\s*,\s*["']([\w.-]+)["']/gu;
const RELATIVE_PATH = /["'`]((?:\.\.\/)+[\w.@-]+)/gu;
const LOCAL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/gu;
const IMPORT_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  "/index.ts", "/index.js"];

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
 * The other workspace dirs each test file under `dir/test` reads, by a path
 * outside a comment in it or in a local file it imports (test helpers).
 * @param {string} root @param {string} dir @param {string[]} dirs
 * @returns {Map<string, string[]>} test file -> dirs it reads
 */
function testFileReads(root, dir, dirs) {
  const testDir = path.join(root, dir, "test");
  if (!existsSync(testDir)) return new Map();
  /** @param {string} target */
  const owner = (target) => dirs.find((candidate) =>
    target === candidate || target.startsWith(`${candidate}/`));
  /** @type {Map<string, { reads: Set<string>, imports: string[] }>} */
  const files = new Map();
  for (const entry of readdirSync(testDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE_FILE.test(entry.name)) continue;
    const file = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
    const code = readFileSync(path.join(root, file), "utf8").split("\n")
      .filter((line) => !COMMENT_LINE.test(line)).join("\n");
    const reads = new Set();
    for (const [, target] of code.matchAll(WORKSPACE_PATH)) reads.add(owner(target));
    for (const [, parent, name] of code.matchAll(JOINED_PATH)) reads.add(owner(`${parent}/${name}`));
    for (const [, relative] of code.matchAll(RELATIVE_PATH)) {
      for (const base of [path.posix.dirname(file), dir]) {
        reads.add(owner(path.posix.normalize(path.posix.join(base, relative))));
      }
    }
    reads.delete(undefined);
    reads.delete(dir);
    const imports = [...code.matchAll(LOCAL_IMPORT)].map(([, specifier]) =>
      path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
    files.set(file, { reads, imports });
  }
  /** @param {string} specifier */
  const resolve = (specifier) => IMPORT_SUFFIXES
    .flatMap((suffix) => [specifier.replace(/\.[cm]?jsx?$/u, "") + suffix, specifier + suffix])
    .find((candidate) => files.has(candidate));
  for (let grew = true; grew;) {
    grew = false;
    for (const { reads, imports } of files.values()) {
      for (const specifier of imports) {
        for (const read of files.get(resolve(specifier) ?? "")?.reads ?? []) {
          if (!reads.has(read)) {
            reads.add(read);
            grew = true;
          }
        }
      }
    }
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b))
    .filter(([file, { reads }]) => TEST_FILE.test(file) && reads.size > 0)
    .map(([file, { reads }]) => [file, [...reads].sort()]));
}

/**
 * The workspace: package dirs, who depends on each, and the package test
 * files that read another workspace dir's files. An app whose tests read a
 * dir depends on it, since apps always run whole.
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
  for (const [dir, names] of Object.entries(BUNDLE_ONLY_DEPENDENCIES)) {
    for (const name of names) {
      const dependency = byName.get(name);
      if (!dependency) throw new Error(`Unknown bundle-only dependency ${name}.`);
      dependents.get(dependency)?.push(dir);
    }
  }
  /** @type {Array<{ dir: string, file: string, reads: string[] }>} */
  const readers = [];
  for (const dir of dirs) {
    for (const [file, reads] of testFileReads(root, dir, dirs)) {
      if (dir.startsWith("apps/")) {
        for (const read of reads) dependents.get(read)?.push(dir);
      } else {
        readers.push({ dir, file, reads });
      }
    }
  }
  return { dirs, byName, dependents, readers };
}

/**
 * `changed` is every workspace dir whose code the diff changes, directly or
 * through a dependency. Both apps run when either is in it. Each other
 * package's test files that read a reached dir's files run too
 * (`readerTests`, by package).
 * @param {string[]} changedFiles
 * @param {ReturnType<typeof readWorkspace>} workspace
 * @returns {{ full: boolean, changed: string[], apps: boolean, readerTests: Record<string, string[]> }}
 */
export function diffReach(changedFiles, workspace) {
  const everything = { full: true, changed: [...workspace.dirs], apps: true, readerTests: {} };
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
  const reached = new Set([...changed, ...(apps ? COUPLED_APPS : [])]);
  /** @type {Record<string, string[]>} */
  const readerTests = {};
  for (const { dir, file, reads } of workspace.readers) {
    if (!changed.has(dir) && reads.some((read) => reached.has(read))) {
      (readerTests[dir] ??= []).push(file);
    }
  }
  return { full: false, changed: [...changed].sort(), apps, readerTests };
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
    // The runner bundle is built from Cloudflare's dependency closure plus
    // its bundle-only dependencies.
    runner_bundle: String(reach.changed.includes("apps/cloudflare")),
    cli: String(reach.changed.includes("packages/cli")),
    packages: JSON.stringify(reach.changed.filter((dir) => dir.startsWith("packages/"))),
    reader_tests: JSON.stringify(reach.readerTests),
  };
}

/**
 * Runs each unreached package's test files that read reached files, through
 * that package's own `test` script, without coverage. Returns the exit code.
 * @param {ReturnType<typeof diffReach>} reach
 */
function runReaderTests(reach) {
  for (const [dir, files] of Object.entries(reach.readerTests)) {
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
  if (argv.length === 1 && argv[0] === "--run-reader-tests") {
    process.exitCode = runReaderTests(currentReach());
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
