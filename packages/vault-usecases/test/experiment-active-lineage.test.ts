import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExperiment, initializeVault, parseFrontmatterDocument } from "@murphai/core";
import { test } from "vitest";
import { updateExperimentRecord } from "../src/usecases/experiment-journal-vault.ts";

const reference = {
  key: "protocol_variant:retired/synthetic-comparison",
  pageRevisionId: `sha256:${"1".repeat(64)}`,
  runSpecRevisionId: `sha256:${"2".repeat(64)}`,
};
const snapshot = {
  effectiveSpecHash: `sha256:${"3".repeat(64)}`,
  doseSignature: "One bounded synthetic comparison",
};
type Update = Parameters<typeof updateExperimentRecord>[0];

async function withSavedRun(
  status: "planned" | "paused" | "active" | "completed",
  run: (input: { vault: string; lookup: string; file: string }) => Promise<void>,
  savedPlan: Pick<Parameters<typeof createExperiment>[0], "commonsProtocolRef" | "onboarding"> = {},
) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "saved-experiment-"));
  try {
    await initializeVault({ vaultRoot: vault });
    const created = await createExperiment({
      vaultRoot: vault,
      slug: "saved-comparison",
      title: "Saved comparison",
      status,
      commonsProtocolRef: reference,
      effectiveProtocolSnapshot: snapshot,
      runPlan: { interventionStart: "2026-06-01", interventionEnd: "2026-06-07" },
      analysisPlan: { primaryBiomarkerKey: "biomarker:resting-heart-rate" },
      ...savedPlan,
    });
    await run({ vault, lookup: created.experiment.id, file: path.join(vault, created.experiment.relativePath) });
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
}

test.each(["planned", "paused", "active", "completed"] as const)(
  "preserves saved %s experiment lineage and snapshot without a public catalog",
  async (status) => withSavedRun(status, async ({ vault, lookup, file }) => {
    const before = await fs.readFile(file, "utf8");
    const changes: Partial<Update>[] = [
      { commonsProtocolRef: null },
      { commonsProtocolRef: { ...reference, pageRevisionId: `sha256:${"4".repeat(64)}` } },
      { effectiveProtocolSnapshot: { ...snapshot, doseSignature: "A different intervention" } },
      { effectiveProtocolSnapshot: null },
    ];
    for (const change of changes) {
      await assert.rejects(updateExperimentRecord({ vault, lookup, ...change }), /preserve.*protocol lineage/u);
      assert.equal(await fs.readFile(file, "utf8"), before);
    }
  }),
);

test.each(["planned", "paused"] as const)(
  "requires a recorded safety review before activating a saved %s run",
  async (status) => withSavedRun(status, async ({ vault, lookup, file }) => {
    const before = await fs.readFile(file, "utf8");
    await assert.rejects(updateExperimentRecord({ vault, lookup, status: "active" }), /Complete and record the safety review/u);
    assert.equal(await fs.readFile(file, "utf8"), before);
    await updateExperimentRecord({ vault, lookup, status: "active", onboarding: { completedAt: "2026-06-01T12:00:00.000Z" } });
    const saved = parseFrontmatterDocument(await fs.readFile(file, "utf8")).attributes;
    assert.equal(saved.status, "active");
    assert.deepEqual(saved.commonsProtocolRef, reference);
    assert.deepEqual(saved.effectiveProtocolSnapshot, snapshot);
  }),
);

test("saved safety blockers cannot be bypassed by catalog retirement", async () => {
  await withSavedRun("paused", async ({ vault, lookup, file }) => {
    const before = await fs.readFile(file, "utf8");
    await assert.rejects(updateExperimentRecord({
      vault, lookup, status: "active",
      onboarding: {
        completedAt: "2026-06-01T12:00:00.000Z",
        safety: { disposition: "do_not_start_unsupervised", positiveQuestionIds: ["synthetic-risk"] },
      },
    }), /[Kk]eep it planned/u);
    assert.equal(await fs.readFile(file, "utf8"), before);
  });
});

test("saved runs can tune their schedule and close out without a catalog lookup", async () => {
  await withSavedRun("active", async ({ vault, lookup, file }) => {
    await updateExperimentRecord({ vault, lookup, runPlan: { interventionStart: "2026-06-02", interventionEnd: "2026-06-08" } });
    await updateExperimentRecord({ vault, lookup, status: "completed" });
    const saved = parseFrontmatterDocument(await fs.readFile(file, "utf8")).attributes;
    assert.equal(saved.status, "completed");
    assert.deepEqual(saved.commonsProtocolRef, reference);
    assert.deepEqual(saved.effectiveProtocolSnapshot, snapshot);
  });
});

test("saved positive answers cannot activate under an unverifiable caution disposition", async () => {
  await withSavedRun("paused", async ({ vault, lookup, file }) => {
    const before = await fs.readFile(file, "utf8");
    await assert.rejects(updateExperimentRecord({
      vault, lookup, status: "active",
      onboarding: {
        completedAt: "2026-06-01T12:00:00.000Z",
        safety: { disposition: "continue_with_caution", positiveQuestionIds: ["synthetic-risk"] },
      },
    }), /fresh safety review/u);
    assert.equal(await fs.readFile(file, "utf8"), before);
  });
});

test.each<string[] | undefined>([undefined, []])(
  "blocks saved compression activation with negative safety answers (%j)",
  async (positiveQuestionIds) => withSavedRun("planned", async ({ vault, lookup, file }) => {
    const before = await fs.readFile(file, "utf8");
    await assert.rejects(
      updateExperimentRecord({ vault, lookup, status: "active" }),
      /fresh safety review/u,
    );
    assert.equal(await fs.readFile(file, "utf8"), before);
    assert.equal(parseFrontmatterDocument(before).attributes.status, "planned");
  }, {
    commonsProtocolRef: {
      ...reference,
      key: "protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants",
    },
    onboarding: {
      completedAt: "2026-06-01T12:00:00.000Z",
      safety: { positiveQuestionIds },
    },
  }),
);
