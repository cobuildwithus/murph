import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  createExperiment,
  initializeVault,
  listWriteOperationMetadataPaths,
  parseFrontmatterDocument,
  readStoredWriteOperation,
  updateExperiment,
  VaultError,
  withHostedCanonicalWritePort,
} from "../src/index.ts";

async function makeVault(): Promise<string> {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-experiment-atomic-"));
  await initializeVault({ vaultRoot, timezone: "UTC" });
  return vaultRoot;
}

function completeExperimentInput(vaultRoot: string) {
  return {
    vaultRoot,
    slug: "evening-downshift",
    title: "Evening Downshift",
    hypothesis: "A small transition ritual makes bedtime easier.",
    startedOn: "2026-07-16T12:00:00.000Z",
    status: "active",
    body: "# Evening Downshift\n\n## Plan\n\nTry the small transition for one week.\n",
    tags: ["sleep", "evening"],
    commonsProtocolRef: {
      key: "protocol_variant:bedtime-transition/standard-tiny-fallback-transition",
      pageRevisionId: `sha256:${"a".repeat(64)}`,
      runSpecRevisionId: `sha256:${"b".repeat(64)}`,
      testPlanId: "sleep-quality-7d",
    },
    effectiveProtocolSnapshot: {
      effectiveSpecHash: `sha256:${"c".repeat(64)}`,
      doseSignature: "One small pre-bed transition each evening",
      modality: "bedtime_transition",
      targetSessions: 7,
      minimumUsefulSessions: 4,
      stopConditions: ["Stop if the routine makes bedtime more stressful."],
    },
    runPlan: {
      interventionStart: "2026-07-16",
      interventionEnd: "2026-07-22",
      modality: "bedtime_transition",
      targetSessions: 7,
      minimumUsefulSessions: 4,
      logging: {
        sessionFields: ["sleep_quality_1_10"],
      },
    },
    analysisPlan: {
      primaryBiomarkerKey: "biomarker:sleep-quality",
      desiredDirection: "increase" as const,
    },
    onboarding: {
      completedAt: "2026-07-16T11:30:00.000Z",
      safety: {
        cautionLevel: "moderate" as const,
        notes: ["No blocking safety answers."],
      },
    },
    assistantSupport: {
      remindersEnabled: true,
      checkInCadence: "weekly" as const,
    },
  };
}

test("complete experiment create commits plan, onboarding, and start evidence in one operation", async () => {
  const vaultRoot = await makeVault();

  try {
    const input = completeExperimentInput(vaultRoot);
    const created = await createExperiment(input);
    const retry = await createExperiment(input);
    const raw = await fs.readFile(path.join(vaultRoot, created.experiment.relativePath), "utf8");
    const document = parseFrontmatterDocument(raw);

    assert.equal(created.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.experiment.id, created.experiment.id);
    assert.deepEqual(document.attributes.runPlan, input.runPlan);
    assert.deepEqual(document.attributes.analysisPlan, input.analysisPlan);
    assert.deepEqual(document.attributes.onboarding, input.onboarding);
    assert.deepEqual(document.attributes.commonsProtocolRef, input.commonsProtocolRef);
    assert.deepEqual(document.attributes.assistantSupport, input.assistantSupport);
    assert.equal(document.body, input.body);

    await assert.rejects(
      () =>
        createExperiment({
          ...input,
          onboarding: {
            ...input.onboarding,
            contextNotes: ["A different prepared plan must not overwrite this run."],
          },
        }),
      (error: unknown) =>
        error instanceof VaultError && error.code === "VAULT_EXPERIMENT_CONFLICT",
    );
    assert.equal(
      await fs.readFile(path.join(vaultRoot, created.experiment.relativePath), "utf8"),
      raw,
    );

    const operationPaths = await listWriteOperationMetadataPaths(vaultRoot);
    const operations = await Promise.all(
      operationPaths.map((relativePath) => readStoredWriteOperation(vaultRoot, relativePath)),
    );
    assert.equal(
      operations.filter((operation) => operation.operationType === "experiment_create").length,
      1,
    );
    assert.equal(
      operations.filter((operation) => operation.operationType === "experiment_update").length,
      0,
    );
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});

test("a failed complete experiment commit leaves no partial active experiment", async () => {
  const vaultRoot = await makeVault();
  const referenceVaultRoot = await makeVault();
  const input = completeExperimentInput(vaultRoot);

  try {
    const created = await createExperiment({
      ...input,
      vaultRoot: referenceVaultRoot,
    });
    await assert.rejects(
      () =>
        withHostedCanonicalWritePort(
          {
            async persistCanonicalWrite() {
              throw new Error("injected canonical persistence failure");
            },
          },
          () => createExperiment(input),
        ),
      /injected canonical persistence failure/u,
    );

    await assert.rejects(
      fs.access(path.join(vaultRoot, created.experiment.relativePath)),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        Reflect.get(error, "code") === "ENOENT",
    );
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(referenceVaultRoot, { recursive: true, force: true });
  }
});

test("experiment document CAS admits only one of two concurrent stale edits", async () => {
  const vaultRoot = await makeVault();

  try {
    const created = await createExperiment({
      vaultRoot,
      slug: "concurrent-activation",
      title: "Concurrent Activation",
      startedOn: "2026-07-16T12:00:00.000Z",
      status: "planned",
    });
    const absolutePath = path.join(vaultRoot, created.experiment.relativePath);
    const original = await fs.readFile(absolutePath, "utf8");
    const expectedDocumentSha256 = createHash("sha256").update(original).digest("hex");

    const results = await Promise.allSettled([
      updateExperiment({
        vaultRoot,
        relativePath: created.experiment.relativePath,
        title: "Concurrent Activation A",
        expectedDocumentSha256,
      }),
      updateExperiment({
        vaultRoot,
        relativePath: created.experiment.relativePath,
        title: "Concurrent Activation B",
        expectedDocumentSha256,
      }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof VaultError);
    assert.equal(rejected.reason.code, "VAULT_EXPERIMENT_CONFLICT");

    const updated = parseFrontmatterDocument(await fs.readFile(absolutePath, "utf8"));
    assert.ok(
      updated.attributes.title === "Concurrent Activation A" ||
        updated.attributes.title === "Concurrent Activation B",
    );
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});
