import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test, vi } from "vitest";

import { type CanonicalEntity, resolveCanonicalRecordClass } from "../src/canonical-entities.ts";
import { buildExportPack } from "../src/export-pack.ts";
import {
  listAssessments,
  readAssessment,
  showAssessment,
} from "../src/health/assessments.ts";
import {
  collectCanonicalEntities,
} from "../src/health/canonical-collector.ts";
import {
  compareByOccurredAtDescThenId,
  compareByRecordedOrImportedAtDescThenId,
} from "../src/health/comparators.ts";
import {
  readJsonlEntitiesStrict,
  readJsonlEntitiesStrictSync,
  readJsonlEntitiesTolerant,
  readJsonlEntitiesTolerantSync,
} from "../src/health/entity-slices.ts";
import {
  readHealthLibraryGraph,
  readHealthLibraryGraphWithIssues,
} from "../src/health-library.ts";
import {
  readJsonlRecordOutcomes,
  readJsonlRecordOutcomesSync,
  readJsonlRecords,
  readJsonlRecordsSync,
  readMarkdownDocument,
  readMarkdownDocumentOutcome,
  readMarkdownDocumentOutcomeSync,
  readMarkdownDocumentSync,
  readOptionalMarkdownDocument,
  readOptionalMarkdownDocumentOutcome,
  readOptionalMarkdownDocumentOutcomeSync,
  walkRelativeFiles,
  walkRelativeFilesSync,
} from "../src/health/loaders.ts";
import {
  projectAssessmentEntity,
} from "../src/health/projectors/assessment.ts";
import {
  collapseEventLedgerEntities,
  projectHistoryEntity,
} from "../src/health/projectors/history.ts";
import {
  assessmentRecordFromEntity,
  compareAssessments,
  selectAssessmentRecords,
  toAssessmentRecord,
} from "../src/health/projections.ts";
import {
  readSupplement,
  listSupplementCompounds,
  listSupplements,
  showSupplement,
  showSupplementCompound,
} from "../src/health/supplements.ts";
import {
  applyLimit,
  asObject,
  firstBoolean,
  firstNumber,
  firstObject,
  firstString,
  firstStringArray,
  matchesDateRange,
  matchesLookup,
  matchesStatus,
  matchesText,
  maybeString,
  normalizeStringList,
  parseFrontmatterDocument,
  pathSlug,
} from "../src/health/shared.ts";
import {
  listBloodTests,
  readBloodTest,
  showBloodTest,
  toBloodTestRecord,
} from "../src/health/blood-tests.ts";
import { createVaultReadModel } from "../src/model.ts";
import {
  buildOverviewWeeklyStats,
} from "../src/overview.ts";
import { buildTimeline } from "../src/timeline.ts";

const createdVaultRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    createdVaultRoots.splice(0).map(async (vaultRoot) => {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }),
  );
});

async function createVaultRoot(prefix: string): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  createdVaultRoots.push(vaultRoot);
  return vaultRoot;
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await writeFile(path.join(vaultRoot, relativePath), contents, "utf8");
}

function createEntity(
  family: CanonicalEntity["family"],
  entityId: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  return {
    entityId,
    primaryLookupId: entityId,
    lookupIds: [entityId],
    family,
    recordClass: resolveCanonicalRecordClass(family),
    kind: family,
    status: null,
    occurredAt: null,
    date: null,
    path: `vault/${entityId}.md`,
    title: null,
    body: null,
    attributes: {},
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: null,
    tags: [],
    ...overrides,
  };
}

test("health loaders and entity slices cover strict and tolerant file handling", async () => {
  const vaultRoot = await createVaultRoot("murph-query-health-loaders-");

  await writeVaultFile(
    vaultRoot,
    "docs/valid.md",
    [
      "---",
      "title: Example",
      "---",
      "",
      "Body line",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "docs/invalid.md",
    [
      "---",
      "title: Broken",
      "",
      "# Broken",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "records/good/2026-04.jsonl",
    [
      JSON.stringify({ id: "asmt_b", recordedAt: "2026-04-02T09:00:00Z" }),
      "",
      JSON.stringify({ id: "asmt_a", importedAt: "2026-04-01T09:00:00Z" }),
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "records/mixed/2026-04.jsonl",
    [
      JSON.stringify({ id: "asmt_b", recordedAt: "2026-04-02T09:00:00Z" }),
      "{bad json",
      JSON.stringify({ id: "skip_me" }),
    ].join("\n"),
  );

  assert.deepEqual(await walkRelativeFiles(vaultRoot, "docs", ".md"), [
    "docs/invalid.md",
    "docs/valid.md",
  ]);
  assert.deepEqual(await walkRelativeFiles(vaultRoot, "missing", ".md"), []);
  assert.deepEqual(walkRelativeFilesSync(vaultRoot, "docs", ".md"), [
    "docs/invalid.md",
    "docs/valid.md",
  ]);
  assert.deepEqual(walkRelativeFilesSync(vaultRoot, "missing", ".md"), []);

  assert.equal(
    await readOptionalMarkdownDocumentOutcome(vaultRoot, "docs/missing.md"),
    null,
  );
  assert.equal(
    readOptionalMarkdownDocumentOutcomeSync(vaultRoot, "docs/missing.md"),
    null,
  );

  const validMarkdown = await readMarkdownDocument(vaultRoot, "docs/valid.md");
  assert.equal(validMarkdown.body, "Body line");
  assert.equal(
    readMarkdownDocumentSync(vaultRoot, "docs/valid.md").attributes.title,
    "Example",
  );
  assert.equal(
    (await readMarkdownDocumentOutcome(vaultRoot, "docs/valid.md")).ok,
    true,
  );
  assert.equal(
    readMarkdownDocumentOutcomeSync(vaultRoot, "docs/valid.md").ok,
    true,
  );

  const invalidMarkdown = await readOptionalMarkdownDocumentOutcome(vaultRoot, "docs/invalid.md");
  assert.equal(invalidMarkdown?.ok, false);
  assert.equal(
    readOptionalMarkdownDocumentOutcomeSync(vaultRoot, "docs/invalid.md")?.ok,
    false,
  );
  await assert.rejects(
    () => readMarkdownDocument(vaultRoot, "docs/invalid.md"),
    /Failed to parse frontmatter at docs\/invalid\.md/u,
  );
  await assert.rejects(
    () => readOptionalMarkdownDocument(vaultRoot, "docs/invalid.md"),
    /Failed to parse frontmatter at docs\/invalid\.md/u,
  );
  assert.throws(
    () => readMarkdownDocumentSync(vaultRoot, "docs/invalid.md"),
    /Failed to parse frontmatter at docs\/invalid\.md/u,
  );
  await assert.rejects(
    () => readMarkdownDocumentOutcome(vaultRoot, "docs/missing.md"),
    /Missing markdown document at docs\/missing\.md/u,
  );
  assert.throws(
    () => readMarkdownDocumentOutcomeSync(vaultRoot, "docs/missing.md"),
    /Missing markdown document at docs\/missing\.md/u,
  );

  const mixedOutcomes = await readJsonlRecordOutcomes(vaultRoot, "records/mixed");
  assert.equal(mixedOutcomes.length, 3);
  assert.equal(mixedOutcomes[1]?.ok, false);
  assert.equal(mixedOutcomes[1]?.lineNumber, 2);
  assert.equal(readJsonlRecordOutcomesSync(vaultRoot, "records/mixed")[1]?.ok, false);

  await assert.rejects(
    () => readJsonlRecords(vaultRoot, "records/mixed"),
    /Failed to parse JSONL at records\/mixed\/2026-04\.jsonl:2/u,
  );
  assert.throws(
    () => readJsonlRecordsSync(vaultRoot, "records/mixed"),
    /Failed to parse JSONL at records\/mixed\/2026-04\.jsonl:2/u,
  );

  assert.deepEqual(
    (await readJsonlRecords(vaultRoot, "records/good")).map((entry) => entry.relativePath),
    ["records/good/2026-04.jsonl", "records/good/2026-04.jsonl"],
  );
  assert.equal(readJsonlRecordsSync(vaultRoot, "records/good").length, 2);

  const projectAssessment = (value: unknown, relativePath: string) =>
    projectAssessmentEntity(value, relativePath);

  const strictEntities = await readJsonlEntitiesStrict(vaultRoot, "records/good", projectAssessment);
  const strictEntitiesSync = readJsonlEntitiesStrictSync(vaultRoot, "records/good", projectAssessment);
  assert.deepEqual(strictEntities.map((entity) => entity.entityId), ["asmt_a", "asmt_b"]);
  assert.deepEqual(strictEntitiesSync.map((entity) => entity.entityId), ["asmt_a", "asmt_b"]);

  const tolerantEntities = await readJsonlEntitiesTolerant(vaultRoot, "records/mixed", projectAssessment);
  const tolerantEntitiesSync = readJsonlEntitiesTolerantSync(vaultRoot, "records/mixed", projectAssessment);
  assert.deepEqual(tolerantEntities.entities.map((entity) => entity.entityId), ["asmt_b"]);
  assert.deepEqual(tolerantEntitiesSync.entities.map((entity) => entity.entityId), ["asmt_b"]);
  assert.equal(tolerantEntities.failures.length, 1);
  assert.equal(tolerantEntitiesSync.failures.length, 1);
});

test("assessment projectors and queries cover filtering, lookup, and sorting", async () => {
  const vaultRoot = await createVaultRoot("murph-query-assessment-");

  await writeVaultFile(
    vaultRoot,
    "ledger/assessments/2026/2026-04.jsonl",
    [
      JSON.stringify({
        id: "asmt_alpha",
        title: "Morning intake",
        recordedAt: "2026-04-10T09:00:00Z",
        questionnaireSlug: "sleep-check",
        source: "manual",
        relatedIds: ["goal_sleep"],
        tags: ["sleep", "sleep"],
        responses: { energy: "good" },
      }),
      JSON.stringify({
        id: "asmt_beta",
        occurredAt: "2026-04-09T09:00:00Z",
        importedAt: "2026-04-09T10:00:00Z",
        title: "Imported follow-up",
        source: "import",
        response: { soreness: "low" },
      }),
    ].join("\n"),
  );

  assert.equal(projectAssessmentEntity(null, "ledger/assessments/nope.jsonl"), null);
  assert.equal(
    projectAssessmentEntity({ id: "bad", recordedAt: "2026-04-10T09:00:00Z" }, "ledger/assessments/nope.jsonl"),
    null,
  );

  const projected = projectAssessmentEntity(
    {
      id: "asmt_projected",
      title: "Projected assessment",
      occurredAt: "2026-04-08T08:00:00Z",
      questionnaireSlug: "morning-check",
      relatedIds: ["goal_sleep", "goal_sleep"],
      response: { calm: true },
      tags: ["focus", "focus", "sleep"],
    },
    "ledger/assessments/2026/2026-04.jsonl",
  );
  assert.ok(projected);
  assert.deepEqual(projected?.lookupIds, ["asmt_projected", "morning-check"]);
  assert.deepEqual(projected?.relatedIds, ["goal_sleep"]);
  assert.deepEqual(projected?.attributes.responses, { calm: true });
  assert.deepEqual(projected?.tags, ["focus", "sleep"]);

  assert.equal(
    assessmentRecordFromEntity(createEntity("goal", "goal_sleep")),
    null,
  );
  assert.equal(
    assessmentRecordFromEntity({
      ...createEntity("assessment", "asmt_missing_attributes"),
      attributes: null as unknown as Record<string, unknown>,
    }),
    null,
  );

  const rawRecord = toAssessmentRecord(
    {
      id: "asmt_raw",
      title: "Raw assessment",
      recordedAt: "2026-04-07T08:00:00Z",
      sourcePath: "raw/import.json",
      questionnaireSlug: "raw-check",
      responses: { focus: "high" },
    },
    "ledger/assessments/2026/2026-04.jsonl",
  );
  assert.ok(rawRecord);
  assert.equal(rawRecord?.questionnaireSlug, "raw-check");
  assert.equal(rawRecord?.sourcePath, "raw/import.json");

  const listed = await listAssessments(vaultRoot, {
    from: "2026-04-09",
    text: "sleep",
  });
  assert.deepEqual(listed.map((record) => record.id), ["asmt_alpha"]);
  assert.equal((await readAssessment(vaultRoot, "asmt_beta"))?.id, "asmt_beta");
  assert.equal((await readAssessment(vaultRoot, "missing")) ?? null, null);
  assert.equal((await showAssessment(vaultRoot, " morning intake "))?.id, "asmt_alpha");

  const projectedRecords = selectAssessmentRecords(
    [
      createEntity("assessment", "asmt_gamma", {
        title: "Gamma",
        attributes: {
          assessmentType: "checkin",
          importedAt: "2026-04-01T09:00:00Z",
          responses: { score: 3 },
        },
      }),
      createEntity("goal", "goal_skip"),
    ],
    { limit: 1 },
  );
  assert.deepEqual(projectedRecords.map((record) => record.id), ["asmt_gamma"]);

  assert.equal(
    compareAssessments(
      {
        id: "b",
        title: null,
        assessmentType: null,
        recordedAt: "2026-04-09T09:00:00Z",
        importedAt: null,
        source: null,
        sourcePath: null,
        questionnaireSlug: null,
        relatedIds: [],
        responses: {},
        relativePath: "b",
      },
      {
        id: "a",
        title: null,
        assessmentType: null,
        recordedAt: "2026-04-10T09:00:00Z",
        importedAt: null,
        source: null,
        sourcePath: null,
        questionnaireSlug: null,
        relatedIds: [],
        responses: {},
        relativePath: "a",
      },
    ) > 0,
    true,
  );
  assert.equal(
    compareByRecordedOrImportedAtDescThenId(
      { id: "b", recordedAt: null, importedAt: "2026-04-09T09:00:00Z" },
      { id: "a", recordedAt: null, importedAt: "2026-04-09T09:00:00Z" },
    ) > 0,
    true,
  );
  assert.equal(
    compareByOccurredAtDescThenId(
      { id: "a", occurredAt: "2026-04-09T09:00:00Z" },
      { id: "b", occurredAt: "2026-04-10T09:00:00Z" },
    ) > 0,
    true,
  );
  assert.equal(
    compareByOccurredAtDescThenId(
      { id: "a", occurredAt: "2026-04-10T09:00:00Z" },
      { id: "b", occurredAt: "2026-04-10T09:00:00Z" },
    ) < 0,
    true,
  );
});

test("history projectors collapse revisions and preserve explicit or fallback links", () => {
  const explicit = projectHistoryEntity(
    {
      id: "evt_history",
      kind: "test",
      occurredAt: "2026-04-10T09:00:00Z",
      title: "Blood test",
      resultStatus: "final",
      note: "Ferritin panel",
      links: [
        { type: "supports_goal", targetId: "goal_sleep" },
        { type: "bad_type", targetId: "ignore" },
      ],
      tags: ["lab", "follow-up"],
    },
    "ledger/events/2026/2026-04.jsonl",
  );
  assert.ok(explicit);
  assert.equal(explicit?.status, "final");
  assert.deepEqual(explicit?.relatedIds, ["goal_sleep"]);

  const fallback = projectHistoryEntity(
    {
      id: "evt_related",
      kind: "encounter",
      occurredAt: "2026-04-09T09:00:00Z",
      title: "Follow up",
      relatedIds: ["cond_alpha", "goal_sleep"],
      status: "completed",
    },
    "ledger/events/2026/2026-04.jsonl",
  );
  assert.ok(fallback);
  assert.deepEqual(fallback?.relatedIds, ["cond_alpha", "goal_sleep"]);

  assert.equal(
    projectHistoryEntity(
      {
        id: "evt_missing_title",
        kind: "encounter",
        occurredAt: "2026-04-09T09:00:00Z",
      },
      "ledger/events/2026/2026-04.jsonl",
    ),
    null,
  );

  const collapsed = collapseEventLedgerEntities([
    createEntity("event", "evt_same", {
      kind: "encounter",
      title: "Older revision",
      occurredAt: "2026-04-10T09:00:00Z",
      path: "ledger/events/2026/2026-04-a.jsonl",
      attributes: {
        lifecycle: { revision: 1 },
        recordedAt: "2026-04-10T09:00:00Z",
      },
    }),
    createEntity("event", "evt_same", {
      kind: "encounter",
      title: "Deleted revision",
      occurredAt: "2026-04-10T09:00:00Z",
      path: "ledger/events/2026/2026-04-b.jsonl",
      attributes: {
        lifecycle: { revision: 2, state: "deleted" },
        recordedAt: "2026-04-10T10:00:00Z",
      },
    }),
    createEntity("event", "evt_keep", {
      kind: "procedure",
      title: "Keep me",
      occurredAt: "2026-04-11T09:00:00Z",
      path: "ledger/events/2026/2026-04-c.jsonl",
      attributes: {
        recordedAt: "2026-04-11T09:00:00Z",
      },
    }),
    createEntity("event", "evt_invalid", {
      kind: "encounter",
      title: "Skip invalid lifecycle",
      occurredAt: "2026-04-12T09:00:00Z",
      path: "ledger/events/2026/2026-04-d.jsonl",
      attributes: {
        lifecycle: { revision: 0 },
      },
    }),
  ]);

  assert.deepEqual(collapsed.map((entity) => entity.entityId), ["evt_keep"]);
});

test("health shared helpers normalize primitive accessors and matching logic", () => {
  const parsed = parseFrontmatterDocument([
    "---",
    "title: Example",
    "tags:",
    "  - alpha",
    "---",
    "",
    "Body text",
  ].join("\n"));
  assert.equal(parsed.body, "Body text");
  assert.deepEqual(parsed.attributes.tags, ["alpha"]);
  assert.throws(
    () =>
      parseFrontmatterDocument([
        "---",
        "title broken",
        "---",
      ].join("\n")),
    /Expected "key: value" frontmatter at line 1\./u,
  );

  const source = {
    boolTrue: true,
    empty: "  ",
    nested: { value: 1 },
    number: 42,
    strings: [" alpha ", "", 5, "beta"],
    title: "  Example  ",
  };

  assert.deepEqual(asObject(source), source);
  assert.equal(asObject(["bad"]), null);
  assert.equal(firstString(source, ["empty", "title"]), "Example");
  assert.equal(firstNumber(source, ["number"]), 42);
  assert.equal(firstBoolean(source, ["boolTrue"]), true);
  assert.deepEqual(firstObject(source, ["nested"]), { value: 1 });
  assert.deepEqual(firstStringArray(source, ["strings"]), ["alpha", "beta"]);
  assert.deepEqual(normalizeStringList([" one ", null, "two", 2]), ["one", "two"]);
  assert.equal(matchesText([{ label: "Gamma" }, "sleep"], " gamma "), true);
  assert.equal(matchesText(["value"], "   "), true);
  assert.equal(matchesStatus("active", undefined), true);
  assert.equal(matchesStatus("active", []), true);
  assert.equal(matchesStatus(null, "active"), false);
  assert.equal(matchesStatus("ACTIVE", ["paused", " active "]), true);
  assert.equal(matchesDateRange(undefined, "2026-04-01", undefined), false);
  assert.equal(matchesDateRange(undefined, undefined, undefined), true);
  assert.equal(matchesDateRange("2026-04-05T09:00:00Z", "2026-04-01", "2026-04-10"), true);
  assert.deepEqual(applyLimit([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(applyLimit([1, 2, 3], 0), [1, 2, 3]);
  assert.equal(matchesLookup(" sleep quality ", "sleep-quality", " Sleep Quality "), true);
  assert.equal(pathSlug("bank/goals/sleep-quality.md"), "sleep-quality");
  assert.equal(maybeString("  value  "), "value");
  assert.equal(maybeString("   "), null);
  assert.equal(toBloodTestRecord(null, "ledger/events/2026/2026-04.jsonl"), null);
  assert.deepEqual(
    toBloodTestRecord(
      {
        id: "evt_blood_panel",
        kind: "test",
        occurredAt: "2026-04-08T09:00:00Z",
        specimenType: "serum",
        tags: ["lab", 7],
        relatedIds: ["goal_sleep_depth", 4],
        title: "Quarterly panel",
      },
      "ledger/events/2026/2026-04.jsonl",
    )?.relatedIds,
    ["goal_sleep_depth"],
  );
});

test("health library and canonical collector use fallback node metadata and tolerant issue capture", async () => {
  const vaultRoot = await createVaultRoot("murph-query-health-library-");

  await writeVaultFile(
    vaultRoot,
    "bank/library/resting-heart-rate.md",
    [
      "---",
      "slug: resting-heart-rate",
      "entityType: biomarker",
      "---",
      "",
      "# Resting heart rate",
      "",
      `Stable biomarker guidance ${"detail ".repeat(50)}`,
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/library/skip-me.md",
    [
      "---",
      "slug: skip-me",
      "entityType: not-real",
      "---",
      "",
      "Ignored content",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/library/broken.md",
    [
      "---",
      "slug: broken",
      "",
      "# Broken",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/goals/sleep-depth.md",
    [
      "---",
      "schemaVersion: hv/goal@v1",
      "goalId: goal_sleep_depth",
      "slug: sleep-depth",
      "title: Sleep Depth",
      "status: active",
      "---",
      "# Sleep Depth",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/allergies/pollen.md",
    [
      "---",
      "schemaVersion: hv/allergy@v1",
      "allergyId: alg_pollen",
      "slug: pollen",
      "title: Pollen",
      "status: active",
      "substance: Pollen",
      "---",
      "# Pollen",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/goals/broken.md",
    [
      "---",
      "title: Broken goal",
      "",
      "# Broken goal",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/foods/overnight-oats.md",
    [
      "---",
      "schemaVersion: hv/food@v1",
      "foodId: food_overnight_oats",
      "slug: overnight-oats",
      "title: Overnight oats",
      "status: active",
      "---",
      "# Overnight oats",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/foods/missing-id.md",
    [
      "---",
      "schemaVersion: hv/food@v1",
      "slug: missing-id",
      "title: Missing id",
      "status: active",
      "---",
      "# Missing id",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/recipes/salmon-rice-bowl.md",
    [
      "---",
      "schemaVersion: hv/recipe@v1",
      "recipeId: recipe_salmon_rice_bowl",
      "slug: salmon-rice-bowl",
      "title: Salmon rice bowl",
      "status: saved",
      "servings: 2",
      "---",
      "# Salmon rice bowl",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/providers/primary-care.md",
    [
      "---",
      "schemaVersion: hv/provider@v1",
      "providerId: prov_primary_care",
      "slug: primary-care",
      "title: Primary care",
      "status: active",
      "specialty: primary-care",
      "---",
      "# Primary care",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/workout-formats/push-day-a.md",
    [
      "---",
      "schemaVersion: hv/workout_format@v1",
      "workoutFormatId: wfmt_push_day_a",
      "slug: push-day-a",
      "title: Push Day A",
      "status: active",
      "activityType: strength-training",
      "durationMinutes: 45",
      "---",
      "# Push Day A",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "ledger/assessments/2026/2026-04.jsonl",
    JSON.stringify({
      id: "asmt_collected",
      recordedAt: "2026-04-10T09:00:00Z",
      title: "Collected assessment",
    }),
  );

  await assert.rejects(
    () => readHealthLibraryGraph(vaultRoot),
    /Failed to parse frontmatter/u,
  );

  const graphWithIssues = await readHealthLibraryGraphWithIssues(vaultRoot);
  assert.equal(graphWithIssues.graph.nodes.length, 1);
  assert.equal(graphWithIssues.issues[0]?.relativePath, "bank/library/broken.md");

  const tolerantCollection = await collectCanonicalEntities(vaultRoot, {
    mode: "tolerant-async",
  });
  const tolerantSyncCollection = collectCanonicalEntities(vaultRoot, {
    mode: "tolerant-sync",
  });
  assert.equal(tolerantCollection.failures.length, 1);
  assert.equal(tolerantSyncCollection.failures.length, 1);
  assert.equal(tolerantCollection.goals[0]?.entityId, "goal_sleep_depth");
  assert.equal(
    tolerantCollection.markdownByPath.get("bank/goals/sleep-depth.md")?.includes("Sleep Depth"),
    true,
  );
});

test("supplement queries aggregate active compounds and support flexible lookup paths", async () => {
  const vaultRoot = await createVaultRoot("murph-query-supplements-");

  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/vitamin-c.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_vitamin_c",
      "slug: vitamin-c",
      "title: Vitamin C",
      "status: active",
      "kind: supplement",
      "brand: Example Brand",
      "ingredients:",
      "  -",
      "    compound: Vitamin C",
      "    label: Ascorbic acid",
      "    amount: 500",
      "    unit: mg",
      "---",
      "# Vitamin C",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/vitamin-c-powder.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_vitamin_c_powder",
      "slug: vitamin-c-powder",
      "title: Vitamin C Powder",
      "status: active",
      "kind: supplement",
      "ingredients:",
      "  -",
      "    compound: Vitamin C",
      "    label: Buffered C",
      "    amount: null",
      "    unit: mg",
      "---",
      "# Vitamin C Powder",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/symbols.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_symbols",
      "slug: symbols",
      "title: Symbols",
      "status: active",
      "kind: supplement",
      "ingredients:",
      "  -",
      "    compound: \"!!!\"",
      "    label: Symbols",
      "    amount: null",
      "    unit: null",
      "---",
      "# Symbols",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/legacy-magnesium.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_legacy_magnesium",
      "slug: legacy-magnesium",
      "title: Legacy Magnesium",
      "status: stopped",
      "kind: supplement",
      "substance: Magnesium",
      "dose: 250",
      "unit: mg",
      "---",
      "# Legacy Magnesium",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/protocols/manual.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_manual",
      "slug: manual-protocol",
      "title: Manual Protocol",
      "status: active",
      "kind: protocol",
      "---",
      "# Manual Protocol",
      "",
    ].join("\n"),
  );

  assert.deepEqual(
    (await listSupplements(vaultRoot)).map((record) => record.entity.id),
    ["prot_legacy_magnesium", "prot_symbols", "prot_vitamin_c", "prot_vitamin_c_powder"],
  );
  assert.equal((await readSupplement(vaultRoot, "prot_manual")) ?? null, null);
  assert.equal((await showSupplement(vaultRoot, " vitamin c "))?.entity.id, "prot_vitamin_c");

  const activeCompounds = await listSupplementCompounds(vaultRoot, { text: "vitamin" });
  assert.equal(activeCompounds.length, 1);
  assert.deepEqual(activeCompounds[0], {
    compound: "Vitamin C",
    lookupId: "vitamin-c",
    totals: [
      {
        incomplete: true,
        sourceCount: 2,
        totalAmount: 500,
        unit: "mg",
      },
    ],
    supplementCount: 2,
    supplementIds: ["prot_vitamin_c", "prot_vitamin_c_powder"],
    sources: [
      {
        supplementId: "prot_vitamin_c",
        supplementSlug: "vitamin-c",
        supplementTitle: "Vitamin C",
        brand: "Example Brand",
        manufacturer: null,
        status: "active",
        label: "Ascorbic acid",
        amount: 500,
        unit: "mg",
        note: null,
      },
      {
        supplementId: "prot_vitamin_c_powder",
        supplementSlug: "vitamin-c-powder",
        supplementTitle: "Vitamin C Powder",
        brand: null,
        manufacturer: null,
        status: "active",
        label: "Buffered C",
        amount: null,
        unit: "mg",
        note: null,
      },
    ],
  });
  assert.equal(
    (await showSupplementCompound(vaultRoot, "Symbols"))?.lookupId,
    "!!!",
  );
  assert.equal(
    (await listSupplementCompounds(vaultRoot, { status: ["active", "stopped"] }))
      .some((record) => record.lookupId === "magnesium"),
    true,
  );
});

test("export pack, overview, and timeline cover health prompts and fallback rendering", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-18T12:00:00.000Z"));

  const vault = createVaultReadModel({
    vaultRoot: "/tmp/query-health-coverage",
    entities: [
      createEntity("assessment", "asmt_health", {
        title: null,
        kind: "assessment",
        date: "2026-04-16",
        path: "ledger/assessments/2026/2026-04.jsonl",
        attributes: {
          assessmentType: "  ",
          recordedAt: "2026-04-16T08:00:00Z",
          responses: {},
        },
      }),
      createEntity("goal", "goal_sleep", {
        title: "Sleep quality",
        kind: "goal",
        path: "bank/goals/sleep-quality.md",
        attributes: {
          goalId: "goal_sleep",
          slug: "sleep-quality",
          title: "Sleep quality",
          status: "active",
        },
      }),
      createEntity("event", "evt_health", {
        kind: "encounter",
        occurredAt: "2026-04-15T10:00:00Z",
        title: "Clinic visit",
        path: "ledger/events/2026/2026-04.jsonl",
        attributes: {
          note: "Follow-up visit",
          recordedAt: "2026-04-15T10:05:00Z",
        },
      }),
      createEntity("journal", "journal:2026-04-16", {
        kind: "journal_day",
        date: "2026-04-16",
        title: "Journal day",
        body: "Felt steady",
        path: "journal/2026/2026-04-16.md",
        attributes: {
          eventIds: "evt_health",
          sampleStreams: null,
        },
      }),
      createEntity("sample", "sample_prev", {
        date: "2026-04-10",
        stream: "hrv",
        path: "ledger/samples/2026/2026-04.jsonl",
        attributes: {
          unit: "ms",
          value: 40,
        },
      }),
      createEntity("sample", "sample_curr", {
        date: "2026-04-17",
        stream: "hrv",
        path: "ledger/samples/2026/2026-04.jsonl",
        attributes: {
          unit: "ms",
          value: 60,
        },
      }),
      createEntity("sample", "sample_summary_fallback", {
        date: "2026-04-16",
        occurredAt: null,
        stream: "sleep_stage",
        path: "ledger/samples/2026/2026-04.jsonl",
        attributes: {
          unit: null,
          value: "bad",
        },
      }),
    ],
  });

  const pack = buildExportPack(vault, {
    from: "2026-04-01",
    to: "2026-04-30",
    generatedAt: "2026-04-18T12:00:00.000Z",
    packId: "health focus",
  });
  assert.equal(pack.packId, "health-focus");
  assert.equal(
    pack.questionPack.questions.includes(
      "Which intake-assessment answers appear most relevant to the current goals, conditions, or protocols?",
    ),
    true,
  );
  assert.equal(
    pack.questionPack.questions.includes(
      "Which durable goals, conditions, protocols, family history, or genetics context should shape interpretation of the other records?",
    ),
    true,
  );
  assert.equal(
    pack.questionPack.questions.includes(
      "Which time-stamped health events most change the interpretation of the other records?",
    ),
    true,
  );
  assert.deepEqual(pack.questionPack.context.journals[0]?.eventIds, []);
  assert.deepEqual(pack.questionPack.context.journals[0]?.sampleStreams, []);

  assert.deepEqual(buildOverviewWeeklyStats(vault, "UTC"), [
    {
      currentWeekAvg: 60,
      deltaPercent: 50,
      previousWeekAvg: 40,
      stream: "hrv",
      unit: "ms",
    },
  ]);

  const timeline = buildTimeline(vault, {
    kinds: ["assessment", "sample_summary"],
    includeEvents: false,
    includeJournal: false,
    limit: Number.NaN,
  });
  assert.equal(timeline.some((entry) => entry.id === "asmt_health" && entry.title === "asmt_health"), true);
  assert.equal(
    timeline.some(
      (entry) =>
        entry.entryType === "sample_summary" &&
        entry.stream === "sleep_stage" &&
        entry.occurredAt === "2026-04-16T23:59:59Z",
    ),
    true,
  );
});
