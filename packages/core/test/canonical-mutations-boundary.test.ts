import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test, vi } from "vitest";

import type { EventRecord, ExperimentEventRecord } from "@murphai/contracts";

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
  linkJournalStreams,
  parseFrontmatterDocument,
  promoteInboxExperimentNote,
  promoteInboxJournal,
  readJsonlRecords,
  resolveWorkoutSourceImportStatus,
  stopExperiment,
  unlinkJournalEventIds,
  unlinkJournalStreams,
  updateExperiment,
  updateVaultSummary,
  upsertEvent,
  upsertProvider,
  VaultError,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("public core exports include the high-level canonical mutation ports", () => {
  assert.equal(typeof appendJournal, "function");
  assert.equal(typeof checkpointExperiment, "function");
  assert.equal(typeof linkJournalEventIds, "function");
  assert.equal(typeof linkJournalStreams, "function");
  assert.equal(typeof promoteInboxExperimentNote, "function");
  assert.equal(typeof promoteInboxJournal, "function");
  assert.equal(typeof stopExperiment, "function");
  assert.equal(typeof unlinkJournalEventIds, "function");
  assert.equal(typeof unlinkJournalStreams, "function");
  assert.equal(typeof updateExperiment, "function");
  assert.equal(typeof updateVaultSummary, "function");
  assert.equal(typeof upsertEvent, "function");
  assert.equal(typeof upsertProvider, "function");
});

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

test("high-level core experiment and journal mutation ports preserve canonical behavior", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "focus-sprint",
    title: "Focus Sprint",
    startedOn: "2026-03-10",
  });
  const relativePath = created.experiment.relativePath;

  const updated = await updateExperiment({
    vaultRoot,
    relativePath,
    title: "Focus Sprint Updated",
    hypothesis: "Walking after lunch improves the afternoon energy dip.",
    status: "paused",
    body: "# Focus Sprint Updated\n\n## Plan\n\nKeep the walks short and consistent.\n",
    tags: ["energy", "walking"],
  });
  const checkpoint = await checkpointExperiment({
    vaultRoot,
    relativePath,
    occurredAt: "2026-03-12T14:30:00.000Z",
    title: "Midpoint",
    note: "Energy improved after lunch and the afternoon dip arrived later.",
  });
  const stopped = await stopExperiment({
    vaultRoot,
    relativePath,
    occurredAt: "2026-03-13T18:45:00.000Z",
    title: "Stopped",
    note: "The sprint is complete and the updated routine is stable enough to keep.",
  });
  const appended = await appendJournal({
    vaultRoot,
    date: "2026-03-13",
    text: "Evening note from the canonical journal append port.",
  });
  await linkJournalEventIds({
    vaultRoot,
    date: "2026-03-13",
    values: [checkpoint.eventId, stopped.eventId],
  });
  await linkJournalStreams({
    vaultRoot,
    date: "2026-03-13",
    values: ["heart_rate", "glucose"],
  });
  const unlinkedEventIds = await unlinkJournalEventIds({
    vaultRoot,
    date: "2026-03-13",
    values: [checkpoint.eventId],
  });
  const unlinkedStreams = await unlinkJournalStreams({
    vaultRoot,
    date: "2026-03-13",
    values: ["glucose"],
  });

  assert.equal(updated.status, "paused");
  assert.equal(stopped.status, "completed");
  assert.deepEqual(unlinkedEventIds.eventIds, [stopped.eventId]);
  assert.deepEqual(unlinkedStreams.sampleStreams, ["heart_rate"]);

  const experimentDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, relativePath), "utf8"),
  );
  assert.equal(experimentDocument.attributes.title, "Focus Sprint Updated");
  assert.equal(experimentDocument.attributes.status, "completed");
  assert.equal(experimentDocument.attributes.endedOn, "2026-03-13");
  assert.deepEqual(experimentDocument.attributes.tags, ["energy", "walking"]);
  assert.match(experimentDocument.body, /Midpoint/u);
  assert.match(
    experimentDocument.body,
    /The sprint is complete and the updated routine is stable enough to keep\./u,
  );

  const lifecycleRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: checkpoint.ledgerFile,
  });
  const phases = lifecycleRecords
    .filter(
      (record): record is ExperimentEventRecord =>
        (record as { kind?: string }).kind === "experiment_event" &&
        (record as { experimentId?: string }).experimentId === created.experiment.id,
    )
    .map((record) => record.phase);
  assert.equal(phases.includes("checkpoint"), true);
  assert.equal(phases.includes("stop"), true);

  const journalDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, appended.relativePath), "utf8"),
  );
  assert.deepEqual(journalDocument.attributes.eventIds, [stopped.eventId]);
  assert.deepEqual(journalDocument.attributes.sampleStreams, ["heart_rate"]);
  assert.match(
    journalDocument.body,
    /Evening note from the canonical journal append port\./u,
  );
});

test("high-level core provider, event, and summary mutation ports preserve canonical behavior", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary");
  await initializeVault({ vaultRoot });

  const summary = await updateVaultSummary({
    vaultRoot,
    title: "Health Ops Vault",
    timezone: "America/Los_Angeles",
  });
  const createdProvider = await upsertProvider({
    vaultRoot,
    title: "Labcorp",
    slug: "labcorp",
    note: "Primary lab partner.",
    body: "# Labcorp\n\nPrimary lab partner.\n",
  });
  const renamedProvider = await upsertProvider({
    vaultRoot,
    providerId: createdProvider.providerId,
    slug: "labcorp-west",
    title: "Labcorp West",
    note: "Primary lab partner.",
    body: "# Labcorp West\n\nPrimary lab partner.\n",
  });
  const eventPayload = {
    id: "evt_01JNV422Y2M5ZBV64ZP4N1DRB1",
    kind: "note",
    occurredAt: "2026-03-12T08:15:00.000Z",
    title: "Morning note",
    note: "Provider follow-up scheduled.",
    links: [{ type: "related_to", targetId: createdProvider.providerId }],
  } satisfies Record<string, unknown>;
  const firstEvent = await upsertEvent({
    vaultRoot,
    payload: eventPayload,
  });
  const secondEvent = await upsertEvent({
    vaultRoot,
    payload: eventPayload,
  });

  assert.equal(summary.title, "Health Ops Vault");
  assert.equal(summary.timezone, "America/Los_Angeles");
  assert.equal(createdProvider.created, true);
  assert.equal(renamedProvider.created, false);
  assert.equal(renamedProvider.relativePath, "bank/providers/labcorp-west.md");
  assert.equal(firstEvent.created, true);
  assert.equal(secondEvent.created, false);

  const vaultMetadata = JSON.parse(
    await fs.readFile(path.join(vaultRoot, "vault.json"), "utf8"),
  ) as {
    title: string;
    timezone: string;
  };
  const coreDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, "CORE.md"), "utf8"),
  );
  const providerDocument = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, renamedProvider.relativePath), "utf8"),
  );
  const ledgerRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: firstEvent.ledgerFile,
  });
  const eventRecord = ledgerRecords.find(
    (record) => (record as { id?: string }).id === eventPayload.id,
  ) as EventRecord | undefined;

  assert.equal(vaultMetadata.title, "Health Ops Vault");
  assert.equal(vaultMetadata.timezone, "America/Los_Angeles");
  assert.equal(coreDocument.attributes.title, "Health Ops Vault");
  assert.equal(coreDocument.attributes.timezone, "America/Los_Angeles");
  assert.equal(providerDocument.attributes.providerId, createdProvider.providerId);
  assert.equal(providerDocument.attributes.slug, "labcorp-west");
  assert.equal(providerDocument.attributes.title, "Labcorp West");
  assert.ok(eventRecord);
  assert.deepEqual(eventRecord.links, [{ type: "related_to", targetId: createdProvider.providerId }]);
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

test("high-level core inbox promotion ports preserve journal and experiment-note idempotency", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-boundary");
  await initializeVault({ vaultRoot });

  const created = await createExperiment({
    vaultRoot,
    slug: "focus-sprint",
    title: "Focus Sprint",
    startedOn: "2026-03-10",
  });
  const capture = {
    captureId: "cap_01JNV422Y2M5ZBV64ZP4N1DRB1",
    eventId: "evt_01JNV422Y2M5ZBV64ZP4N1DRB2",
    source: "telegram",
    occurredAt: "2026-03-13T08:00:00.000Z",
    text: "Breakfast note from inbox",
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

  const firstJournalPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture,
  });
  const secondJournalPromotion = await promoteInboxJournal({
    vaultRoot,
    date: "2026-03-13",
    capture,
  });
  const firstExperimentPromotion = await promoteInboxExperimentNote({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    capture,
  });
  const secondExperimentPromotion = await promoteInboxExperimentNote({
    vaultRoot,
    relativePath: created.experiment.relativePath,
    capture,
  });

  assert.equal(firstJournalPromotion.created, true);
  assert.equal(firstJournalPromotion.appended, true);
  assert.equal(firstJournalPromotion.linked, true);
  assert.equal(secondJournalPromotion.created, false);
  assert.equal(secondJournalPromotion.appended, false);
  assert.equal(secondJournalPromotion.linked, false);
  assert.equal(firstExperimentPromotion.appended, true);
  assert.equal(secondExperimentPromotion.appended, false);

  const journalMarkdown = await fs.readFile(
    path.join(vaultRoot, firstJournalPromotion.journalPath),
    "utf8",
  );
  const experimentMarkdown = await fs.readFile(
    path.join(vaultRoot, created.experiment.relativePath),
    "utf8",
  );
  assert.equal(
    journalMarkdown.split(`<!-- inbox-capture:${capture.captureId} -->`).length - 1,
    1,
  );
  assert.equal(
    experimentMarkdown.split(`<!-- inbox-capture:${capture.captureId} -->`).length - 1,
    1,
  );
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
