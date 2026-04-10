import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomic } from "./atomic-write.ts";

interface ProcessDirectoryLockState {
  depth: number;
  metadata: unknown;
  lockPath: string;
  cleanupRetries: number | undefined;
  cleanupRetryDelayMs: number | undefined;
}

const processDirectoryLocks = new Map<string, ProcessDirectoryLockState>();
const STALE_LOCK_CLAIM_FILE_NAME = ".cleanup-claim";

interface LockPathIdentity {
  dev: number;
  ino: number;
}

interface DirectoryLockSnapshot {
  lockIdentity: LockPathIdentity;
  metadataIdentity: LockPathIdentity | null;
  metadataState: "missing" | "invalid" | "present";
  metadataText: string | null;
}

interface DirectoryLockInspectionDetails<TMetadata> {
  inspection: DirectoryLockInspection<TMetadata>;
  snapshot: DirectoryLockSnapshot | null;
}

export interface DirectoryLockHandle<TMetadata> {
  readonly metadata: TMetadata;
  release(): Promise<void>;
}

export type DirectoryLockInspection<TMetadata> =
  | {
      state: "unlocked";
      lockPath: string;
      metadataPath: string;
    }
  | {
      state: "active";
      lockPath: string;
      metadataPath: string;
      metadata: TMetadata;
    }
  | {
      state: "stale";
      lockPath: string;
      metadataPath: string;
      metadata: TMetadata | null;
      reason: string;
    };

export interface DirectoryLockReadOptions<TMetadata> {
  lockPath: string;
  metadataPath: string;
  parseMetadata(value: unknown): TMetadata | null;
  invalidMetadataReason?: string;
  missingMetadataReason?: string;
  inspectStale?(metadata: TMetadata): string | null;
}

export interface AcquireDirectoryLockOptions<TMetadata>
  extends DirectoryLockReadOptions<TMetadata> {
  ownerKey: string;
  metadata: TMetadata;
  clearStale?: boolean;
  cleanupRetries?: number;
  cleanupRetryDelayMs?: number;
}

export class DirectoryLockHeldError<TMetadata> extends Error {
  readonly inspection: Exclude<DirectoryLockInspection<TMetadata>, { state: "unlocked" }>;

  constructor(inspection: Exclude<DirectoryLockInspection<TMetadata>, { state: "unlocked" }>) {
    super("Directory lock is already held.");
    this.name = "DirectoryLockHeldError";
    this.inspection = inspection;
  }
}

export async function inspectDirectoryLock<TMetadata>(
  options: DirectoryLockReadOptions<TMetadata>,
): Promise<DirectoryLockInspection<TMetadata>> {
  return (await inspectDirectoryLockDetails(options)).inspection;
}

export async function acquireDirectoryLock<TMetadata>(
  options: AcquireDirectoryLockOptions<TMetadata>,
): Promise<DirectoryLockHandle<TMetadata>> {
  const existing = processDirectoryLocks.get(options.ownerKey);
  if (existing) {
    existing.depth += 1;
    let released = false;

    return {
      metadata: existing.metadata as TMetadata,
      async release() {
        if (released) {
          return;
        }

        released = true;
        existing.depth -= 1;

        if (existing.depth <= 0) {
          processDirectoryLocks.delete(options.ownerKey);
          await cleanupLockDirectory(options.lockPath, existing);
        }
      },
    };
  }

  await mkdir(path.dirname(options.lockPath), { recursive: true });

  while (true) {
    try {
      await publishDirectoryLock(options);
      break;
    } catch (error) {
      if (!isLockPathOccupiedError(error)) {
        throw error;
      }

      const inspection = await inspectDirectoryLockDetails(options);

      if (inspection.inspection.state === "unlocked") {
        continue;
      }

      if (inspection.inspection.state === "stale" && (options.clearStale ?? true)) {
        await tryCleanupStaleLockDirectory(options, inspection.snapshot);
        continue;
      }

      throw new DirectoryLockHeldError(inspection.inspection);
    }
  }

  const state: ProcessDirectoryLockState = {
    depth: 1,
    metadata: options.metadata,
    lockPath: options.lockPath,
    cleanupRetries: options.cleanupRetries,
    cleanupRetryDelayMs: options.cleanupRetryDelayMs,
  };
  processDirectoryLocks.set(options.ownerKey, state);
  let released = false;

  return {
    metadata: options.metadata,
    async release() {
      if (released) {
        return;
      }

      released = true;
      state.depth -= 1;

      if (state.depth > 0) {
        return;
      }

      processDirectoryLocks.delete(options.ownerKey);
      await cleanupLockDirectory(options.lockPath, state);
    },
  };
}

async function cleanupLockDirectory(
  lockPath: string,
  options: {
    cleanupRetries?: number;
    cleanupRetryDelayMs?: number;
  },
): Promise<void> {
  const detachedLockPath = buildLockSiblingPath(lockPath, "cleanup");

  try {
    await rename(lockPath, detachedLockPath);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return;
    }

    throw error;
  }

  await cleanupDetachedDirectory(detachedLockPath, options);
}

async function cleanupDetachedDirectory(
  targetPath: string,
  options: {
    cleanupRetries?: number;
    cleanupRetryDelayMs?: number;
  },
): Promise<void> {
  const rmOptions = {
    recursive: true,
    force: true,
    ...(typeof options.cleanupRetries === "number"
      ? { maxRetries: options.cleanupRetries }
      : {}),
    ...(typeof options.cleanupRetryDelayMs === "number"
      ? { retryDelay: options.cleanupRetryDelayMs }
      : {}),
  };

  await rm(targetPath, rmOptions);
}

async function publishDirectoryLock<TMetadata>(
  options: AcquireDirectoryLockOptions<TMetadata>,
): Promise<void> {
  const tempLockPath = buildLockSiblingPath(options.lockPath, "pending");
  const tempMetadataPath = path.join(
    tempLockPath,
    getRelativeMetadataPath(options.lockPath, options.metadataPath),
  );

  await mkdir(tempLockPath);

  try {
    await writeJsonFileAtomic(tempMetadataPath, options.metadata);
    await rename(tempLockPath, options.lockPath);
  } catch (error) {
    await cleanupDetachedDirectory(tempLockPath, options);
    throw error;
  }
}

async function tryCleanupStaleLockDirectory<TMetadata>(
  options: AcquireDirectoryLockOptions<TMetadata>,
  expectedSnapshot: DirectoryLockSnapshot | null,
): Promise<"cleaned" | "retry"> {
  if (!expectedSnapshot) {
    return "retry";
  }

  const claimPath = path.join(options.lockPath, STALE_LOCK_CLAIM_FILE_NAME);

  try {
    await writeFile(claimPath, buildClaimToken(), { flag: "wx", encoding: "utf8" });
  } catch (error) {
    if (isErrnoException(error, "EEXIST") || isErrnoException(error, "ENOENT")) {
      return "retry";
    }

    throw error;
  }

  try {
    const currentInspection = await inspectDirectoryLockDetails(options);
    if (
      currentInspection.inspection.state !== "stale" ||
      !sameDirectoryLockSnapshot(currentInspection.snapshot, expectedSnapshot)
    ) {
      return "retry";
    }

    const detachedLockPath = buildLockSiblingPath(options.lockPath, "stale");
    await rename(options.lockPath, detachedLockPath);
    await cleanupDetachedDirectory(detachedLockPath, options);
    return "cleaned";
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return "retry";
    }

    throw error;
  } finally {
    await rm(claimPath, { force: true });
  }
}

async function readOptionalJson(filePath: string): Promise<
  | {
      state: "missing";
      identity: null;
      text: null;
    }
  | {
      state: "invalid";
      identity: LockPathIdentity | null;
      text: string | null;
    }
  | {
      state: "present";
      value: unknown;
      identity: LockPathIdentity;
      text: string;
    }
> {
  try {
    const text = await readFile(filePath, "utf8");
    return {
      state: "present",
      value: JSON.parse(text) as unknown,
      identity: await readRequiredPathIdentity(filePath),
      text,
    };
  } catch (error) {
    if (
      isErrnoException(error, "ENOENT")
    ) {
      return {
        state: "missing",
        identity: null,
        text: null,
      };
    }

    const fileIdentity = await readPathIdentity(filePath);
    const fileText = await readOptionalText(filePath);
    return {
      state: "invalid",
      identity: fileIdentity,
      text: fileText,
    };
  }
}

async function inspectDirectoryLockDetails<TMetadata>(
  options: DirectoryLockReadOptions<TMetadata>,
): Promise<DirectoryLockInspectionDetails<TMetadata>> {
  const lockIdentity = await readPathIdentity(options.lockPath);
  if (!lockIdentity) {
    return {
      inspection: {
        state: "unlocked",
        lockPath: options.lockPath,
        metadataPath: options.metadataPath,
      },
      snapshot: null,
    };
  }

  const raw = await readOptionalJson(options.metadataPath);
  const snapshot: DirectoryLockSnapshot = {
    lockIdentity,
    metadataIdentity: raw.identity,
    metadataState: raw.state,
    metadataText: raw.text,
  };

  if (raw.state === "missing") {
    return {
      inspection: {
        state: "stale",
        lockPath: options.lockPath,
        metadataPath: options.metadataPath,
        metadata: null,
        reason:
          options.missingMetadataReason ??
          `Missing ${path.basename(options.metadataPath)} metadata.`,
      },
      snapshot,
    };
  }

  if (raw.state === "invalid") {
    return {
      inspection: {
        state: "stale",
        lockPath: options.lockPath,
        metadataPath: options.metadataPath,
        metadata: null,
        reason: options.invalidMetadataReason ?? "Lock metadata is malformed.",
      },
      snapshot,
    };
  }

  const metadata = options.parseMetadata(raw.value);
  if (!metadata) {
    return {
      inspection: {
        state: "stale",
        lockPath: options.lockPath,
        metadataPath: options.metadataPath,
        metadata: null,
        reason: options.invalidMetadataReason ?? "Lock metadata is malformed.",
      },
      snapshot,
    };
  }

  const staleReason = options.inspectStale?.(metadata) ?? null;
  if (staleReason) {
    return {
      inspection: {
        state: "stale",
        lockPath: options.lockPath,
        metadataPath: options.metadataPath,
        metadata,
        reason: staleReason,
      },
      snapshot,
    };
  }

  return {
    inspection: {
      state: "active",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
      metadata,
    },
    snapshot,
  };
}

function getRelativeMetadataPath(lockPath: string, metadataPath: string): string {
  const relativePath = path.relative(lockPath, metadataPath);
  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Lock metadata path must be inside the lock directory.");
  }

  return relativePath;
}

function buildLockSiblingPath(lockPath: string, suffix: string): string {
  return path.join(
    path.dirname(lockPath),
    `.${path.basename(lockPath)}.${suffix}.${randomUUID().replace(/-/g, "")}`,
  );
}

function buildClaimToken(): string {
  return `${randomUUID().replace(/-/g, "")}\n`;
}

function sameDirectoryLockSnapshot(
  left: DirectoryLockSnapshot | null,
  right: DirectoryLockSnapshot | null,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    samePathIdentity(left.lockIdentity, right.lockIdentity) &&
    samePathIdentity(left.metadataIdentity, right.metadataIdentity) &&
    left.metadataState === right.metadataState &&
    left.metadataText === right.metadataText
  );
}

function samePathIdentity(
  left: LockPathIdentity | null,
  right: LockPathIdentity | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.dev === right.dev && left.ino === right.ino;
}

function isErrnoException(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isLockPathOccupiedError(error: unknown): boolean {
  return isErrnoException(error, "EEXIST") || isErrnoException(error, "ENOTEMPTY");
}

async function readPathIdentity(targetPath: string): Promise<LockPathIdentity | null> {
  try {
    return await readRequiredPathIdentity(targetPath);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}

async function readRequiredPathIdentity(targetPath: string): Promise<LockPathIdentity> {
  const stats = await lstat(targetPath);
  return {
    dev: stats.dev,
    ino: stats.ino,
  };
}

async function readOptionalText(targetPath: string): Promise<string | null> {
  try {
    return await readFile(targetPath, "utf8");
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return null;
    }

    throw error;
  }
}
