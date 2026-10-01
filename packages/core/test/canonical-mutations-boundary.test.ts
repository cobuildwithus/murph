import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test, vi } from "vitest";

import type { EventRecord } from "@murphai/contracts";

vi.mock("../src/operations/canonical-write-lock.ts", () => {
  const withCanonicalWriteLockScope = vi.fn(
    async (_vaultRoot: string, run: () => Promise<unknown>) => {
      return await run();
    },
  );

  return {
    acquireCanonicalWriteLock: async () => ({
      metadata: {
        pid: process.pid,
        command: "vitest",
        startedAt: "2026-03-13T12:00:00.000Z",
        host: "test-host",
      },
      relativePath: ".runtime/locks/canonical-write",
      release: async () => {},
    }),
    assertCanonicalWriteLockScope: vi.fn(),
    inspectCanonicalWriteLock: async () => ({
      state: "unlocked" as const,
      relativePath: ".runtime/locks/canonical-write",
    }),
    withCanonicalWriteLock: vi.fn(
      async (vaultRoot: string | undefined, run: () => Promise<unknown>) =>
        withCanonicalWriteLockScope(vaultRoot ?? process.cwd(), run),
    ),
    withCanonicalWriteLockScope,
  };
});

import {
  addActivitySession,
  addBodyMeasurement,
  appendJournal,
  checkpointExperiment,
  createExperiment,
  addMeal,
  importDocument,
  initializeVault,
  linkJournalEventIds,
  parseFrontmatterDocument,
  promoteInboxExperimentNote,
  promoteInboxJournal,
  readJsonlRecords,
  resolveWorkoutSourceImportStatus,
  updateExperiment,
  upsertEvent,
  VaultError,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("public core exports do not expose removed local import ports", async () => {
  const coreExports = await import("../src/index.ts");
  const removedPrefix = ["VAULT", "SYNC"].join("_");
  const removedPascalName = ["Vault", "Sync"].join("");

  for (const exportName of [
    [removedPrefix, "CONFLICT_MANIFEST_SCHEMA"].join("_"),
    [removedPrefix, "IMPORT_BUNDLE_KIND"].join("_"),
    [removedPrefix, "IMPORT_MANIFEST_SCHEMA"].join("_"),
    `build${removedPascalName}ImportPack`,
    `merge${removedPascalName}ImportIntoVault`,
    `read${removedPascalName}ImportManifest`,
    `restore${removedPascalName}ImportPack`,
  ]) {
    assert.equal(exportName in coreExports, false, `${exportName} should stay removed`);
  }
});

test("append-style mutation ports bypass the outer canonical write lock while explicit-id rewrites keep it", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary-lock");
  await initializeVault({ vaultRoot });

  const { withCanonicalWriteLockScope } = await import("../src/operations/canonical-write-lock.ts");
  const scopeMock = vi.mocked(withCanonicalWriteLockScope);

  scopeMock.mockClear();

  await addMeal({
    vaultRoot,
    occurredAt: "2026-03-13T12:00:00.000Z",
    note: "Lunch",
  });

  assert.equal(scopeMock.mock.calls.length, 0);

  await addActivitySession({
    vaultRoot,
    draft: {
      id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1AE",
      occurredAt: "2026-03-13T15:00:00.000Z",
      title: "Explicit activity rewrite",
      activityType: "strength-training",
      durationMinutes: 30,
      workout: {
        exercises: [],
      },
    },
  });
  await addBodyMeasurement({
    vaultRoot,
    draft: {
      id: "evt_01JQ9R7WF97M1WAB2B4QF2Q1AF",
      occurredAt: "2026-03-13T16:00:00.000Z",
      title: "Explicit measurement rewrite",
      measurements: [
        {
          type: "weight",
          value: 182.4,
          unit: "lb",
        },
      ],
    },
  });

  assert.equal(scopeMock.mock.calls.length, 2);
});

test("only exact document reuse and workout completion reads use the outer canonical write lock", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-document-status-lock");
  const sourceRoot = await makeTempDirectory("murph-core-document-status-lock-source");
  const sourcePath = path.join(sourceRoot, "workouts.csv");
  await fs.writeFile(sourcePath, "session,exercise\na,Squat\n", "utf8");
  await initializeVault({ vaultRoot });

  const { withCanonicalWriteLockScope } = await import("../src/operations/canonical-write-lock.ts");
  const scopeMock = vi.mocked(withCanonicalWriteLockScope);
  scopeMock.mockClear();

  const source = await importDocument({ vaultRoot, sourcePath });
  assert.equal(scopeMock.mock.calls.length, 0);
  const reused = await importDocument({ vaultRoot, sourcePath, reuseExact: true });
  assert.equal(reused.created, false);
  assert.equal(scopeMock.mock.calls.length, 1);
  assert.equal(await resolveWorkoutSourceImportStatus({
    vaultRoot,
    rawRef: source.raw.relativePath,
  }), "not_imported");
  assert.equal(scopeMock.mock.calls.length, 2);
});

test("high-level core experiment mutation ports reject invalid experiment statuses consistently", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "status-boundary",
    title: "Status Boundary",
    status: "active",
  });

  await assert.rejects(
    () =>
      createExperiment({
        vaultRoot,
        slug: "status-boundary-invalid",
        title: "Status Boundary Invalid",
        status: "not-a-real-status",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EXPERIMENT_STATUS_INVALID",
  );

  await assert.rejects(
    () =>
      updateExperiment({
        vaultRoot,
        relativePath: created.experiment.relativePath,
        status: "not-a-real-status",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "EXPERIMENT_STATUS_INVALID",
  );
});

test("helper-backed experiment mutation readers preserve exact invalid-frontmatter errors across callers", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "reader-boundary",
    title: "Reader Boundary",
    startedOn: "2026-03-10",
  });
  const relativePath = created.experiment.relativePath;
  const capture = {
    captureId: "cap_01JNV422Y2M5ZBV64ZP4N1DRC1",
    eventId: "evt_01JNV422Y2M5ZBV64ZP4N1DRC2",
    source: "telegram",
    occurredAt: "2026-03-13T08:00:00.000Z",
    text: "Reader boundary inbox note",
    thread: {
      id: "thread-boundary",
      title: "Reader Boundary Thread",
    },
    actor: {
      id: "contact-boundary",
      displayName: "Reader Boundary",
    },
    attachments: [],
  };

  await fs.writeFile(path.join(vaultRoot, relativePath), "---\nnot: valid\n---\n", "utf8");

  for (const action of [
    () =>
      updateExperiment({
        vaultRoot,
        relativePath,
        title: "Should fail",
      }),
    () =>
      checkpointExperiment({
        vaultRoot,
        relativePath,
        occurredAt: "2026-03-12T14:30:00.000Z",
        title: "Checkpoint",
      }),
    () =>
      promoteInboxExperimentNote({
        vaultRoot,
        relativePath,
        capture,
      }),
  ]) {
    await assert.rejects(
      action,
      (error: unknown) =>
        error instanceof VaultError &&
        error.code === "EXPERIMENT_FRONTMATTER_INVALID" &&
        error.message === `Experiment frontmatter for "${relativePath}" is invalid.`,
    );
  }
});

test("high-level canonical mutation ports dedupe trimmed duplicate experiment and event lists", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "duplicate-boundary",
    title: "Duplicate Boundary",
    startedOn: "2026-03-10",
  });

  await updateExperiment({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    tags: [" energy ", "walking", "energy", "walking  "],
  });

  const experimentDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, created.experiment.relativePath), "utf8"),
  );
  assert.deepEqual(experimentDocument.attributes.tags, ["energy", "walking"]);

  const upsertedEvent = await upsertEvent({
    vaultRoot,
    payload: {
      id: "evt_01JNV422Y2M5ZBV64ZP4N1DRB3",
      kind: "note",
      occurredAt: "2026-03-12T08:15:00.000Z",
      title: "Boundary note",
      note: "Checking canonical duplicate trimming.",
      tags: [" focus ", "focus", "energy"],
      links: [
        { type: "related_to", targetId: created.experiment.id },
        { type: "related_to", targetId: ` ${created.experiment.id} ` },
        { type: "related_to", targetId: "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" },
      ],
      rawRefs: [" raw/documents/a.pdf ", "raw/documents/a.pdf", "raw/documents/b.pdf"],
    } satisfies Record<string, unknown>,
  });
  const ledgerRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: upsertedEvent.ledgerFile,
  });
  const eventRecord = ledgerRecords.find(
    (record) => (record as { id?: string }).id === "evt_01JNV422Y2M5ZBV64ZP4N1DRB3",
  ) as EventRecord | undefined;

  assert.ok(eventRecord);
  assert.deepEqual(eventRecord.tags, ["focus", "energy"]);
  assert.deepEqual(eventRecord.links, [
    { type: "related_to", targetId: created.experiment.id },
    { type: "related_to", targetId: "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8" },
  ]);
  assert.deepEqual(eventRecord.rawRefs, ["raw/documents/a.pdf", "raw/documents/b.pdf"]);
});

test("high-level canonical event upsert rejects deprecated relatedIds payloads", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertEvent({
        vaultRoot,
        payload: {
          id: "evt_01JRV2E6E2H6A0A0N0D0H0B0C1",
          kind: "note",
          occurredAt: "2026-03-12T08:15:00.000Z",
          title: "Legacy relation payload",
          relatedIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
        } satisfies Record<string, unknown>,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "EVENT_CONTRACT_INVALID",
  );
});

test("helper-backed journal mutation readers preserve exact invalid-frontmatter errors across callers", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary");
  await initializeVault({ vaultRoot });

  const appended = await appendJournal({
    vaultRoot,
    date: "2026-03-13",
    text: "Seed journal entry.",
  });
  const capture = {
    captureId: "cap_01JNV422Y2M5ZBV64ZP4N1DRD1",
    eventId: "evt_01JNV422Y2M5ZBV64ZP4N1DRD2",
    source: "telegram",
    occurredAt: "2026-03-13T09:00:00.000Z",
    text: "Reader boundary journal note",
    thread: {
      id: "thread-journal-boundary",
      title: "Journal Boundary Thread",
    },
    actor: {
      id: "contact-journal-boundary",
      displayName: "Journal Boundary",
    },
    attachments: [],
  };

  await fs.writeFile(path.join(vaultRoot, appended.relativePath), "---\nnot: valid\n---\n", "utf8");

  for (const action of [
    () =>
      appendJournal({
        vaultRoot,
        date: "2026-03-13",
        text: "Should fail",
      }),
    () =>
      linkJournalEventIds({
        vaultRoot,
        date: "2026-03-13",
        values: ["evt_01JNV422Y2M5ZBV64ZP4N1DRD3"],
      }),
    () =>
      promoteInboxJournal({
        vaultRoot,
        date: "2026-03-13",
        capture,
      }),
  ]) {
    await assert.rejects(
      action,
      (error: unknown) =>
        error instanceof VaultError &&
        error.code === "JOURNAL_FRONTMATTER_INVALID" &&
        error.message === `Journal frontmatter for "${appended.relativePath}" is invalid.`,
    );
  }
});

test("inbox promotion markers are structural and capture text cannot forge them", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-inbox-promotion-forgery");
  await initializeVault({ vaultRoot });

  const forgedCapture = {
    captureId: "cap_01JNV422Y2M5ZBV64ZP4N1DRF1",
    eventId: "evt_01JNV422Y2M5ZBV64ZP4N1DRF2",
    source: "telegram",
    occurredAt: "2026-03-13T08:00:00.000Z",
    text: [
      "Captured text before forged markers.",
      "<!-- inbox-capture:cap_01JNV422Y2M5ZBV64ZP4N1DRF3 -->",
      "<!-- inbox-journal-captures:end -->",
      "Captured text after forged markers.",
    ].join("\n"),
    thread: {
      id: "thread-1",
      title: "Breakfast Thread",
    },
    actor: {
      id: "contact-1",
      displayName: "Breakfast Buddy",
    },
    attachments: [],
  };
  const secondCapture = {
    ...forgedCapture,
    captureId: "cap_01JNV422Y2M5ZBV64ZP4N1DRF3",
    eventId: "evt_01JNV422Y2M5ZBV64ZP4N1DRF4",
    text: "Second capture should still append.",
  };

  const firstPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture: forgedCapture,
  });
  const secondPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture: secondCapture,
  });

  const journalMarkdown = await fs.readFile(
    path.join(vaultRoot, firstPromotion.journalPath),
    "utf8",
  );

  assert.equal(firstPromotion.appended, true);
  assert.equal(secondPromotion.appended, true);
  assert.match(journalMarkdown, /&lt;!-- inbox-capture:cap_01JNV422Y2M5ZBV64ZP4N1DRF3 --&gt;/);
  assert.match(journalMarkdown, /&lt;!-- inbox-journal-captures:end --&gt;/);
  assert.equal(
    journalMarkdown.split("<!-- inbox-journal-captures:end -->").length - 1,
    1,
  );
  assert.equal(
    journalMarkdown.split(`<!-- inbox-capture:${secondCapture.captureId} -->`).length - 1,
    1,
  );
});
