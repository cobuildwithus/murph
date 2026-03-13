import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

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

test("readVault tolerates missing optional files and normalizes alias-heavy fixtures", async () => {
  const vaultRoot = await createSparseVault();

  try {
    const vault = await readVault(vaultRoot);

    assert.equal(vault.metadata, null);
    assert.equal(vault.coreDocument, null);
    assert.equal(vault.audits.length, 0);
    assert.equal(vault.experiments.length, 1);
    assert.equal(vault.experiments[0]?.experimentSlug, "recovery-plan");
    assert.equal(vault.experiments[0]?.title, "recovery-plan");
    assert.equal(vault.journalEntries[0]?.title, "2026-03-09");
    assert.deepEqual(vault.journalEntries[0]?.data.eventIds, [
      "evt_01JNV4ALT000000000000001",
    ]);
    assert.deepEqual(vault.journalEntries[0]?.data.sampleStreams, ["glucose"]);
    assert.equal(vault.samples[0]?.stream, "glucose");
    assert.match(String(vault.samples[0]?.id), /^sample:/);
    assert.equal(lookupRecordById(vault, "   "), null);
    assert.deepEqual(
      listRecords(vault, {
        recordTypes: ["sample"],
        streams: ["glucose"],
      }).map((record) => record.id),
      [vault.samples[0]?.id],
    );
    assert.deepEqual(
      listExperiments(vault, { slug: "recovery-plan", text: "hydration" }).map(
        (record) => record.experimentSlug,
      ),
      ["recovery-plan"],
    );
    assert.deepEqual(
      listJournalEntries(vault, {
        experimentSlug: "recovery-plan",
        tags: ["focus"],
        text: "steady",
      }).map((record) => record.id),
      ["journal:2026-03-09"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("summarizeDailySamples honors filters and ignores incomplete sample records", () => {
  const vault = createEmptyReadModel();
  vault.samples = [
    createSampleRecord({
      id: "smp_filter_01",
      occurredAt: null,
      date: null,
      stream: "glucose",
      sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
      data: { value: 91, unit: "mg_dL" },
    }),
    createSampleRecord({
      id: "smp_filter_02",
      stream: null,
      sourcePath: "ledger/samples/unknown/2026/2026-03.jsonl",
      data: { value: 88, unit: "mg_dL" },
    }),
    createSampleRecord({
      id: "smp_filter_03",
      occurredAt: "2026-03-10T08:00:00Z",
      stream: "glucose",
      experimentSlug: "recovery-plan",
      sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
      data: { value: 92, unit: "mg_dL" },
    }),
    createSampleRecord({
      id: "smp_filter_04",
      occurredAt: "2026-03-10T12:00:00Z",
      stream: "glucose",
      experimentSlug: "recovery-plan",
      sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
      data: { value: "n/a", unit: "mmol/L" },
    }),
    createSampleRecord({
      id: "smp_filter_05",
      occurredAt: "2026-03-10T18:00:00Z",
      stream: "glucose",
      experimentSlug: "recovery-plan",
      sourcePath: "ledger/samples/glucose/2026/2026-03-b.jsonl",
      data: { value: 98, unit: "mmol/L" },
    }),
    createSampleRecord({
      id: "smp_filter_06",
      occurredAt: "2026-03-10T19:00:00Z",
      stream: "heart_rate",
      experimentSlug: "recovery-plan",
      sourcePath: "ledger/samples/heart_rate/2026/2026-03.jsonl",
      data: { value: 63, unit: "bpm" },
    }),
    createSampleRecord({
      id: "smp_filter_07",
      occurredAt: "2026-03-10T20:00:00Z",
      stream: "glucose",
      experimentSlug: "other-plan",
      sourcePath: "ledger/samples/glucose/2026/2026-03-c.jsonl",
      data: { value: 110, unit: "mg_dL" },
    }),
  ];

  const summaries = summarizeDailySamples(vault, {
    from: "2026-03-10",
    to: "2026-03-10",
    streams: ["glucose"],
    experimentSlug: "recovery-plan",
  });

  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0]?.sampleIds, [
    "smp_filter_03",
    "smp_filter_04",
    "smp_filter_05",
  ]);
  assert.deepEqual(summaries[0]?.sourcePaths, [
    "ledger/samples/glucose/2026/2026-03-b.jsonl",
    "ledger/samples/glucose/2026/2026-03.jsonl",
  ]);
  assert.deepEqual(summaries[0]?.units, ["mg_dL", "mmol/L"]);
  assert.equal(summaries[0]?.unit, null);
  assert.equal(summaries[0]?.minValue, 92);
  assert.equal(summaries[0]?.maxValue, 98);
  assert.equal(summaries[0]?.averageValue, 95);
  assert.equal(summaries[0]?.firstSampleAt, "2026-03-10T08:00:00Z");
  assert.equal(summaries[0]?.lastSampleAt, "2026-03-10T18:00:00Z");
});

test("buildExportPack omits optional sections when the scoped vault is empty", () => {
  const pack = buildExportPack(createEmptyReadModel());

  assert.equal(pack.packId, "pack-start-end-all");
  assert.equal(pack.manifest.recordCount, 0);
  assert.equal(pack.manifest.questionCount, 2);
  assert.equal(pack.manifest.fileCount, 5);

  const assistantFile = pack.files.find((file) =>
    file.path.endsWith("assistant-context.md"),
  );
  const questionPackFile = pack.files.find((file) =>
    file.path.endsWith("question-pack.json"),
  );

  assert.ok(assistantFile);
  assert.ok(questionPackFile);
  assert.match(assistantFile.contents, /No sample summaries in scope/);
  assert.doesNotMatch(assistantFile.contents, /## Experiment Focus/);
  assert.doesNotMatch(assistantFile.contents, /## Journal Highlights/);

  const questionPack = JSON.parse(questionPackFile.contents) as {
    questions: string[];
    context: {
      experiment: unknown;
      journals: unknown[];
      dailySampleSummaries: unknown[];
    };
  };

  assert.deepEqual(questionPack.questions, [
    "What are the most important changes or events between the start and the end?",
    "Which records look most actionable for follow-up, and why?",
  ]);
  assert.equal(questionPack.context.experiment, null);
  assert.deepEqual(questionPack.context.journals, []);
  assert.deepEqual(questionPack.context.dailySampleSummaries, []);
});

test("buildExportPack renders experiment, journal, timeline, and meal prompts for rich scoped packs", () => {
  const vault = createEmptyReadModel();
  const experiment = createRecord({
    id: "exp_focus",
    lookupIds: ["exp_focus", "focus"],
    recordType: "experiment",
    sourcePath: "bank/experiments/focus.md",
    occurredAt: "2026-03-09T08:00:00Z",
    date: "2026-03-09",
    kind: "experiment",
    experimentSlug: "focus",
    title: "Focus Trial",
    tags: ["focus"],
    data: {
      experimentId: "exp_focus",
      slug: "focus",
      startedOn: "2026-03-09",
    },
    body: "Experiment body",
    frontmatter: {
      experimentId: "exp_focus",
      slug: "focus",
    },
  });
  const journal = createRecord({
    id: "journal:2026-03-10",
    lookupIds: ["journal:2026-03-10", "2026-03-10"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-10.md",
    occurredAt: "2026-03-10T20:00:00Z",
    date: "2026-03-10",
    kind: "journal_day",
    experimentSlug: "focus",
    title: "March 10",
    tags: ["focus"],
    data: {
      eventIds: ["meal_focus"],
      sampleStreams: ["glucose"],
    },
    body: "Journal summary",
    frontmatter: {
      dayKey: "2026-03-10",
    },
  });
  const meal = createRecord({
    id: "meal_focus",
    lookupIds: ["meal_focus", "evt_meal_focus"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-10T12:00:00Z",
    date: "2026-03-10",
    kind: "meal",
    experimentSlug: "focus",
    title: null,
    tags: ["meal"],
    data: {
      kind: "meal",
      mealId: "meal_focus",
    },
    body: "Meal detail\nSecond line",
    frontmatter: null,
  });
  const note = createRecord({
    id: "evt_focus_note",
    lookupIds: ["evt_focus_note"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-10T18:00:00Z",
    date: "2026-03-10",
    kind: "note",
    experimentSlug: "focus",
    title: null,
    tags: [],
    data: {
      kind: "note",
    },
    body: null,
    frontmatter: null,
  });
  const sampleA = createSampleRecord({
    id: "smp_focus_01",
    occurredAt: "2026-03-10T08:00:00Z",
    experimentSlug: "focus",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: { value: 91, unit: "mg_dL" },
  });
  const sampleB = createSampleRecord({
    id: "smp_focus_02",
    occurredAt: "2026-03-10T09:00:00Z",
    experimentSlug: "focus",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: { value: 95, unit: "mg_dL" },
  });

  vault.experiments = [experiment];
  vault.journalEntries = [journal];
  vault.events = [meal, note];
  vault.samples = [sampleA, sampleB];
  vault.records = [experiment, journal, sampleA, meal, sampleB, note];

  const pack = buildExportPack(vault, {
    from: "2026-03-10",
    to: "2026-03-10",
    experimentSlug: "focus",
    generatedAt: "2026-03-12T15:00:00.000Z",
  });

  assert.equal(pack.packId, "pack-2026-03-10-2026-03-10-focus");
  assert.equal(pack.manifest.recordCount, 5);
  assert.equal(pack.manifest.experimentCount, 1);
  assert.equal(pack.manifest.journalCount, 1);
  assert.equal(pack.manifest.sampleSummaryCount, 1);
  assert.ok(
    pack.questionPack.questions.some((question) =>
      question.includes("focus experiment"),
    ),
  );
  assert.ok(
    pack.questionPack.questions.some((question) =>
      question.includes("meals or meal-adjacent"),
    ),
  );

  const assistantFile = pack.files.find((file) =>
    file.path.endsWith("assistant-context.md"),
  );

  assert.ok(assistantFile);
  assert.match(assistantFile.contents, /## Experiment Focus/);
  assert.match(assistantFile.contents, /## Journal Highlights/);
  assert.match(assistantFile.contents, /## Record Timeline/);
  assert.match(assistantFile.contents, /## Daily Sample Summaries/);
  assert.match(assistantFile.contents, /Meal detail/);
  assert.match(assistantFile.contents, /note \| evt_focus_note \| note/);
});

test("model helpers return null or empty results for unmatched ids and filters", () => {
  const vault = createEmptyReadModel();
  const experiment = createRecord({
    id: "experiment:focus",
    lookupIds: ["experiment:focus", "focus"],
    recordType: "experiment",
    sourcePath: "bank/experiments/focus.md",
    experimentSlug: "focus",
    title: "Focus",
    tags: ["focus"],
    data: {},
    frontmatter: {},
  });
  const journal = createRecord({
    id: "journal:2026-03-12",
    lookupIds: ["journal:2026-03-12", "2026-03-12"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-12.md",
    date: "2026-03-12",
    experimentSlug: "focus",
    title: "March 12",
    tags: ["focus"],
    data: {},
    body: "Steady day",
    frontmatter: {},
  });
  const orphanEvent = createRecord({
    id: "evt_orphan",
    lookupIds: ["evt_orphan"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: null,
    date: null,
    kind: null,
    stream: null,
    title: null,
    tags: [],
    data: {},
    body: null,
    frontmatter: null,
  });

  vault.experiments = [experiment];
  vault.journalEntries = [journal];
  vault.records = [experiment, journal, orphanEvent];

  assert.equal(lookupRecordById(vault, "unknown-id"), null);
  assert.equal(getExperiment(vault, "missing"), null);
  assert.equal(getJournalEntry(vault, "2026-03-13"), null);
  assert.deepEqual(listExperiments(vault, { slug: "missing" }), []);
  assert.deepEqual(listJournalEntries(vault, { from: "2026-03-13" }), []);
  assert.deepEqual(listRecords(vault, { streams: ["glucose"] }), []);
  assert.deepEqual(listRecords(vault, { from: "2026-03-10" }).map((record) => record.id), [
    "journal:2026-03-12",
  ]);
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

async function createSparseVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-query-sparse-"));

  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "journal/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/samples/glucose/2026"), { recursive: true });

  await writeFile(
    path.join(vaultRoot, "bank/experiments/recovery-plan.md"),
    `---
schemaVersion: hb.frontmatter.experiment.v1
docType: experiment
experiment_id: exp_01JNV4ALT000000000000001
experiment_slug: recovery-plan
started_on: 2026-03-09
updated_at: 2026-03-09T09:00:00Z
tags:
  - focus
---
Hydration reset baseline.
`,
  );

  await writeFile(
    path.join(vaultRoot, "journal/2026/2026-03-09.md"),
    `---
schemaVersion: hb.frontmatter.journal-day.v1
docType: journal_day
day_key: 2026-03-09
experiment_slug: recovery-plan
event_ids:
  - evt_01JNV4ALT000000000000001
sample_streams:
  - glucose
tags:
  - focus
---
Steady energy through the afternoon.
`,
  );

  await writeFile(
    path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
    `${JSON.stringify({
      schemaVersion: "hb.event.v1",
      id: "evt_01JNV4ALT000000000000001",
      kind: "note",
      occurred_at: "2026-03-09T09:15:00Z",
      recorded_at: "2026-03-09T09:15:00Z",
      day_key: "2026-03-09",
      source: "manual",
      summary: "Hydration note",
      tags: ["focus"],
    })}\n`,
  );

  await writeFile(
    path.join(vaultRoot, "ledger/samples/glucose/2026/2026-03.jsonl"),
    `${JSON.stringify({
      schemaVersion: "hb.sample.v1",
      recorded_at: "2026-03-09T10:00:00Z",
      day_key: "2026-03-09",
      source: "device",
      quality: "raw",
      value: 94,
      unit: "mg_dL",
    })}\n`,
  );

  return vaultRoot;
}

function createEmptyReadModel(): Awaited<ReturnType<typeof readVault>> {
  return {
    format: "healthybob.query.v1",
    vaultRoot: "/tmp/empty-vault",
    metadata: null,
    coreDocument: null,
    experiments: [],
    journalEntries: [],
    events: [],
    samples: [],
    audits: [],
    records: [],
  };
}

function createSampleRecord(overrides: {
  id: string;
  occurredAt?: string | null;
  date?: string | null;
  stream?: string | null;
  experimentSlug?: string | null;
  sourcePath: string;
  data: Record<string, unknown>;
}): Awaited<ReturnType<typeof readVault>>["samples"][number] {
  const occurredAt = overrides.occurredAt ?? "2026-03-10T00:00:00Z";

  return {
    id: overrides.id,
    lookupIds: [overrides.id],
    recordType: "sample",
    sourcePath: overrides.sourcePath,
    sourceFile: path.join("/tmp", overrides.id),
    occurredAt,
    date: overrides.date ?? (occurredAt ? occurredAt.slice(0, 10) : null),
    kind: "sample",
    stream: overrides.stream ?? "glucose",
    experimentSlug: overrides.experimentSlug ?? null,
    title: "sample",
    tags: [],
    data: overrides.data,
    body: null,
    frontmatter: null,
  };
}

function createRecord(
  overrides: Partial<Awaited<ReturnType<typeof readVault>>["records"][number]> & {
    id: string;
    recordType: Awaited<ReturnType<typeof readVault>>["records"][number]["recordType"];
    sourcePath: string;
  },
): Awaited<ReturnType<typeof readVault>>["records"][number] {
  return {
    id: overrides.id,
    lookupIds: overrides.lookupIds ?? [overrides.id],
    recordType: overrides.recordType,
    sourcePath: overrides.sourcePath,
    sourceFile: overrides.sourceFile ?? path.join("/tmp", overrides.id),
    occurredAt: overrides.occurredAt ?? null,
    date: overrides.date ?? null,
    kind: overrides.kind ?? overrides.recordType,
    stream: overrides.stream ?? null,
    experimentSlug: overrides.experimentSlug ?? null,
    title: overrides.title ?? null,
    tags: overrides.tags ?? [],
    data: overrides.data ?? {},
    body: overrides.body ?? null,
    frontmatter: overrides.frontmatter ?? null,
  };
}
