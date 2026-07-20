import { execFile } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export const MURPH_VITEST_TEMP_MARKER = ".murph-vitest-temp-v1.json";
export const MURPH_VITEST_TEMP_PREFIX = "r-";
export const MURPH_VITEST_TEMP_STALE_MS = 24 * 60 * 60 * 1000;
export const murphVitestTempGlobalSetup = fileURLToPath(
  new URL("./vitest-temp-global-setup.ts", import.meta.url),
);

type TestTempMarker = {
  schemaVersion: 1;
  ownerPid: number;
  createdAt: string;
};

export type TestTempCleanupDecision = {
  action: "keep" | "remove" | "removed";
  path: string;
  reason:
    | "active-cwd"
    | "invalid-marker"
    | "live-owner"
    | "remove-failed"
    | "stale"
    | "young";
};

export type TestTempCleanupResult = {
  decisions: TestTempCleanupDecision[];
  ignoredUnmarked: number;
};

export type TestTempCleanupOptions = {
  activeCwds?: readonly string[] | null;
  apply?: boolean;
  baseDirectory?: string;
  isProcessAlive?: (pid: number) => boolean;
  nowMs?: number;
  staleAfterMs?: number;
};

export function resolveMurphTestTempBaseDirectory(): string {
  return process.env.MURPH_VITEST_TEMP_PARENT
    ?? path.join(os.tmpdir(), "mv");
}

export async function cleanupStaleTestTempRoots(
  options: TestTempCleanupOptions = {},
): Promise<TestTempCleanupResult> {
  let baseDirectory: string;
  try {
    baseDirectory = await realpath(
      options.baseDirectory ?? resolveMurphTestTempBaseDirectory(),
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return { decisions: [], ignoredUnmarked: 0 };
    }
    throw error;
  }
  const entries = await readdir(baseDirectory, { withFileTypes: true });
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? MURPH_VITEST_TEMP_STALE_MS;
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  const decisions: TestTempCleanupDecision[] = [];
  const staleCandidates: string[] = [];
  let ignoredUnmarked = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(MURPH_VITEST_TEMP_PREFIX)) {
      continue;
    }

    const candidatePath = path.join(baseDirectory, entry.name);
    const marker = await readMarker(candidatePath);
    if (!marker) {
      ignoredUnmarked += 1;
      decisions.push({ action: "keep", path: candidatePath, reason: "invalid-marker" });
      continue;
    }

    const createdAtMs = Date.parse(marker.createdAt);
    if (nowMs - createdAtMs < staleAfterMs) {
      decisions.push({ action: "keep", path: candidatePath, reason: "young" });
      continue;
    }
    if (isProcessAlive(marker.ownerPid)) {
      decisions.push({ action: "keep", path: candidatePath, reason: "live-owner" });
      continue;
    }

    staleCandidates.push(candidatePath);
  }

  const activeCwds = staleCandidates.length === 0
    ? []
    : options.activeCwds === undefined
      ? await readCurrentUserProcessCwds()
      : options.activeCwds;
  const canonicalActiveCwds = activeCwds === null
    ? null
    : await canonicalizeExistingPaths(activeCwds);
  for (const candidatePath of staleCandidates) {
    if (
      canonicalActiveCwds === null
      || canonicalActiveCwds.some((cwd) => isPathWithin(candidatePath, cwd))
    ) {
      decisions.push({ action: "keep", path: candidatePath, reason: "active-cwd" });
      continue;
    }

    decisions.push({
      action: options.apply ? "removed" : "remove",
      path: candidatePath,
      reason: "stale",
    });
  }

  if (options.apply) {
    const removable = decisions.filter((decision) => decision.action === "removed");
    await runBounded(removable, 8, async (decision) => {
      try {
        await rm(decision.path, { force: true, recursive: true });
      } catch {
        decision.action = "keep";
        decision.reason = "remove-failed";
      }
    });
  }

  return { decisions, ignoredUnmarked };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

async function readMarker(candidatePath: string): Promise<TestTempMarker | null> {
  try {
    const candidateStats = await lstat(candidatePath);
    if (!candidateStats.isDirectory() || candidateStats.isSymbolicLink()) return null;

    const markerPath = path.join(candidatePath, MURPH_VITEST_TEMP_MARKER);
    const markerStats = await lstat(markerPath);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) return null;
    const parsed = JSON.parse(await readFile(markerPath, "utf8")) as Partial<TestTempMarker>;
    if (
      parsed.schemaVersion !== 1
      || !Number.isSafeInteger(parsed.ownerPid)
      || (parsed.ownerPid ?? 0) <= 0
      || typeof parsed.createdAt !== "string"
      || !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      return null;
    }
    return parsed as TestTempMarker;
  } catch {
    return null;
  }
}

async function canonicalizeExistingPaths(paths: readonly string[]): Promise<string[]> {
  const canonicalPaths: string[] = [];
  for (const candidatePath of paths) {
    try {
      canonicalPaths.push(await realpath(candidatePath));
    } catch {
      // A process may exit between enumeration and canonicalization.
    }
  }
  return canonicalPaths;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}

async function readCurrentUserProcessCwds(): Promise<string[] | null> {
  if (process.platform === "linux") return readLinuxProcessCwds();
  if (process.platform === "darwin") return readDarwinProcessCwds();
  return null;
}

async function readLinuxProcessCwds(): Promise<string[]> {
  const entries = await readdir("/proc", { withFileTypes: true });
  const cwdPaths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    try {
      cwdPaths.push(await readlink(path.join("/proc", entry.name, "cwd")));
    } catch {
      // Other users' and short-lived processes are expected to be unreadable.
    }
  }
  return cwdPaths;
}

async function readDarwinProcessCwds(): Promise<string[] | null> {
  if (typeof process.getuid !== "function") return null;
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-n", "-w", "-a", "-d", "cwd", "-u", String(process.getuid()), "-Fn"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout
      .split("\n")
      .filter((line) => line.startsWith("n/"))
      .map((line) => line.slice(1));
  } catch {
    return null;
  }
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`);
}

async function runBounded<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex];
        nextIndex += 1;
        if (value !== undefined) await operation(value);
      }
    },
  );
  await Promise.all(workers);
}
