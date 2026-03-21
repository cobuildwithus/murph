import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomic } from "./atomic-write.js";

interface ProcessDirectoryLockState {
  depth: number;
  metadata: unknown;
  lockPath: string;
  cleanupRetries: number | undefined;
  cleanupRetryDelayMs: number | undefined;
}

const processDirectoryLocks = new Map<string, ProcessDirectoryLockState>();

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
  if (!(await pathExists(options.lockPath))) {
    return {
      state: "unlocked",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
    };
  }

  const raw = await readOptionalJson(options.metadataPath);
  if (raw.state === "missing") {
    return {
      state: "stale",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
      metadata: null,
      reason:
        options.missingMetadataReason ??
        `Missing ${path.posix.basename(options.metadataPath)} metadata.`,
    };
  }

  if (raw.state === "invalid") {
    return {
      state: "stale",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
      metadata: null,
      reason: options.invalidMetadataReason ?? "Lock metadata is malformed.",
    };
  }

  const metadata = options.parseMetadata(raw.value);
  if (!metadata) {
    return {
      state: "stale",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
      metadata: null,
      reason: options.invalidMetadataReason ?? "Lock metadata is malformed.",
    };
  }

  const staleReason = options.inspectStale?.(metadata) ?? null;
  if (staleReason) {
    return {
      state: "stale",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
      metadata,
      reason: staleReason,
    };
  }

  return {
    state: "active",
    lockPath: options.lockPath,
    metadataPath: options.metadataPath,
    metadata,
  };
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
      await mkdir(options.lockPath);
      break;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "EEXIST"
      ) {
        const inspection = await inspectDirectoryLock(options);

        if (inspection.state === "unlocked") {
          continue;
        }

        if (inspection.state === "stale" && (options.clearStale ?? true)) {
          await cleanupLockDirectory(options.lockPath, options);
          continue;
        }

        throw new DirectoryLockHeldError(inspection);
      }

      throw error;
    }
  }

  try {
    await writeJsonFileAtomic(options.metadataPath, options.metadata);
  } catch (error) {
    await cleanupLockDirectory(options.lockPath, options);
    throw error;
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

  await rm(lockPath, rmOptions);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalJson(filePath: string): Promise<
  | {
      state: "missing";
    }
  | {
      state: "invalid";
    }
  | {
      state: "present";
      value: unknown;
    }
> {
  try {
    return {
      state: "present",
      value: JSON.parse(await readFile(filePath, "utf8")) as unknown,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return {
        state: "missing",
      };
    }

    return {
      state: "invalid",
    };
  }
}
