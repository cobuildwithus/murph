import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireDirectoryLock,
  DirectoryLockHeldError,
  inspectDirectoryLock,
  type AcquireDirectoryLockOptions,
} from "../src/node/index.ts";

interface TestLockMetadata {
  owner: string;
  stale?: boolean;
}

const tempRoots: string[] = [];

function createTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "runtime-state-locks-"));
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

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe("runtime-state locks", () => {
  it("inspects unlocked, malformed, parsed, and stale lock states", async () => {
    const tempRoot = createTempRoot();
    const options = createLockOptions(tempRoot);

    await expect(inspectDirectoryLock(options)).resolves.toEqual({
      state: "unlocked",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
    });

    mkdirSync(options.lockPath, { recursive: true });
    await expect(inspectDirectoryLock(options)).resolves.toMatchObject({
      state: "stale",
      metadata: null,
      reason: "Missing metadata.json metadata.",
    });

    writeFileSync(options.metadataPath, "{not-json", "utf8");
    await expect(inspectDirectoryLock(options)).resolves.toMatchObject({
      state: "stale",
      metadata: null,
      reason: "Lock metadata is malformed.",
    });

    writeFileSync(options.metadataPath, JSON.stringify({ owner: 123 }), "utf8");
    await expect(inspectDirectoryLock(options)).resolves.toMatchObject({
      state: "stale",
      metadata: null,
      reason: "Lock metadata is malformed.",
    });

    writeFileSync(options.metadataPath, JSON.stringify({ owner: "owner-1" }), "utf8");
    await expect(inspectDirectoryLock(options)).resolves.toEqual({
      state: "active",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
      metadata: { owner: "owner-1" },
    });

    writeFileSync(options.metadataPath, JSON.stringify({ owner: "owner-1", stale: true }), "utf8");
    await expect(inspectDirectoryLock(options)).resolves.toEqual({
      state: "stale",
      lockPath: options.lockPath,
      metadataPath: options.metadataPath,
      metadata: { owner: "owner-1", stale: true },
      reason: "Marked stale for test.",
    });
  });

  it("supports reentrant acquisition per owner key and cleans up on final release", async () => {
    const tempRoot = createTempRoot();
    const options = createLockOptions(tempRoot);

    const firstHandle = await acquireDirectoryLock(options);
    const secondHandle = await acquireDirectoryLock({
      ...options,
      metadata: { owner: "owner-2" },
    });

    expect(firstHandle.metadata).toEqual({ owner: "owner-1" });
    expect(secondHandle.metadata).toEqual({ owner: "owner-1" });
    expect(existsSync(options.lockPath)).toBe(true);

    await firstHandle.release();
    expect(existsSync(options.lockPath)).toBe(true);

    await firstHandle.release();
    await secondHandle.release();
    expect(existsSync(options.lockPath)).toBe(false);

    await secondHandle.release();
    expect(existsSync(options.lockPath)).toBe(false);
  });

  it("clears stale lock directories by default before acquiring a new handle", async () => {
    const tempRoot = createTempRoot();
    const options = createLockOptions(tempRoot);

    mkdirSync(options.lockPath, { recursive: true });
    writeFileSync(options.metadataPath, JSON.stringify({ owner: "stale-owner", stale: true }), "utf8");

    const handle = await acquireDirectoryLock({
      ...options,
      metadata: { owner: "fresh-owner" },
      ownerKey: "owner-2",
    });

    try {
      await expect(inspectDirectoryLock(options)).resolves.toEqual({
        state: "active",
        lockPath: options.lockPath,
        metadataPath: options.metadataPath,
        metadata: { owner: "fresh-owner" },
      });
    } finally {
      await handle.release();
    }
  });

  it("throws with inspection details when a stale lock is not cleared or an active lock is held", async () => {
    const tempRoot = createTempRoot();
    const options = createLockOptions(tempRoot);

    mkdirSync(options.lockPath, { recursive: true });
    writeFileSync(options.metadataPath, JSON.stringify({ owner: "stale-owner", stale: true }), "utf8");

    await expect(
      acquireDirectoryLock({
        ...options,
        clearStale: false,
        ownerKey: "owner-2",
      }),
    ).rejects.toMatchObject({
      name: "DirectoryLockHeldError",
      inspection: {
        state: "stale",
        metadata: { owner: "stale-owner", stale: true },
      },
    });

    rmSync(options.lockPath, { force: true, recursive: true });

    const heldHandle = await acquireDirectoryLock(options);
    try {
      await expect(
        acquireDirectoryLock({
          ...options,
          ownerKey: "owner-2",
        }),
      ).rejects.toMatchObject({
        name: "DirectoryLockHeldError",
        inspection: {
          state: "active",
          metadata: { owner: "owner-1" },
        },
      });
    } finally {
      await heldHandle.release();
    }
  });
});
