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

test("experiment lifecycle reads never list anything from the outcomes tree", async () => {
  const vaultRoot = await makeVault("murph-experiment-lifecycle-outcomes");

  try {
    await fs.mkdir(path.join(vaultRoot, "bank/experiments/outcomes"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(vaultRoot, "bank/experiments/outcomes/completed-2026-04-01.json"),
      "{}\n",
      "utf8",
    );
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
    // Un-promoted legacy media is inert for document listing too.
    await fs.writeFile(
      path.join(experimentRoot, "media/sleep-reset/2026-06-26/baseline.webp"),
      "image-bytes",
      "utf8",
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

test("experiment lifecycle reads never report a document hidden below the root as absent", async () => {
  for (const hidden of [
    "recovered/sleep-reset.md",
    "recovered/deeper/still/sleep-reset.md",
    // The reserved outcomes subtree is not exempt from this: it is walked by
    // the same rule as any other directory.
    "outcomes/sleep-reset.md",
    "outcomes/nested/sleep-reset.md",
  ]) {
    const vaultRoot = await makeVault("murph-experiment-lifecycle-hidden-md");
    const experimentRoot = path.join(vaultRoot, "bank/experiments");

    try {
      await createExperiment({ slug: "other", title: "Other", vaultRoot });
      const hiddenPath = path.join(experimentRoot, hidden);
      await fs.mkdir(path.dirname(hiddenPath), { recursive: true });
      await fs.writeFile(hiddenPath, "---\nslug: sleep-reset\n---\n", "utf8");

      // Reporting `other` alone would be authoritative absence for sleep-reset,
      // and callers archive that experiment's automations from this snapshot.
      await assert.rejects(
        readExperimentLifecycleFrontmatterDocuments({ vaultRoot }),
        (error: unknown) =>
          error instanceof VaultError
          && error.code === "EXPERIMENT_STORAGE_INVALID"
          // The rejected path names the hidden document itself.
          && (error.details as { relativePath?: string }).relativePath
            === `bank/experiments/${hidden}`,
        `hidden document ${hidden}`,
      );
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  }
});

test("experiment lifecycle reads fail closed on an entry they cannot prove inert", async () => {
  const vaultRoot = await makeVault("murph-experiment-lifecycle-symlink");
  const experimentRoot = path.join(vaultRoot, "bank/experiments");

  try {
    await createExperiment({ slug: "sleep-reset", title: "Sleep Reset", vaultRoot });
    // A symlink can stand in for a Markdown document or a directory holding one.
    await fs.symlink(
      path.join(experimentRoot, "sleep-reset.md"),
      path.join(experimentRoot, "alias-link.md"),
    );

    await assert.rejects(
      readExperimentLifecycleFrontmatterDocuments({ vaultRoot }),
      (error: unknown) =>
        error instanceof VaultError && error.code === "EXPERIMENT_STORAGE_INVALID",
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
