import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  buildExportPack,
  buildTimeline,
  getExperiment,
  getJournalEntry,
  listFamilyMembers,
  listGeneticVariants,
  listExperiments,
  listJournalEntries,
  listRecords,
  lookupRecordById,
  readVault,
  searchVault,
  summarizeDailySamples,
} from "../src/index.js";
import { parseFrontmatterDocument as parseHealthFrontmatterDocument } from "../src/health/shared.js";
import { parseMarkdownDocument } from "../src/markdown.js";

test("parseMarkdownDocument keeps tolerant parsing explicit", () => {
  const parsed = parseMarkdownDocument(`---
# comment
title: 'Flexible Title'
tags:
- alpha
---

Body line
`);

  assert.deepEqual(parsed.attributes, {
    title: "Flexible Title",
    tags: ["alpha"],
  });
  assert.equal(parsed.body, "Body line");
  assert.equal(parsed.rawFrontmatter, "# comment\ntitle: 'Flexible Title'\ntags:\n- alpha");
});

test("parseMarkdownDocument falls back to body-only content when frontmatter is malformed", () => {
  const parsed = parseMarkdownDocument(`---
title broken
---

Body line
`);

  assert.deepEqual(parsed.attributes, {});
  assert.equal(parsed.rawFrontmatter, null);
  assert.equal(parsed.body, "---\ntitle broken\n---\n\nBody line");
});

test("health frontmatter parsing keeps strict errors and trimmed bodies", () => {
  const parsed = parseHealthFrontmatterDocument(`---
title: Example
---

Body line
`);

  assert.equal(parsed.body, "Body line");
  assert.deepEqual(parsed.attributes, { title: "Example" });

  assert.throws(
    () =>
      parseHealthFrontmatterDocument(`---
title broken
---
`),
    /Expected "key: value" frontmatter at line 1\./,
  );
});

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
      assert.equal(mealRecord?.displayId, "meal_01JNV4MEAL00000000000001");
      assert.equal(mealRecord?.primaryLookupId, "evt_01JNV4MEAL000000000000001");
      assert.equal(mealRecord?.data.kind, "meal");
      assert.deepEqual(mealRecord?.data.eventIds, ["evt_01JNV4MEAL000000000000001"]);

      const mealEventAlias = lookupRecordById(vault, "evt_01JNV4MEAL000000000000001");
      assert.equal(mealEventAlias?.displayId, "meal_01JNV4MEAL00000000000001");
      assert.equal(mealEventAlias?.primaryLookupId, "evt_01JNV4MEAL000000000000001");

      const documentRecord = lookupRecordById(vault, "doc_01JNV4DOC0000000000000001");
      assert.equal(documentRecord?.displayId, "doc_01JNV4DOC0000000000000001");
      assert.equal(documentRecord?.primaryLookupId, "evt_01JNV4DOC000000000000001");
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
      marchRecords.map((record) => record.displayId),
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
      mealRecords.map((record) => record.displayId),
      ["meal_01JNV4MEAL00000000000001"],
    );

    const documentRecords = listRecords(vault, { ids: ["evt_01JNV4DOC000000000000001"] });
    assert.deepEqual(
      documentRecords.map((record) => record.displayId),
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
    assert.equal(pack.manifest.questionCount, 4);
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

test("buildExportPack sanitizes explicit pack ids before deriving output paths", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);
    const pack = buildExportPack(vault, {
      packId: "../../unsafe pack",
      generatedAt: "2026-03-12T15:00:00.000Z",
    });

    assert.equal(pack.packId, "unsafe-pack");
    assert.equal(pack.basePath, "exports/packs/unsafe-pack");
    assert.ok(pack.files.every((file) => file.path.startsWith("exports/packs/unsafe-pack/")));
    assert.ok(pack.files.every((file) => !file.path.includes("..")));
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

test("health registry queries prefer canonical fields and stable title ordering", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const family = await listFamilyMembers(vaultRoot);
    const genetics = await listGeneticVariants(vaultRoot);

    assert.deepEqual(
      family.map((record) => record.id),
      [
        "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
        "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      ],
    );
    assert.deepEqual(family[0]?.relatedVariantIds, ["var_01JNW7YJ7MNE7M9Q2QWQK4Z400"]);
    assert.deepEqual(family[1]?.relatedVariantIds, []);
    assert.equal(family[1]?.updatedAt, "2026-03-12T09:00:00Z");

    assert.deepEqual(
      genetics.map((record) => record.id),
      [
        "var_01JNW7YJ7MNE7M9Q2QWQK4Z400",
        "var_01JNW7YJ7MNE7M9Q2QWQK4Z401",
      ],
    );
    assert.equal(genetics[1]?.updatedAt, "2026-03-12T11:00:00Z");
    assert.deepEqual(genetics[1]?.sourceFamilyMemberIds, ["fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"]);
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

test("searchVault ranks body and structured matches while excluding raw samples by default", () => {
  const vault = createEmptyReadModel();
  const journal = createRecord({
    id: "journal:2026-03-12",
    lookupIds: ["journal:2026-03-12", "2026-03-12"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-12.md",
    date: "2026-03-12",
    kind: "journal_day",
    title: "March 12",
    tags: ["focus"],
    body: "Steady energy. Afternoon crash after pasta lunch and coffee.",
    frontmatter: {
      dayKey: "2026-03-12",
    },
  });
  const meal = createRecord({
    id: "meal_01",
    lookupIds: ["meal_01", "evt_meal_01"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T12:15:00Z",
    date: "2026-03-12",
    kind: "meal",
    title: "Lunch",
    tags: ["meal", "lunch"],
    data: {
      mealId: "meal_01",
      note: "Afternoon crash after pasta and coffee.",
    },
    body: "Pasta with coffee at lunch.",
  });
  const sample = createSampleRecord({
    id: "smp_01",
    occurredAt: "2026-03-12T18:00:00Z",
    stream: "heart_rate",
    sourcePath: "ledger/samples/heart_rate/2026/2026-03.jsonl",
    data: {
      value: 72,
      unit: "bpm",
      note: "brief spike",
    },
  });

  vault.journalEntries = [journal];
  vault.events = [meal];
  vault.samples = [sample];
  vault.records = [journal, meal, sample];

  const result = searchVault(vault, "afternoon crash pasta", {
    limit: 10,
  });

  assert.equal(result.format, "healthybob.search.v1");
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.hits.map((hit) => hit.recordId),
    ["journal:2026-03-12", "meal_01"],
  );
  assert.match(result.hits[0]?.snippet ?? "", /afternoon crash/i);
  assert.deepEqual(result.hits[0]?.matchedTerms, ["afternoon", "crash", "pasta"]);
});

test("searchVault includes sample rows when the caller scopes by sample record type or stream", () => {
  const vault = createEmptyReadModel();
  const sample = createSampleRecord({
    id: "smp_glucose_01",
    occurredAt: "2026-03-12T08:00:00Z",
    stream: "glucose",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 104,
      unit: "mg_dL",
      note: "post meal spike",
    },
  });

  vault.samples = [sample];
  vault.records = [sample];

  const result = searchVault(vault, "glucose spike", {
    streams: ["glucose"],
  });

  assert.equal(result.total, 1);
  assert.equal(result.hits[0]?.recordId, "smp_glucose_01");
  assert.equal(result.hits[0]?.recordType, "sample");
  assert.equal(result.hits[0]?.stream, "glucose");
});

test("buildTimeline merges journals, events, and daily sample summaries into a descending feed", () => {
  const vault = createEmptyReadModel();
  const journal = createRecord({
    id: "journal:2026-03-12",
    lookupIds: ["journal:2026-03-12", "2026-03-12"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-12.md",
    date: "2026-03-12",
    kind: "journal_day",
    title: "March 12",
    body: "Good day.",
    frontmatter: {
      dayKey: "2026-03-12",
    },
  });
  const event = createRecord({
    id: "evt_walk_01",
    lookupIds: ["evt_walk_01"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T18:00:00Z",
    date: "2026-03-12",
    kind: "activity_session",
    title: "Walk",
    tags: ["exercise"],
    data: {
      durationMinutes: 30,
    },
  });
  const sampleA = createSampleRecord({
    id: "smp_hr_01",
    occurredAt: "2026-03-12T07:00:00Z",
    stream: "heart_rate",
    sourcePath: "ledger/samples/heart_rate/2026/2026-03.jsonl",
    data: {
      value: 60,
      unit: "bpm",
    },
  });
  const sampleB = createSampleRecord({
    id: "smp_hr_02",
    occurredAt: "2026-03-12T20:00:00Z",
    stream: "heart_rate",
    sourcePath: "ledger/samples/heart_rate/2026/2026-03.jsonl",
    data: {
      value: 78,
      unit: "bpm",
    },
  });

  vault.journalEntries = [journal];
  vault.events = [event];
  vault.samples = [sampleA, sampleB];
  vault.records = [journal, sampleA, event, sampleB];

  const timeline = buildTimeline(vault, {
    from: "2026-03-12",
    to: "2026-03-12",
  });

  assert.deepEqual(
    timeline.map((entry) => [entry.entryType, entry.id]),
    [
      ["sample_summary", "sample-summary:2026-03-12:heart_rate"],
      ["event", "evt_walk_01"],
      ["journal", "journal:2026-03-12"],
    ],
  );
  assert.equal(timeline[0]?.kind, "sample_summary");
  assert.equal(timeline[0]?.stream, "heart_rate");
  assert.equal(timeline[0]?.data.averageValue, 69);
});

test("searchVault supports blank queries, structured-only matches, and filter normalization", () => {
  const blank = searchVault(createEmptyReadModel(), "   ");
  assert.equal(blank.total, 0);
  assert.deepEqual(blank.hits, []);

  const vault = createEmptyReadModel();
  const structuredOnly = createRecord({
    id: "evt_structured",
    lookupIds: ["evt_structured", "doc_structured"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T10:00:00Z",
    date: "2026-03-11",
    kind: "document",
    experimentSlug: "iron-study",
    title: "External report",
    tags: ["labs"],
    data: {
      provider: "Labcorp",
      ferritin: 12,
    },
  });
  const wrongExperiment = createRecord({
    id: "evt_wrong_experiment",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T09:00:00Z",
    date: "2026-03-11",
    kind: "document",
    experimentSlug: "other-study",
    title: "Mismatch",
    tags: ["labs"],
    body: "Labcorp ferritin",
  });
  const missingKind = createRecord({
    id: "evt_missing_kind",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T08:00:00Z",
    date: "2026-03-11",
    kind: null,
    experimentSlug: "iron-study",
    title: "Untyped report",
    tags: ["labs"],
    body: "Labcorp ferritin",
  });
  const wrongDate = createRecord({
    id: "evt_wrong_date",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-10T08:00:00Z",
    date: "2026-03-10",
    kind: "document",
    experimentSlug: "iron-study",
    title: "Old report",
    tags: ["labs"],
    body: "Labcorp ferritin",
  });
  const missingTag = createRecord({
    id: "evt_missing_tag",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T11:00:00Z",
    date: "2026-03-11",
    kind: "document",
    experimentSlug: "iron-study",
    title: "Tagless report",
    tags: [],
    body: "Labcorp ferritin",
  });

  vault.events = [
    structuredOnly,
    wrongExperiment,
    missingKind,
    wrongDate,
    missingTag,
  ];
  vault.records = vault.events;

  const result = searchVault(vault, "labcorp ferritin", {
    recordTypes: ["event"],
    kinds: ["document"],
    experimentSlug: "iron-study",
    from: "2026-03-11",
    to: "2026-03-11",
    tags: ["labs"],
    limit: 0,
  });

  assert.equal(result.total, 1);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.recordId, "evt_structured");
  assert.equal(
    result.hits[0]?.snippet,
    "External report · document · iron-study",
  );
});

test("searchVault orders equal scores by recency and trims long snippets around matches", () => {
  const vault = createEmptyReadModel();
  const longBody = `${"before ".repeat(20)}caffeine${" after".repeat(25)}`;
  const older = createRecord({
    id: "evt_caffeine_old",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-11T09:00:00Z",
    date: "2026-03-11",
    kind: "note",
    title: "Caffeine log",
    body: longBody,
  });
  const newer = createRecord({
    id: "evt_caffeine_new",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T09:00:00Z",
    date: "2026-03-12",
    kind: "note",
    title: "Caffeine log",
    body: longBody,
  });

  vault.events = [older, newer];
  vault.records = [older, newer];

  const result = searchVault(vault, "caffeine");

  assert.deepEqual(
    result.hits.map((hit) => hit.recordId),
    ["evt_caffeine_new", "evt_caffeine_old"],
  );
  assert.match(result.hits[0]?.snippet ?? "", /^\.\.\..+\.\.\.$/);
});

test("buildTimeline applies toggles, fallback timestamps, and filter caps", () => {
  const vault = createEmptyReadModel();
  const journalFallback = createRecord({
    id: "journal:2026-03-13",
    lookupIds: ["journal:2026-03-13", "2026-03-13"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-13.md",
    occurredAt: "2026-03-13T09:00:00Z",
    date: null,
    kind: null,
    experimentSlug: "focus",
    title: null,
    data: {},
    frontmatter: {},
  });
  const journalMissingDate = createRecord({
    id: "journal:missing",
    lookupIds: ["journal:missing"],
    recordType: "journal",
    sourcePath: "journal/2026/missing.md",
    occurredAt: null,
    date: null,
    kind: null,
    title: "Skip me",
    data: {},
    frontmatter: {},
  });
  const eventFallback = createRecord({
    id: "evt_focus",
    lookupIds: ["evt_focus"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: null,
    date: "2026-03-13",
    kind: null,
    stream: "glucose",
    experimentSlug: "focus",
    title: null,
    data: {},
  });
  const eventWrongStream = createRecord({
    id: "evt_wrong_stream",
    lookupIds: ["evt_wrong_stream"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-13T10:00:00Z",
    date: "2026-03-13",
    kind: "note",
    stream: "heart_rate",
    experimentSlug: "focus",
    title: "Wrong stream",
    data: {},
  });
  const eventMissingDate = createRecord({
    id: "evt_missing_date",
    lookupIds: ["evt_missing_date"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: null,
    date: null,
    kind: null,
    stream: "glucose",
    experimentSlug: "focus",
    title: "Skip me too",
    data: {},
  });
  const sampleFallback = createSampleRecord({
    id: "smp_focus_01",
    occurredAt: null,
    date: "2026-03-13",
    stream: "glucose",
    experimentSlug: "focus",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 91,
      unit: "mg_dL",
    },
  });
  const sampleOtherExperiment = createSampleRecord({
    id: "smp_other_01",
    occurredAt: "2026-03-13T18:00:00Z",
    date: "2026-03-13",
    stream: "glucose",
    experimentSlug: "other",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 99,
      unit: "mg_dL",
    },
  });

  journalFallback.kind = null;
  journalMissingDate.kind = null;
  eventFallback.kind = null;
  eventMissingDate.kind = null;
  sampleFallback.occurredAt = null;

  vault.journalEntries = [journalFallback, journalMissingDate];
  vault.events = [eventFallback, eventWrongStream, eventMissingDate];
  vault.samples = [sampleFallback, sampleOtherExperiment];
  vault.records = [
    journalFallback,
    journalMissingDate,
    eventFallback,
    eventWrongStream,
    eventMissingDate,
    sampleFallback,
    sampleOtherExperiment,
  ];

  const timeline = buildTimeline(vault, {
    from: "2026-03-13",
    to: "2026-03-13",
    experimentSlug: "focus",
    kinds: ["journal_day", "event", "sample_summary"],
    streams: ["glucose"],
    limit: 999,
  });

  assert.deepEqual(
    timeline.map((entry) => [entry.entryType, entry.id]),
    [
      ["sample_summary", "sample-summary:2026-03-13:glucose"],
      ["journal", "journal:2026-03-13"],
      ["event", "evt_focus"],
    ],
  );
  assert.equal(timeline[0]?.occurredAt, "2026-03-13T23:59:59");
  assert.equal(timeline[1]?.kind, "journal_day");
  assert.equal(timeline[2]?.occurredAt, "2026-03-13T00:00:00");

  const summariesOnly = buildTimeline(vault, {
    experimentSlug: "focus",
    kinds: ["sample_summary"],
    streams: ["glucose"],
    includeJournal: false,
    includeEvents: false,
    limit: 0,
  });

  assert.equal(summariesOnly.length, 1);
  assert.equal(summariesOnly[0]?.entryType, "sample_summary");
});

test("buildTimeline breaks sort ties by date then id when timestamps match", () => {
  const vault = createEmptyReadModel();
  const olderDate = createRecord({
    id: "evt_tie_a",
    lookupIds: ["evt_tie_a"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-14T08:00:00Z",
    date: "2026-03-13",
    kind: "note",
    title: "Tie A",
    data: {},
  });
  const laterId = createRecord({
    id: "evt_tie_c",
    lookupIds: ["evt_tie_c"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-14T08:00:00Z",
    date: "2026-03-14",
    kind: "note",
    title: "Tie C",
    data: {},
  });
  const earlierId = createRecord({
    id: "evt_tie_b",
    lookupIds: ["evt_tie_b"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-14T08:00:00Z",
    date: "2026-03-14",
    kind: "note",
    title: "Tie B",
    data: {},
  });

  vault.events = [olderDate, laterId, earlierId];
  vault.records = [olderDate, laterId, earlierId];

  const timeline = buildTimeline(vault, {
    includeJournal: false,
    includeDailySampleSummaries: false,
  });

  assert.deepEqual(
    timeline.map((entry) => entry.id),
    ["evt_tie_b", "evt_tie_c", "evt_tie_a"],
  );
});

test("buildTimeline excludes records outside the requested date and experiment window", () => {
  const vault = createEmptyReadModel();
  const journal = createRecord({
    id: "journal:2026-03-14",
    lookupIds: ["journal:2026-03-14", "2026-03-14"],
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-14.md",
    date: "2026-03-14",
    kind: "journal_day",
    experimentSlug: "other",
    title: "March 14",
    data: {},
    frontmatter: {},
  });
  const event = createRecord({
    id: "evt_outside_window",
    lookupIds: ["evt_outside_window"],
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-14T08:00:00Z",
    date: "2026-03-14",
    kind: "note",
    experimentSlug: "focus",
    title: "Outside window",
    data: {},
  });
  const sample = createSampleRecord({
    id: "smp_outside_window",
    occurredAt: "2026-03-14T09:00:00Z",
    date: "2026-03-14",
    stream: "glucose",
    experimentSlug: "other",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 101,
      unit: "mg_dL",
    },
  });

  vault.journalEntries = [journal];
  vault.events = [event];
  vault.samples = [sample];
  vault.records = [journal, event, sample];

  const timeline = buildTimeline(vault, {
    from: "2026-03-15",
    to: "2026-03-15",
    experimentSlug: "focus",
  });

  assert.deepEqual(timeline, []);
});

async function createFixtureVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-query-"));

  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "bank/family"), { recursive: true });
  await mkdir(path.join(vaultRoot, "bank/genetics"), { recursive: true });
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
    path.join(vaultRoot, "bank/family/mother.md"),
    `---
schemaVersion: hb.frontmatter.family-member.v1
docType: family_member
familyMemberId: fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8
slug: mother
title: Mother
relationship: mother
familyMemberIds:
  - var_should_not_leak_from_wrong_field
updatedAt: 2026-03-12T09:00:00Z
---
# Mother

Tracked for query ordering checks.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/family/father.md"),
    `---
schemaVersion: hb.frontmatter.family-member.v1
docType: family_member
familyMemberId: fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9
slug: father
title: Father
relationship: father
relatedVariantIds:
  - var_01JNW7YJ7MNE7M9Q2QWQK4Z400
updatedAt: 2026-03-10T09:00:00Z
---
# Father

Has a linked canonical variant id.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/genetics/apoe-e4.md"),
    `---
schemaVersion: hb.frontmatter.genetic-variant.v1
docType: genetic_variant
variantId: var_01JNW7YJ7MNE7M9Q2QWQK4Z400
slug: apoe-e4
title: APOE e4 allele
gene: APOE
significance: risk_factor
sourceFamilyMemberIds:
  - fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9
updatedAt: 2026-03-10T10:00:00Z
---
# APOE e4 allele

Older genetics record.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/genetics/mthfr-c677t.md"),
    `---
schemaVersion: hb.frontmatter.genetic-variant.v1
docType: genetic_variant
variantId: var_01JNW7YJ7MNE7M9Q2QWQK4Z401
slug: mthfr-c677t
title: MTHFR C677T
gene: MTHFR
significance: risk_factor
sourceFamilyMemberIds:
  - fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8
updatedAt: 2026-03-12T11:00:00Z
---
# MTHFR C677T

Newer genetics record.
`,
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
    displayId: overrides.id,
    primaryLookupId: overrides.id,
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
  const displayId = overrides.displayId ?? overrides.id;
  const lookupIds = Array.from(
    new Set(
      overrides.lookupIds ??
        [overrides.primaryLookupId ?? displayId, displayId],
    ),
  );
  const primaryLookupId =
    overrides.primaryLookupId ??
    lookupIds.find((lookupId) => lookupId !== displayId) ??
    displayId;

  return {
    displayId,
    primaryLookupId,
    id: displayId,
    lookupIds,
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
