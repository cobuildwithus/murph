import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import type { AcquireDirectoryLockOptions } from "../src/locks.ts";

interface TestLockMetadata {
  owner: string;
  stale?: boolean;
}

const tempRoots: string[] = [];

function createTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "runtime-state-locks-race-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function createLockOptions(
  tempRoot: string,
  overrides: Partial<AcquireDirectoryLockOptions<TestLockMetadata>> = {},
): AcquireDirectoryLockOptions<TestLockMetadata> {
  const lockPath = path.join(tempRoot, "locks", "state.lock");
  return {
    ownerKey: "owner-1",
    lockPath,
    metadataPath: path.join(lockPath, "metadata.json"),
    metadata: { owner: "owner-1" },
    parseMetadata(value) {
      if (!value || typeof value !== "object") {
        return null;
      }

      const owner = "owner" in value ? value.owner : undefined;
      if (typeof owner !== "string") {
        return null;
      }

      const stale = "stale" in value ? value.stale : undefined;
      if (typeof stale !== "undefined" && typeof stale !== "boolean") {
        return null;
      }

      return {
        owner,
        ...(typeof stale === "boolean" ? { stale } : {}),
      };
    },
    inspectStale(metadata) {
      return metadata.stale ? "Marked stale for test." : null;
    },
    ...overrides,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve(value) {
      resolve?.(value as T | PromiseLike<T>);
    },
    reject(reason) {
      reject?.(reason);
    },
  };
}

afterEach(() => {
  vi.doUnmock("../src/atomic-write.ts");
  vi.restoreAllMocks();
  vi.resetModules();

  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

it("does not let a failed metadata write clean up a contender that already acquired the lock", async () => {
  const tempRoot = createTempRoot();
  const options = createLockOptions(tempRoot);
  const actualAtomicWrite = await vi.importActual<typeof import("../src/atomic-write.ts")>(
    "../src/atomic-write.ts"
  );
  const failingWriteReady = createDeferred<void>();
  const releaseFailingWrite = createDeferred<void>();

  vi.doMock("../src/atomic-write.ts", () => ({
    ...actualAtomicWrite,
    writeJsonFileAtomic: vi.fn(
      async (...args: Parameters<typeof actualAtomicWrite.writeJsonFileAtomic>) => {
        const [, value] = args;
        const owner =
          value && typeof value === "object" && "owner" in value ? value.owner : undefined;
        if (owner === "failing-owner") {
          failingWriteReady.resolve();
          await releaseFailingWrite.promise;
          throw new Error("simulated metadata write failure");
        }

        return actualAtomicWrite.writeJsonFileAtomic(...args);
      },
    ),
  }));

  const { acquireDirectoryLock, inspectDirectoryLock } = await import("../src/locks.ts");

  let winner:
    | Awaited<ReturnType<typeof acquireDirectoryLock<TestLockMetadata>>>
    | null = null;

  try {
    const failingAcquire = acquireDirectoryLock({
      ...options,
      ownerKey: "owner-2",
      metadata: { owner: "failing-owner" },
    });
    await failingWriteReady.promise;

    winner = await acquireDirectoryLock({
      ...options,
      ownerKey: "owner-3",
      metadata: { owner: "winner-owner" },
    });

    releaseFailingWrite.resolve();

    await expect(failingAcquire).rejects.toThrow("simulated metadata write failure");
    await expect(inspectDirectoryLock(options)).resolves.toEqual({
      state: "active",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
      metadata: { owner: "winner-owner" },
    });
  } finally {
    releaseFailingWrite.resolve();
    await winner?.release();
  }
});
