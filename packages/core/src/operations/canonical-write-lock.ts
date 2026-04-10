import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  acquireDirectoryLock,
  buildProcessCommand,
  DirectoryLockHeldError,
  fingerprintHost,
  inspectDirectoryLock,
  isProcessRunning,
} from "@murphai/runtime-state/node";

import { VaultError } from "../errors.ts";
import { normalizeVaultRoot, resolveVaultPath } from "../path-safety.ts";
import { toIsoTimestamp } from "../time.ts";
import { isErrnoException, isPlainRecord } from "../types.ts";

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

interface CanonicalWriteLockContext {
  ownerToken: string;
  vaultRoot: string;
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

const canonicalWriteLockContextStorage = new AsyncLocalStorage<CanonicalWriteLockContext>();
const processCanonicalWriteQueues = new Map<string, Promise<void>>();

function buildMetadata(): CanonicalWriteLockMetadata {
  return {
    pid: process.pid,
    command: buildProcessCommand(),
    startedAt: toIsoTimestamp(new Date(), "startedAt"),
    host: fingerprintHost(),
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

function mapDirectoryLockInspection(
  inspection:
    | {
        state: "active";
        metadata: CanonicalWriteLockMetadata;
      }
    | {
        state: "stale";
        metadata: CanonicalWriteLockMetadata | null;
        reason: string;
      },
): Exclude<CanonicalWriteLockInspection, { state: "unlocked" }> {
  if (inspection.state === "active") {
    return {
      state: "active",
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
      metadata: inspection.metadata,
    };
  }

  return {
    state: "stale",
    relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
    metadata: inspection.metadata,
    reason: inspection.reason,
  };
}

export async function inspectCanonicalWriteLock(vaultRoot: string): Promise<CanonicalWriteLockInspection> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const lockPath = resolveVaultPath(absoluteRoot, CANONICAL_WRITE_LOCK_DIRECTORY);
  const metadataPath = resolveVaultPath(absoluteRoot, CANONICAL_WRITE_LOCK_METADATA_PATH);
  const inspection = await inspectDirectoryLock({
    lockPath: lockPath.absolutePath,
    metadataPath: metadataPath.absolutePath,
    parseMetadata(value) {
      return isCanonicalWriteLockMetadata(value) ? value : null;
    },
    invalidMetadataReason: "Canonical write lock metadata is malformed.",
    missingMetadataReason: `Missing ${path.posix.basename(CANONICAL_WRITE_LOCK_METADATA_PATH)} metadata.`,
    inspectStale(metadata) {
      if (metadata.host === fingerprintHost() && !isProcessRunning(metadata.pid)) {
        return `Process ${metadata.pid} is no longer running.`;
      }

      return null;
    },
  });

  if (inspection.state === "unlocked") {
    return {
      state: "unlocked",
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
    };
  }

  if (inspection.state === "stale") {
    return {
      state: "stale",
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
      metadata: inspection.metadata,
      reason: inspection.reason,
    };
  }

  return {
    state: "active",
    relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
    metadata: inspection.metadata,
  };
}

export async function withCanonicalWriteLockScope<TResult>(
  vaultRoot: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const parentContext = canonicalWriteLockContextStorage.getStore();

  if (parentContext?.vaultRoot === absoluteRoot) {
    return await run();
  }

  return await canonicalWriteLockContextStorage.run(
    {
      ownerToken: randomUUID().replace(/-/g, ""),
      vaultRoot: absoluteRoot,
    },
    run,
  );
}

export async function acquireCanonicalWriteLock(vaultRoot: string): Promise<CanonicalWriteLockHandle> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const context = canonicalWriteLockContextStorage.getStore();
  const ownerToken =
    context?.vaultRoot === absoluteRoot
      ? context.ownerToken
      : randomUUID().replace(/-/g, "");
  const isReentrantOwner = context?.vaultRoot === absoluteRoot && context.ownerToken === ownerToken;
  const releaseQueue = isReentrantOwner ? null : await acquireCanonicalWriteQueueSlot(absoluteRoot);
  const lockPath = resolveVaultPath(absoluteRoot, CANONICAL_WRITE_LOCK_DIRECTORY);
  const metadataPath = resolveVaultPath(absoluteRoot, CANONICAL_WRITE_LOCK_METADATA_PATH);

  try {
    const handle = await acquireDirectoryLock({
      ownerKey: `canonical-write:${absoluteRoot}:${ownerToken}`,
      lockPath: lockPath.absolutePath,
      metadataPath: metadataPath.absolutePath,
      metadata: buildMetadata(),
      parseMetadata(value) {
        return isCanonicalWriteLockMetadata(value) ? value : null;
      },
      invalidMetadataReason: "Canonical write lock metadata is malformed.",
      missingMetadataReason: `Missing ${path.posix.basename(CANONICAL_WRITE_LOCK_METADATA_PATH)} metadata.`,
      inspectStale(metadata) {
        if (metadata.host === fingerprintHost() && !isProcessRunning(metadata.pid)) {
          return `Process ${metadata.pid} is no longer running.`;
        }

        return null;
      },
    });

    return {
      metadata: handle.metadata,
      relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
      async release() {
        try {
          await handle.release();
        } finally {
          releaseQueue?.();
        }
      },
    };
  } catch (error) {
    releaseQueue?.();

    if (error instanceof DirectoryLockHeldError) {
      const inspection = mapDirectoryLockInspection(
        error.inspection.state === "active"
          ? {
              state: "active",
              metadata: error.inspection.metadata as CanonicalWriteLockMetadata,
            }
          : {
              state: "stale",
              metadata: error.inspection.metadata as CanonicalWriteLockMetadata | null,
              reason: error.inspection.reason,
            },
      );

      throw new VaultError("CANONICAL_WRITE_LOCKED", toLockFailureMessage(inspection), {
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

    if (isErrnoException(error) && error.code === "EEXIST") {
      const inspection = await inspectCanonicalWriteLock(absoluteRoot);
      if (inspection.state !== "unlocked") {
        throw new VaultError("CANONICAL_WRITE_LOCKED", toLockFailureMessage(inspection), {
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
    }

    throw error;
  }
}

async function acquireCanonicalWriteQueueSlot(vaultRoot: string): Promise<() => void> {
  const queueKey = `canonical-write:${vaultRoot}`;
  const prior = processCanonicalWriteQueues.get(queueKey) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const tail = prior.then(
    () => queued,
    () => queued,
  );
  processCanonicalWriteQueues.set(queueKey, tail);

  await prior.catch(() => undefined);

  return () => {
    releaseQueue();
    if (processCanonicalWriteQueues.get(queueKey) === tail) {
      processCanonicalWriteQueues.delete(queueKey);
    }
  };
}
