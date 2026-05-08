import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, test, vi } from "vitest";

const tempRoots: string[] = [];

async function loadCoreIndex() {
  return await import("../src/index.ts");
}

async function loadCanonicalResourceLockModule() {
  return await import("../src/operations/canonical-resource-lock.ts");
}

async function makeScratchRoot(prefix = "murph-core-resource-lock-"): Promise<string> {
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

test("canonical resource locks wait for same-resource contention and allow disjoint resources", async () => {
  const vaultRoot = await makeVaultRoot();
  const {
    acquireCanonicalResourceLock,
    canonicalPathResource,
  } = await loadCoreIndex();

  const heldHandle = await acquireCanonicalResourceLock({
    vaultRoot,
    resource: canonicalPathResource("bank/memory.md"),
    timeoutMs: 1_000,
  });

  let acquiredWhileHeld = false;
  const waitingLockPromise = acquireCanonicalResourceLock({
    vaultRoot,
    resource: canonicalPathResource("bank/memory.md"),
    timeoutMs: 1_000,
  }).then((handle) => {
    acquiredWhileHeld = true;
    return handle;
  });

  await sleep(75);
  assert.equal(acquiredWhileHeld, false);

  const [disjointMemoryLock, disjointPreferencesLock] = await Promise.all([
    acquireCanonicalResourceLock({
      vaultRoot,
      resource: canonicalPathResource("derived/knowledge/index.md"),
      timeoutMs: 1_000,
    }),
    acquireCanonicalResourceLock({
      vaultRoot,
      resource: canonicalPathResource("bank/preferences.json"),
      timeoutMs: 1_000,
    }),
  ]);

  await disjointPreferencesLock.release();
  await disjointMemoryLock.release();

  await heldHandle.release();

  const waitingHandle = await waitingLockPromise;
  assert.equal(acquiredWhileHeld, true);
  await waitingHandle.release();
});

test("canonical path resources fold case-insensitive aliases into one key when requested", async () => {
  const { canonicalPathResource, dedupeCanonicalResources } = await loadCoreIndex();

  const upperAlias = canonicalPathResource("Bank/Memory.md", {
    caseInsensitive: true,
  });
  const lowerAlias = canonicalPathResource("bank/memory.md", {
    caseInsensitive: true,
  });

  assert.equal(upperAlias.key, lowerAlias.key);
  assert.equal(upperAlias.label, "Bank/Memory.md");
  assert.deepEqual(dedupeCanonicalResources([upperAlias, lowerAlias]), [upperAlias]);
});

test("canonical resource lock scopes re-enter the same resource without deadlocking", async () => {
  const vaultRoot = await makeVaultRoot();
  const {
    acquireCanonicalResourceLock,
    canonicalPathResource,
    withCanonicalResourceLocks,
  } = await loadCoreIndex();

  await withCanonicalResourceLocks({
    vaultRoot,
    resources: [canonicalPathResource("bank/memory.md")],
    run: async () => {
      const innerResource = canonicalPathResource("derived/knowledge/index.md");
      const outerHandle = await acquireCanonicalResourceLock({
        vaultRoot,
        resource: innerResource,
        timeoutMs: 1_000,
      });
      const innerHandle = await acquireCanonicalResourceLock({
        vaultRoot,
        resource: innerResource,
        timeoutMs: 1_000,
      });

      await outerHandle.release();

      let acquiredWhileInnerHandleActive = false;
      const waitingLockPromise = acquireCanonicalResourceLock({
        ownerToken: "foreign-owner",
        vaultRoot,
        resource: innerResource,
        timeoutMs: 1_000,
      }).then((handle) => {
        acquiredWhileInnerHandleActive = true;
        return handle;
      });

      await sleep(75);
      assert.equal(acquiredWhileInnerHandleActive, false);

      await innerHandle.release();
      const waitingHandle = await waitingLockPromise;
      assert.equal(acquiredWhileInnerHandleActive, true);
      await waitingHandle.release();

      await withCanonicalResourceLocks({
        vaultRoot,
        resources: [canonicalPathResource("bank/memory.md")],
        run: async () => {},
      });
    },
  });
});

test("canonical resource lock scopes compose only in global sorted order", async () => {
  const vaultRoot = await makeVaultRoot();
  const {
    canonicalPathResource,
    withCanonicalResourceLocks,
  } = await loadCoreIndex();

  await withCanonicalResourceLocks({
    vaultRoot,
    resources: [canonicalPathResource("bank/memory.md")],
    run: async () => {
      await withCanonicalResourceLocks({
        vaultRoot,
        resources: [canonicalPathResource("derived/knowledge/index.md")],
        run: async () => {},
      });
    },
  });

  await assert.rejects(
    () =>
      withCanonicalResourceLocks({
        vaultRoot,
        resources: [canonicalPathResource("derived/knowledge/index.md")],
        run: async () =>
          await withCanonicalResourceLocks({
            vaultRoot,
            resources: [canonicalPathResource("bank/memory.md")],
            run: async () => {},
          }),
      }),
    (error: unknown) => {
      assert.equal((error as { name?: string }).name, "VaultError");
      const lockError = error as {
        code?: string;
        details?: {
          highestHeldResourceKey?: string;
          heldResourceKeys?: string[];
          resourceKey?: string;
        };
        message: string;
      };
      assert.equal(lockError.code, "CANONICAL_RESOURCE_LOCK_ORDER");
      assert.match(lockError.message, /Acquire canonical resources together in sorted order/u);
      assert.equal(lockError.details?.resourceKey, "path:bank/memory.md");
      assert.equal(lockError.details?.highestHeldResourceKey, "path:derived/knowledge/index.md");
      assert.deepEqual(lockError.details?.heldResourceKeys, ["path:derived/knowledge/index.md"]);
      return true;
    },
  );
});

test("canonical resource lock scopes serialize sibling acquisitions while a higher key is pending", async () => {
  const actualRuntimeState = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );
  let delayHigherLock = true;
  let markHigherAcquisitionDelayStarted!: () => void;
  const higherAcquisitionDelayStarted = new Promise<void>((resolve) => {
    markHigherAcquisitionDelayStarted = resolve;
  });
  let releaseHigherAcquisitionDelay!: () => void;
  const higherAcquisitionDelay = new Promise<void>((resolve) => {
    releaseHigherAcquisitionDelay = resolve;
  });
  vi.doMock("@murphai/runtime-state/node", async () => ({
    ...actualRuntimeState,
    acquireDirectoryLock: async (input: Parameters<typeof actualRuntimeState.acquireDirectoryLock>[0]) => {
      const metadata = input.metadata as { resourceKey?: string } | null;
      if (delayHigherLock && metadata?.resourceKey === "path:derived/knowledge/index.md") {
        delayHigherLock = false;
        markHigherAcquisitionDelayStarted();
        await higherAcquisitionDelay;
      }

      return await actualRuntimeState.acquireDirectoryLock(input);
    },
  }));

  const { initializeVault } = await loadCoreIndex();
  const {
    canonicalPathResource,
    withCanonicalResourceLocks,
  } = await loadCanonicalResourceLockModule();
  const vaultRoot = await makeScratchRoot("murph-core-resource-lock-scope-queue-");
  await initializeVault({ vaultRoot });
  const higherResource = canonicalPathResource("derived/knowledge/index.md");
  const lowerResource = canonicalPathResource("bank/preferences.json");
  let higherAcquired = false;
  let markHigherAcquired!: () => void;
  const higherAcquiredPromise = new Promise<void>((resolve) => {
    markHigherAcquired = resolve;
  });
  let releaseHigher!: () => void;
  const holdHigher = new Promise<void>((resolve) => {
    releaseHigher = resolve;
  });

  await withCanonicalResourceLocks({
    vaultRoot,
    resources: [canonicalPathResource("bank/memory.md")],
    run: async () => {
      const higherLock = withCanonicalResourceLocks({
        vaultRoot,
          resources: [higherResource],
          run: async () => {
            higherAcquired = true;
            markHigherAcquired();
            await holdHigher;
          },
        });

      await higherAcquisitionDelayStarted;

      let lowerResourceAcquired = false;
      let lowerLockSettled = false;
      const lowerLockResult = withCanonicalResourceLocks({
        vaultRoot,
        resources: [lowerResource],
        run: async () => {
          lowerResourceAcquired = true;
        },
      }).then(
        () => ({
          status: "fulfilled" as const,
        }),
        (error: unknown) => ({
          error,
          status: "rejected" as const,
        }),
      );
      lowerLockResult.finally(() => {
        lowerLockSettled = true;
      });

      try {
        await sleep(10);
        assert.equal(higherAcquired, false);
        assert.equal(lowerResourceAcquired, false);
        assert.equal(lowerLockSettled, false);

        releaseHigherAcquisitionDelay();
        await higherAcquiredPromise;
        const lowerResult = await lowerLockResult;
        assert.equal(lowerResourceAcquired, false);
        assert.equal(lowerResult.status, "rejected");
        assert.equal((lowerResult.error as { code?: string }).code, "CANONICAL_RESOURCE_LOCK_ORDER");
      } finally {
        releaseHigherAcquisitionDelay();
        releaseHigher();
        await higherLock;
      }
    },
  });
});

test("canonical resource locks time out with held-resource metadata", async () => {
  const actualRuntimeState = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );
  const acquireDirectoryLock = vi.fn(async () => {
    throw new actualRuntimeState.DirectoryLockHeldError({
      lockPath: "/tmp/mock-vault/.runtime/locks/canonical-resources/mock",
      metadataPath: "/tmp/mock-vault/.runtime/locks/canonical-resources/mock/owner.json",
      metadata: {
        pid: 4242,
        command: "foreign-resource-holder",
        startedAt: "2026-04-08T00:00:00.000Z",
        host: "foreign-host",
        resourceKey: "path:bank/memory.md",
        resourceLabel: "bank/memory.md",
      },
      state: "active",
    });
  });

  vi.doMock("@murphai/runtime-state/node", async () => ({
    ...actualRuntimeState,
    acquireDirectoryLock,
  }));

  const { acquireCanonicalResourceLock, canonicalPathResource } = await loadCanonicalResourceLockModule();
  const vaultRoot = await makeScratchRoot("murph-core-resource-timeout-");

  await assert.rejects(
    () =>
      acquireCanonicalResourceLock({
        vaultRoot,
        resource: canonicalPathResource("bank/memory.md"),
        timeoutMs: 10,
      }),
    (error: unknown) => {
      assert.equal((error as { name?: string }).name, "VaultError");
      const lockError = error as {
        code?: string;
        details?: {
          metadata?: {
            command?: string;
            pid?: number;
            resourceKey?: string;
            resourceLabel?: string;
          } | null;
          resourceKey?: string;
          resourceLabel?: string;
        };
        message: string;
      };
      assert.equal(lockError.code, "CANONICAL_RESOURCE_LOCKED");
      assert.match(lockError.message, /Timed out waiting for canonical resource "bank\/memory\.md"/u);
      assert.equal(lockError.details?.resourceKey, "path:bank/memory.md");
      assert.equal(lockError.details?.resourceLabel, "bank/memory.md");
      assert.equal(lockError.details?.metadata?.pid, 4242);
      assert.equal(lockError.details?.metadata?.command, "foreign-resource-holder");
      return true;
    },
  );
});

test("canonical resource locks clear malformed and stale on-disk metadata before acquiring", async () => {
  const {
    acquireCanonicalResourceLock,
    canonicalPathResource,
    CANONICAL_RESOURCE_LOCK_DIRECTORY,
    CANONICAL_RESOURCE_LOCK_METADATA_BASENAME,
  } = await loadCanonicalResourceLockModule();
  const actualRuntimeState = await vi.importActual<typeof import("@murphai/runtime-state/node")>(
    "@murphai/runtime-state/node",
  );
  const resource = canonicalPathResource("bank/memory.md");
  const resourceHash = createHash("sha1").update(resource.key).digest("hex");
  const vaultRoot = await makeVaultRoot();
  const lockDirectory = path.join(vaultRoot, CANONICAL_RESOURCE_LOCK_DIRECTORY, resourceHash);
  const metadataPath = path.join(lockDirectory, CANONICAL_RESOURCE_LOCK_METADATA_BASENAME);

  await fs.mkdir(lockDirectory, { recursive: true });
  await fs.writeFile(metadataPath, "{ not json }\n", "utf8");
  const malformedHandle = await acquireCanonicalResourceLock({
    vaultRoot,
    resource,
    timeoutMs: 1_000,
  });
  await malformedHandle.release();

  await fs.mkdir(lockDirectory, { recursive: true });
  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        pid: 999_999,
        command: "dead-resource-holder",
        startedAt: "2026-04-08T00:00:00.000Z",
        host: actualRuntimeState.fingerprintHost(),
        resourceKey: resource.key,
        resourceLabel: resource.label,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const staleHandle = await acquireCanonicalResourceLock({
    vaultRoot,
    resource,
    timeoutMs: 1_000,
  });
  await staleHandle.release();
});
