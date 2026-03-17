import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rememberLaunchCwd } from "../src/lib/vault";

const LOCAL_HOST = "127.0.0.1";
const QUERY_BUILD_ENTRY_RELATIVE_PATH = "../query/dist/index.js";
const require = createRequire(import.meta.url);
const fs = require("node:fs") as typeof import("node:fs");
const fsPromises = require("node:fs/promises") as typeof import("node:fs/promises");

let dotEnvGuardsInstalled = false;

export function buildNextCliArgs(argv: readonly string[]): string[] {
  const [command = "dev", ...rest] = argv;
  const args = [command];

  if ((command === "dev" || command === "start") && !hasHostFlag(rest)) {
    args.push("--hostname", LOCAL_HOST);
  }

  if ((command === "dev" || command === "build") && !hasBundlerFlag(rest)) {
    args.push("--webpack");
  }

  args.push(...rest);
  return args;
}

export function shouldEnsureQueryBuild(command: string): boolean {
  return command === "dev" || command === "build" || command === "start";
}

export function resolveQueryBuildEntryPath(packageDir: string): string {
  return path.resolve(packageDir, QUERY_BUILD_ENTRY_RELATIVE_PATH);
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
  await ensureQueryBuild(packageDir, command);
  process.argv = [process.execPath, nextBinPath, ...buildNextCliArgs(process.argv.slice(2))];

  await import(pathToFileURL(nextBinPath).href);
}

async function ensureQueryBuild(packageDir: string, command: string): Promise<void> {
  if (!shouldEnsureQueryBuild(command)) {
    return;
  }

  const queryBuildEntryPath = resolveQueryBuildEntryPath(packageDir);

  try {
    await fsPromises.access(queryBuildEntryPath);
    return;
  } catch {
    // Fall through and rebuild the workspace package when the expected build output is absent.
  }

  const invocation = resolvePnpmInvocation();
  const result = spawnSync(
    invocation.command,
    [...invocation.prefixArgs, "--dir", "../query", "build"],
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
      `Failed to rebuild @healthybob/query after missing ${queryBuildEntryPath}.`,
    );
  }

  await fsPromises.access(queryBuildEntryPath);
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

function hasHostFlag(args: readonly string[]): boolean {
  return args.some((value) => value === "--hostname" || value === "-H");
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
