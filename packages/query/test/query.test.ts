import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { test, vi } from "vitest";
import {
  INBOX_DB_RELATIVE_PATH,
  SEARCH_DB_RELATIVE_PATH,
} from "@murphai/runtime-state/node";

import {
  ID_FAMILY_REGISTRY,
  buildOverviewMetrics,
  buildOverviewWeeklyStats,
  buildExportPack,
  createVaultReadModel,
  describeLookupConstraint,
  inferIdEntityKind,
  isQueryableLookupId,
  buildTimeline,
  getExperiment,
  getJournalEntry,
  getSqliteSearchStatus,
  listFamilyMembers,
  listGeneticVariants,
  listExperiments,
  listJournalEntries,
  listRecords,
  lookupRecordById,
  readVault,
  rebuildSqliteSearchIndex,
  searchVault,
  searchVaultSafe,
  searchVaultRuntime,
  summarizeCurrentOverviewProfile,
  summarizeDailySamples,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
} from "../src/index.ts";
import {
  type CanonicalEntity,
  linkTargetIds,
  normalizeCanonicalLinks,
  resolveCanonicalRecordClass,
} from "../src/canonical-entities.ts";
import { projectProfileSnapshotEntity } from "../src/health/projectors/profile.ts";
import { ALL_VAULT_RECORD_TYPES } from "../src/model.ts";
import { profileSnapshotRecordFromEntity } from "../src/health/projections.ts";
import { parseFrontmatterDocument as parseHealthFrontmatterDocument } from "../src/health/shared.ts";
import { parseMarkdownDocument } from "../src/markdown.ts";
import {
  scoreSearchDocuments,
  type SearchableDocument,
} from "../src/search.ts";

const require = createRequire(import.meta.url);

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

test("id-family helpers no longer register the hard-cut legacy colon-prefixed families", () => {
  assert.deepEqual(
    ID_FAMILY_REGISTRY.filter((family) => family.family.endsWith("_legacy")).map(
      (family) => family.family,
    ),
    [],
  );
  assert.equal(isQueryableLookupId("audit:2026-03"), false);
  assert.equal(isQueryableLookupId("event:legacy"), false);
  assert.equal(isQueryableLookupId("experiment:focus"), false);
  assert.equal(isQueryableLookupId("sample:path:12"), false);
  assert.equal(isQueryableLookupId("aud_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("food_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("rcp_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("prov_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(isQueryableLookupId("wfmt_01JNV40W8VFYQ2H7CMJY5A9R4K"), true);
  assert.equal(inferIdEntityKind("food_01JNV40W8VFYQ2H7CMJY5A9R4K"), "food");
  assert.equal(inferIdEntityKind("rcp_01JNV40W8VFYQ2H7CMJY5A9R4K"), "recipe");
  assert.equal(inferIdEntityKind("prov_01JNV40W8VFYQ2H7CMJY5A9R4K"), "provider");
  assert.equal(
    inferIdEntityKind("wfmt_01JNV40W8VFYQ2H7CMJY5A9R4K"),
    "workout_format",
  );
  assert.equal(describeLookupConstraint("food_01JNV40W8VFYQ2H7CMJY5A9R4K"), null);
});

test("readVault collapses append-only event revisions to the latest active current-view record", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-events-"));

  try {
    const eventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1C1";
    const marchShard = path.join(vaultRoot, "ledger/events/2026");
    const aprilShard = path.join(vaultRoot, "ledger/events/2026");
    const mayShard = path.join(vaultRoot, "ledger/events/2026");
    await mkdir(marchShard, { recursive: true });
    await mkdir(aprilShard, { recursive: true });
    await mkdir(mayShard, { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: eventId,
        kind: "note",
        occurredAt: "2026-03-12T08:15:00.000Z",
        recordedAt: "2026-03-12T08:16:00.000Z",
        dayKey: "2026-03-12",
        source: "manual",
        title: "Original note",
        note: "First revision.",
        lifecycle: {
          revision: 1,
        },
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-04.jsonl"),
      [
        {
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-04-02T07:00:00.000Z",
          recordedAt: "2026-04-02T07:05:00.000Z",
          dayKey: "2026-04-02",
          source: "manual",
          title: "Updated note",
          note: "Second revision.",
          lifecycle: {
            revision: 2,
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-04-02T07:00:00.000Z",
          recordedAt: "2026-04-02T07:10:00.000Z",
          dayKey: "2026-04-02",
          source: "manual",
          title: "Updated note",
          note: "Second revision.",
          lifecycle: {
            revision: 3,
            state: "deleted",
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")
        .concat("\n"),
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-05.jsonl"),
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: eventId,
        kind: "note",
        occurredAt: "2026-05-01T09:30:00.000Z",
        recordedAt: "2026-05-01T09:35:00.000Z",
        dayKey: "2026-05-01",
        source: "manual",
        title: "Revived note",
        note: "Latest active revision.",
        lifecycle: {
          revision: 4,
        },
      })}\n`,
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const matchingEvents = listRecords(vault, {
      recordTypes: ["event"],
    }).filter((record) => record.primaryLookupId === eventId);
    const revivedEvent = lookupRecordById(vault, eventId);

    assert.equal(matchingEvents.length, 1);
    assert.equal(revivedEvent?.recordType, "event");
    assert.equal(revivedEvent?.title, "Revived note");
    assert.equal(revivedEvent?.occurredAt, "2026-05-01T09:30:00.000Z");
    assert.deepEqual(revivedEvent?.data.lifecycle, { revision: 4 });
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault ignores malformed event lifecycles instead of promoting them into the current view", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-events-invalid-lifecycle-"));

  try {
    const eventId = "evt_01JQ9R7WF97M1WAB2B4QF2Q1C2";
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });

    await writeFile(
      path.join(vaultRoot, "ledger/events/2026/2026-03.jsonl"),
      [
        {
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-03-12T08:15:00.000Z",
          recordedAt: "2026-03-12T08:16:00.000Z",
          dayKey: "2026-03-12",
          source: "manual",
          title: "Original note",
          note: "Valid revision.",
          lifecycle: {
            revision: 1,
          },
        },
        {
          schemaVersion: "murph.event.v1",
          id: eventId,
          kind: "note",
          occurredAt: "2026-03-13T09:15:00.000Z",
          recordedAt: "2026-03-13T09:16:00.000Z",
          dayKey: "2026-03-13",
          source: "manual",
          title: "Corrupt note",
          note: "Malformed lifecycle should be ignored.",
          lifecycle: {
            revision: 0,
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")
        .concat("\n"),
      "utf8",
    );

    const vault = await readVault(vaultRoot);
    const survivingEvent = lookupRecordById(vault, eventId);

    assert.equal(survivingEvent?.title, "Original note");
    assert.equal(survivingEvent?.occurredAt, "2026-03-12T08:15:00.000Z");
    assert.deepEqual(survivingEvent?.data.lifecycle, { revision: 1 });
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("normalizeCanonicalLinks drops blank targets and dedupes identical pairs", () => {
  const blankFiltered = normalizeCanonicalLinks([
    { type: "related_to", targetId: "" },
    { type: "related_to", targetId: "   " },
    { type: "related_to", targetId: "goal_01" },
  ]);

  assert.deepEqual(blankFiltered, [{ type: "related_to", targetId: "goal_01" }]);
  assert.deepEqual(linkTargetIds(blankFiltered), ["goal_01"]);

  const deduped = normalizeCanonicalLinks([
    { type: "related_to", targetId: "goal_01" },
    { type: "related_to", targetId: "goal_01" },
    { type: "parent_of", targetId: "goal_01" },
  ]);

  assert.deepEqual(deduped, [
    { type: "related_to", targetId: "goal_01" },
    { type: "parent_of", targetId: "goal_01" },
  ]);
  assert.deepEqual(linkTargetIds(deduped), ["goal_01"]);
});

test(
  "readVault assembles a stable read model from contract-shaped markdown and jsonl sources",
  async () => {
    const vaultRoot = await createFixtureVault();

    try {
      const vault = await readVault(vaultRoot);

      assert.equal(vault.format, "murph.query.v1");
      assert.equal(vault.metadata?.vaultId, "vault_01JNV40W8VFYQ2H7CMJY5A9R4K");
      assert.equal(vault.coreDocument?.displayId, "vault_01JNV40W8VFYQ2H7CMJY5A9R4K");
      assert.equal(vault.experiments.length, 1);
      assert.equal(vault.journalEntries.length, 2);
      assert.equal(vault.events.length, 3);
      assert.equal(vault.samples.length, 5);
      assert.equal(vault.audits.length, 1);
      assert.deepEqual(vault.byFamily.core?.map((record) => record.displayId), [
        vault.coreDocument?.displayId,
      ]);
      assert.deepEqual(
        vault.byFamily.experiment?.map((record) => record.displayId),
        vault.experiments.map((record) => record.displayId),
      );
      assert.deepEqual(
        vault.byFamily.journal?.map((record) => record.displayId),
        vault.journalEntries.map((record) => record.displayId),
      );
      assert.deepEqual(
        vault.byFamily.event?.map((record) => record.displayId),
        vault.events.map((record) => record.displayId),
      );
      assert.deepEqual(
        vault.byFamily.sample?.map((record) => record.displayId),
        vault.samples.map((record) => record.displayId),
      );
      assert.deepEqual(
        vault.byFamily.audit?.map((record) => record.displayId),
        vault.audits.map((record) => record.displayId),
      );
      assert.deepEqual(
        vault.byFamily.family?.map((record) => record.displayId),
        vault.records
          .filter((record) => record.recordType === "family")
          .map((record) => record.displayId),
      );
      assert.deepEqual(
        vault.byFamily.genetics?.map((record) => record.displayId),
        vault.records
          .filter((record) => record.recordType === "genetics")
          .map((record) => record.displayId),
      );

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

test("readVault keeps legacy convenience arrays isolated from byFamily buckets", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const vault = await readVault(vaultRoot);

    assert.notStrictEqual(vault.experiments, vault.byFamily.experiment);
    assert.notStrictEqual(vault.events, vault.byFamily.event);

    vault.experiments.pop();
    vault.events.pop();

    assert.equal(vault.experiments.length, 0);
    assert.equal(vault.events.length, 2);
    assert.equal(vault.byFamily.experiment?.length, 1);
    assert.equal(vault.byFamily.event?.length, 3);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

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
        "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
        "var_01JNW7YJ7MNE7M9Q2QWQK4Z400",
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

test("listRecords prefers stored local day keys over UTC-derived dates", () => {
  const vault = createEmptyReadModel();
  const sample = createSampleRecord({
    id: "smp_local_day_01",
    occurredAt: "2026-03-26T21:00:00.000Z",
    date: "2026-03-27",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 94,
      unit: "mg_dL",
    },
  });

  vault.samples = [sample];
  vault.records = [sample];
  syncVaultDerivedFields(vault);

  assert.deepEqual(
    listRecords(vault, {
      from: "2026-03-27",
      to: "2026-03-27",
    }).map((record) => record.displayId),
    ["smp_local_day_01"],
  );
  assert.deepEqual(
    listRecords(vault, {
      from: "2026-03-26",
      to: "2026-03-26",
    }).map((record) => record.displayId),
    [],
  );
});

test("createVaultReadModel keeps manual query fixtures aligned with records and byFamily", () => {
  const vault = createEmptyReadModel();
  const sample = createSampleRecord({
    id: "smp_sync_01",
    occurredAt: "2026-03-27T08:00:00.000Z",
    date: "2026-03-27",
    sourcePath: "ledger/samples/glucose/2026/2026-03.jsonl",
    data: {
      value: 88,
      unit: "mg_dL",
    },
  });

  vault.samples = [sample];

  assert.deepEqual(vault.records.map((record) => record.displayId), ["smp_sync_01"]);
  assert.deepEqual(vault.byFamily.sample?.map((record) => record.displayId), [
    "smp_sync_01",
  ]);
  assert.deepEqual(vault.samples.map((record) => record.displayId), ["smp_sync_01"]);
});

test("createVaultReadModel accepts canonical entities as the authoritative read-model input", () => {
  const entity: CanonicalEntity = {
    entityId: "goal_sleep_01",
    primaryLookupId: "improve-sleep",
    lookupIds: ["goal_sleep_01", "improve-sleep"],
    family: "goal",
    recordClass: "bank",
    kind: "goal",
    status: "active",
    occurredAt: null,
    date: "2026-03-27",
    path: "bank/goals/improve-sleep.md",
    title: "Improve sleep consistency",
    body: "Keep a stable bedtime.",
    attributes: {
      slug: "improve-sleep",
      status: "active",
    },
    frontmatter: {
      slug: "improve-sleep",
      status: "active",
      title: "Improve sleep consistency",
    },
    links: normalizeCanonicalLinks([
      {
        type: "related_to",
        targetId: "cond_sleep_01",
      },
    ]),
    relatedIds: ["cond_sleep_01"],
    stream: null,
    experimentSlug: null,
    tags: ["sleep"],
  };
  const vault = createVaultReadModel({
    vaultRoot: "/tmp/entity-vault",
    metadata: null,
    entities: [entity],
  });

  assert.deepEqual(vault.entities.map((entry) => entry.entityId), ["goal_sleep_01"]);
  assert.deepEqual(vault.records.map((record) => record.displayId), ["goal_sleep_01"]);
  assert.deepEqual(vault.byFamily.goal?.map((record) => record.displayId), ["goal_sleep_01"]);
  assert.deepEqual(vault.goals.map((record) => record.displayId), ["goal_sleep_01"]);
  assert.equal(vault.records[0]?.primaryLookupId, "improve-sleep");
  assert.equal(vault.records[0]?.sourceFile, path.join("/tmp/entity-vault", "bank/goals/improve-sleep.md"));
});

test("createVaultReadModel preserves manual sourceFile values on the VaultRecord compatibility surface", () => {
  const record = createRecord({
    id: "goal_manual_source_01",
    recordType: "goal",
    sourcePath: "bank/goals/manual-source.md",
    sourceFile: "/custom/manual-fixture.md",
    primaryLookupId: "manual-source",
    title: "Manual source fixture",
    data: {},
    frontmatter: {},
  });
  const vault = createVaultReadModel({
    vaultRoot: "/tmp/entity-vault",
    metadata: null,
    records: [record],
  });

  assert.equal(vault.records[0]?.sourceFile, "/custom/manual-fixture.md");
  assert.equal(vault.goals[0]?.sourceFile, "/custom/manual-fixture.md");
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

    assert.equal(pack.format, "murph.export-pack.v1");
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
    assert.match(manifestFile.contents, /"format": "murph.export-pack.v1"/);
    assert.match(manifestFile.contents, /"fileCount": 5/);

    const questionPackFile = pack.files.find((file) =>
      file.path.endsWith("question-pack.json"),
    );
    assert.ok(questionPackFile);
    assert.match(questionPackFile.contents, /"format": "murph.question-pack.v1"/);
    assert.match(questionPackFile.contents, /low-carb experiment/);

    const assistantFile = pack.files.find((file) =>
      file.path.endsWith("assistant-context.md"),
    );
    assert.ok(assistantFile);
    assert.match(assistantFile.contents, /Murph Export Pack/);
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

test("readVault rejects alias-heavy fixtures once query reads go canonical-only", async () => {
  const vaultRoot = await createSparseVault();

  try {
    await assert.rejects(
      () => readVault(vaultRoot),
      /Missing canonical "experimentId" in experiment frontmatter at bank\/experiments\/recovery-plan\.md\./u,
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
      family.map((record) => record.entity.id),
      [
        "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
        "fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      ],
    );
    assert.equal(family[1]?.entity.title, "Mother");
    assert.equal(family[1]?.entity.relationship, "mother");
    assert.equal(family[1]?.entity.note, null);
    assert.deepEqual(family[0]?.entity.relatedVariantIds, ["var_01JNW7YJ7MNE7M9Q2QWQK4Z400"]);
    assert.deepEqual(family[1]?.entity.relatedVariantIds, []);

    assert.deepEqual(
      genetics.map((record) => record.entity.id),
      [
        "var_01JNW7YJ7MNE7M9Q2QWQK4Z400",
        "var_01JNW7YJ7MNE7M9Q2QWQK4Z401",
      ],
    );
    assert.equal(genetics[0]?.entity.title, "APOE e4 allele");
    assert.deepEqual(genetics[1]?.entity.sourceFamilyMemberIds, ["fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"]);
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
  syncVaultDerivedFields(vault);

  const summaries = summarizeDailySamples(vault, {
    from: "2026-03-10",
    to: "2026-03-10",
    streams: ["glucose"],
    experimentSlug: "recovery-plan",
  });

  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries[0]?.sampleIds, [
    "smp_filter_03",
  ]);
  assert.deepEqual(summaries[0]?.sourcePaths, [
    "ledger/samples/glucose/2026/2026-03.jsonl",
  ]);
  assert.deepEqual(summaries[0]?.units, ["mg_dL"]);
  assert.equal(summaries[0]?.unit, "mg_dL");
  assert.equal(summaries[0]?.minValue, 92);
  assert.equal(summaries[0]?.maxValue, 92);
  assert.equal(summaries[0]?.averageValue, 92);
  assert.equal(summaries[0]?.firstSampleAt, "2026-03-10T08:00:00Z");
  assert.equal(summaries[0]?.lastSampleAt, "2026-03-10T08:00:00Z");
  assert.deepEqual(summaries[1]?.sampleIds, [
    "smp_filter_04",
    "smp_filter_05",
  ]);
  assert.deepEqual(summaries[1]?.sourcePaths, [
    "ledger/samples/glucose/2026/2026-03-b.jsonl",
    "ledger/samples/glucose/2026/2026-03.jsonl",
  ]);
  assert.deepEqual(summaries[1]?.units, ["mmol/L"]);
  assert.equal(summaries[1]?.unit, "mmol/L");
  assert.equal(summaries[1]?.minValue, 98);
  assert.equal(summaries[1]?.maxValue, 98);
  assert.equal(summaries[1]?.averageValue, 98);
  assert.equal(summaries[1]?.firstSampleAt, "2026-03-10T12:00:00Z");
  assert.equal(summaries[1]?.lastSampleAt, "2026-03-10T18:00:00Z");
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
  syncVaultDerivedFields(vault);

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
  syncVaultDerivedFields(vault);

  assert.equal(lookupRecordById(vault, "unknown-id"), null);
  assert.equal(getExperiment(vault, "missing"), null);
  assert.equal(getJournalEntry(vault, "2026-03-13"), null);
  assert.deepEqual(listExperiments(vault, { slug: "missing" }), []);
  assert.deepEqual(listJournalEntries(vault, { from: "2026-03-13" }), []);
  assert.deepEqual(listRecords(vault, { streams: ["glucose"] }), []);
  assert.deepEqual(listRecords(vault, { from: "2026-03-10" }).map((record) => record.displayId), [
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
  syncVaultDerivedFields(vault);

  const result = searchVault(vault, "afternoon crash pasta", {
    limit: 10,
  });

  assert.equal(result.format, "murph.search.v1");
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
  syncVaultDerivedFields(vault);

  const result = searchVault(vault, "glucose spike", {
    streams: ["glucose"],
  });

  assert.equal(result.total, 1);
  assert.equal(result.hits[0]?.recordId, "smp_glucose_01");
  assert.equal(result.hits[0]?.recordType, "sample");
  assert.equal(result.hits[0]?.stream, "glucose");
});

test("overview selectors move cleanly onto the query read model", () => {
  const vault = createEmptyReadModel();
  const goal = createRecord({
    id: "goal_sleep_01",
    recordType: "goal",
    sourcePath: "bank/goals/protect-sleep.md",
    title: "Protect sleep consistency",
  });
  const currentProfile = createRecord({
    id: "profile_current_01",
    recordType: "current_profile",
    sourcePath: "bank/profile/current.md",
    occurredAt: "2026-03-12T14:00:00Z",
    title: "Current Profile",
    body: "# Current Profile\n- Sleep steadier and the evening routine is holding.",
    data: {},
  });
  const latestSnapshot = createRecord({
    id: "psnap_01",
    recordType: "profile_snapshot",
    sourcePath: "ledger/profile-snapshots/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T13:55:00Z",
    data: {
      profile: {
        goals: {
          topGoalIds: ["goal_sleep_01"],
        },
      },
    },
  });
  const journalNewer = createRecord({
    id: "journal:2026-03-12",
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-12.md",
    date: "2026-03-12",
    title: "March 12",
    tags: ["recovery"],
    body: "# March 12\nSteadier sleep after the lighter dinner.",
  });
  const journalOlder = createRecord({
    id: "journal:2026-03-10",
    recordType: "journal",
    sourcePath: "journal/2026/2026-03-10.md",
    date: "2026-03-10",
    title: "March 10",
    body: "Earlier note.",
  });
  const activeExperiment = createRecord({
    id: "exp_sleep_reset_01",
    recordType: "experiment",
    sourcePath: "bank/experiments/sleep-reset.md",
    occurredAt: "2026-03-01T00:00:00Z",
    date: "2026-03-01",
    experimentSlug: "sleep-reset",
    title: "Sleep Reset",
    status: "active",
    tags: ["sleep"],
    body: "# Sleep Reset\nTracking sleep consistency.",
  });
  const completedExperiment = createRecord({
    id: "exp_completed_01",
    recordType: "experiment",
    sourcePath: "bank/experiments/completed.md",
    occurredAt: "2026-03-15T00:00:00Z",
    date: "2026-03-15",
    experimentSlug: "completed",
    title: "Completed Trial",
    status: "completed",
    body: "Finished and documented.",
  });

  vault.currentProfile = currentProfile;
  vault.profileSnapshots = [latestSnapshot];
  vault.goals = [goal];
  vault.journalEntries = [journalOlder, journalNewer];
  vault.experiments = [completedExperiment, activeExperiment];
  vault.records = [
    goal,
    currentProfile,
    latestSnapshot,
    journalOlder,
    journalNewer,
    completedExperiment,
    activeExperiment,
  ];
  syncVaultDerivedFields(vault);

  assert.deepEqual(
    buildOverviewMetrics(vault).map((metric) => [metric.label, metric.value]),
    [
      ["records", 7],
      ["events", 0],
      ["samples", 0],
      ["journal days", 2],
      ["experiments", 2],
      ["registries", 1],
    ],
  );
  assert.deepEqual(summarizeCurrentOverviewProfile(vault), {
    id: "profile_current_01",
    recordedAt: "2026-03-12T14:00:00Z",
    summary: "Sleep steadier and the evening routine is holding.",
    title: "Current Profile",
    topGoals: [
      {
        id: "goal_sleep_01",
        title: "Protect sleep consistency",
      },
    ],
  });
  assert.deepEqual(
    summarizeRecentOverviewJournals(vault).map((entry) => ({
      date: entry.date,
      summary: entry.summary,
      title: entry.title,
    })),
    [
      {
        date: "2026-03-12",
        summary: "Steadier sleep after the lighter dinner.",
        title: "March 12",
      },
      {
        date: "2026-03-10",
        summary: "Earlier note.",
        title: "March 10",
      },
    ],
  );
  assert.deepEqual(
    summarizeOverviewExperiments(vault).map((entry) => ({
      status: entry.status,
      title: entry.title,
    })),
    [
      {
        status: "active",
        title: "Sleep Reset",
      },
      {
        status: "completed",
        title: "Completed Trial",
      },
    ],
  );
});

test("profile snapshot query projections keep nested typed summary fields", () => {
  const entity = projectProfileSnapshotEntity(
    {
      id: "psnap_01",
      recordedAt: "2026-03-12T13:55:00Z",
      source: "manual",
      profile: {
        narrative: {
          summary: "Sleep steadier and the evening routine is holding.",
        },
        goals: {
          topGoalIds: ["goal_sleep_01"],
        },
      },
    },
    "ledger/profile-snapshots/2026/2026-03.jsonl",
  );

  assert.ok(entity);
  assert.equal(entity.title, "Sleep steadier and the evening routine is holding.");
  assert.equal(entity.body, "Sleep steadier and the evening routine is holding.");
  assert.equal(
    profileSnapshotRecordFromEntity(entity)?.summary,
    "Sleep steadier and the evening routine is holding.",
  );
});

test("buildOverviewWeeklyStats keeps same-stream units separate across timezone week windows", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-23T23:30:00.000Z"));

  try {
    const vault = createEmptyReadModel();
    const currentHours = createSampleRecord({
      id: "smp_sleep_hours_current",
      occurredAt: "2026-03-23T21:00:00.000Z",
      date: "2026-03-24",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 8,
        unit: "hrs",
      },
    });
    const currentMinutes = createSampleRecord({
      id: "smp_sleep_minutes_current",
      occurredAt: "2026-03-23T22:00:00.000Z",
      date: "2026-03-24",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 480,
        unit: "min",
      },
    });
    const previousHours = createSampleRecord({
      id: "smp_sleep_hours_previous",
      occurredAt: "2026-03-16T21:00:00.000Z",
      date: "2026-03-17",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 7,
        unit: "hrs",
      },
    });
    const previousMinutes = createSampleRecord({
      id: "smp_sleep_minutes_previous",
      occurredAt: "2026-03-16T22:00:00.000Z",
      date: "2026-03-17",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 420,
        unit: "min",
      },
    });

    vault.samples = [
      currentHours,
      currentMinutes,
      previousHours,
      previousMinutes,
    ];
    syncVaultDerivedFields(vault);

    assert.deepEqual(buildOverviewWeeklyStats(vault, "Australia/Melbourne"), [
      {
        currentWeekAvg: 8,
        deltaPercent: ((8 - 7) / 7) * 100,
        previousWeekAvg: 7,
        stream: "sleep",
        unit: "hrs",
      },
      {
        currentWeekAvg: 480,
        deltaPercent: ((480 - 420) / 420) * 100,
        previousWeekAvg: 420,
        stream: "sleep",
        unit: "min",
      },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("buildOverviewWeeklyStats returns null delta when previous week avg is zero", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-23T23:30:00.000Z"));

  try {
    const vault = createEmptyReadModel();
    const currentWeek = createSampleRecord({
      id: "smp_sleep_hours_current_nonzero",
      occurredAt: "2026-03-23T21:00:00.000Z",
      date: "2026-03-24",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 8,
        unit: "hrs",
      },
    });
    const previousWeek = createSampleRecord({
      id: "smp_sleep_hours_previous_zero",
      occurredAt: "2026-03-16T21:00:00.000Z",
      date: "2026-03-17",
      stream: "sleep",
      sourcePath: "ledger/samples/sleep/2026/2026-03.jsonl",
      data: {
        value: 0,
        unit: "hrs",
      },
    });

    vault.samples = [currentWeek, previousWeek];
    syncVaultDerivedFields(vault);

    assert.deepEqual(buildOverviewWeeklyStats(vault, "Australia/Melbourne"), [
      {
        currentWeekAvg: 8,
        deltaPercent: null,
        previousWeekAvg: 0,
        stream: "sleep",
        unit: "hrs",
      },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("searchVaultSafe omits raw path terms and path fields by construction", () => {
  const vault = createEmptyReadModel();
  const pathOnly = createRecord({
    id: "evt_quiet_probe",
    recordType: "event",
    sourcePath: "bank/experiments/path-only-token-probe.md",
    occurredAt: "2026-03-12T09:00:00Z",
    date: "2026-03-12",
    kind: "note",
    title: "Quiet Probe",
    body: "Ordinary notes without the filename token.",
    data: {
      documentPath: "raw/documents/path-only-token-probe.pdf",
    },
  });
  const visible = createRecord({
    id: "evt_recovery_probe",
    recordType: "event",
    sourcePath: "ledger/events/2026/2026-03.jsonl",
    occurredAt: "2026-03-12T10:00:00Z",
    date: "2026-03-12",
    kind: "note",
    title: "Recovery Probe",
    body: "Post-run sleep steadier after stretching.",
  });

  vault.events = [pathOnly, visible];
  vault.records = [pathOnly, visible];
  syncVaultDerivedFields(vault);

  const fullSearch = searchVault(vault, "path-only-token-probe", {
    includeSamples: true,
  });
  const safePathSearch = searchVaultSafe(vault, "path-only-token-probe", {
    includeSamples: true,
  });
  const safeBodySearch = searchVaultSafe(vault, "post-run", {
    includeSamples: true,
  });

  assert.equal(fullSearch.total, 1);
  assert.equal(safePathSearch.total, 0);
  assert.equal(safeBodySearch.total, 1);
  assert.equal(safeBodySearch.hits[0]?.recordId, "evt_recovery_probe");
  assert.equal("path" in (safeBodySearch.hits[0] ?? {}), false);
  assert.equal("citation" in (safeBodySearch.hits[0] ?? {}), false);
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
  syncVaultDerivedFields(vault);

  const timeline = buildTimeline(vault, {
    from: "2026-03-12",
    to: "2026-03-12",
  });

  assert.deepEqual(
    timeline.map((entry) => [entry.entryType, entry.id]),
    [
      ["sample_summary", "sample-summary:2026-03-12:heart_rate:bpm"],
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
  syncVaultDerivedFields(vault);

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
  syncVaultDerivedFields(vault);

  const result = searchVault(vault, "caffeine");

  assert.deepEqual(
    result.hits.map((hit) => hit.recordId),
    ["evt_caffeine_new", "evt_caffeine_old"],
  );
  assert.match(result.hits[0]?.snippet ?? "", /^\.\.\..+\.\.\.$/);
});

test("scoreSearchDocuments preserves shared hyphenated, Unicode, and one-character token behavior", () => {
  const documents: SearchableDocument[] = [
    {
      aliasIds: [],
      bodyText: "Post-run recovery note.",
      date: "2026-03-12",
      experimentSlug: null,
      kind: "note",
      occurredAt: "2026-03-12T09:00:00Z",
      recordId: "evt_post_run",
      recordType: "event",
      stream: null,
      structuredText: "",
      tags: [],
      tagsText: "",
      title: "Recovery note",
      titleText: "Recovery note",
    },
    {
      aliasIds: [],
      bodyText: "Post run recovery note.",
      date: "2026-03-11",
      experimentSlug: null,
      kind: "note",
      occurredAt: "2026-03-11T09:00:00Z",
      recordId: "evt_post_run_split",
      recordType: "event",
      stream: null,
      structuredText: "",
      tags: [],
      tagsText: "",
      title: "Recovery note",
      titleText: "Recovery note",
    },
    {
      aliasIds: [],
      bodyText: "睡眠 quality improved after the walk.",
      date: "2026-03-13",
      experimentSlug: null,
      kind: "note",
      occurredAt: "2026-03-13T09:00:00Z",
      recordId: "evt_unicode",
      recordType: "event",
      stream: null,
      structuredText: "",
      tags: [],
      tagsText: "",
      title: "Unicode note",
      titleText: "Unicode note",
    },
  ];

  const hyphenated = scoreSearchDocuments(documents, "post-run", {
    includeSamples: true,
    limit: 10,
  });
  assert.deepEqual(hyphenated.hits.map((hit) => hit.recordId), ["evt_post_run"]);
  assert.equal(hyphenated.hits[0]?.path, "");
  assert.match(hyphenated.hits[0]?.snippet ?? "", /post-run/i);

  const unicode = scoreSearchDocuments(documents, "睡眠", {
    includeSamples: true,
    limit: 10,
  });
  assert.deepEqual(unicode.hits.map((hit) => hit.recordId), ["evt_unicode"]);
  assert.deepEqual(unicode.hits[0]?.matchedTerms, ["睡眠"]);

  const oneCharacter = scoreSearchDocuments(documents, "a", {
    includeSamples: true,
    limit: 10,
  });
  assert.equal(oneCharacter.total, 0);
  assert.deepEqual(oneCharacter.hits, []);
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
  syncVaultDerivedFields(vault);

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
      ["sample_summary", "sample-summary:2026-03-13:glucose:mg_dL"],
      ["journal", "journal:2026-03-13"],
      ["event", "evt_focus"],
    ],
  );
  assert.equal(timeline[0]?.occurredAt, "2026-03-13T23:59:59Z");
  assert.equal(timeline[1]?.kind, "journal_day");
  assert.equal(timeline[2]?.occurredAt, "2026-03-13T00:00:00Z");

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
  syncVaultDerivedFields(vault);

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
  syncVaultDerivedFields(vault);

  const timeline = buildTimeline(vault, {
    from: "2026-03-15",
    to: "2026-03-15",
    experimentSlug: "focus",
  });

  assert.deepEqual(timeline, []);
});

async function createFixtureVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-"));

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
        schemaVersion: "murph.vault.v1",
        vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
        createdAt: "2026-03-10T06:00:00Z",
        title: "Murph Vault",
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
schemaVersion: murph.frontmatter.family-member.v1
docType: family_member
familyMemberId: fam_01JNW7YJ7MNE7M9Q2QWQK4Z3F8
slug: mother
title: Mother
name: Alias Mother
relationship: mother
relation: alias-mother
familyMemberIds:
  - var_should_not_leak_from_wrong_field
summary: Alias summary that should not leak
updatedAt: 2026-03-12T09:00:00Z
---
# Mother

Tracked for query ordering checks.
`,
  );

  await writeFile(
    path.join(vaultRoot, "bank/family/father.md"),
    `---
schemaVersion: murph.frontmatter.family-member.v1
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
schemaVersion: murph.frontmatter.genetic-variant.v1
docType: genetic_variant
variantId: var_01JNW7YJ7MNE7M9Q2QWQK4Z400
slug: apoe-e4
title: APOE e4 allele
label: Alias APOE label
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
schemaVersion: murph.frontmatter.genetic-variant.v1
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
schemaVersion: murph.frontmatter.core.v1
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
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01JNV4EXP000000000000001
slug: low-carb
status: active
title: Low Carb Trial
startedOn: 2026-03-01
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
schemaVersion: murph.frontmatter.journal-day.v1
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
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-11
eventIds:
  - evt_01JNV4NOTE000000000000001
sampleStreams:
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
        schemaVersion: "murph.event.v1",
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
        schemaVersion: "murph.event.v1",
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
        schemaVersion: "murph.event.v1",
        id: "evt_01JNV4DOC000000000000001",
        kind: "document",
        occurredAt: "2026-03-12T14:00:00Z",
        recordedAt: "2026-03-12T14:02:00Z",
        dayKey: "2026-03-12",
        source: "import",
        title: "Lab report",
        relatedIds: ["doc_01JNV4DOC0000000000000001"],
        documentId: "doc_01JNV4DOC0000000000000001",
        documentPath:
          "raw/documents/2026/03/doc_01JNV4DOC0000000000000001/lab-report.pdf",
        mimeType: "application/pdf",
      }),
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(vaultRoot, "ledger/samples/glucose/2026/2026-03.jsonl"),
    [
      JSON.stringify({
        schemaVersion: "murph.sample.v1",
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
        schemaVersion: "murph.sample.v1",
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
        schemaVersion: "murph.sample.v1",
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
        schemaVersion: "murph.sample.v1",
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
        schemaVersion: "murph.sample.v1",
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
        schemaVersion: "murph.audit.v1",
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
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-sparse-"));

  await mkdir(path.join(vaultRoot, "bank/experiments"), { recursive: true });
  await mkdir(path.join(vaultRoot, "journal/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
  await mkdir(path.join(vaultRoot, "ledger/samples/glucose/2026"), { recursive: true });

  await writeFile(
    path.join(vaultRoot, "bank/experiments/recovery-plan.md"),
    `---
schemaVersion: murph.frontmatter.experiment.v1
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
schemaVersion: murph.frontmatter.journal-day.v1
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
      schemaVersion: "murph.event.v1",
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
      schemaVersion: "murph.sample.v1",
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
  return createReadModelFromRecords([]);
}

function createReadModelFromRecords(
  records: Awaited<ReturnType<typeof readVault>>["records"],
): Awaited<ReturnType<typeof readVault>> {
  return createVaultReadModel({
    vaultRoot: "/tmp/empty-vault",
    metadata: null,
    records,
  });
}

function syncVaultDerivedFields(vault: Awaited<ReturnType<typeof readVault>>): void {
  vault.records = vault.records.length > 0 ? vault.records.slice() : collectVaultRecords(vault);
}

function collectVaultRecords(
  vault: Awaited<ReturnType<typeof readVault>>,
): Awaited<ReturnType<typeof readVault>>["records"] {
  return ALL_VAULT_RECORD_TYPES.flatMap(
    (recordType) => vault.byFamily[recordType]?.slice() ?? [],
  );
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
  const links = normalizeCanonicalLinks([]);

  return {
    displayId: overrides.id,
    primaryLookupId: overrides.id,
    lookupIds: [overrides.id],
    recordType: "sample",
    recordClass: "sample",
    sourcePath: overrides.sourcePath,
    sourceFile: path.join("/tmp", overrides.id),
    occurredAt,
    date: overrides.date ?? (occurredAt ? occurredAt.split("T", 1)[0] ?? null : null),
    kind: "sample",
    stream: overrides.stream ?? "glucose",
    experimentSlug: overrides.experimentSlug ?? null,
    title: "sample",
    tags: [],
    data: overrides.data,
    body: null,
    frontmatter: null,
    links,
    relatedIds: linkTargetIds(links),
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
  const links = normalizeCanonicalLinks(
    (overrides.relatedIds ?? []).map((targetId) => ({
      type: "related_to" as const,
      targetId,
    })),
  );

  return {
    displayId,
    primaryLookupId,
    lookupIds,
    recordType: overrides.recordType,
    recordClass:
      overrides.recordClass ?? resolveCanonicalRecordClass(overrides.recordType),
    sourcePath: overrides.sourcePath,
    sourceFile: overrides.sourceFile ?? path.join("/tmp", overrides.id),
    occurredAt: overrides.occurredAt ?? null,
    date: overrides.date ?? null,
    kind: overrides.kind ?? overrides.recordType,
    status: overrides.status ?? null,
    stream: overrides.stream ?? null,
    experimentSlug: overrides.experimentSlug ?? null,
    title: overrides.title ?? null,
    tags: overrides.tags ?? [],
    data: overrides.data ?? {},
    body: overrides.body ?? null,
    frontmatter: overrides.frontmatter ?? null,
    links,
    relatedIds: overrides.relatedIds ?? linkTargetIds(links),
  };
}

test("rebuildSqliteSearchIndex only materializes non-sample documents and search index status stays read-only when absent", async () => {
  const vaultRoot = await createFixtureVault();
  const runtimeDatabasePath = path.join(vaultRoot, SEARCH_DB_RELATIVE_PATH);

  try {
    assert.equal(existsSync(runtimeDatabasePath), false);

    const statusBefore = getSqliteSearchStatus(vaultRoot);
    assert.equal(statusBefore.exists, false);
    assert.equal(statusBefore.dbPath, SEARCH_DB_RELATIVE_PATH);
    assert.equal(existsSync(runtimeDatabasePath), false);

    const vault = await readVault(vaultRoot);
    const expectedDocumentCount = vault.records.filter(
      (record) => record.recordType !== "sample",
    ).length;

    const rebuilt = await rebuildSqliteSearchIndex(vaultRoot);
    assert.equal(rebuilt.backend, "sqlite");
    assert.equal(rebuilt.exists, true);
    assert.equal(rebuilt.dbPath, SEARCH_DB_RELATIVE_PATH);
    assert.equal(rebuilt.schemaVersion, "murph.search.v1");
    assert.equal(rebuilt.documentCount, expectedDocumentCount);
    assert.equal(existsSync(runtimeDatabasePath), true);

    const statusAfter = getSqliteSearchStatus(vaultRoot);
    assert.equal(statusAfter.exists, true);
    assert.equal(statusAfter.documentCount, expectedDocumentCount);
    assert.equal(statusAfter.schemaVersion, rebuilt.schemaVersion);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("searchVaultRuntime auto falls back to scan and sqlite merges sample rows only when explicitly requested", async () => {
  const vaultRoot = await createFixtureVault();

  try {
    const scanFallback = await searchVaultRuntime(vaultRoot, "lab report", {
      recordTypes: ["event"],
      kinds: ["document"],
    });

    assert.equal(scanFallback.total, 1);
    assert.equal(scanFallback.hits[0]?.recordId, "doc_01JNV4DOC0000000000000001");

    await rebuildSqliteSearchIndex(vaultRoot);

    const sqliteResult = await searchVaultRuntime(
      vaultRoot,
      "lab report",
      {
        recordTypes: ["event"],
        kinds: ["document"],
      },
      { backend: "sqlite" },
    );

    assert.equal(sqliteResult.total, 1);
    assert.equal(sqliteResult.hits[0]?.recordId, "doc_01JNV4DOC0000000000000001");
    assert.match(sqliteResult.hits[0]?.snippet ?? "", /lab report/i);

    const sqliteSampleResult = await searchVaultRuntime(
      vaultRoot,
      "heart_rate",
      {
        streams: ["heart_rate"],
      },
      { backend: "sqlite" },
    );

    assert.equal(
      sqliteSampleResult.hits.some(
        (hit) => hit.recordType === "sample" && hit.stream === "heart_rate",
      ),
      true,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("getSqliteSearchStatus ignores a copied inbox search db until rebuild restores the canonical search db", async () => {
  const vaultRoot = await createFixtureVault();
  const searchDatabasePath = path.join(vaultRoot, SEARCH_DB_RELATIVE_PATH);
  const legacyDatabasePath = path.join(vaultRoot, INBOX_DB_RELATIVE_PATH);

  try {
    await rebuildSqliteSearchIndex(vaultRoot);
    await mkdir(path.dirname(legacyDatabasePath), { recursive: true });
    await copyFile(searchDatabasePath, legacyDatabasePath);
    await rm(searchDatabasePath, { force: true });

    const legacyStatus = getSqliteSearchStatus(vaultRoot);
    assert.equal(legacyStatus.exists, false);
    assert.equal(legacyStatus.dbPath, SEARCH_DB_RELATIVE_PATH);

    await assert.rejects(
      () =>
        searchVaultRuntime(
          vaultRoot,
          "lab report",
          {
            recordTypes: ["event"],
            kinds: ["document"],
          },
          { backend: "sqlite" },
        ),
      /index rebuild|--backend scan/u,
    );

    const rebuilt = await rebuildSqliteSearchIndex(vaultRoot);
    assert.equal(rebuilt.dbPath, SEARCH_DB_RELATIVE_PATH);
    assert.equal(existsSync(searchDatabasePath), true);

    const statusAfterRebuild = getSqliteSearchStatus(vaultRoot);
    assert.equal(statusAfterRebuild.exists, true);
    assert.equal(statusAfterRebuild.dbPath, SEARCH_DB_RELATIVE_PATH);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("getSqliteSearchStatus ignores an inbox runtime copy when the canonical search db exists", async () => {
  const vaultRoot = await createFixtureVault();
  const searchDatabasePath = path.join(vaultRoot, SEARCH_DB_RELATIVE_PATH);
  const legacyDatabasePath = path.join(vaultRoot, INBOX_DB_RELATIVE_PATH);
  const journalPath = path.join(vaultRoot, "journal/2026/2026-03-10.md");

  try {
    await rebuildSqliteSearchIndex(vaultRoot);
    await mkdir(path.dirname(legacyDatabasePath), { recursive: true });
    await copyFile(searchDatabasePath, legacyDatabasePath);

    await writeFile(
      journalPath,
      `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-10
title: March 10
tags:
  - energy
---
# March 10

Saffron tea replaced the usual afternoon coffee.
`,
      "utf8",
    );
    await rebuildSqliteSearchIndex(vaultRoot);

    const status = getSqliteSearchStatus(vaultRoot);
    assert.equal(status.exists, true);
    assert.equal(status.dbPath, SEARCH_DB_RELATIVE_PATH);

    const sqliteResult = await searchVaultRuntime(
      vaultRoot,
      "saffron",
      {},
      { backend: "sqlite" },
    );

    assert.equal(sqliteResult.total, 1);
    assert.equal(sqliteResult.hits[0]?.recordId, "journal:2026-03-10");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("getSqliteSearchStatus stays false against a pre-existing inbox runtime db without search tables and sqlite backend errors with rebuild guidance", async () => {
  const vaultRoot = await createFixtureVault();
  const runtimeRoot = path.join(vaultRoot, ".runtime");
  const runtimeDatabasePath = path.join(runtimeRoot, "inboxd.sqlite");

  await mkdir(runtimeRoot, { recursive: true });
  const database = openDatabaseSync(runtimeDatabasePath);
  database.exec("CREATE TABLE inbox_state (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
  database.close();

  try {
    const status = getSqliteSearchStatus(vaultRoot);
    assert.equal(status.exists, false);
    assert.equal(status.dbPath, SEARCH_DB_RELATIVE_PATH);

    const schemaDatabase = openDatabaseSync(runtimeDatabasePath, { readOnly: true });
    const tableNames = schemaDatabase
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name LIKE 'murph_search_%'
        ORDER BY name ASC
      `)
      .all() as Array<{ name: string }>;
    schemaDatabase.close();

    assert.deepEqual(tableNames, []);

    await assert.rejects(
      () =>
        searchVaultRuntime(
          vaultRoot,
          "labcorp",
          { recordTypes: ["event"] },
          { backend: "sqlite" },
        ),
      /index rebuild|--backend scan/u,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("rebuildSqliteSearchIndex leaves a pre-existing inbox runtime db untouched and writes search tables to search.sqlite", async () => {
  const vaultRoot = await createFixtureVault();
  const runtimeRoot = path.join(vaultRoot, ".runtime");
  const runtimeDatabasePath = path.join(runtimeRoot, "inboxd.sqlite");
  const searchDatabasePath = path.join(vaultRoot, SEARCH_DB_RELATIVE_PATH);

  await mkdir(runtimeRoot, { recursive: true });
  const inboxDatabase = openDatabaseSync(runtimeDatabasePath);
  inboxDatabase.exec("CREATE TABLE inbox_state (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
  inboxDatabase
    .prepare("INSERT INTO inbox_state (id, value) VALUES (?, ?)")
    .run("cursor", "{\"offset\":1}");
  inboxDatabase.close();

  try {
    const rebuilt = await rebuildSqliteSearchIndex(vaultRoot);
    assert.equal(rebuilt.dbPath, SEARCH_DB_RELATIVE_PATH);
    assert.equal(existsSync(searchDatabasePath), true);

    const searchDatabase = openDatabaseSync(searchDatabasePath, { readOnly: true });
    const searchTables = searchDatabase
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name LIKE 'murph_search_%'
        ORDER BY name ASC
      `)
      .all() as Array<{ name: string }>;
    searchDatabase.close();

    assert.equal(searchTables.some((table) => table.name === "murph_search_document"), true);
    assert.equal(searchTables.some((table) => table.name === "murph_search_meta"), true);
    assert.equal(searchTables.some((table) => table.name === "murph_search_fts"), true);

    const inboxStateDatabase = openDatabaseSync(runtimeDatabasePath, { readOnly: true });
    const inboxState = inboxStateDatabase
      .prepare("SELECT value FROM inbox_state WHERE id = ?")
      .get("cursor") as { value: string } | undefined;
    const inboxSearchTables = inboxStateDatabase
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name LIKE 'murph_search_%'
        ORDER BY name ASC
      `)
      .all() as Array<{ name: string }>;
    inboxStateDatabase.close();

    assert.equal(inboxState?.value, "{\"offset\":1}");
    assert.deepEqual(inboxSearchTables, []);

    const sqliteResult = await searchVaultRuntime(
      vaultRoot,
      "lab report",
      {
        recordTypes: ["event"],
        kinds: ["document"],
      },
      { backend: "sqlite" },
    );

    assert.equal(sqliteResult.total, 1);
    assert.equal(sqliteResult.hits[0]?.recordId, "doc_01JNV4DOC0000000000000001");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("searchVaultRuntime auto switches from scan results to stale sqlite state after rebuild", async () => {
  const vaultRoot = await createFixtureVault();
  const journalPath = path.join(vaultRoot, "journal/2026/2026-03-10.md");

  try {
    await writeFile(
      journalPath,
      `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-10
title: March 10
tags:
  - focus
  - hydration
eventIds:
  - evt_01JNV4MEAL000000000000001
  - evt_01JNV4DOC000000000000001
sampleStreams:
  - glucose
  - heart_rate
---
Steady energy after electrolyte drink.
`,
    );

    const autoBeforeRebuild = await searchVaultRuntime(
      vaultRoot,
      "electrolyte",
      { recordTypes: ["journal"] },
      { backend: "auto" },
    );
    assert.equal(autoBeforeRebuild.hits[0]?.recordId, "journal:2026-03-10");

    await rebuildSqliteSearchIndex(vaultRoot);

    await writeFile(
      journalPath,
      `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-10
title: March 10
tags:
  - focus
  - hydration
eventIds:
  - evt_01JNV4MEAL000000000000001
  - evt_01JNV4DOC000000000000001
sampleStreams:
  - glucose
  - heart_rate
---
Steady energy after saffron tea.
`,
    );

    const autoAfterRebuild = await searchVaultRuntime(
      vaultRoot,
      "saffron",
      { recordTypes: ["journal"] },
      { backend: "auto" },
    );
    const scanAfterRebuild = await searchVaultRuntime(
      vaultRoot,
      "saffron",
      { recordTypes: ["journal"] },
      { backend: "scan" },
    );

    assert.equal(autoAfterRebuild.total, 0);
    assert.equal(scanAfterRebuild.hits[0]?.recordId, "journal:2026-03-10");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

function openDatabaseSync(
  databasePath: string,
  options?: ConstructorParameters<typeof import("node:sqlite").DatabaseSync>[1],
): DatabaseSync {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(databasePath, options ?? {});
}
