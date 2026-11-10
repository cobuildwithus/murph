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

test("concurrent wearable and entity readers serialize publication and materialize provider rows once", async () => {
  vi.resetModules();

  let wearableProjectionCount = 0;
  vi.doMock("../src/projection/wearable-summary-projector.ts", async () => {
    const actual = await vi.importActual<typeof import("../src/projection/wearable-summary-projector.ts")>(
      "../src/projection/wearable-summary-projector.ts",
    );
    return {
      ...actual,
      buildWearableSummaryProjectionFromDataset: (...args: Parameters<typeof actual.buildWearableSummaryProjectionFromDataset>) => {
        wearableProjectionCount += 1;
        return actual.buildWearableSummaryProjectionFromDataset(...args);
      },
    };
  });
  let rebuildCallCount = 0;
  let activeRebuildCount = 0;
  let maxActiveRebuildCount = 0;

  vi.doMock("../src/vault-source.ts", async () => {
    const actual = await vi.importActual<typeof import("../src/vault-source.ts")>(
      "../src/vault-source.ts",
    );

    return {
      ...actual,
      readVaultSourceStrict: async (
        ...args: Parameters<typeof actual.readVaultSourceStrict>
      ): ReturnType<typeof actual.readVaultSourceStrict> => {
        rebuildCallCount += 1;
        activeRebuildCount += 1;
        maxActiveRebuildCount = Math.max(maxActiveRebuildCount, activeRebuildCount);

        await new Promise((resolve) => setTimeout(resolve, 25));

        try {
          return await actual.readVaultSourceStrict(...args);
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
    const { withCliTiming, timeCliDispatch } = await import("@murphai/runtime-state/node/cli-timing");
    const reports: import("@murphai/runtime-state/cli-timing").CliTiming[] = [];
    async function measured<T>(command: string, read: () => Promise<T>): Promise<T> {
      let value!: T;
      await withCliTiming(() => timeCliDispatch(command, async () => { value = await read(); }),
        (report) => { reports.push(report); });
      return value;
    }
    const [vault, wearableSourceHealth] = await Promise.all([
      measured("vault show", () => query.readVault(vaultRoot)),
      measured("wearables sources list", () => query.summarizeWearableSourceHealthRuntime(vaultRoot)),
    ]);
    const phases = reports.flatMap((r) => r.commands.flatMap((c) => c.phases));
    // Both sections publish under the same lock; provider rows are built once.
    const rebuildPhases = phases.filter((p) => p.phase === "query-rebuild").length;
    assert.equal(rebuildPhases, 2);
    assert.equal(wearableProjectionCount, 1);
    assert.equal(phases.filter((p) => p.phase === "query-wait").length, 2);
    assert.equal(phases.filter((p) => p.phase === "query-freshness").length, 2);
    assert.deepEqual(reports.flatMap((r) => r.commands.map((c) => c.command)).sort(),
      ["vault show", "wearables sources list"]);
    assert.equal(JSON.stringify(reports).includes(vaultRoot), false);
    const status = await query.getQueryProjectionStatus(vaultRoot);

    assert.equal(vault.metadata?.vaultId, "vault_01K9D9B2D7N4QW5T6Y7Z8A9B0E");
    assert.deepEqual(wearableSourceHealth, []);
    assert.equal(status.fresh, false);
    const { readFreshQueryProjectionSections } = await import("../src/projection/freshness.ts");
    const { currentQueryProjectionLocation } = await import("../src/projection/schema.ts");
    const { listCanonicalSourceManifest } = await import("../src/vault-source.ts");
    assert.deepEqual([...await readFreshQueryProjectionSections(
      currentQueryProjectionLocation(vaultRoot), await listCanonicalSourceManifest(vaultRoot),
    )], ["entities", "wearables"]);
    assert.equal(rebuildCallCount, 2);
    assert.equal(maxActiveRebuildCount, 1);
  } finally {
    vi.doUnmock("../src/vault-source.ts");
    vi.doUnmock("../src/projection/wearable-summary-projector.ts");
    vi.resetModules();
  }
});

test("projection rebuild shares one wearable dataset collection", async () => {
  vi.resetModules();

  let collectWearableDatasetCallCount = 0;

  vi.doMock("../src/wearables/candidates.ts", async () => {
    const actual = await vi.importActual<typeof import("../src/wearables/candidates.ts")>(
      "../src/wearables/candidates.ts",
    );

    return {
      ...actual,
      collectWearableDataset: (
        ...args: Parameters<typeof actual.collectWearableDataset>
      ): ReturnType<typeof actual.collectWearableDataset> => {
        collectWearableDatasetCallCount += 1;
        return actual.collectWearableDataset(...args);
      },
    };
  });

  try {
    const vaultRoot = await createTempVaultRoot();
    await writeMinimalVault(vaultRoot);

    const { rebuildQueryProjection } = await import("../src/query-projection.ts");
    await rebuildQueryProjection(vaultRoot);

    assert.equal(collectWearableDatasetCallCount, 1);
  } finally {
    vi.doUnmock("../src/wearables/candidates.ts");
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


test("freshness timing measures one unlocked check and one locked recheck before publication", async () => {
  vi.resetModules();
  let tick = 0n;
  const order: string[] = [];
  const clock = vi.spyOn(process.hrtime, "bigint").mockImplementation(() => tick);
  vi.doMock("../src/vault-source.ts", async () => {
    const actual = await vi.importActual<typeof import("../src/vault-source.ts")>("../src/vault-source.ts");
    return { ...actual, listCanonicalSourceManifest: async (...args: Parameters<typeof actual.listCanonicalSourceManifest>) => {
      order.push("manifest"); tick += 700_000_000n;
      return actual.listCanonicalSourceManifest(...args);
    }, readVaultSourceStrict: async (...args: Parameters<typeof actual.readVaultSourceStrict>) => {
      order.push("rebuild"); tick += 3_000_000_000n;
      return actual.readVaultSourceStrict(...args);
    } };
  });
  vi.doMock("../src/projection/freshness.ts", async () => {
    const actual = await vi.importActual<typeof import("../src/projection/freshness.ts")>("../src/projection/freshness.ts");
    return { ...actual, readFreshQueryProjectionSections: async (...args: Parameters<typeof actual.readFreshQueryProjectionSections>) => {
      order.push("status"); tick += 200_000_000n;
      return actual.readFreshQueryProjectionSections(...args);
    } };
  });
  try {
    const root = await createTempVaultRoot();
    await writeMinimalVault(root);
    const query = await import("../src/query-projection.ts");
    const { timeCliDispatch, withCliTiming } = await import("@murphai/runtime-state/node/cli-timing");
    let report!: import("@murphai/runtime-state/cli-timing").CliTiming;
    let rows!: Awaited<ReturnType<typeof query.listCanonicalEntitiesRuntime>>;
    await withCliTiming(() => timeCliDispatch("goal list", async () => {
      rows = await query.listCanonicalEntitiesRuntime(root);
    }), (value) => { report = value; });
    assert.deepEqual(order, ["manifest", "status", "manifest", "status", "rebuild"]);
    const phases = Object.fromEntries(report.commands[0]!.phases.map((p) => [p.phase, p]));
    assert.equal(phases["query-manifest"]!.count, 2);
    assert.equal(phases["query-manifest"]!.sumUs, 1_400_000);
    assert.equal(phases["query-status"]!.count, 2);
    assert.equal(phases["query-status"]!.sumUs, 400_000);
    assert.equal(phases["query-rebuild"]!.sumUs, 3_000_000);
    assert.equal(phases["query-freshness"]!.sumUs, 4_800_000);
    assert.equal(phases["query-wait"]!.count, 1);
    assert.equal(phases["query-wait"]!.sumUs, 0);
    assert.deepEqual(await query.listCanonicalEntitiesRuntime(root), rows);
    assert.equal(JSON.stringify(report).includes(root), false);
  } finally {
    clock.mockRestore();
    vi.doUnmock("../src/vault-source.ts");
    vi.doUnmock("../src/projection/freshness.ts");
    vi.resetModules();
  }
});

test("query failures preserve the original rejection and close only measured spans", async () => {
  vi.resetModules();
  const failure = Object.assign(new Error("PRIVATE_SENTINEL"), { name: "AbortError" });
  vi.doMock("../src/vault-source.ts", async () => {
    const actual = await vi.importActual<typeof import("../src/vault-source.ts")>("../src/vault-source.ts");
    return { ...actual, listCanonicalSourceManifest: async () => { throw failure; } };
  });
  try {
    const query = await import("../src/query-projection.ts");
    const { timeCliDispatch, withCliTiming } = await import("@murphai/runtime-state/node/cli-timing");
    let report!: import("@murphai/runtime-state/cli-timing").CliTiming;
    await assert.rejects(withCliTiming(() => timeCliDispatch("goal list", async () => {
      await query.listCanonicalEntitiesRuntime("/PRIVATE_SENTINEL");
    }), (value) => { report = value; }), (error) => error === failure);
    const command = report.commands[0]!;
    assert.equal(command.outcome, "error"); // No invented timeout/cancellation dimension.
    assert.equal(command.phases.some((p) => p.phase === "query-manifest"), true);
    assert.equal(command.phases.some((p) => p.phase === "query-status"), false);
    assert.equal(JSON.stringify(report).includes("PRIVATE_SENTINEL"), false);
  } finally {
    vi.doUnmock("../src/vault-source.ts");
    vi.resetModules();
  }
});
