import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  createExperiment,
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

test("experiment lifecycle reads skip residue that cannot be a document", async () => {
  const vaultRoot = await makeVault("murph-experiment-lifecycle-residue");
  const experimentRoot = path.join(vaultRoot, "bank/experiments");

  try {
    await createExperiment({ slug: "sleep-reset", title: "Sleep Reset", vaultRoot });
    // Empty directories left behind by a completed media promotion.
    await fs.mkdir(path.join(experimentRoot, "media/sleep-reset/2026-06-26"), {
      recursive: true,
    });
    // Residue a synced filesystem adds on its own.
    await fs.writeFile(path.join(experimentRoot, ".DS_Store"), "finder", "utf8");
    await fs.writeFile(path.join(experimentRoot, "scratch.txt"), "notes", "utf8");
    await fs.symlink(
      path.join(experimentRoot, "sleep-reset.md"),
      path.join(experimentRoot, "alias-link.md"),
    );

    const result = await readExperimentLifecycleFrontmatterDocuments({ vaultRoot });
    assert.equal(result.yielded, false);
    assert.deepEqual(result.items.map((item) => item.slug), ["sleep-reset"]);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});

test("experiment lifecycle reads still fail closed on a stray Markdown document", async () => {
  const vaultRoot = await makeVault("murph-experiment-lifecycle-stray-md");
  const experimentRoot = path.join(vaultRoot, "bank/experiments");

  try {
    await fs.writeFile(
      path.join(experimentRoot, "Sleep Reset Copy.md"),
      "---\nslug: sleep-reset\n---\n",
      "utf8",
    );

    await assert.rejects(
      readExperimentLifecycleFrontmatterDocuments({ vaultRoot }),
      (error: unknown) =>
        error instanceof VaultError
        && error.code === "EXPERIMENT_STORAGE_INVALID"
        // The rejected path is what makes this diagnosable in production.
        && (error.details as { relativePath?: string }).relativePath
          === "bank/experiments/Sleep Reset Copy.md",
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
