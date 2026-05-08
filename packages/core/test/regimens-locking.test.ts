import os from "node:os";
import path from "node:path";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  afterEach,
  expect,
  test,
  vi,
} from "vitest";

const tempRoots: string[] = [];

async function makeVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-core-regimens-locking-"));
  tempRoots.push(vaultRoot);
  return vaultRoot;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("serializes regimen registry writes before resolving the latest target", async () => {
  const vaultRoot = await makeVaultRoot();
  const vaultModule = await import("../src/vault.ts");
  await vaultModule.initializeVault({ vaultRoot });

  vi.resetModules();
  const operationsModule = await import("../src/operations/index.ts");
  let tail = Promise.resolve();
  const lockCalls: Array<Array<{ key: string; label: string }>> = [];
  const lockSpy = vi
    .spyOn(operationsModule, "withCanonicalResourceLocks")
    .mockImplementation(async (input) => {
      lockCalls.push([...input.resources]);
      const previous = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      try {
        return await input.run();
      } finally {
        release?.();
      }
    });
  const regimensModule = await import("../src/bank/regimens.ts");

  const results = await Promise.all([
    regimensModule.upsertRegimen({
      vaultRoot,
      title: "Vitamin D",
      kind: "supplement",
      startedOn: "2026-05-01",
      dose: 2000,
      unit: "IU",
    }),
    regimensModule.upsertRegimen({
      vaultRoot,
      title: "Magnesium",
      kind: "supplement",
      startedOn: "2026-05-01",
      dose: 200,
      unit: "mg",
    }),
  ]);
  await regimensModule.stopRegimen({
    vaultRoot,
    regimenId: results[0].record.entity.regimenId,
    stoppedOn: "2026-05-06",
  });

  const listed = await regimensModule.listRegimens(vaultRoot);

  expect(lockSpy).toHaveBeenCalledTimes(3);
  expect(
    lockCalls.every((resources) =>
      resources.some(
        (resource) =>
          resource.key === "logical:bank/regimens" &&
          resource.label === "bank/regimens",
      ),
    ),
  ).toBe(true);
  expect(listed.map((record) => record.entity.title).sort()).toEqual(["Magnesium", "Vitamin D"]);
  expect(listed.find((record) => record.entity.title === "Vitamin D")?.entity.status).toBe("stopped");
});
