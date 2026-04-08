import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, test, vi } from "vitest";

const tempRoots: string[] = [];

async function loadCoreIndex() {
  return await import("../src/index.ts");
}

async function loadCanonicalWriteLockModule() {
  return await import("../src/operations/canonical-write-lock.ts");
}

async function makeScratchRoot(prefix = "murph-core-lock-"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function makeVaultRoot(): Promise<string> {
  const vaultRoot = await makeScratchRoot();
  const { initializeVault } = await loadCoreIndex();
  await initializeVault({ vaultRoot });
  return vaultRoot;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock("@murphai/runtime-state/node");
  vi.resetModules();

  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) =>
      fs.rm(vaultRoot, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("canonical write lock reports active, stale, missing, malformed, and unlocked states from on-disk metadata", async () => {
  const vaultRoot = await makeVaultRoot();
  const { acquireCanonicalWriteLock, inspectCanonicalWriteLock, CANONICAL_WRITE_LOCK_DIRECTORY, CANONICAL_WRITE_LOCK_METADATA_PATH } =
    await loadCanonicalWriteLockModule();

  const lock = await acquireCanonicalWriteLock(vaultRoot);

  try {
    const active = await inspectCanonicalWriteLock(vaultRoot);
    assert.equal(active.state, "active");
    assert.equal(active.relativePath, CANONICAL_WRITE_LOCK_DIRECTORY);
    assert.equal(active.metadata.pid, process.pid);
    assert.equal(typeof active.metadata.command, "string");
    assert.equal(active.metadata.command.length > 0, true);
    assert.equal(typeof active.metadata.host, "string");
    assert.equal(active.metadata.host.length > 0, true);
  } finally {
    await lock.release();
  }

  const unlocked = await inspectCanonicalWriteLock(vaultRoot);
  assert.deepEqual(unlocked, {
    state: "unlocked",
    relativePath: CANONICAL_WRITE_LOCK_DIRECTORY,
  });

  await fs.mkdir(path.join(vaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), { recursive: true });
  const missingMetadata = await inspectCanonicalWriteLock(vaultRoot);
  assert.equal(missingMetadata.state, "stale");
  assert.equal(missingMetadata.metadata, null);
  assert.match(missingMetadata.reason, /Missing owner\.json metadata\./u);

  await fs.writeFile(
    path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
    "{ not json }\n",
    "utf8",
  );
  const malformedMetadata = await inspectCanonicalWriteLock(vaultRoot);
  assert.equal(malformedMetadata.state, "stale");
  assert.equal(malformedMetadata.metadata, null);
  assert.match(malformedMetadata.reason, /Canonical write lock metadata is malformed\./u);
});

test("canonical write lock treats dead local pids as stale and foreign hosts as active", async () => {
  const vaultRoot = await makeVaultRoot();
  const { acquireCanonicalWriteLock, inspectCanonicalWriteLock, CANONICAL_WRITE_LOCK_DIRECTORY, CANONICAL_WRITE_LOCK_METADATA_PATH } =
    await loadCanonicalWriteLockModule();
  const firstLock = await acquireCanonicalWriteLock(vaultRoot);
  let localHost = "";

  try {
    const metadataText = await fs.readFile(path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH), "utf8");
    const metadata = JSON.parse(metadataText) as {
      host: string;
    };
    localHost = metadata.host;
  } finally {
    await firstLock.release();
  }

  await fs.mkdir(path.join(vaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
    `${JSON.stringify(
      {
        pid: 999_999,
        command: "test-lock-holder",
        startedAt: "2026-04-08T00:00:00.000Z",
        host: localHost,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const stale = await inspectCanonicalWriteLock(vaultRoot);
  assert.equal(stale.state, "stale");
  assert.equal(stale.metadata?.pid, 999_999);
  assert.match(stale.reason, /no longer running/u);

  await fs.writeFile(
    path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
    `${JSON.stringify(
      {
        pid: 999_999,
        command: "foreign-lock-holder",
        startedAt: "2026-04-08T00:00:00.000Z",
        host: "foreign-host",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const active = await inspectCanonicalWriteLock(vaultRoot);
  assert.equal(active.state, "active");
  assert.equal(active.metadata.pid, 999_999);
  assert.equal(active.metadata.host, "foreign-host");
});

test("canonical write lock rejects concurrent acquisition with an active VaultError", async () => {
  const vaultRoot = await makeVaultRoot();
  const { acquireCanonicalWriteLock, CANONICAL_WRITE_LOCK_DIRECTORY, CANONICAL_WRITE_LOCK_METADATA_PATH } =
    await loadCanonicalWriteLockModule();

  await fs.mkdir(path.join(vaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
    `${JSON.stringify(
      {
        pid: 4242,
        command: "foreign-lock-holder",
        startedAt: "2026-04-08T04:00:00.000Z",
        host: "foreign-host",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await assert.rejects(
    () => acquireCanonicalWriteLock(vaultRoot),
    (error: unknown) => {
      assert.equal((error as { name?: string }).name, "VaultError");
      const lockError = error as {
        code?: string;
        details: {
          metadata?: {
            command?: string;
            host?: string;
            pid?: number;
            startedAt?: string;
          } | null;
          relativePath?: string;
        };
        message: string;
      };
      assert.equal(lockError.code, "CANONICAL_WRITE_LOCKED");
      assert.match(lockError.message, /already in progress/u);
      assert.equal(lockError.details.relativePath, CANONICAL_WRITE_LOCK_DIRECTORY);
      assert.equal(lockError.details.metadata?.pid, 4242);
      assert.equal(lockError.details.metadata?.command, "foreign-lock-holder");
      assert.equal(lockError.details.metadata?.startedAt, "2026-04-08T04:00:00.000Z");
      assert.equal(lockError.details.metadata?.host, "foreign-host");
      return true;
    },
  );
});

test("canonical write lock rejects stale held locks with a rich VaultError", async () => {
  const actualRuntimeState = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );
  const acquireDirectoryLock = vi.fn(async () => {
    throw new actualRuntimeState.DirectoryLockHeldError({
      lockPath: "/tmp/mock-vault/.runtime/locks/canonical-write",
      metadataPath: "/tmp/mock-vault/.runtime/locks/canonical-write/owner.json",
      metadata: {
        pid: 1234,
        command: "stale-lock-holder",
        startedAt: "2026-04-08T00:00:00.000Z",
        host: "stale-host",
      },
      reason: "Process 1234 is no longer running.",
      state: "stale",
    });
  });

  vi.doMock("@murphai/runtime-state/node", async () => ({
    ...actualRuntimeState,
    acquireDirectoryLock,
  }));

  const { acquireCanonicalWriteLock, CANONICAL_WRITE_LOCK_DIRECTORY } = await loadCanonicalWriteLockModule();
  const vaultRoot = await makeScratchRoot("murph-core-lock-stale-held-");

  await assert.rejects(
    () => acquireCanonicalWriteLock(vaultRoot),
    (error: unknown) => {
      assert.equal((error as { name?: string }).name, "VaultError");
      const lockError = error as {
        code?: string;
        details: {
          metadata?: {
            command?: string;
            host?: string;
            pid?: number;
            startedAt?: string;
          } | null;
          relativePath?: string;
        };
        message: string;
      };
      assert.equal(lockError.code, "CANONICAL_WRITE_LOCKED");
      assert.match(lockError.message, /blocked by a stale lock/u);
      assert.match(lockError.message, /Process 1234 is no longer running\./u);
      assert.match(lockError.message, /stale-lock-holder/u);
      assert.equal(lockError.details.relativePath, CANONICAL_WRITE_LOCK_DIRECTORY);
      assert.equal(lockError.details.metadata?.pid, 1234);
      assert.equal(lockError.details.metadata?.command, "stale-lock-holder");
      assert.equal(lockError.details.metadata?.startedAt, "2026-04-08T00:00:00.000Z");
      assert.equal(lockError.details.metadata?.host, "stale-host");
      return true;
    },
  );
});

test("canonical write lock re-inspects EEXIST failures and either rethrows or reports stale locks", async () => {
  const actualRuntimeState = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );
  const acquireDirectoryLock = vi.fn(async () => {
    const error = new Error("lock already exists");
    Object.assign(error, { code: "EEXIST" });
    throw error;
  });

  vi.doMock("@murphai/runtime-state/node", async () => ({
    ...actualRuntimeState,
    acquireDirectoryLock,
  }));

  const {
    acquireCanonicalWriteLock,
    CANONICAL_WRITE_LOCK_DIRECTORY,
    CANONICAL_WRITE_LOCK_METADATA_PATH,
  } = await loadCanonicalWriteLockModule();

  const staleVaultRoot = await makeScratchRoot("murph-core-lock-eexist-stale-");
  await fs.mkdir(path.join(staleVaultRoot, CANONICAL_WRITE_LOCK_DIRECTORY), { recursive: true });
  await fs.writeFile(
    path.join(staleVaultRoot, CANONICAL_WRITE_LOCK_METADATA_PATH),
    `${JSON.stringify(
      {
        pid: 999_999,
        command: "stale-eexist-holder",
        startedAt: "2026-04-08T04:00:00.000Z",
        host: actualRuntimeState.fingerprintHost(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await assert.rejects(
    () => acquireCanonicalWriteLock(staleVaultRoot),
    (error: unknown) => {
      assert.equal((error as { name?: string }).name, "VaultError");
      const lockError = error as {
        code?: string;
        details: {
          metadata?: {
            command?: string;
            host?: string;
            pid?: number;
            startedAt?: string;
          } | null;
          relativePath?: string;
        };
        message: string;
      };
      assert.equal(lockError.code, "CANONICAL_WRITE_LOCKED");
      assert.match(lockError.message, /blocked by a stale lock/u);
      assert.match(lockError.message, /stale-eexist-holder/u);
      assert.equal(lockError.details.relativePath, CANONICAL_WRITE_LOCK_DIRECTORY);
      assert.equal(lockError.details.metadata?.pid, 999_999);
      assert.equal(lockError.details.metadata?.command, "stale-eexist-holder");
      assert.equal(lockError.details.metadata?.startedAt, "2026-04-08T04:00:00.000Z");
      assert.equal(lockError.details.metadata?.host, actualRuntimeState.fingerprintHost());
      return true;
    },
  );

  const unlockedVaultRoot = await makeScratchRoot("murph-core-lock-eexist-unlocked-");
  await assert.rejects(
    () => acquireCanonicalWriteLock(unlockedVaultRoot),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "EEXIST");
      assert.equal((error as { message?: string }).message, "lock already exists");
      return true;
    },
  );
});
