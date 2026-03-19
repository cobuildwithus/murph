import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rememberLaunchCwd } from "../src/lib/vault";

const require = createRequire(import.meta.url);
const fs = require("node:fs") as typeof import("node:fs");
const fsPromises = require("node:fs/promises") as typeof import("node:fs/promises");

let dotEnvGuardsInstalled = false;

const WORKSPACE_RUNTIME_BUILD_TARGETS = [
  {
    buildDir: "../contracts",
    entryRelativePath: "../contracts/dist/index.js",
    packageName: "@healthybob/contracts",
    requiredRelativePaths: ["../contracts/dist/index.js"],
  },
  {
    buildDir: "../runtime-state",
    entryRelativePath: "../runtime-state/dist/index.js",
    packageName: "@healthybob/runtime-state",
    requiredRelativePaths: ["../runtime-state/dist/index.js"],
  },
  {
    buildDir: "../query",
    entryRelativePath: "../query/dist/index.js",
    packageName: "@healthybob/query",
    requiredRelativePaths: [
      "../query/dist/index.js",
      "../query/dist/canonical-entities.js",
      "../query/dist/export-pack.js",
      "../query/dist/export-pack-health.js",
      "../query/dist/health-library.js",
      "../query/dist/health/canonical-collector.js",
      "../query/dist/health/comparators.js",
      "../query/dist/health/loaders.js",
      "../query/dist/health/shared.js",
    ],
  },
] as const;

interface RuntimeBuildTarget {
  buildDir: string;
  entryPath: string;
  packageName: string;
  requiredPaths: string[];
}

export function buildNextCliArgs(argv: readonly string[]): string[] {
  const [command = "dev", ...rest] = argv;
  const args = [command];

  if ((command === "dev" || command === "build") && !hasBundlerFlag(rest)) {
    args.push("--webpack");
  }

  args.push(...rest);
  return args;
}

export function shouldEnsureRuntimeBuild(command: string): boolean {
  return command === "dev" || command === "build" || command === "start";
}

export function resolveQueryBuildEntryPath(packageDir: string): string {
  return resolveRuntimeBuildTargets(packageDir).at(-1)!.entryPath;
}

export function resolveRuntimeBuildTargets(packageDir: string): RuntimeBuildTarget[] {
  return WORKSPACE_RUNTIME_BUILD_TARGETS.map((target) => ({
    buildDir: target.buildDir,
    entryPath: path.resolve(packageDir, target.entryRelativePath),
    packageName: target.packageName,
    requiredPaths: target.requiredRelativePaths.map((relativePath) =>
      path.resolve(packageDir, relativePath),
    ),
  }));
}

export function isBlockedDotEnvPath(value: unknown): boolean {
  const candidatePath = coercePath(value);
  if (!candidatePath) {
    return false;
  }

  const baseName = path.basename(candidatePath);
  return baseName === ".env" || baseName.startsWith(".env.");
}

export function installDotEnvGuards(): void {
  if (dotEnvGuardsInstalled) {
    return;
  }

  dotEnvGuardsInstalled = true;

  const originalStatSync = fs.statSync.bind(fs);
  const originalLstatSync = fs.lstatSync.bind(fs);
  const originalReadFileSync = fs.readFileSync.bind(fs);
  const originalExistsSync = fs.existsSync.bind(fs);
  const originalAccessSync = fs.accessSync.bind(fs);
  const originalOpenSync = fs.openSync.bind(fs);
  const originalStat = fsPromises.stat.bind(fsPromises);
  const originalLstat = fsPromises.lstat.bind(fsPromises);
  const originalReadFile = fsPromises.readFile.bind(fsPromises);
  const originalAccess = fsPromises.access.bind(fsPromises);
  const originalOpen = fsPromises.open.bind(fsPromises);

  overrideProperty(fs, "statSync", ((filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalStatSync(filePath, ...rest);
  }) as typeof fs.statSync);

  overrideProperty(fs, "lstatSync", ((filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalLstatSync(filePath, ...rest);
  }) as typeof fs.lstatSync);

  overrideProperty(fs, "readFileSync", ((filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalReadFileSync(filePath, ...rest);
  }) as typeof fs.readFileSync);

  overrideProperty(fs, "existsSync", ((filePath) => {
    if (isBlockedDotEnvPath(filePath)) {
      return false;
    }

    return originalExistsSync(filePath);
  }) as typeof fs.existsSync);

  overrideProperty(fs, "accessSync", ((filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalAccessSync(filePath, ...rest);
  }) as typeof fs.accessSync);

  overrideProperty(fs, "openSync", ((filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalOpenSync(filePath, ...rest);
  }) as typeof fs.openSync);

  overrideProperty(fsPromises, "stat", (async (filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalStat(filePath, ...rest);
  }) as typeof fsPromises.stat);

  overrideProperty(fsPromises, "lstat", (async (filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalLstat(filePath, ...rest);
  }) as typeof fsPromises.lstat);

  overrideProperty(fsPromises, "readFile", (async (filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalReadFile(filePath, ...rest);
  }) as typeof fsPromises.readFile);

  overrideProperty(fsPromises, "access", (async (filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalAccess(filePath, ...rest);
  }) as typeof fsPromises.access);

  overrideProperty(fsPromises, "open", (async (filePath, ...rest) => {
    throwIfBlocked(filePath);
    return originalOpen(filePath, ...rest);
  }) as typeof fsPromises.open);
}

async function main(): Promise<void> {
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const nextBinPath = path.join(packageDir, "node_modules/next/dist/bin/next");
  const [command = "dev"] = process.argv.slice(2);

  rememberLaunchCwd();
  process.chdir(packageDir);
  installDotEnvGuards();
  await ensureRuntimeBuild(packageDir, command);
  process.argv = [process.execPath, nextBinPath, ...buildNextCliArgs(process.argv.slice(2))];

  await import(pathToFileURL(nextBinPath).href);
}

async function ensureRuntimeBuild(packageDir: string, command: string): Promise<void> {
  if (!shouldEnsureRuntimeBuild(command)) {
    return;
  }

  const missingTargets = await findMissingRuntimeBuildTargets(packageDir);
  if (missingTargets.length === 0) {
    return;
  }

  const invocation = resolvePnpmInvocation();
  for (const target of missingTargets) {
    const result = spawnSync(
      invocation.command,
      [...invocation.prefixArgs, "--dir", target.buildDir, "build"],
      {
        cwd: packageDir,
        stdio: "inherit",
      },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        `Failed to rebuild ${target.packageName} after missing ${target.entryPath}.`,
      );
    }
  }

  const unresolvedTargets = await findMissingRuntimeBuildTargets(packageDir);
  if (unresolvedTargets.length === 0) {
    return;
  }

  throw new Error(
    `Missing runtime build output after rebuild: ${unresolvedTargets.map((target) => target.packageName).join(", ")}.`,
  );
}

async function findMissingRuntimeBuildTargets(packageDir: string): Promise<RuntimeBuildTarget[]> {
  const targets = resolveRuntimeBuildTargets(packageDir);
  const checks = await Promise.all(
    targets.map(async (target) => ({
      missing: !(await Promise.all(target.requiredPaths.map(pathExists))).every(Boolean),
      target,
    })),
  );

  return checks.filter((check) => check.missing).map((check) => check.target);
}

async function pathExists(entryPath: string): Promise<boolean> {
  try {
    await fsPromises.access(entryPath);
    return true;
  } catch {
    return false;
  }
}

function resolvePnpmInvocation(): { command: string; prefixArgs: string[] } {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && path.basename(npmExecPath).startsWith("pnpm")) {
    return {
      command: process.execPath,
      prefixArgs: [npmExecPath],
    };
  }

  return {
    command: "pnpm",
    prefixArgs: [],
  };
}

function hasBundlerFlag(args: readonly string[]): boolean {
  return args.some(
    (value) => value === "--webpack" || value === "--turbopack" || value === "--rspack",
  );
}

function throwIfBlocked(filePath: unknown): void {
  if (!isBlockedDotEnvPath(filePath)) {
    return;
  }

  const error = new Error(
    `ENOENT: no such file or directory, open '${coercePath(filePath) ?? ".env"}'`,
  ) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  throw error;
}

function coercePath(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof URL) {
    return fileURLToPath(value);
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }

  return null;
}

function overrideProperty<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K],
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    value,
    writable: true,
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
