import { spawn, type ChildProcessByStdio } from "node:child_process";
import { access, readFile, readdir, rm, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  HOSTED_WEB_SMOKE_DIST_DIR,
  createHostedWebSmokeEnvironment,
  isHostedWebDevFileSystemCacheEnabled,
} from "../next-artifacts";

const requestTimeoutMs = 30_000;
const serverReadyTimeoutMs = 90_000;
const serverReadyPollIntervalMs = 250;
const childShutdownTimeoutMs = 5_000;
const artifactFreshnessToleranceMs = 2_000;
const hostedWebSmokeLocalEnvEnvVarName = "MURPH_HOSTED_WEB_SMOKE_USE_LOCAL_ENV";
const hostedWebSmokePreparedLocalEnvEnvVarName = "MURPH_HOSTED_WEB_SMOKE_PREPARED_LOCAL_ENV";
const hostedWebSmokePruneCacheEnvVarName = "MURPH_HOSTED_WEB_SMOKE_PRUNE_CACHE";
export const HOSTED_WEB_SMOKE_HEALTH_PATH = "/api/internal/health";

type HostedWebSmokeChildProcess = ChildProcessByStdio<null, Readable, Readable>;
type HostedWebSmokeDevCommand = "dev" | "dev:local-env" | "dev:prepared-local-env";

interface HostedWebSmokeLockCleanupOptions {
  isProcessRunning?: (pid: number) => boolean;
}

export function resolveHostedWebSmokeDevCommand(
  environment: NodeJS.ProcessEnv = process.env,
): HostedWebSmokeDevCommand {
  if (environment[hostedWebSmokePreparedLocalEnvEnvVarName] === "1") {
    return "dev:prepared-local-env";
  }

  if (environment[hostedWebSmokeLocalEnvEnvVarName] === "1") {
    return "dev:local-env";
  }

  const ci = environment.CI?.trim().toLowerCase();
  return ci === "1" || ci === "true" ? "dev:local-env" : "dev";
}

export function shouldPruneHostedWebSmokeCache(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = parseBooleanEnvironmentValue(environment[hostedWebSmokePruneCacheEnvVarName]);

  if (override !== null) {
    return override;
  }

  return parseBooleanEnvironmentValue(environment.CI) === true;
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(packageDir, "../..");
  const distDir = path.join(packageDir, HOSTED_WEB_SMOKE_DIST_DIR);
  const nextLockPath = resolveHostedWebSmokeLockPath(distDir);
  const port = await reserveTcpPort();
  const smokeDevCommand = resolveHostedWebSmokeDevCommand(process.env);
  await clearStaleHostedWebSmokeLocks(nextLockPath);
  if (shouldPruneHostedWebSmokeCache(process.env)) {
    await pruneTurbopackCache(distDir);
  }
  const smokeStartedAtMs = Date.now();
  const child = spawn(
    resolvePnpmCommand(),
    [
      "--dir",
      packageDir,
      smokeDevCommand,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: createHostedWebSmokeEnvironment(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const removeExitCleanup = installProcessExitCleanup(() => {
    terminateChildProcess(child, "SIGKILL");
  });
  const removeSignalCleanup = installProcessTerminationCleanup(child, removeExitCleanup);

  let combinedOutput = "";
  const captureChunk = (chunk: Buffer | string) => {
    combinedOutput += chunk.toString();
    if (combinedOutput.length > 24_000) {
      combinedOutput = combinedOutput.slice(-24_000);
    }
  };

  child.stdout.on("data", captureChunk);
  child.stderr.on("data", captureChunk);

  try {
    await waitForHealthyServer(port, child, () => combinedOutput);
    await assertRequestStatus(port, "GET", HOSTED_WEB_SMOKE_HEALTH_PATH);
    await assertDevArtifacts(distDir, smokeStartedAtMs);
  } finally {
    removeSignalCleanup();
    removeExitCleanup();
    await shutdownHostedWebSmokeChildProcess(child);
    await removeDeadHostedWebSmokeLock(nextLockPath);
  }
}

async function waitForHealthyServer(
  port: number,
  child: HostedWebSmokeChildProcess,
  readOutput: () => string,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < serverReadyTimeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`apps/web dev exited early with code ${child.exitCode}\n${readOutput()}`);
    }

    try {
      const response = await request(port, "GET", HOSTED_WEB_SMOKE_HEALTH_PATH);
      if (response.statusCode === 200) {
        return;
      }
    } catch {
      // Wait for the server to finish booting.
    }

    await sleep(serverReadyPollIntervalMs);
  }

  throw new Error(`Timed out waiting for apps/web dev to boot.\n${readOutput()}`);
}

async function assertRequestStatus(
  port: number,
  method: "GET" | "HEAD",
  pathname: string,
): Promise<void> {
  const response = await request(port, method, pathname);

  if (response.statusCode !== 200) {
    throw new Error(`${method} ${pathname} returned ${response.statusCode}`);
  }
}

async function assertDevArtifacts(distDir: string, smokeStartedAtMs: number): Promise<void> {
  await access(distDir);
  const routeTypesPath = path.join(distDir, "dev", "types", "routes.d.ts");
  const routeTypesStats = await readPathStats(routeTypesPath);

  if (!routeTypesStats || !isHostedWebSmokeArtifactFresh(routeTypesStats, smokeStartedAtMs)) {
    throw new Error(`apps/web dev smoke did not materialize route types under ${distDir}`);
  }

  if (
    isHostedWebDevFileSystemCacheEnabled(process.env)
    && !await hasFreshTurbopackCache(distDir, smokeStartedAtMs)
  ) {
    throw new Error(`apps/web dev smoke did not materialize a Turbopack cache under ${distDir}`);
  }
}

async function hasFreshTurbopackCache(
  distDir: string,
  smokeStartedAtMs: number,
): Promise<boolean> {
  const cacheRoots = [
    path.join(distDir, "dev", "cache", "turbopack"),
    path.join(distDir, "cache", "turbopack"),
  ];

  for (const cacheRoot of cacheRoots) {
    if (await hasFreshTurbopackCacheRoot(cacheRoot, smokeStartedAtMs)) {
      return true;
    }
  }

  return false;
}

async function hasFreshTurbopackCacheRoot(
  cacheRoot: string,
  smokeStartedAtMs: number,
): Promise<boolean> {
  const cacheRootStats = await readPathStats(cacheRoot);
  if (!cacheRootStats) {
    return false;
  }

  if (isHostedWebSmokeArtifactFresh(cacheRootStats, smokeStartedAtMs)) {
    return true;
  }

  let entries;
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }

  for (const entry of entries) {
    const entryStats = await readPathStats(path.join(cacheRoot, entry.name));
    if (entryStats && isHostedWebSmokeArtifactFresh(entryStats, smokeStartedAtMs)) {
      return true;
    }
  }

  return false;
}

export function isHostedWebSmokeArtifactFresh(
  stats: Pick<Stats, "mtimeMs">,
  smokeStartedAtMs: number,
): boolean {
  return (
    stats.mtimeMs + artifactFreshnessToleranceMs >= smokeStartedAtMs
  );
}

async function readPathStats(targetPath: string): Promise<Stats | null> {
  try {
    return await stat(targetPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

async function request(
  port: number,
  method: "GET" | "HEAD",
  pathname: string,
): Promise<{ statusCode: number | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        method,
        path: pathname,
        port,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ statusCode: response.statusCode }));
      },
    );

    req.setTimeout(requestTimeoutMs, () => {
      req.destroy(new Error(`${method} ${pathname} timed out after ${requestTimeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function reserveTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a TCP port for apps/web dev smoke.")));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

function resolveHostedWebSmokeLockPath(distDir: string): string {
  return path.join(distDir, "dev", "lock");
}

export async function clearStaleHostedWebSmokeLocks(
  nextLockPath: string,
  options: HostedWebSmokeLockCleanupOptions = {},
): Promise<void> {
  const checkProcessRunning = options.isProcessRunning ?? isProcessRunning;
  const lockDescriptor = await readHostedWebSmokeLockDescriptor(nextLockPath);

  if (lockDescriptor === null || !checkProcessRunning(lockDescriptor.pid)) {
    await rm(nextLockPath, { force: true });
    return;
  }

  throw new Error(
    `apps/web smoke dist dir has an active process lock (pid ${lockDescriptor.pid}, port ${lockDescriptor.port}). Stop that process before running the smoke test.`,
  );
}

async function readHostedWebSmokeLockDescriptor(
  lockPath: string,
): Promise<{ pid: number; port: number } | null> {
  let rawLock: string;

  try {
    rawLock = await readFile(lockPath, "utf8");
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
    return null;
  }

  if (
    !isJsonObject(parsed)
    || typeof parsed.pid !== "number"
    || !Number.isInteger(parsed.pid)
    || typeof parsed.port !== "number"
    || !Number.isInteger(parsed.port)
  ) {
    return null;
  }

  return {
    pid: parsed.pid,
    port: parsed.port,
  };
}

function installProcessTerminationCleanup(
  child: HostedWebSmokeChildProcess,
  removeExitCleanup: () => void,
): () => void {
  const listeners: Array<readonly [NodeJS.Signals, () => void]> = [];
  let shutdown: Promise<void> | null = null;

  for (const signal of resolveTerminationSignals()) {
    const listener = () => {
      terminateChildProcess(child, signal);
      if (shutdown !== null) {
        return;
      }
      shutdown = shutdownHostedWebSmokeChildProcess(child, signal);
      void shutdown.finally(() => {
        removeListeners();
        removeExitCleanup();
        process.exitCode = signal === "SIGINT" ? 130 : 143;
        process.exit();
      });
    };

    listeners.push([signal, listener]);
    process.on(signal, listener);
  }

  const removeListeners = () => {
    for (const [signal, listener] of listeners) {
      process.removeListener(signal, listener);
    }
  };

  return removeListeners;
}

function installProcessExitCleanup(cleanup: () => void): () => void {
  const handleExit = () => {
    cleanup();
  };

  process.once("exit", handleExit);
  return () => {
    process.removeListener("exit", handleExit);
  };
}

export async function shutdownHostedWebSmokeChildProcess(
  child: HostedWebSmokeChildProcess,
  signal: NodeJS.Signals = "SIGINT",
): Promise<void> {
  const processGroupId = resolveOwnedProcessGroupId(child);
  if (processGroupId !== null) {
    await terminateOwnedProcessGroupAndWait(processGroupId, signal);
    return;
  }

  if (hasChildExited(child)) {
    return;
  }

  terminateChildProcess(child, signal);

  try {
    await waitForChildExit(child, childShutdownTimeoutMs);
    return;
  } catch {
    terminateChildProcess(child, "SIGKILL");
    await waitForChildExit(child, childShutdownTimeoutMs).catch(() => {
      // Best-effort cleanup only.
    });
  }
}

function terminateChildProcess(
  child: HostedWebSmokeChildProcess,
  signal: NodeJS.Signals,
): void {
  const pid = resolveOwnedProcessGroupId(child);

  if (pid !== null) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall back to the direct child below.
    }
  }

  if (!hasChildExited(child)) {
    try {
      child.kill(signal);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function terminateOwnedProcessGroupAndWait(
  processGroupId: number,
  signal: NodeJS.Signals,
): Promise<void> {
  if (!isProcessGroupRunning(processGroupId)) {
    return;
  }

  if (!signalProcessGroup(processGroupId, signal)) {
    return;
  }
  if (await waitForProcessGroupExit(processGroupId, childShutdownTimeoutMs)) {
    return;
  }

  if (!signalProcessGroup(processGroupId, "SIGKILL")) {
    return;
  }
  await waitForProcessGroupExit(processGroupId, childShutdownTimeoutMs);
}

function resolveOwnedProcessGroupId(child: HostedWebSmokeChildProcess): number | null {
  return process.platform !== "win32"
    && typeof child.pid === "number"
    && child.pid > 0
    ? child.pid
    : null;
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

function isProcessGroupRunning(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

async function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessGroupRunning(processGroupId)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return false;
    }
    await sleep(Math.min(serverReadyPollIntervalMs, remainingMs));
  }
  return true;
}

function hasChildExited(child: HostedWebSmokeChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(
  child: HostedWebSmokeChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting ${timeoutMs}ms for apps/web dev smoke child to exit.`));
    }, timeoutMs);

    const handleExit = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("exit", handleExit);
      child.removeListener("error", handleError);
    };

    child.once("exit", handleExit);
    child.once("error", handleError);
  });
}

async function removeDeadHostedWebSmokeLock(lockPath: string): Promise<void> {
  const descriptor = await readHostedWebSmokeLockDescriptor(lockPath);
  if (descriptor === null || !isProcessRunning(descriptor.pid)) {
    await rm(lockPath, { force: true });
  }
}

function resolveTerminationSignals(): NodeJS.Signals[] {
  return process.platform === "win32"
    ? ["SIGINT", "SIGTERM"]
    : ["SIGINT", "SIGTERM", "SIGHUP"];
}

function resolvePnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

async function pruneTurbopackCache(distDir: string): Promise<void> {
  await Promise.all([
    rm(path.join(distDir, "cache", "turbopack"), { force: true, recursive: true }),
    rm(path.join(distDir, "dev", "cache", "turbopack"), { force: true, recursive: true }),
  ]);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBooleanEnvironmentValue(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return null;
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT",
  );
}

function isMissingProcessError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ESRCH",
  );
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) {
      return false;
    }

    return true;
  }
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
