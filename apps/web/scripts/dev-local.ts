import { existsSync, readFileSync, rmSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { resolveHostedWebDistDir } from "../next-artifacts";
import { assertHostedWebDatabaseUrlConfigured } from "../src/lib/hosted-web/database-env";

const DEFAULT_DEV_CACHE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;
const hostedWebDevBundlerEnvVarName = "MURPH_NEXT_DEV_BUNDLER";
const hostedWebDevCacheLimitEnvVarName = "MURPH_NEXT_DEV_CACHE_LIMIT_MB";
const hostedWebDevLockDirectoryName = ".dev-server.lock";
const hostedWebDevLockMetadataFileName = "owner.json";
const hostedWebDevOwnerPidEnvVarName = "MURPH_HOSTED_WEB_DEV_OWNER_PID";
const hostedWebDevSourceMapsEnvVarName = "MURPH_NEXT_DEV_SOURCE_MAPS";
const ownerWatchdogPollIntervalMs = 2_000;

interface HostedWebDevServerLockMetadata {
  command: string;
  pid: number;
  port: number;
  startedAt: string;
}

interface HostedWebDevRuntimePaths {
  distDir: string;
  distDirName: string;
  lockMetadataPath: string;
  lockPath: string;
  nextDevLockPath: string;
  turbopackCacheDir: string;
}

interface NextDevLockDescriptor {
  pid: number;
  port: number;
}

interface NextDevLockCleanupOptions {
  isProcessRunning?: (pid: number) => boolean;
}

export function buildHostedWebDevArgv(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const resolvedArgv = argv[0] === "--" ? [...argv.slice(1)] : [...argv];

  if (!resolvedArgv.includes("--turbopack") && !resolvedArgv.includes("--webpack")) {
    resolvedArgv.push(resolveHostedWebDevBundlerFlag(environment));
  }

  if (
    environment[hostedWebDevSourceMapsEnvVarName] === "1"
    || resolvedArgv.includes("--disable-source-maps")
  ) {
    return resolvedArgv;
  }

  return [...resolvedArgv, "--disable-source-maps"];
}

export function resolveHostedWebDevCacheLimitBytes(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const configuredLimitMegabytes = Number.parseInt(
    environment[hostedWebDevCacheLimitEnvVarName] ?? "",
    10,
  );

  if (!Number.isFinite(configuredLimitMegabytes) || configuredLimitMegabytes <= 0) {
    return DEFAULT_DEV_CACHE_LIMIT_BYTES;
  }

  return configuredLimitMegabytes * 1024 * 1024;
}

export function resolveHostedWebDevOwnerPid(
  environment: NodeJS.ProcessEnv = process.env,
): number | null {
  const rawOwnerPid = environment[hostedWebDevOwnerPidEnvVarName]?.trim();

  if (!rawOwnerPid) {
    return null;
  }

  const ownerPid = Number.parseInt(rawOwnerPid, 10);
  return Number.isInteger(ownerPid) && ownerPid > 0 ? ownerPid : null;
}

export function assertHostedWebDevRequiredEnv(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  assertHostedWebDatabaseUrlConfigured(environment);
}

export function loadHostedWebDevLocalEnv(packageDir: string): void {
  for (const envFile of [".env.local", ".env"]) {
    const envPath = path.join(packageDir, envFile);
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
}

export function resolveHostedWebDevRuntimePaths(
  packageDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): HostedWebDevRuntimePaths {
  const distDirName = resolveHostedWebDistDir(PHASE_DEVELOPMENT_SERVER, environment);
  const distDir = path.join(packageDir, distDirName);
  const lockPath = path.join(distDir, hostedWebDevLockDirectoryName);

  return {
    distDir,
    distDirName,
    lockMetadataPath: path.join(lockPath, hostedWebDevLockMetadataFileName),
    lockPath,
    nextDevLockPath: path.join(distDir, "dev", "lock"),
    turbopackCacheDir: path.join(distDir, "dev", "cache", "turbopack"),
  };
}

async function main(): Promise<void> {
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const nextBinPath = path.join(packageDir, "node_modules/next/dist/bin/next");
  const runtimePaths = resolveHostedWebDevRuntimePaths(packageDir, process.env);

  loadHostedWebDevLocalEnv(packageDir);
  assertHostedWebDevRequiredEnv(process.env);
  process.chdir(packageDir);
  const releaseLock = await acquireHostedWebDevServerLock(
    runtimePaths,
    process.argv.slice(2),
    process.env,
  );
  const releaseOwnerWatchdog = installHostedWebDevOwnerWatchdog(process.env);
  const releaseSignalShutdown = installHostedWebDevSignalShutdown(
    releaseLock,
    releaseOwnerWatchdog,
  );
  process.argv = [
    process.execPath,
    nextBinPath,
    ...buildHostedWebDevArgv(process.argv.slice(2), process.env),
  ];

  try {
    await clearConflictingNextDevLock(runtimePaths.nextDevLockPath);
    await pruneOversizedHostedWebDevArtifacts(runtimePaths, process.env);
    await import(pathToFileURL(nextBinPath).href);
    // The Next CLI returns after booting dev, while the server keeps the event loop alive.
    // Keep this wrapper alive so its lock and signal cleanup remain active.
    await new Promise<never>(() => {});
  } finally {
    releaseSignalShutdown();
    releaseOwnerWatchdog();
    await releaseLock();
  }
}

async function acquireHostedWebDevServerLock(
  runtimePaths: HostedWebDevRuntimePaths,
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<() => Promise<void>> {
  await mkdir(path.dirname(runtimePaths.lockPath), { recursive: true });

  while (true) {
    try {
      await mkdir(runtimePaths.lockPath);
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const existingOwner = await inspectHostedWebDevServerLock(runtimePaths.lockMetadataPath);

      if (existingOwner.state === "stale") {
        await rm(runtimePaths.lockPath, { force: true, recursive: true });
        continue;
      }

      throw new Error(
        `Another apps/web dev server is already running for ${runtimePaths.distDirName} (${formatHostedWebDevServerOwner(existingOwner.metadata)}). Stop it before starting another one.`,
      );
    }
  }

  const releaseExitHandler = () => {
    removeHostedWebDevServerLockIfOwnedSync(runtimePaths);
  };

  try {
    await writeFile(
      runtimePaths.lockMetadataPath,
      `${JSON.stringify(createHostedWebDevServerLockMetadata(argv, environment), null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    rmSync(runtimePaths.lockPath, { force: true, recursive: true });
    throw error;
  }

  process.once("exit", releaseExitHandler);
  let released = false;

  return async () => {
    if (released) {
      return;
    }

    released = true;
    try {
      await removeHostedWebDevServerLockIfOwned(runtimePaths);
    } finally {
      process.off("exit", releaseExitHandler);
    }
  };
}

export async function removeHostedWebDevServerLockIfOwned(
  runtimePaths: Pick<HostedWebDevRuntimePaths, "lockMetadataPath" | "lockPath">,
): Promise<void> {
  const metadata = await readHostedWebDevServerLockMetadata(runtimePaths.lockMetadataPath);
  if (metadata?.pid === process.pid) {
    await rm(runtimePaths.lockPath, { force: true, recursive: true });
  }
}

function removeHostedWebDevServerLockIfOwnedSync(
  runtimePaths: Pick<HostedWebDevRuntimePaths, "lockMetadataPath" | "lockPath">,
): void {
  let metadata: HostedWebDevServerLockMetadata | null;

  try {
    metadata = readHostedWebDevServerLockMetadataSync(runtimePaths.lockMetadataPath);
  } catch {
    return;
  }

  if (metadata?.pid === process.pid) {
    rmSync(runtimePaths.lockPath, { force: true, recursive: true });
  }
}

function createHostedWebDevServerLockMetadata(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): HostedWebDevServerLockMetadata {
  return {
    command: buildProcessCommand(),
    pid: process.pid,
    port: resolveHostedWebDevPort(argv, environment),
    startedAt: new Date().toISOString(),
  };
}

function installHostedWebDevOwnerWatchdog(
  environment: NodeJS.ProcessEnv,
): () => void {
  const ownerPid = resolveHostedWebDevOwnerPid(environment);

  if (ownerPid === null) {
    return () => {};
  }

  let shuttingDown = false;
  const interval = setInterval(() => {
    if (shuttingDown || isProcessRunning(ownerPid)) {
      return;
    }

    shuttingDown = true;
    process.exit(0);
  }, ownerWatchdogPollIntervalMs);
  interval.unref?.();

  return () => {
    clearInterval(interval);
  };
}

function installHostedWebDevSignalShutdown(
  releaseLock: () => Promise<void>,
  releaseOwnerWatchdog: () => void,
): () => void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    releaseHandlers();
    releaseOwnerWatchdog();
    void releaseLock().finally(() => {
      process.exit(resolveHostedWebDevSignalExitCode(signal));
    });
  };

  const handlers = new Map<NodeJS.Signals, () => void>(
    signals.map((signal) => [signal, () => shutdown(signal)]),
  );

  for (const [signal, handler] of handlers) {
    process.once(signal, handler);
  }

  function releaseHandlers(): void {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  }

  return releaseHandlers;
}

function resolveHostedWebDevSignalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    default:
      return 1;
  }
}

async function inspectHostedWebDevServerLock(
  lockMetadataPath: string,
): Promise<
  | { state: "active"; metadata: HostedWebDevServerLockMetadata }
  | { state: "stale" }
> {
  const metadata = await readHostedWebDevServerLockMetadata(lockMetadataPath);
  if (metadata === null) {
    return { state: "stale" };
  }

  if (!isProcessRunning(metadata.pid)) {
    return { state: "stale" };
  }

  return {
    state: "active",
    metadata,
  };
}

async function readHostedWebDevServerLockMetadata(
  lockMetadataPath: string,
): Promise<HostedWebDevServerLockMetadata | null> {
  try {
    return parseHostedWebDevServerLockMetadata(await readFile(lockMetadataPath, "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

function readHostedWebDevServerLockMetadataSync(
  lockMetadataPath: string,
): HostedWebDevServerLockMetadata | null {
  try {
    return parseHostedWebDevServerLockMetadata(readFileSync(lockMetadataPath, "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

function parseHostedWebDevServerLockMetadata(
  rawMetadata: string,
): HostedWebDevServerLockMetadata | null {
  let metadata: unknown;

  try {
    metadata = JSON.parse(rawMetadata);
  } catch {
    return null;
  }

  return isHostedWebDevServerLockMetadata(metadata) ? metadata : null;
}

async function pruneOversizedHostedWebDevArtifacts(
  runtimePaths: HostedWebDevRuntimePaths,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const cacheSizeBytes = await getDirectorySizeBytes(runtimePaths.turbopackCacheDir);
  const cacheLimitBytes = resolveHostedWebDevCacheLimitBytes(environment);

  if (cacheSizeBytes <= cacheLimitBytes) {
    return;
  }

  await rm(runtimePaths.turbopackCacheDir, { force: true, recursive: true });
  process.stderr.write(
    `Pruned hosted-web ${runtimePaths.distDirName} Turbopack cache after it reached ${formatBytes(cacheSizeBytes)} (limit ${formatBytes(cacheLimitBytes)}).\n`,
  );
}

function resolveHostedWebDevBundlerFlag(environment: NodeJS.ProcessEnv): "--turbopack" | "--webpack" {
  return environment[hostedWebDevBundlerEnvVarName] === "webpack" ? "--webpack" : "--turbopack";
}

function resolveHostedWebDevPort(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const resolvedArgv = argv[0] === "--" ? argv.slice(1) : argv;

  for (let index = 0; index < resolvedArgv.length; index += 1) {
    const argument = resolvedArgv[index];

    if (argument === "--port" || argument === "-p") {
      const parsed = Number.parseInt(resolvedArgv[index + 1] ?? "", 10);

      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }

      continue;
    }

    if (argument.startsWith("--port=")) {
      const parsed = Number.parseInt(argument.slice("--port=".length), 10);

      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  const envPort = Number.parseInt(environment.PORT ?? "", 10);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

async function getDirectorySizeBytes(directoryPath: string): Promise<number> {
  let entries;

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return 0;
    }

    throw error;
  }

  let totalSizeBytes = 0;

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      totalSizeBytes += await getDirectorySizeBytes(entryPath);
      continue;
    }

    const stats = await lstat(entryPath);
    totalSizeBytes += stats.size;
  }

  return totalSizeBytes;
}

function formatBytes(value: number): string {
  const gibibytes = value / (1024 * 1024 * 1024);

  if (gibibytes >= 1) {
    return `${gibibytes.toFixed(1)} GiB`;
  }

  const mebibytes = value / (1024 * 1024);

  if (mebibytes >= 1) {
    return `${mebibytes.toFixed(0)} MiB`;
  }

  return `${value} B`;
}

function formatHostedWebDevServerOwner(metadata: HostedWebDevServerLockMetadata): string {
  return `pid ${metadata.pid}, port ${metadata.port}, command ${metadata.command}`;
}

function buildProcessCommand(argv: readonly string[] = process.argv): string {
  const parts = [argv[0], argv[1]]
    .map((value) => (typeof value === "string" && value.trim().length > 0 ? path.basename(value) : ""))
    .filter(Boolean);

  return parts.join(" ").trim() || "unknown";
}

export async function clearConflictingNextDevLock(
  nextDevLockPath: string,
  options: NextDevLockCleanupOptions = {},
): Promise<void> {
  const checkProcessRunning = options.isProcessRunning ?? isProcessRunning;
  const descriptor = await readNextDevLockDescriptor(nextDevLockPath);

  if (descriptor === null) {
    return;
  }

  if (!checkProcessRunning(descriptor.pid)) {
    await rm(nextDevLockPath, { force: true });
    return;
  }

  throw new Error(
    [
      `Next dev lock is held by an active process (pid ${descriptor.pid}, port ${descriptor.port}).`,
      "Stop that process or use a separate apps/web dist directory.",
    ].join(" "),
  );
}

async function readNextDevLockDescriptor(
  nextDevLockPath: string,
): Promise<NextDevLockDescriptor | null> {
  let rawLock: string;

  try {
    rawLock = await readFile(nextDevLockPath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawLock);
  } catch {
    await rm(nextDevLockPath, { force: true });
    return null;
  }

  if (
    !parsed
    || typeof parsed !== "object"
    || !("pid" in parsed)
    || !("port" in parsed)
    || typeof parsed.pid !== "number"
    || !Number.isInteger(parsed.pid)
    || typeof parsed.port !== "number"
    || !Number.isInteger(parsed.port)
  ) {
    await rm(nextDevLockPath, { force: true });
    return null;
  }

  return {
    pid: parsed.pid,
    port: parsed.port,
  };
}

function isHostedWebDevServerLockMetadata(value: unknown): value is HostedWebDevServerLockMetadata {
  return Boolean(
    value
    && typeof value === "object"
    && "command" in value
    && "pid" in value
    && "port" in value
    && "startedAt" in value
    && typeof value.command === "string"
    && typeof value.pid === "number"
    && Number.isInteger(value.pid)
    && typeof value.port === "number"
    && Number.isInteger(value.port)
    && typeof value.startedAt === "string",
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "EEXIST",
  );
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ESRCH"
    ) {
      return false;
    }

    return true;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
