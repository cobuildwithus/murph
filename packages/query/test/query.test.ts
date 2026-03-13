import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildExportPack,
  getExperiment,
  getJournalEntry,
  listExperiments,
  listJournalEntries,
  listRecords,
  lookupRecordById,
  readVault,
  summarizeDailySamples,
} from "../src/index.js";

test(
  "readVault assembles a stable read model from contract-shaped markdown and jsonl sources",
  async () => {
    const vaultRoot = await createFixtureVault();

    try {
      const vault = await readVault(vaultRoot);

      assert.equal(vault.format, "healthybob.query.v1");
      assert.equal(vault.metadata?.vaultId, "vault_01JNV40W8VFYQ2H7CMJY5A9R4K");
      assert.equal(vault.coreDocument?.id, "vault_01JNV40W8VFYQ2H7CMJY5A9R4K");
      assert.equal(vault.experiments.length, 1);
      assert.equal(vault.journalEntries.length, 2);
      assert.equal(vault.events.length, 3);
      assert.equal(vault.samples.length, 5);
      assert.equal(vault.audits.length, 1);

      const experiment = getExperiment(vault, "low-carb");
      assert.equal(experiment?.title, "Low Carb Trial");
      assert.equal(experiment?.data.startedOn, "2026-03-01");

      const journal = getJournalEntry(vault, "2026-03-10");
      assert.equal(journal?.title, "March 10");

      const mealRecord = lookupRecordById(vault, "meal_01JNV4MEAL00000000000001");
      assert.equal(mealRecord?.recordType, "event");
      assert.equal(mealRecord?.id, "meal_01JNV4MEAL00000000000001");
      assert.equal(mealRecord?.data.kind, "meal");
      assert.deepEqual(mealRecord?.data.eventIds, ["evt_01JNV4MEAL000000000000001"]);

      const mealEventAlias = lookupRecordById(vault, "evt_01JNV4MEAL000000000000001");
      assert.equal(mealEventAlias?.id, "meal_01JNV4MEAL00000000000001");

      const documentRecord = lookupRecordById(vault, "doc_01JNV4DOC0000000000000001");
      assert.equal(documentRecord?.data.documentId, "doc_01JNV4DOC0000000000000001");
      assert.equal(
        documentRecord?.data.documentPath,
        "raw/documents/2026/03/doc_01JNV4DOC0000000000000001/lab-report.pdf",
      );
      assert.equal(documentRecord?.data.mimeType, "application/pdf");

      const legacyJournal = getJournalEntry(vault, "2026-03-11");
      assert.deepEqual(legacyJournal?.data.eventIds, ["evt_01JNV4NOTE000000000000001"]);
      assert.deepEqual(legacyJournal?.data.sampleStreams, ["heart_rate"]);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  },
);

test("list helpers apply date, tag, text, and kind filters against contract data", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);

    const marchRecords = listRecords(vault, {
      from: "2026-03-10",
      to: "2026-03-10",
    });
    assert.deepEqual(
      marchRecords.map((record) => record.id),
      [
        "journal:2026-03-10",
        "smp_01JNV4GLU000000000000001",
        "smp_01JNV4HR0000000000000001",
        "meal_01JNV4MEAL00000000000001",
        "smp_01JNV4GLU000000000000002",
        "smp_01JNV4HR0000000000000002",
      ],
    );

    const mealRecords = listRecords(vault, { kinds: ["meal"] });
    assert.deepEqual(
      mealRecords.map((record) => record.id),
      ["meal_01JNV4MEAL00000000000001"],
    );

    const documentRecords = listRecords(vault, { ids: ["evt_01JNV4DOC000000000000001"] });
    assert.deepEqual(
      documentRecords.map((record) => record.id),
      ["doc_01JNV4DOC0000000000000001"],
    );

    const taggedExperiments = listExperiments(vault, { tags: ["nutrition"] });
    assert.deepEqual(
      taggedExperiments.map((record) => record.experimentSlug),
      ["low-carb"],
    );

    const matchingJournal = listJournalEntries(vault, { text: "steady energy" });
    assert.deepEqual(
      matchingJournal.map((record) => record.date),
      ["2026-03-10"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("summarizeDailySamples groups by day and stream with stable numeric aggregates", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);
    const summaries = summarizeDailySamples(vault, {
      from: "2026-03-10",
      to: "2026-03-11",
    });

    assert.deepEqual(
      summaries.map((summary) => [summary.date, summary.stream, summary.sampleCount]),
      [
        ["2026-03-10", "glucose", 2],
        ["2026-03-10", "heart_rate", 2],
        ["2026-03-11", "heart_rate", 1],
      ],
    );

    const glucoseSummary = summaries.find((summary) => summary.stream === "glucose");
    assert.equal(glucoseSummary?.averageValue, 96);
    assert.equal(glucoseSummary?.minValue, 92);
    assert.equal(glucoseSummary?.maxValue, 100);
    assert.equal(glucoseSummary?.unit, "mg_dL");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("buildExportPack produces derived exports payloads without touching the vault", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);
    const pack = buildExportPack(vault, {
      from: "2026-03-10",
      to: "2026-03-10",
      experimentSlug: "low-carb",
      packId: "focus-pack",
      generatedAt: "2026-03-12T15:00:00.000Z",
    });

    assert.equal(pack.format, "healthybob.export-pack.v1");
    assert.equal(pack.basePath, "exports/packs/focus-pack");
    assert.equal(pack.manifest.recordCount, 0);
    assert.equal(pack.manifest.experimentCount, 1);
    assert.equal(pack.manifest.journalCount, 0);
    assert.equal(pack.manifest.questionCount, 3);
    assert.equal(pack.manifest.fileCount, 5);
    assert.equal(pack.files.length, 5);
    assert.ok(pack.files.every((file) => file.path.startsWith("exports/packs/focus-pack/")));

    const manifestFile = pack.files.find((file) => file.path.endsWith("manifest.json"));
    assert.ok(manifestFile);
    assert.match(manifestFile.contents, /"format": "healthybob.export-pack.v1"/);
    assert.match(manifestFile.contents, /"fileCount": 5/);

    const questionPackFile = pack.files.find((file) =>
      file.path.endsWith("question-pack.json"),
    );
    assert.ok(questionPackFile);
    assert.match(questionPackFile.contents, /"format": "healthybob.question-pack.v1"/);
    assert.match(questionPackFile.contents, /low-carb experiment/);

    const assistantFile = pack.files.find((file) =>
      file.path.endsWith("assistant-context.md"),
    );
    assert.ok(assistantFile);
    assert.match(assistantFile.contents, /Healthy Bob Export Pack/);
    assert.match(assistantFile.contents, /## Questions/);
    assert.match(assistantFile.contents, /Low Carb Trial/);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

async function createFixtureVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-query-"));

  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "journal/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/samples/heart_rate/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/samples/glucose/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "audit/2026"), { recursive: true });

  await writeFile(
    path.join(vaultRoot, "vault.json"),
    JSON.stringify(
      {
        schemaVersion: "hb.vault.v1",
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
        createdAt: "2026-03-10T06:00:00Z",
        title: "Healthy Bob Vault",
        timezone: "America/New_York",
        idPolicy: {
          format: "prefix_ulid",
          prefixes: {
            audit: "aud",
            document: "doc",
            event: "evt",
            experiment: "exp",
            meal: "meal",
            pack: "pack",
            provider: "prov",
            sample: "smp",
            transform: "xfm",
            vault: "vault",
          },
        },
        paths: {
          coreDocument: "CORE.md",
          journalRoot: "journal",
          experimentsRoot: "bank/experiments",
          providersRoot: "bank/providers",
          rawRoot: "raw",
          eventsRoot: "ledger/events",
          samplesRoot: "ledger/samples",
          auditRoot: "audit",
          exportsRoot: "exports",
        },
        shards: {
          events: "ledger/events/YYYY/YYYY-MM.jsonl",
          samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
          audit: "audit/YYYY/YYYY-MM.jsonl",
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    path.join(vaultRoot, "CORE.md"),
    `---
schemaVersion: hb.frontmatter.core.v1
docType: core
vaultId: vault_01JNV40W8VFYQ2H7CMJY5A9R4K
title: Core Health Context
timezone: America/New_York
updatedAt: 2026-03-12T20:00:00Z
tags:
  - baseline
---
# Core Health Context

Summary of baseline routines.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/experiments/low-carb.md"),
    `---
schemaVersion: hb.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01JNV4EXP000000000000001
slug: low-carb
status: active
title: Low Carb Trial
started_on: 2026-03-01
tags:
  - nutrition
  - glucose
---
# Low Carb Trial

Reduce breakfast carbs and observe glucose stability.
`,
  );

  await writeFile(
    path.join(vaultRoot, "journal/2026/2026-03-10.md"),
    `---
schemaVersion: hb.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-10
eventIds:
  - evt_01JNV4MEAL000000000000001
sampleStreams:
  - glucose
  - heart_rate
---
# March 10

Fasted longer than usual. Steady energy through the afternoon.
`,
  );

  await writeFile(
    path.join(vaultRoot, "journal/2026/2026-03-11.md"),
    `---
schemaVersion: hb.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-11
event_ids:
  - evt_01JNV4NOTE000000000000001
sample_streams:
  - heart_rate
---
# March 11

Light walk and early bedtime.
`,
  );

  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "hb.event.v1",
        id: "evt_01JNV4MEAL000000000000001",
        kind: "meal",
        occurredAt: "2026-03-10T12:15:00Z",
        recordedAt: "2026-03-10T12:16:00Z",
        dayKey: "2026-03-10",
        source: "manual",
        title: "Lunch",
        note: "Eggs and avocado lunch.",
        tags: ["meal", "nutrition"],
        mealId: "meal_01JNV4MEAL00000000000001",
        photoPaths: ["raw/meals/2026/03/meal_01JNV4MEAL00000000000001/photo-lunch.jpg"],
        audioPaths: [],
      }),
      JSON.stringify({
        schemaVersion: "hb.event.v1",
        id: "evt_01JNV4NOTE000000000000001",
        kind: "note",
        occurredAt: "2026-03-11T09:00:00Z",
        recordedAt: "2026-03-11T09:00:00Z",
        dayKey: "2026-03-11",
        source: "manual",
        title: "Morning note",
        note: "Slept well and woke up rested.",
      }),
      JSON.stringify({
        schemaVersion: "hb.event.v1",
        id: "evt_01JNV4DOC000000000000001",
        kind: "document",
        occurred_at: "2026-03-12T14:00:00Z",
        recorded_at: "2026-03-12T14:02:00Z",
        day_key: "2026-03-12",
        source: "import",
        title: "Lab report",
        related_ids: ["doc_01JNV4DOC0000000000000001"],
        document_id: "doc_01JNV4DOC0000000000000001",
        document_path:
          "raw/documents/2026/03/doc_01JNV4DOC0000000000000001/lab-report.pdf",
        mime_type: "application/pdf",
      }),
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(vaultRoot, "ledger/samples/glucose/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "hb.sample.v1",
        id: "smp_01JNV4GLU000000000000001",
        stream: "glucose",
        recordedAt: "2026-03-10T08:00:00Z",
        dayKey: "2026-03-10",
        source: "device",
        quality: "raw",
        value: 92,
        unit: "mg_dL",
      }),
      JSON.stringify({
        schemaVersion: "hb.sample.v1",
        id: "smp_01JNV4GLU000000000000002",
        stream: "glucose",
        recordedAt: "2026-03-10T12:15:00Z",
        dayKey: "2026-03-10",
        source: "device",
        quality: "raw",
        value: 100,
        unit: "mg_dL",
      }),
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(vaultRoot, "ledger/samples/heart_rate/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "hb.sample.v1",
        id: "smp_01JNV4HR0000000000000001",
        stream: "heart_rate",
        recordedAt: "2026-03-10T08:30:00Z",
        dayKey: "2026-03-10",
        source: "device",
        quality: "raw",
        value: 68,
        unit: "bpm",
      }),
      JSON.stringify({
        schemaVersion: "hb.sample.v1",
        id: "smp_01JNV4HR0000000000000002",
        stream: "heart_rate",
        recordedAt: "2026-03-10T21:30:00Z",
        dayKey: "2026-03-10",
        source: "device",
        quality: "raw",
        value: 72,
        unit: "bpm",
      }),
      JSON.stringify({
        schemaVersion: "hb.sample.v1",
        id: "smp_01JNV4HR0000000000000003",
        stream: "heart_rate",
        recordedAt: "2026-03-11T08:30:00Z",
        dayKey: "2026-03-11",
        source: "device",
        quality: "raw",
        value: 70,
        unit: "bpm",
      }),
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(vaultRoot, "audit/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "hb.audit.v1",
        id: "aud_01JNV4AUD000000000000001",
        action: "validate",
        status: "success",
        occurredAt: "2026-03-12T07:00:00Z",
        actor: "query",
        commandName: "vault-cli validate",
        summary: "Validated fixture vault.",
        changes: [],
      }),
      "",
    ].join("\n"),
  );

  return vaultRoot;
}
