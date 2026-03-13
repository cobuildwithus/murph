import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { VaultError } from "../errors.js";
import { ensureDirectory, pathExists, readJsonFile } from "../fs.js";
import { normalizeVaultRoot, resolveVaultPath } from "../path-safety.js";
import { toIsoTimestamp } from "../time.js";
import { isErrnoException, isPlainRecord } from "../types.js";

export const CANONICAL_WRITE_LOCK_DIRECTORY = ".runtime/locks/canonical-write";
export const CANONICAL_WRITE_LOCK_METADATA_PATH = `${CANONICAL_WRITE_LOCK_DIRECTORY}/owner.json`;

export interface CanonicalWriteLockMetadata {
  pid: number;
  command: string;
  startedAt: string;
  host: string;
}

export interface CanonicalWriteLockHandle {
  readonly metadata: CanonicalWriteLockMetadata;
  readonly relativePath: typeof CANONICAL_WRITE_LOCK_DIRECTORY;
  release(): Promise<void>;
}

export type CanonicalWriteLockInspection =
  | {
      state: "unlocked";
      relativePath: typeof CANONICAL_WRITE_LOCK_DIRECTORY;
    }
  | {
      state: "active";
      relativePath: typeof CANONICAL_WRITE_LOCK_DIRECTORY;
      metadata: CanonicalWriteLockMetadata;
    }
  | {
      state: "stale";
      relativePath: typeof CANONICAL_WRITE_LOCK_DIRECTORY;
      metadata: CanonicalWriteLockMetadata | null;
      reason: string;
    };

interface ProcessLockState {
  depth: number;
  metadata: CanonicalWriteLockMetadata;
}

const processLocks = new Map<string, ProcessLockState>();

function normalizeHost(): string {
  return `sha256:${createHash("sha256").update(os.hostname()).digest("hex").slice(0, 12)}`;
}

function normalizeCommand(): string {
  const parts = [process.argv[0], process.argv[1]]
    .map((value) => (typeof value === "string" && value.trim().length > 0 ? path.basename(value) : ""))
    .filter(Boolean);

  return parts.join(" ").trim() || "unknown";
}

function buildMetadata(): CanonicalWriteLockMetadata {
  return {
    pid: process.pid,
    command: normalizeCommand(),
    startedAt: toIsoTimestamp(new Date(), "startedAt"),
    host: normalizeHost(),
  };
}

function toLockFailureMessage(inspection: Exclude<CanonicalWriteLockInspection, { state: "unlocked" }>): string {
  if (inspection.state === "stale") {
    const details = inspection.metadata
      ? ` pid=${inspection.metadata.pid} startedAt=${inspection.metadata.startedAt} command=${inspection.metadata.command}.`
      : "";
    return `Canonical vault writes are blocked by a stale lock at "${inspection.relativePath}" (${inspection.reason}).${details}`;
  }

  const { metadata } = inspection;
  return `Canonical vault writes are already in progress (pid=${metadata.pid}, startedAt=${metadata.startedAt}, command=${metadata.command}).`;
}

function isCanonicalWriteLockMetadata(value: unknown): value is CanonicalWriteLockMetadata {
  return (
    isPlainRecord(value) &&
    typeof value.pid === "number" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.command === "string" &&
    value.command.trim().length > 0 &&
    typeof value.startedAt === "string" &&
    value.startedAt.trim().length > 0 &&
    typeof value.host === "string" &&
    value.host.trim().length > 0
  );
}

async function readLockMetadata(vaultRoot: string): Promise<CanonicalWriteLockMetadata | null> {
  const metadataPath = resolveVaultPath(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH);

  if (!(await pathExists(metadataPath.absolutePath))) {
    return null;
  }

  const raw = await readJsonFile(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH);
  if (!isCanonicalWriteLockMetadata(raw)) {
    throw new VaultError(
      "HB_CANONICAL_WRITE_LOCK_INVALID",
      "Canonical write lock metadata is malformed.",
      {
        relativePath: CANONICAL_WRITE_LOCK_METADATA_PATH,
      },
    );
  }

  return raw;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ESRCH") {
      return false;
    }

    return true;
  }
}

export async function inspectCanonicalWriteLock(vaultRoot: string): Promise<CanonicalWriteLockInspection> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const lockPath = resolveVaultPath(absoluteRoot, CANONICAL_WRITE_LOCK_DIRECTORY);

  if (!(await pathExists(lockPath.absolutePath))) {
    return {
      state: "unlocked",
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
    };
  }

  let metadata: CanonicalWriteLockMetadata | null = null;

  try {
    metadata = await readLockMetadata(absoluteRoot);
  } catch (error) {
    return {
      state: "stale",
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
      metadata: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!metadata) {
    return {
      state: "stale",
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
      metadata: null,
      reason: `Missing ${path.posix.basename(CANONICAL_WRITE_LOCK_METADATA_PATH)} metadata.`,
    };
  }

  if (metadata.host === normalizeHost() && !isProcessRunning(metadata.pid)) {
    return {
      state: "stale",
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
      metadata,
      reason: `Process ${metadata.pid} is no longer running.`,
    };
  }

  return {
    state: "active",
    relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
    metadata,
  };
}

export async function acquireCanonicalWriteLock(vaultRoot: string): Promise<CanonicalWriteLockHandle> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const existing = processLocks.get(absoluteRoot);

  if (existing) {
    existing.depth += 1;
    let released = false;

    return {
      metadata: existing.metadata,
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
      async release() {
        if (released) {
          return;
        }

        released = true;
        existing.depth -= 1;
        if (existing.depth <= 0) {
          processLocks.delete(absoluteRoot);
        }
      },
    };
  }

  const lockPath = resolveVaultPath(absoluteRoot, CANONICAL_WRITE_LOCK_DIRECTORY);
  const metadataPath = resolveVaultPath(absoluteRoot, CANONICAL_WRITE_LOCK_METADATA_PATH);
  await ensureDirectory(path.dirname(lockPath.absolutePath));

  try {
    await fs.mkdir(lockPath.absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      const inspection = await inspectCanonicalWriteLock(absoluteRoot);
      if (inspection.state === "unlocked") {
        return acquireCanonicalWriteLock(absoluteRoot);
      }
      throw new VaultError("HB_CANONICAL_WRITE_LOCKED", toLockFailureMessage(inspection), {
        relativePath: inspection.relativePath,
        metadata: inspection.metadata
          ? {
              pid: inspection.metadata.pid,
              command: inspection.metadata.command,
              startedAt: inspection.metadata.startedAt,
              host: inspection.metadata.host,
            }
          : null,
      });
    }

    throw error;
  }

  const metadata = buildMetadata();

  try {
    await fs.writeFile(metadataPath.absolutePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  } catch (error) {
    await fs.rm(lockPath.absolutePath, { recursive: true, force: true });
    throw error;
  }

  const state: ProcessLockState = {
    depth: 1,
    metadata,
  };
  processLocks.set(absoluteRoot, state);
  let released = false;

  return {
    metadata,
    relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
    async release() {
      if (released) {
        return;
      }

      released = true;
      state.depth -= 1;

      if (state.depth > 0) {
        return;
      }

      processLocks.delete(absoluteRoot);
      await fs.rm(lockPath.absolutePath, { recursive: true, force: true });
    },
  };
}
