import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";

import { afterEach, test } from "vitest";

import { VAULT_LAYOUT } from "@murphai/contracts";

import {
  applyCanonicalWriteBatch,
  createExperiment,
  initializeVault,
  repairExperimentMedia,
  validateVault,
  walkVaultFiles,
} from "../src/index.ts";
import { WriteBatch } from "../src/operations/index.ts";
import { assertWriteTargetPolicy } from "../src/write-policy.ts";

const tempRoots: string[] = [];

async function createTempVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-experiment-media-"));
  tempRoots.push(vaultRoot);
  await initializeVault({ vaultRoot, title: "Experiment Media Test Vault" });
  return vaultRoot;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, { force: true, recursive: true })
    ),
  );
});

test("experiment media repair is dry-run first and copy-verifies before exact literal rewrite and delete", async () => {
  const vaultRoot = await createTempVault();
  const experiment = await createExperiment({
    slug: "sleep-reset",
    startedOn: "2026-04-02T09:00:00.000Z",
    title: "Sleep Reset",
    vaultRoot,
  });
  const legacyRelativePath =
    `${VAULT_LAYOUT.experimentsDirectory}/sleep-reset/baseline.jpg`;
  const legacyPath = path.join(vaultRoot, legacyRelativePath);
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(legacyPath, "legacy-image-bytes", "utf8");
  await utimes(
    legacyPath,
    new Date("2026-04-03T10:00:00.000Z"),
    new Date("2026-04-03T10:00:00.000Z"),
  );
  const experimentPath = path.join(
    vaultRoot,
    experiment.experiment.relativePath,
  );
  await writeFile(
    experimentPath,
    `${await readFile(experimentPath, "utf8")}\nEvidence source: ${legacyRelativePath}.\n![Baseline](${legacyRelativePath})\n`,
    "utf8",
  );

  const preview = await repairExperimentMedia({ vaultRoot });
  assert.equal(preview.mode, "dry-run");
  assert.equal(preview.candidateCount, 1);
  assert.equal(preview.blockerCount, 0);
  assert.equal(preview.mutated, false);
  assert.equal(await readFile(legacyPath, "utf8"), "legacy-image-bytes");
  assert.deepEqual(
    await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawCapturesDirectory),
    [],
  );

  const applied = await repairExperimentMedia({
    apply: true,
    now: new Date("2026-04-04T10:00:00.000Z"),
    vaultRoot,
  });
  assert.equal(applied.mode, "apply");
  assert.equal(applied.createdCaptureCount, 1);
  assert.equal(applied.reusedCaptureCount, 0);
  assert.equal(applied.deletedFileCount, 1);
  assert.equal(applied.rewrittenDocumentCount, 1);
  assert.equal(applied.mutated, true);
  await assert.rejects(readFile(legacyPath, "utf8"), { code: "ENOENT" });

  const canonicalCapturePaths = await walkVaultFiles(
    vaultRoot,
    VAULT_LAYOUT.rawCapturesDirectory,
  );
  const capturedMediaPath = canonicalCapturePaths.find((relativePath) =>
    relativePath.endsWith("/experiment-media-baseline.jpg")
  );
  assert.ok(capturedMediaPath);
  assert.equal(
    await readFile(path.join(vaultRoot, capturedMediaPath), "utf8"),
    "legacy-image-bytes",
  );
  const repairedMarkdown = await readFile(experimentPath, "utf8");
  assert.equal(repairedMarkdown.includes(legacyRelativePath), false);
  assert.equal(repairedMarkdown.split(capturedMediaPath).length - 1, 2);
  assert.equal((await validateVault({ vaultRoot })).valid, true);

  await writeFile(legacyPath, "legacy-image-bytes", "utf8");
  await writeFile(
    experimentPath,
    `${repairedMarkdown}\nRestored source: ${legacyRelativePath}\n`,
    "utf8",
  );
  const idempotent = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(idempotent.createdCaptureCount, 0);
  assert.equal(idempotent.reusedCaptureCount, 1);
  assert.equal(idempotent.deletedFileCount, 1);
  assert.deepEqual(
    await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawCapturesDirectory),
    canonicalCapturePaths,
  );

  await writeFile(legacyPath, "legacy-image-bytes", "utf8");
  await writeFile(
    experimentPath,
    `${await readFile(experimentPath, "utf8")}\nTamper check: ${legacyRelativePath}\n`,
    "utf8",
  );
  await writeFile(path.join(vaultRoot, capturedMediaPath), "tampered", "utf8");
  const tampered = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(tampered.mutated, false);
  assert.equal(tampered.blockersByCode.EXPERIMENT_MEDIA_CAPTURE_CONFLICT, 1);
  assert.equal(await readFile(legacyPath, "utf8"), "legacy-image-bytes");
});

test("experiment media repair leaves unreferenced media in place", async () => {
  const vaultRoot = await createTempVault();
  await createExperiment({
    slug: "unreferenced-media",
    title: "Unreferenced Media",
    vaultRoot,
  });
  const legacyPath = path.join(
    vaultRoot,
    VAULT_LAYOUT.experimentsDirectory,
    "unreferenced-media",
    "orphan.jpg",
  );
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(legacyPath, "orphan-image", "utf8");

  const preview = await repairExperimentMedia({ vaultRoot });
  assert.equal(preview.candidateCount, 0);
  assert.equal(preview.blockersByCode.EXPERIMENT_MEDIA_UNASSOCIATED, 1);

  const applied = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(applied.mutated, false);
  assert.equal(await readFile(legacyPath, "utf8"), "orphan-image");
  assert.deepEqual(
    await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawCapturesDirectory),
    [],
  );
});

test("experiment media repair promotes a unique exact full-path Markdown literal", async () => {
  const vaultRoot = await createTempVault();
  const experiment = await createExperiment({
    slug: "markdown-owned-media",
    title: "Markdown Owned Media",
    vaultRoot,
  });
  const legacyRelativePath =
    `${VAULT_LAYOUT.experimentsDirectory}/markdown-proof.webp`;
  const legacyPath = path.join(vaultRoot, legacyRelativePath);
  await writeFile(legacyPath, "markdown-webp", "utf8");
  const experimentPath = path.join(
    vaultRoot,
    experiment.experiment.relativePath,
  );
  await writeFile(
    experimentPath,
    `${await readFile(experimentPath, "utf8")}\n![Evidence](${legacyRelativePath})\n`,
    "utf8",
  );

  const preview = await repairExperimentMedia({ vaultRoot });
  assert.equal(preview.candidateCount, 1);
  assert.equal(preview.blockerCount, 0);

  const applied = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(applied.createdCaptureCount, 1);
  assert.equal(applied.deletedFileCount, 1);
  assert.equal(applied.rewrittenDocumentCount, 1);
  await assert.rejects(readFile(legacyPath, "utf8"), { code: "ENOENT" });

  const capturePath = (await walkVaultFiles(
    vaultRoot,
    VAULT_LAYOUT.rawCapturesDirectory,
  )).find((relativePath) =>
    relativePath.endsWith("/experiment-media-markdown-proof.webp")
  );
  assert.ok(capturePath);
  const repairedDocument = await readFile(experimentPath, "utf8");
  assert.equal(repairedDocument.includes(legacyRelativePath), false);
  assert.equal(repairedDocument.includes(capturePath), true);
});

test("experiment media repair rejects full paths embedded in larger tokens", async () => {
  const vaultRoot = await createTempVault();
  const experiment = await createExperiment({
    slug: "substring-nonmatch",
    title: "Substring Nonmatch",
    vaultRoot,
  });
  const legacyRelativePath =
    `${VAULT_LAYOUT.experimentsDirectory}/substring.webp`;
  const legacyPath = path.join(vaultRoot, legacyRelativePath);
  await writeFile(legacyPath, "substring-webp", "utf8");
  const experimentPath = path.join(
    vaultRoot,
    experiment.experiment.relativePath,
  );
  await writeFile(
    experimentPath,
    `${await readFile(experimentPath, "utf8")}\nNot exact: ${legacyRelativePath}.backup\nAlso not exact: prefix${legacyRelativePath}\nRelative only: ![Proof](substring.webp)\n`,
    "utf8",
  );

  const preview = await repairExperimentMedia({ vaultRoot });
  assert.equal(preview.candidateCount, 0);
  assert.equal(preview.blockersByCode.EXPERIMENT_MEDIA_UNASSOCIATED, 1);
  const applied = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(applied.mutated, false);
  assert.equal(await readFile(legacyPath, "utf8"), "substring-webp");
});

test("experiment media repair blocks one full path owned by multiple documents", async () => {
  const vaultRoot = await createTempVault();
  const firstExperiment = await createExperiment({
    slug: "first-owner",
    title: "First Owner",
    vaultRoot,
  });
  const secondExperiment = await createExperiment({
    slug: "second-owner",
    title: "Second Owner",
    vaultRoot,
  });
  const legacyRelativePath =
    `${VAULT_LAYOUT.experimentsDirectory}/ambiguous.webp`;
  const legacyPath = path.join(vaultRoot, legacyRelativePath);
  await writeFile(legacyPath, "ambiguous-webp", "utf8");

  for (const relativePath of [
    firstExperiment.experiment.relativePath,
    secondExperiment.experiment.relativePath,
  ]) {
    const experimentPath = path.join(vaultRoot, relativePath);
    await writeFile(
      experimentPath,
      `${await readFile(experimentPath, "utf8")}\nEvidence: ${legacyRelativePath}\n`,
      "utf8",
    );
  }

  const preview = await repairExperimentMedia({ vaultRoot });
  assert.equal(preview.candidateCount, 0);
  assert.equal(
    preview.blockersByCode.EXPERIMENT_MEDIA_ASSOCIATION_AMBIGUOUS,
    1,
  );
  const applied = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(applied.mutated, false);
  assert.equal(await readFile(legacyPath, "utf8"), "ambiguous-webp");
});

test("experiment media repair blocks residual relative or encoded references", async () => {
  const vaultRoot = await createTempVault();
  const owner = await createExperiment({
    slug: "literal-owner",
    title: "Literal Owner",
    vaultRoot,
  });
  const other = await createExperiment({
    slug: "residual-reference",
    title: "Residual Reference",
    vaultRoot,
  });
  const legacyRelativePath =
    `${VAULT_LAYOUT.experimentsDirectory}/literal-owner/photo one.webp`;
  const legacyPath = path.join(vaultRoot, legacyRelativePath);
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(legacyPath, "residual-webp", "utf8");

  const ownerPath = path.join(vaultRoot, owner.experiment.relativePath);
  await writeFile(
    ownerPath,
    `${await readFile(ownerPath, "utf8")}\nEvidence: ${legacyRelativePath}\n`,
    "utf8",
  );
  const otherPath = path.join(vaultRoot, other.experiment.relativePath);
  await writeFile(
    otherPath,
    `${await readFile(otherPath, "utf8")}\n![Legacy](literal-owner/photo%20one.webp)\n`,
    "utf8",
  );

  const preview = await repairExperimentMedia({ vaultRoot });
  assert.equal(preview.candidateCount, 1);
  assert.equal(
    preview.blockersByCode.EXPERIMENT_MEDIA_REFERENCE_UNSUPPORTED,
    1,
  );
  const applied = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(applied.mutated, false);
  assert.equal(await readFile(legacyPath, "utf8"), "residual-webp");
  assert.deepEqual(
    await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawCapturesDirectory),
    [],
  );
});

test("experiment media repair preserves outcomes and inbox evidence", async () => {
  const vaultRoot = await createTempVault();
  const experiment = await createExperiment({
    slug: "strength-baseline",
    startedOn: "2026-04-02T09:00:00.000Z",
    title: "Strength Baseline",
    vaultRoot,
  });
  const legacyRelativePaths = [
    `${VAULT_LAYOUT.experimentsDirectory}/${experiment.experiment.id}/form photo.png`,
    `${VAULT_LAYOUT.experimentsDirectory}/${experiment.experiment.id}/notes.m4a`,
    `${VAULT_LAYOUT.experimentsDirectory}/${experiment.experiment.id}/angle(1).jpg`,
  ];
  for (const [index, relativePath] of legacyRelativePaths.entries()) {
    const absolutePath = path.join(vaultRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `legacy-${index}`, "utf8");
  }

  const experimentPath = path.join(
    vaultRoot,
    experiment.experiment.relativePath,
  );
  await writeFile(
    experimentPath,
    `${await readFile(experimentPath, "utf8")}\n${legacyRelativePaths.map((relativePath) => `Evidence: ${relativePath}`).join("\n")}\n`,
    "utf8",
  );

  const outcomePath = path.join(
    vaultRoot,
    VAULT_LAYOUT.experimentOutcomesDirectory,
    "strength-baseline.json",
  );
  const inboxPath = path.join(
    vaultRoot,
    VAULT_LAYOUT.rawInboxDirectory,
    "test",
    "capture",
    "attachments",
    "original.png",
  );
  await mkdir(path.dirname(outcomePath), { recursive: true });
  await mkdir(path.dirname(inboxPath), { recursive: true });
  await writeFile(outcomePath, "{\"status\":\"pending\"}\n", "utf8");
  await writeFile(inboxPath, "inbox-original", "utf8");

  const applied = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(applied.candidateCount, 3);
  assert.equal(applied.createdCaptureCount, 3);
  assert.equal(applied.deletedFileCount, 3);
  assert.equal(applied.rewrittenDocumentCount, 1);
  for (const relativePath of legacyRelativePaths) {
    await assert.rejects(readFile(path.join(vaultRoot, relativePath), "utf8"), {
      code: "ENOENT",
    });
  }
  assert.equal(
    await readFile(outcomePath, "utf8"),
    "{\"status\":\"pending\"}\n",
  );
  assert.equal(await readFile(inboxPath, "utf8"), "inbox-original");

  const repairedDocument = await readFile(experimentPath, "utf8");
  for (const relativePath of legacyRelativePaths) {
    assert.equal(repairedDocument.includes(relativePath), false);
  }
  assert.match(repairedDocument, /raw\/captures\/.*experiment-media-form-photo\.png/u);
  assert.match(repairedDocument, /raw\/captures\/.*experiment-media-notes\.m4a/u);
  assert.match(repairedDocument, /raw\/captures\/.*\.jpg/u);
});

test("experiment media repair preserves note and source edits that race quarantine, then retries safely", async () => {
  for (const raceTarget of ["document", "source"] as const) {
    const vaultRoot = await createTempVault();
    const experiment = await createExperiment({
      slug: `quarantine-${raceTarget}`,
      title: `Quarantine ${raceTarget}`,
      vaultRoot,
    });
    const sourceRelativePath =
      `${VAULT_LAYOUT.experimentsDirectory}/quarantine-${raceTarget}/proof.webp`;
    const sourceAbsolutePath = path.join(vaultRoot, sourceRelativePath);
    await mkdir(path.dirname(sourceAbsolutePath), { recursive: true });
    await writeFile(sourceAbsolutePath, "inspected-source", "utf8");

    const documentRelativePath = experiment.experiment.relativePath;
    const documentAbsolutePath = path.join(vaultRoot, documentRelativePath);
    const inspectedDocument =
      `${await readFile(documentAbsolutePath, "utf8")}\nEvidence: ${sourceRelativePath}\n`;
    await writeFile(documentAbsolutePath, inspectedDocument, "utf8");

    const racingDocument = `${inspectedDocument}\nOperator note written during repair.\n`;
    const racingSource = "source-updated-during-repair";
    const expectedRacePath = raceTarget === "document"
      ? documentRelativePath
      : sourceRelativePath;
    const originalMoveExpectedTargetToBackup = Reflect.get(
      WriteBatch.prototype,
      "moveExpectedTargetToBackup",
    );
    if (typeof originalMoveExpectedTargetToBackup !== "function") {
      throw new Error("Expected WriteBatch quarantine support.");
    }

    let injectedRace = false;
    Reflect.set(
      WriteBatch.prototype,
      "moveExpectedTargetToBackup",
      async function moveExpectedTargetWithRace(this: object, ...args: unknown[]) {
        const action = args[0];
        if (
          !injectedRace
          && typeof action === "object"
          && action !== null
          && Reflect.get(action, "targetRelativePath") === expectedRacePath
        ) {
          injectedRace = true;
          await writeFile(
            raceTarget === "document" ? documentAbsolutePath : sourceAbsolutePath,
            raceTarget === "document" ? racingDocument : racingSource,
            "utf8",
          );
        }
        return await Reflect.apply(originalMoveExpectedTargetToBackup, this, args);
      },
    );

    try {
      await assert.rejects(
        repairExperimentMedia({ apply: true, vaultRoot }),
        (error: unknown) =>
          error instanceof Error
          && "code" in error
          && error.code === "OPERATION_PRECONDITION_FAILED",
      );
    } finally {
      Reflect.set(
        WriteBatch.prototype,
        "moveExpectedTargetToBackup",
        originalMoveExpectedTargetToBackup,
      );
    }

    assert.equal(injectedRace, true);
    assert.equal(
      await readFile(documentAbsolutePath, "utf8"),
      raceTarget === "document" ? racingDocument : inspectedDocument,
    );
    assert.equal(
      await readFile(sourceAbsolutePath, "utf8"),
      raceTarget === "source" ? racingSource : "inspected-source",
    );

    const retry = await repairExperimentMedia({ apply: true, vaultRoot });
    assert.equal(retry.deletedFileCount, 1);
    assert.equal(retry.rewrittenDocumentCount, 1);
    assert.equal(retry.reusedCaptureCount, raceTarget === "document" ? 1 : 0);
    await assert.rejects(readFile(sourceAbsolutePath, "utf8"), { code: "ENOENT" });
    const repairedDocument = await readFile(documentAbsolutePath, "utf8");
    assert.equal(repairedDocument.includes(sourceRelativePath), false);
    if (raceTarget === "document") {
      assert.match(repairedDocument, /Operator note written during repair\./u);
    }
  }
});

test("experiment media repair rejects source changes during raw staging before capture commit", async () => {
  const vaultRoot = await createTempVault();
  const experiment = await createExperiment({
    slug: "staging-race",
    title: "Staging Race",
    vaultRoot,
  });
  const sourceRelativePath =
    `${VAULT_LAYOUT.experimentsDirectory}/staging-race/proof.webp`;
  const sourceAbsolutePath = path.join(vaultRoot, sourceRelativePath);
  await mkdir(path.dirname(sourceAbsolutePath), { recursive: true });
  await writeFile(sourceAbsolutePath, "inspected-source", "utf8");

  const documentAbsolutePath = path.join(
    vaultRoot,
    experiment.experiment.relativePath,
  );
  const inspectedDocument =
    `${await readFile(documentAbsolutePath, "utf8")}\nEvidence: ${sourceRelativePath}\n`;
  await writeFile(documentAbsolutePath, inspectedDocument, "utf8");

  const originalStageRawCopy = WriteBatch.prototype.stageRawCopy;
  let injectedRace = false;
  Reflect.set(
    WriteBatch.prototype,
    "stageRawCopy",
    async function stageRawCopyWithSourceRace(this: object, input: unknown) {
      if (
        !injectedRace
        && typeof input === "object"
        && input !== null
        && Reflect.get(input, "sourcePath") === sourceAbsolutePath
      ) {
        injectedRace = true;
        await writeFile(sourceAbsolutePath, "source-changed-during-staging", "utf8");
      }
      return await Reflect.apply(originalStageRawCopy, this, [input]);
    },
  );

  try {
    await assert.rejects(
      repairExperimentMedia({ apply: true, vaultRoot }),
      (error: unknown) =>
        error instanceof Error
        && "code" in error
        && error.code === "EXPERIMENT_MEDIA_SOURCE_CHANGED",
    );
  } finally {
    Reflect.set(WriteBatch.prototype, "stageRawCopy", originalStageRawCopy);
  }

  assert.equal(injectedRace, true);
  assert.equal(
    await readFile(sourceAbsolutePath, "utf8"),
    "source-changed-during-staging",
  );
  assert.equal(await readFile(documentAbsolutePath, "utf8"), inspectedDocument);
  assert.deepEqual(
    await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawCapturesDirectory),
    [],
  );
  const eventLedgerPaths = await walkVaultFiles(
    vaultRoot,
    VAULT_LAYOUT.eventLedgerDirectory,
  );
  const eventLedgerContents = await Promise.all(
    eventLedgerPaths.map((relativePath) => readFile(path.join(vaultRoot, relativePath), "utf8")),
  );
  assert.equal(eventLedgerContents.some((content) => content.includes("murph-repair")), false);
});

test("experiment media repair leaves unsupported, unassociated, symlinked, and residual-reference files blocked", async () => {
  const vaultRoot = await createTempVault();
  const experiment = await createExperiment({
    slug: "hydration-test",
    title: "Hydration Test",
    vaultRoot,
  });
  const directory = path.join(
    vaultRoot,
    VAULT_LAYOUT.experimentsDirectory,
    "hydration-test",
  );
  await mkdir(directory, { recursive: true });

  const photoRelativePath =
    `${VAULT_LAYOUT.experimentsDirectory}/hydration-test/Photo.jpg`;
  const pdfRelativePath =
    `${VAULT_LAYOUT.experimentsDirectory}/hydration-test/notes.pdf`;
  const photoPath = path.join(vaultRoot, photoRelativePath);
  const pdfPath = path.join(vaultRoot, pdfRelativePath);
  const orphanPath = path.join(
    vaultRoot,
    VAULT_LAYOUT.experimentsDirectory,
    "orphan.jpg",
  );
  await writeFile(photoPath, "photo", "utf8");
  await writeFile(pdfPath, "pdf", "utf8");
  await writeFile(orphanPath, "orphan", "utf8");
  await symlink(photoPath, path.join(directory, "linked.jpg"));

  const experimentPath = path.join(
    vaultRoot,
    experiment.experiment.relativePath,
  );
  await writeFile(
    experimentPath,
    `${await readFile(experimentPath, "utf8")}\nPhoto: ${photoRelativePath}\nCase variant: ${photoRelativePath.replace("Photo.jpg", "photo.jpg")}\nPDF: ${pdfRelativePath}\n`,
    "utf8",
  );

  const preview = await repairExperimentMedia({ vaultRoot });
  assert.equal(preview.mode, "dry-run");
  assert.equal(preview.candidateCount, 1);
  assert.equal(preview.blockersByCode.EXPERIMENT_MEDIA_UNSUPPORTED, 1);
  assert.equal(preview.blockersByCode.EXPERIMENT_MEDIA_UNASSOCIATED, 1);
  assert.equal(preview.blockersByCode.EXPERIMENT_STORAGE_SYMLINK, 1);
  assert.equal(
    preview.blockersByCode.EXPERIMENT_MEDIA_REFERENCE_UNSUPPORTED,
    1,
  );

  const blockedApply = await repairExperimentMedia({ apply: true, vaultRoot });
  assert.equal(blockedApply.mutated, false);
  assert.equal(await readFile(photoPath, "utf8"), "photo");
  assert.equal(await readFile(pdfPath, "utf8"), "pdf");
  assert.equal(await readFile(orphanPath, "utf8"), "orphan");
  assert.deepEqual(
    await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawCapturesDirectory),
    [],
  );
});

test("vault validation and supported text writes enforce the direct experiment allowlist", async () => {
  const vaultRoot = await createTempVault();
  await createExperiment({ slug: "allowed", title: "Allowed", vaultRoot });
  const outcomesDirectory = path.join(
    vaultRoot,
    VAULT_LAYOUT.experimentOutcomesDirectory,
  );
  await mkdir(outcomesDirectory, { recursive: true });
  await writeFile(path.join(outcomesDirectory, "allowed-2026-04-01.json"), "{}\n", "utf8");
  assert.equal((await validateVault({ vaultRoot })).valid, true);

  assert.throws(
    () => assertWriteTargetPolicy(
      `${VAULT_LAYOUT.bankDirectory}/Experiments/nested/extra.md`,
      { kind: "text" },
      { caseInsensitive: true },
    ),
    (error: unknown) =>
      error instanceof Error
      && "code" in error
      && error.code === "EXPERIMENT_STORAGE_INVALID",
  );

  const matchingExperiment = await createExperiment({
    slug: "frontmatter-slug",
    title: "Frontmatter Slug",
    vaultRoot,
  });
  const expectedPath = path.join(vaultRoot, matchingExperiment.experiment.relativePath);
  const mismatchedPath = path.join(
    vaultRoot,
    VAULT_LAYOUT.experimentsDirectory,
    "file-slug.md",
  );
  await rename(expectedPath, mismatchedPath);
  const mismatchedValidation = await validateVault({ vaultRoot });
  assert.equal(mismatchedValidation.valid, false);
  assert.equal(
    mismatchedValidation.issues.some((issue) =>
      issue.code === "EXPERIMENT_DOCUMENT_PATH_MISMATCH"
      && issue.path === `${VAULT_LAYOUT.experimentsDirectory}/file-slug.md`
    ),
    true,
  );
  const mismatchedRepair = await repairExperimentMedia({ vaultRoot });
  assert.equal(
    mismatchedRepair.blockersByCode.EXPERIMENT_DOCUMENT_PATH_MISMATCH,
    1,
  );
  await rename(mismatchedPath, expectedPath);
  assert.equal((await validateVault({ vaultRoot })).valid, true);

  await assert.rejects(
    applyCanonicalWriteBatch({
      audit: {
        action: "vault_repair",
        commandName: "test.invalidExperimentWrite",
        summary: "Reject invalid experiment path.",
      },
      operationType: "test_invalid_experiment_write",
      summary: "Reject invalid experiment path",
      textWrites: [{
        content: "invalid\n",
        relativePath: `${VAULT_LAYOUT.experimentsDirectory}/nested/extra.md`,
      }],
      vaultRoot,
    }),
    (error: unknown) =>
      error instanceof Error
      && "code" in error
      && error.code === "EXPERIMENT_STORAGE_INVALID",
  );

  await mkdir(path.join(vaultRoot, VAULT_LAYOUT.experimentsDirectory, "nested"), {
    recursive: true,
  });
  await writeFile(
    path.join(vaultRoot, VAULT_LAYOUT.experimentsDirectory, "nested", "extra.md"),
    "---\nslug: extra\n---\n",
    "utf8",
  );
  const validation = await validateVault({ vaultRoot });
  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some((issue) =>
      issue.code === "EXPERIMENT_STORAGE_INVALID"
      && issue.path === `${VAULT_LAYOUT.experimentsDirectory}/nested/extra.md`
    ),
    true,
  );
});
