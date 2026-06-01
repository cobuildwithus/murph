import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test, vi } from "vitest";

import { CURRENT_VAULT_FORMAT_VERSION, VAULT_LAYOUT } from "@murphai/contracts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) => rm(vaultRoot, { force: true, recursive: true })),
  );
});

test("concurrent stale projection readers share one rebuild", async () => {
  vi.resetModules();

  let rebuildCallCount = 0;
  let activeRebuildCount = 0;
  let maxActiveRebuildCount = 0;

  vi.doMock("../src/projection/rebuild.ts", async () => {
    const actual = await vi.importActual<typeof import("../src/projection/rebuild.ts")>(
      "../src/projection/rebuild.ts",
    );

    return {
      ...actual,
      rebuildQueryProjectionWithManifest: async (
        ...args: Parameters<typeof actual.rebuildQueryProjectionWithManifest>
      ): ReturnType<typeof actual.rebuildQueryProjectionWithManifest> => {
        rebuildCallCount += 1;
        activeRebuildCount += 1;
        maxActiveRebuildCount = Math.max(maxActiveRebuildCount, activeRebuildCount);

        await new Promise((resolve) => setTimeout(resolve, 25));

        try {
          return await actual.rebuildQueryProjectionWithManifest(...args);
        } finally {
          activeRebuildCount -= 1;
        }
      },
    };
  });

  try {
    const vaultRoot = await createTempVaultRoot();
    await writeMinimalVault(vaultRoot);

    const query = await import("../src/index.ts");
    const [vault, wearableSourceHealth] = await Promise.all([
      query.readVault(vaultRoot),
      query.summarizeWearableSourceHealthRuntime(vaultRoot),
    ]);
    const status = await query.getQueryProjectionStatus(vaultRoot);

    assert.equal(vault.metadata?.vaultId, "vault_01K9D9B2D7N4QW5T6Y7Z8A9B0E");
    assert.deepEqual(wearableSourceHealth, []);
    assert.equal(status.fresh, true);
    assert.equal(rebuildCallCount, 1);
    assert.equal(maxActiveRebuildCount, 1);
  } finally {
    vi.doUnmock("../src/projection/rebuild.ts");
    vi.resetModules();
  }
});

async function createTempVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-projection-concurrency-"));
  tempRoots.push(vaultRoot);
  return vaultRoot;
}

async function writeMinimalVault(vaultRoot: string): Promise<void> {
  await writeVaultFile(
    vaultRoot,
    VAULT_LAYOUT.metadata,
    JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01K9D9B2D7N4QW5T6Y7Z8A9B0E",
      createdAt: "2026-04-20T00:00:00.000Z",
      title: "Projection concurrency vault",
      timezone: "UTC",
    }),
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-20.md"),
    [
      "---",
      "title: Projection concurrency journal",
      "---",
      "",
      "Projection rebuild regression note.",
    ].join("\n"),
  );
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${content}\n`, "utf8");
}
