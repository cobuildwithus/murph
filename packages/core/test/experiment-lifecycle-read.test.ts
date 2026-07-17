import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  initializeVault,
  MAX_EXPERIMENT_LIFECYCLE_DOCUMENTS,
  readExperimentLifecycleFrontmatterDocuments,
  VaultError,
} from "../src/index.ts";

async function makeVault(name: string): Promise<string> {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  await initializeVault({ vaultRoot, timezone: "UTC" });
  return vaultRoot;
}

test("experiment lifecycle reads discard a partially enumerated snapshot when asked to yield", async () => {
  const vaultRoot = await makeVault("murph-experiment-lifecycle-yield");
  const experimentRoot = path.join(vaultRoot, "bank/experiments");

  try {
    await fs.rm(path.join(experimentRoot, "outcomes"), { recursive: true, force: true });
    await fs.writeFile(path.join(experimentRoot, "first.md"), "partial fixture", "utf8");
    await fs.writeFile(path.join(experimentRoot, "second.md"), "partial fixture", "utf8");
    let checks = 0;

    const result = await readExperimentLifecycleFrontmatterDocuments({
      vaultRoot,
      shouldYield: () => {
        checks += 1;
        return checks === 5;
      },
    });

    assert.deepEqual(result, { items: [], yielded: true });
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});

test("experiment lifecycle reads never traverse the outcomes tree", async () => {
  const vaultRoot = await makeVault("murph-experiment-lifecycle-outcomes");

  try {
    await fs.mkdir(path.join(vaultRoot, "bank/experiments/outcomes"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(vaultRoot, "bank/experiments/outcomes/not-an-outcome.txt"),
      "ignored by lifecycle frontmatter reads",
      "utf8",
    );

    assert.deepEqual(
      await readExperimentLifecycleFrontmatterDocuments({ vaultRoot }),
      { items: [], yielded: false },
    );
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});

test("experiment lifecycle reads enforce the hard direct-document ceiling", async () => {
  const vaultRoot = await makeVault("murph-experiment-lifecycle-limit");
  const experimentRoot = path.join(vaultRoot, "bank/experiments");

  try {
    for (let index = 0; index <= MAX_EXPERIMENT_LIFECYCLE_DOCUMENTS; index += 1) {
      const suffix = index.toString().padStart(4, "0");
      await fs.writeFile(
        path.join(experimentRoot, `experiment-${suffix}.md`),
        "limit fixture",
        "utf8",
      );
    }

    await assert.rejects(
      readExperimentLifecycleFrontmatterDocuments({ vaultRoot }),
      (error: unknown) =>
        error instanceof VaultError
        && error.code === "EXPERIMENT_LIFECYCLE_LIMIT_EXCEEDED",
    );
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});
