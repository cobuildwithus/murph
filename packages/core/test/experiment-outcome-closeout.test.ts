import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  experimentFrontmatterSchema,
  experimentOutcomeSchema,
  type ExperimentFrontmatter,
  type ExperimentOutcome,
} from "@murphai/contracts";
import { test } from "vitest";

import {
  createExperiment,
  initializeVault,
  parseFrontmatterDocument,
  updateExperiment,
  VaultError,
  writeExperimentOutcome,
} from "../src/index.ts";

async function makeVault(name: string): Promise<string> {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  await initializeVault({ vaultRoot });
  return vaultRoot;
}

async function readExperiment(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<{
  frontmatter: ExperimentFrontmatter;
  body: string;
}> {
  const parsed = parseFrontmatterDocument(
    await fs.readFile(path.join(input.vaultRoot, input.relativePath), "utf8"),
  );
  return {
    frontmatter: experimentFrontmatterSchema.parse(parsed.attributes),
    body: parsed.body,
  };
}

function buildOutcome(frontmatter: ExperimentFrontmatter): ExperimentOutcome {
  return experimentOutcomeSchema.parse({
    schemaVersion: "murph.experiment-outcome.v1",
    asOf: "2026-06-07",
    adherenceSummary: {
      adherenceLevel: "good",
      completedSessions: 6,
      minimumUsefulSessions: 4,
      status: "on_track",
      targetSessions: 6,
    },
    conclusion: {
      caveats: [],
      headline: "The planned run is ready for review.",
      plainLanguage: "The planned observations were captured.",
    },
    confidence: {
      level: "medium",
      reasons: ["The planned run reached its minimum useful session count."],
    },
    confounders: [],
    experiment: {
      id: frontmatter.experimentId,
      slug: frontmatter.slug,
      status: frontmatter.status,
      title: frontmatter.title,
    },
    commonsProtocolRef: frontmatter.commonsProtocolRef ?? null,
    effectiveProtocolSnapshot: frontmatter.effectiveProtocolSnapshot ?? null,
    metricResults: [],
    protocolRef: frontmatter.protocolRef ?? null,
    windows: {
      baselineEnd: null,
      baselineStart: null,
      interventionEnd: "2026-06-07",
      interventionStart: "2026-06-01",
    },
  });
}

test("experiment outcome closeout rejects a stale frontmatter revision without overwriting member edits", async () => {
  const vaultRoot = await makeVault("murph-experiment-outcome-stale");
  const created = await createExperiment({
    vaultRoot,
    slug: "sleep-window",
    title: "Sleep Window",
    startedOn: "2026-06-01",
    status: "active",
  });
  await updateExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    runPlan: {
      interventionStart: "2026-06-01",
      interventionEnd: "2026-06-07",
    },
    assistantSupport: { remindersEnabled: true },
  });
  const expected = await readExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
  });

  await updateExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    status: "paused",
    body: "# Sleep Window\n\nMember pause note.\n",
    assistantSupport: { remindersEnabled: false },
  });

  await assert.rejects(
    writeExperimentOutcome({
      vaultRoot,
      relativePath: created.experiment.relativePath,
      expectedFrontmatter: expected.frontmatter,
      outcome: buildOutcome(expected.frontmatter),
    }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EXPERIMENT_REVISION_CONFLICT",
  );

  const current = await readExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
  });
  assert.equal(current.frontmatter.status, "paused");
  assert.equal(current.frontmatter.assistantSupport?.remindersEnabled, false);
  assert.match(current.body, /Member pause note/u);
  assert.equal(current.frontmatter.outcomeRef, undefined);
  await assert.rejects(
    fs.stat(path.join(vaultRoot, "bank/experiments/outcomes/sleep-window-2026-06-07.json")),
    (error: unknown) =>
      error !== null &&
      typeof error === "object" &&
      Reflect.get(error, "code") === "ENOENT",
  );
});

test("concurrent closeout and member pause preserve the pause, consent edit, and body", async () => {
  const vaultRoot = await makeVault("murph-experiment-outcome-race");
  const created = await createExperiment({
    vaultRoot,
    slug: "evening-wind-down",
    title: "Evening Wind Down",
    startedOn: "2026-06-01",
    status: "active",
  });
  await updateExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    body: "# Evening Wind Down\n\nInitial plan.\n",
    runPlan: {
      interventionStart: "2026-06-01",
      interventionEnd: "2026-06-07",
    },
    assistantSupport: { remindersEnabled: true },
  });
  const expected = await readExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
  });

  const [closeout, pause] = await Promise.allSettled([
    writeExperimentOutcome({
      vaultRoot,
      relativePath: created.experiment.relativePath,
      expectedFrontmatter: expected.frontmatter,
      outcome: buildOutcome(expected.frontmatter),
    }),
    updateExperiment({
      vaultRoot,
      relativePath: created.experiment.relativePath,
      status: "paused",
      body: "# Evening Wind Down\n\nMember changed the plan while closeout ran.\n",
      assistantSupport: { remindersEnabled: false },
    }),
  ]);

  assert.equal(pause.status, "fulfilled");
  if (closeout.status === "rejected") {
    assert.ok(closeout.reason instanceof VaultError);
    assert.equal(closeout.reason.code, "EXPERIMENT_REVISION_CONFLICT");
  }

  const current = await readExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
  });
  assert.equal(current.frontmatter.status, "paused");
  assert.equal(current.frontmatter.assistantSupport?.remindersEnabled, false);
  assert.match(current.body, /Member changed the plan while closeout ran/u);

  if (closeout.status === "fulfilled") {
    assert.equal(current.frontmatter.outcomeRef?.outcomeId, closeout.value.outcome.outcomeId);
    const persisted = experimentOutcomeSchema.parse(JSON.parse(
      await fs.readFile(path.join(vaultRoot, closeout.value.outcomePath), "utf8"),
    ));
    assert.equal(persisted.outcomeId, closeout.value.outcome.outcomeId);
  } else {
    assert.equal(current.frontmatter.outcomeRef, undefined);
  }
});

test("core keeps a completed Health Commons lineage and effective snapshot immutable", async () => {
  const vaultRoot = await makeVault("murph-experiment-completed-lineage");
  const commonsProtocolRef = {
    key: "protocol_variant:sleep-baseline-observation/consistent-wake-time",
    pageRevisionId: `sha256:${"1".repeat(64)}`,
    runSpecRevisionId: `sha256:${"2".repeat(64)}`,
  } as const;
  const effectiveProtocolSnapshot = {
    effectiveSpecHash: `sha256:${"3".repeat(64)}`,
    doseSignature: "Keep one wake time for seven days",
  } as const;
  const created = await createExperiment({
    vaultRoot,
    slug: "immutable-wake-time",
    title: "Immutable Wake Time",
    status: "completed",
    commonsProtocolRef,
    effectiveProtocolSnapshot,
  });

  for (const update of [
    {
      commonsProtocolRef: {
        ...commonsProtocolRef,
        pageRevisionId: `sha256:${"4".repeat(64)}` as const,
      },
    },
    {
      effectiveProtocolSnapshot: {
        ...effectiveProtocolSnapshot,
        effectiveSpecHash: `sha256:${"5".repeat(64)}` as const,
      },
    },
  ]) {
    await assert.rejects(
      updateExperiment({
        vaultRoot,
        relativePath: created.experiment.relativePath,
        ...update,
      }),
      (error: unknown) =>
        error instanceof VaultError &&
        error.code === "EXPERIMENT_LINEAGE_IMMUTABLE",
    );
  }

  const current = await readExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
  });
  assert.deepEqual(current.frontmatter.commonsProtocolRef, commonsProtocolRef);
  assert.deepEqual(current.frontmatter.effectiveProtocolSnapshot, effectiveProtocolSnapshot);
});

test("core keeps every part of an active private protocol lineage immutable", async () => {
  const vaultRoot = await makeVault("murph-experiment-active-private-lineage");
  const commonsProtocolRef = {
    key: "protocol_variant:sleep-baseline-observation/consistent-wake-time",
    pageRevisionId: `sha256:${"1".repeat(64)}`,
    runSpecRevisionId: `sha256:${"2".repeat(64)}`,
  } as const;
  const protocolRef = {
    protocolId: "prot_01K87VFGG91SZ3MVV4EVQFDRWA",
    protocolRevisionId: `sha256:${"3".repeat(64)}`,
    effectiveSpecHash: `sha256:${"4".repeat(64)}`,
  } as const;
  const effectiveProtocolSnapshot = {
    effectiveSpecHash: protocolRef.effectiveSpecHash,
    doseSignature: "Keep one wake time for seven days",
  } as const;
  const created = await createExperiment({
    vaultRoot,
    slug: "private-wake-time",
    title: "Private Wake Time",
    status: "active",
    commonsProtocolRef,
    protocolRef,
    effectiveProtocolSnapshot,
  });

  for (const update of [
    {
      protocolRef: {
        ...protocolRef,
        protocolId: "prot_01K87VFGG91SZ3MVV4EVQFDRWB" as const,
      },
    },
    {
      protocolRef: {
        ...protocolRef,
        protocolRevisionId: `sha256:${"5".repeat(64)}` as const,
      },
    },
    {
      protocolRef: {
        ...protocolRef,
        effectiveSpecHash: `sha256:${"6".repeat(64)}` as const,
      },
      effectiveProtocolSnapshot: {
        ...effectiveProtocolSnapshot,
        effectiveSpecHash: `sha256:${"6".repeat(64)}` as const,
      },
    },
  ]) {
    await assert.rejects(
      updateExperiment({
        vaultRoot,
        relativePath: created.experiment.relativePath,
        ...update,
      }),
      (error: unknown) =>
        error instanceof VaultError &&
        error.code === "EXPERIMENT_LINEAGE_IMMUTABLE",
    );
  }

  const current = await readExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
  });
  assert.deepEqual(current.frontmatter.protocolRef, protocolRef);
});

test("experiment outcome closeout rejects schema-valid lineage mismatches before writing", async () => {
  const vaultRoot = await makeVault("murph-experiment-outcome-lineage");
  const commonsProtocolRef = {
    key: "protocol_variant:sleep-baseline-observation/consistent-wake-time",
    pageRevisionId: `sha256:${"1".repeat(64)}`,
    runSpecRevisionId: `sha256:${"2".repeat(64)}`,
  } as const;
  const protocolRef = {
    protocolId: "prot_01K87VFGG91SZ3MVV4EVQFDRWA",
    protocolRevisionId: `sha256:${"3".repeat(64)}`,
    effectiveSpecHash: `sha256:${"4".repeat(64)}`,
  } as const;
  const effectiveProtocolSnapshot = {
    effectiveSpecHash: protocolRef.effectiveSpecHash,
    doseSignature: "Keep one wake time for seven days",
  } as const;
  const created = await createExperiment({
    vaultRoot,
    slug: "lineage-bound-outcome",
    title: "Lineage Bound Outcome",
    status: "active",
    commonsProtocolRef,
    protocolRef,
    effectiveProtocolSnapshot,
  });
  const expected = await readExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
  });
  const matchingOutcome = buildOutcome(expected.frontmatter);
  const mismatchedOutcomes = [
    experimentOutcomeSchema.parse({
      ...matchingOutcome,
      commonsProtocolRef: {
        ...commonsProtocolRef,
        pageRevisionId: `sha256:${"5".repeat(64)}`,
      },
    }),
    experimentOutcomeSchema.parse({
      ...matchingOutcome,
      protocolRef: {
        ...protocolRef,
        protocolRevisionId: `sha256:${"6".repeat(64)}`,
      },
    }),
    experimentOutcomeSchema.parse({
      ...matchingOutcome,
      effectiveProtocolSnapshot: {
        ...effectiveProtocolSnapshot,
        effectiveSpecHash: `sha256:${"7".repeat(64)}`,
      },
    }),
  ];

  for (const outcome of mismatchedOutcomes) {
    await assert.rejects(
      writeExperimentOutcome({
        vaultRoot,
        relativePath: created.experiment.relativePath,
        expectedFrontmatter: expected.frontmatter,
        outcome,
      }),
      (error: unknown) =>
        error instanceof VaultError &&
        error.code === "EXPERIMENT_OUTCOME_LINEAGE_MISMATCH",
    );
  }

  const current = await readExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
  });
  assert.equal(current.frontmatter.outcomeRef, undefined);
  await assert.rejects(
    fs.stat(path.join(
      vaultRoot,
      "bank/experiments/outcomes/lineage-bound-outcome-2026-06-07.json",
    )),
    (error: unknown) =>
      error !== null &&
      typeof error === "object" &&
      Reflect.get(error, "code") === "ENOENT",
  );
});
