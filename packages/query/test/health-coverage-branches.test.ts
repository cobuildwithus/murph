import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { afterEach, test } from "vitest";

import {
  readHealthContext,
  readHealthContextTolerant,
} from "../src/export-pack-health.ts";
import {
  readAssessment,
  listAssessments,
  showAssessment,
} from "../src/health/assessments.ts";
import {
  readBloodTest,
  listBloodTests,
  showBloodTest,
  toBloodTestRecord,
} from "../src/health/blood-tests.ts";
import {
  compareCurrentProfileSnapshotRecency,
  fallbackCurrentProfileEntityFromSnapshotRecord,
  isCurrentProfileStale,
  resolveCurrentProfileDocument,
  resolveCurrentProfileProjection,
  resolveCurrentProfileSnapshot,
  selectLatestCurrentProfileSnapshot,
} from "../src/health/current-profile-resolution.ts";
import {
  readHistoryEvent,
  listHistoryEvents,
  showHistoryEvent,
} from "../src/health/history.ts";
import {
  readMarkdownDocumentOutcome,
  readMarkdownDocument,
  readOptionalMarkdownDocumentOutcome,
  readOptionalMarkdownDocumentOutcomeSync,
  readJsonlRecordOutcomes,
  readJsonlRecordOutcomesSync,
  readJsonlRecords,
  readMarkdownDocumentOutcomeSync,
  walkRelativeFiles,
  walkRelativeFilesSync,
} from "../src/health/loaders.ts";
import {
  type CurrentProfileQueryRecord,
  type ProfileSnapshotQueryRecord,
  currentProfileRecordFromEntity,
  buildCurrentProfileRecord,
  compareAssessments,
  compareHistory,
  compareSnapshots,
  assessmentRecordFromEntity,
  historyRecordFromEntity,
  profileSnapshotRecordFromEntity,
  resolveCurrentProfileRecord,
  selectAssessmentRecords,
  selectHistoryRecords,
  selectProfileSnapshotRecords,
  toAssessmentRecord,
  toCurrentProfileRecord,
  toHistoryRecord,
  toProfileSnapshotRecord,
} from "../src/health/projections.ts";
import {
  projectAssessmentEntity,
} from "../src/health/projectors/assessment.ts";
import {
  projectHistoryEntity,
} from "../src/health/projectors/history.ts";
import {
  fallbackCurrentProfileEntity,
  materializeCurrentProfileDocumentFromSnapshotEntity,
  projectCurrentProfileEntity,
  projectProfileSnapshotEntity,
} from "../src/health/projectors/profile.ts";
import { projectRegistryEntity } from "../src/health/projectors/registry.ts";
import {
  buildPriorityTitleComparator,
  foodRegistryDefinition,
  geneticsRegistryDefinition,
  goalRegistryDefinition,
  listRegistryRecords,
  readPriority,
} from "../src/health/registries.ts";
import {
  asObject,
  applyLimit,
  firstBoolean,
  firstNumber,
  firstObject,
  firstString,
  firstStringArray,
  matchesDateRange,
  matchesLookup,
  matchesStatus,
  matchesText,
  pathSlug,
} from "../src/health/shared.ts";
import {
  listProfileSnapshots,
  readCurrentProfile,
  readProfileSnapshot,
  showProfile,
} from "../src/health/profile-snapshots.ts";
import {
  listSupplementCompounds,
  listSupplements,
  readSupplement,
  showSupplementCompound,
} from "../src/health/supplements.ts";
import {
  readHealthLibraryGraph,
  readHealthLibraryGraphWithIssues,
} from "../src/health-library.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const createdVaultRoots: string[] = [];

const ASSESSMENT_ALPHA_ID = "asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3AA";
const ASSESSMENT_BETA_ID = "asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3AB";
const ASSESSMENT_BEFORE_ID = "asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3AC";
const HISTORY_ALPHA_ID = "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3AA";
const HISTORY_BETA_ID = "evt_01JNW7YJ7MNE7M9Q2QWQK4Z3AB";
const PROFILE_SNAPSHOT_ALPHA_ID = "psnap_01JNW7YJ7MNE7M9Q2QWQK4Z3AA";
const PROFILE_SNAPSHOT_BETA_ID = "psnap_01JNW7YJ7MNE7M9Q2QWQK4Z3AB";

afterEach(async () => {
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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), prefix));
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

test("shared helpers and loaders normalize values and surface parse failures", async () => {
  const vaultRoot = await createVaultRoot("murph-query-coverage-loaders-");

  await writeVaultFile(
    vaultRoot,
    "nested/b/second.md",
    [
      "---",
      "title: Second",
      "slug: second",
      "entityType: biomarker",
      "---",
      "",
      "# Second",
      "",
      "Body text.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "nested/a/first.md",
    [
      "---",
      "title: First",
      "slug: first",
      "entityType: biomarker",
      "---",
      "",
      "# First",
      "",
      "Body text.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "ledger/coverage/2026/2026-03.jsonl",
    [
      JSON.stringify({ id: "ok_1", value: 1 }),
      "{not valid json}",
    ].join("\n") + "\n",
  );
  await writeVaultFile(
    vaultRoot,
    "bank/library/broken.md",
    [
      "---",
      "title: Broken",
      "slug: broken",
      "# Missing closing delimiter",
    ].join("\n"),
  );

  assert.equal(asObject(["not", "an", "object"]), null);
  assert.equal(firstString({ a: "  alpha  ", b: "beta" }, ["a", "b"]), "alpha");
  assert.equal(firstNumber({ a: "nope", b: 3 }, ["a", "b"]), 3);
  assert.equal(firstBoolean({ a: "nope", b: true }, ["a", "b"]), true);
  assert.deepEqual(firstObject({ a: "nope", b: { ok: true } }, ["a", "b"]), {
    ok: true,
  });
  assert.deepEqual(
    firstStringArray({ a: "skip", b: [" one ", "", 2, "two"] }, ["a", "b"]),
    ["one", "two"],
  );
  assert.equal(matchesDateRange("2026-03-10", "2026-03-01", "2026-03-31"), true);
  assert.equal(matchesDateRange("2026-03-10", "2026-03-11", undefined), false);
  assert.equal(matchesDateRange(null, "2026-03-01", undefined), false);
  assert.equal(matchesLookup("  Alpha Intake  ", "alpha intake", "other"), true);
  assert.equal(matchesStatus("Active", ["", "active"]), true);
  assert.equal(matchesText([{ nested: "value" }, "Alpha"], "alpha"), true);
  assert.deepEqual(applyLimit([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(applyLimit([1, 2, 3], 0), [1, 2, 3]);
  assert.equal(pathSlug("bank/library/sleep-architecture.md"), "sleep-architecture");

  assert.deepEqual(
    await walkRelativeFiles(vaultRoot, "nested", ".md"),
    ["nested/a/first.md", "nested/b/second.md"],
  );
  assert.deepEqual(
    walkRelativeFilesSync(vaultRoot, "nested", ".md"),
    ["nested/a/first.md", "nested/b/second.md"],
  );

  assert.equal(await readOptionalMarkdownDocumentOutcome(vaultRoot, "missing.md"), null);
  assert.equal(readOptionalMarkdownDocumentOutcomeSync(vaultRoot, "missing.md"), null);

  const markdownOutcome = await readMarkdownDocumentOutcome(vaultRoot, "bank/library/broken.md");
  assert.equal(markdownOutcome.ok, false);
  if (!markdownOutcome.ok) {
    assert.equal(markdownOutcome.parser, "frontmatter");
  }
  const markdownOutcomeSync = readMarkdownDocumentOutcomeSync(vaultRoot, "bank/library/broken.md");
  assert.equal(markdownOutcomeSync.ok, false);
  if (!markdownOutcomeSync.ok) {
    assert.equal(markdownOutcomeSync.parser, "frontmatter");
  }

  const jsonOutcomes = await readJsonlRecordOutcomes(vaultRoot, "ledger/coverage");
  assert.equal(jsonOutcomes.length, 2);
  assert.equal(jsonOutcomes[0]?.ok, true);
  assert.equal(jsonOutcomes[1]?.ok, false);
  if (jsonOutcomes[1] && !jsonOutcomes[1].ok) {
    assert.equal(jsonOutcomes[1].parser, "json");
    assert.equal(jsonOutcomes[1].lineNumber, 2);
  }
  assert.deepEqual(
    readJsonlRecordOutcomesSync(vaultRoot, "ledger/coverage").map((outcome) => outcome.ok),
    [true, false],
  );

  await assert.rejects(
    () => readJsonlRecords(vaultRoot, "ledger/coverage"),
    /Failed to parse JSONL at ledger\/coverage\/2026\/2026-03\.jsonl:2:/,
  );
  await assert.rejects(
    () => readMarkdownDocument(vaultRoot, "bank/library/missing.md"),
    /Missing markdown document at bank\/library\/missing\.md/,
  );
});

test("projectors, projections, and current-profile resolution preserve canonical fallbacks", () => {
  const assessmentAlpha = projectAssessmentEntity(
    {
      id: ASSESSMENT_ALPHA_ID,
      assessmentType: "intake",
      importedAt: "2026-03-12T09:05:00Z",
      questionnaireSlug: "sleep-intake",
      relatedIds: ["goal_sleep"],
      response: {
        energy: "good",
      },
      tags: [" sleep ", "sleep"],
      title: "Alpha intake",
    },
    "ledger/assessments/2026/2026-03.jsonl",
  );
  const assessmentBeta = projectAssessmentEntity(
    {
      id: ASSESSMENT_BETA_ID,
      assessmentType: "follow-up",
      recordedAt: "2026-03-12T09:05:00Z",
      questionnaireSlug: "sleep-intake",
      responses: {
        energy: "better",
      },
      title: "Beta intake",
    },
    "ledger/assessments/2026/2026-03.jsonl",
  );
  const assessmentInvalid = projectAssessmentEntity(
    {
      id: "invalid_assessment",
      title: "Invalid",
    },
    "ledger/assessments/2026/2026-03.jsonl",
  );

  assert.ok(assessmentAlpha);
  assert.ok(assessmentBeta);
  assert.equal(assessmentInvalid, null);
  assert.equal(assessmentAlpha?.occurredAt, "2026-03-12T09:05:00Z");
  assert.deepEqual(assessmentAlpha?.attributes.responses, {
    energy: "good",
  });
  assert.deepEqual(assessmentAlpha?.lookupIds, [ASSESSMENT_ALPHA_ID, "sleep-intake"]);

  const assessmentAlphaRecord = assessmentRecordFromEntity(assessmentAlpha!);
  const assessmentBetaRecord = assessmentRecordFromEntity(assessmentBeta!);
  assert.equal(assessmentAlphaRecord?.recordedAt, "2026-03-12T09:05:00Z");
  assert.deepEqual(assessmentAlphaRecord?.responses, { energy: "good" });
  assert.equal(toAssessmentRecord({ id: "wrong" }, "ledger/assessments/2026/2026-03.jsonl"), null);
  assert.equal(compareAssessments(assessmentAlphaRecord!, assessmentBetaRecord!), -1);
  assert.deepEqual(
    selectAssessmentRecords([assessmentBeta!, assessmentAlpha!], { limit: 1 }).map((record) => record.id),
    [ASSESSMENT_ALPHA_ID],
  );

  const historyAlpha = projectHistoryEntity(
    {
      id: HISTORY_ALPHA_ID,
      kind: "test",
      occurredAt: "2026-03-12T08:00:00Z",
      resultStatus: "mixed",
      source: "manual",
      tags: ["lab"],
      title: "Alpha panel",
      links: [
        { type: "related_to", targetId: "goal_sleep" },
        { type: "related_to", targetId: "goal_sleep" },
      ],
    },
    "ledger/events/2026/2026-03.jsonl",
  );
  const historyBeta = projectHistoryEntity(
    {
      id: HISTORY_BETA_ID,
      kind: "encounter",
      occurredAt: "2026-03-12T08:00:00Z",
      relatedIds: ["goal_sleep"],
      severity: "important",
      source: "manual",
      title: "Beta encounter",
    },
    "ledger/events/2026/2026-03.jsonl",
  );
  const historyInvalid = projectHistoryEntity(
    {
      id: "invalid_history",
      kind: "encounter",
      title: "Missing date",
    },
    "ledger/events/2026/2026-03.jsonl",
  );

  assert.ok(historyAlpha);
  assert.ok(historyBeta);
  assert.equal(historyInvalid, null);
  assert.equal(historyAlpha?.status, "mixed");
  assert.deepEqual(historyAlpha?.links, [{ type: "related_to", targetId: "goal_sleep" }]);

  const historyAlphaRecord = historyRecordFromEntity(historyAlpha!);
  const historyBetaRecord = historyRecordFromEntity(historyBeta!);
  assert.equal(historyAlphaRecord?.status, "mixed");
  assert.equal(historyBetaRecord?.status, "important");
  assert.equal(toHistoryRecord({ id: "wrong" }, "ledger/events/2026/2026-03.jsonl"), null);
  assert.equal(compareHistory(historyAlphaRecord!, historyBetaRecord!), -1);
  assert.deepEqual(
    selectHistoryRecords([historyBeta!, historyAlpha!], { limit: 1 }).map((record) => record.id),
    [HISTORY_ALPHA_ID],
  );

  const snapshotAlpha = projectProfileSnapshotEntity(
    {
      id: PROFILE_SNAPSHOT_ALPHA_ID,
      profile: {
        goals: {
          topGoalIds: ["goal_sleep"],
        },
        narrative: {
          summary: "Alpha summary",
        },
      },
      recordedAt: "2026-03-12T14:00:00Z",
      source: "assessment_projection",
      sourceAssessmentIds: [ASSESSMENT_ALPHA_ID],
      status: "accepted",
    },
    "ledger/profile-snapshots/2026/2026-03.jsonl",
  );
  const snapshotBeta = projectProfileSnapshotEntity(
    {
      id: PROFILE_SNAPSHOT_BETA_ID,
      profile: {
        narrative: {
          summary: "Beta summary",
        },
      },
      recordedAt: "2026-03-12T14:00:00Z",
      sourceAssessmentIds: [ASSESSMENT_BETA_ID],
      sourceEventIds: [HISTORY_BETA_ID],
    },
    "ledger/profile-snapshots/2026/2026-03.jsonl",
  );
  const snapshotInvalid = projectProfileSnapshotEntity(
    {
      id: "invalid_snapshot",
      profile: {},
    },
    "ledger/profile-snapshots/2026/2026-03.jsonl",
  );

  assert.ok(snapshotAlpha);
  assert.ok(snapshotBeta);
  assert.equal(snapshotInvalid, null);
  assert.equal(snapshotAlpha?.title, "Alpha summary");
  assert.deepEqual(snapshotAlpha?.relatedIds, [ASSESSMENT_ALPHA_ID]);
  assert.deepEqual(snapshotBeta?.relatedIds, [ASSESSMENT_BETA_ID, HISTORY_BETA_ID]);

  const snapshotAlphaRecord = profileSnapshotRecordFromEntity(snapshotAlpha!);
  const snapshotBetaRecord = profileSnapshotRecordFromEntity(snapshotBeta!);
  assert.equal(snapshotAlphaRecord?.summary, "Alpha summary");
  assert.deepEqual(snapshotAlphaRecord?.sourceAssessmentIds, [ASSESSMENT_ALPHA_ID]);
  assert.deepEqual(snapshotBetaRecord?.sourceEventIds, [HISTORY_BETA_ID]);
  assert.equal(toProfileSnapshotRecord({ id: "wrong" }, "ledger/profile-snapshots/2026/2026-03.jsonl"), null);
  assert.equal(compareSnapshots(snapshotAlphaRecord!, snapshotBetaRecord!), -1);
  assert.deepEqual(
    selectProfileSnapshotRecords([snapshotBeta!, snapshotAlpha!], { limit: 1 }).map((record) => record.id),
    [PROFILE_SNAPSHOT_ALPHA_ID],
  );

  const currentDocument = {
    relativePath: "bank/profile/current.md",
    markdown: [
      "# Current Profile",
      "",
      "Snapshot ID: `psnap_body`",
      "Recorded At: 2026-03-12T15:00:00Z",
    ].join("\n"),
    body: [
      "# Current Profile",
      "",
      "Snapshot ID: `psnap_body`",
      "Recorded At: 2026-03-12T15:00:00Z",
    ].join("\n"),
    attributes: {
      snapshotId: PROFILE_SNAPSHOT_ALPHA_ID,
      sourceAssessmentIds: [ASSESSMENT_ALPHA_ID],
      sourceEventIds: [HISTORY_ALPHA_ID],
      topGoalIds: ["goal_sleep"],
    },
  };
  const currentEntity = projectCurrentProfileEntity(currentDocument);
  const currentRecord = currentProfileRecordFromEntity(currentEntity);
  const resolvedCurrentRecord = resolveCurrentProfileRecord(
    currentEntity,
    new Map([[currentEntity.path, currentDocument.markdown]]),
  );

  assert.equal(currentEntity.attributes.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(currentEntity.attributes.updatedAt, "2026-03-12T15:00:00Z");
  assert.deepEqual(currentEntity.links, [
    { type: "snapshot_of", targetId: PROFILE_SNAPSHOT_ALPHA_ID },
    { type: "source_assessment", targetId: ASSESSMENT_ALPHA_ID },
    { type: "source_event", targetId: HISTORY_ALPHA_ID },
    { type: "top_goal", targetId: "goal_sleep" },
  ]);
  assert.equal(currentRecord?.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(resolvedCurrentRecord?.markdown, currentDocument.markdown);
  assert.equal(toCurrentProfileRecord(currentDocument).snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(resolveCurrentProfileRecord(currentEntity, new Map())?.markdown, currentEntity.body);

  const currentBodyOnlyDocument = {
    relativePath: "bank/profile/current-body-only.md",
    markdown: [
      "# Current Profile",
      "",
      "Snapshot ID: `psnap_body`",
      "Recorded At: 2026-03-13T15:00:00Z",
    ].join("\n"),
    body: "",
    attributes: {
      sourceAssessmentIds: [],
      sourceEventIds: [],
      topGoalIds: [],
    },
  };
  const currentBodyOnlyEntity = projectCurrentProfileEntity(currentBodyOnlyDocument);
  assert.equal(currentBodyOnlyEntity.body, currentBodyOnlyDocument.markdown.trim());
  assert.equal(currentBodyOnlyEntity.attributes.snapshotId, "psnap_body");
  assert.equal(currentBodyOnlyEntity.attributes.updatedAt, "2026-03-13T15:00:00Z");
  assert.deepEqual(currentBodyOnlyEntity.links, []);

  assert.equal(assessmentRecordFromEntity(historyAlpha!), null);
  assert.equal(historyRecordFromEntity(assessmentAlpha!), null);
  assert.equal(profileSnapshotRecordFromEntity(assessmentAlpha!), null);
  assert.equal(currentProfileRecordFromEntity(assessmentAlpha!), null);

  const resolution = resolveCurrentProfileSnapshot<
    ProfileSnapshotQueryRecord,
    CurrentProfileQueryRecord
  >(
    [snapshotBetaRecord!, snapshotAlphaRecord!] as ProfileSnapshotQueryRecord[],
    (snapshot) => ({
      snapshotId: snapshot.id,
      snapshotTimestamp: snapshot.recordedAt ?? snapshot.capturedAt,
    }),
    (snapshot) => {
      const profile = snapshot.profile as {
        goals?: {
          topGoalIds?: string[];
        };
      };

      return buildCurrentProfileRecord({
        snapshotId: snapshot.id,
        updatedAt: snapshot.recordedAt ?? snapshot.capturedAt,
        sourceAssessmentIds: snapshot.sourceAssessmentIds,
        sourceEventIds: snapshot.sourceEventIds,
        topGoalIds: profile.goals?.topGoalIds ?? [],
        markdown: null,
        body: null,
      });
    },
  );

  assert.equal(resolution.latestSnapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(resolution.fallbackCurrentProfile?.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(
    compareCurrentProfileSnapshotRecency(
      { snapshotId: PROFILE_SNAPSHOT_ALPHA_ID, snapshotTimestamp: "2026-03-12T14:00:00Z" },
      { snapshotId: PROFILE_SNAPSHOT_BETA_ID, snapshotTimestamp: "2026-03-12T14:00:00Z" },
    ),
    -1,
  );
  assert.equal(selectLatestCurrentProfileSnapshot([snapshotBetaRecord!, snapshotAlphaRecord!], (snapshot) => ({
    snapshotId: snapshot.id,
    snapshotTimestamp: snapshot.recordedAt ?? snapshot.capturedAt,
  }))?.id, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(isCurrentProfileStale(PROFILE_SNAPSHOT_BETA_ID, PROFILE_SNAPSHOT_ALPHA_ID), true);
  assert.equal(isCurrentProfileStale(PROFILE_SNAPSHOT_ALPHA_ID, PROFILE_SNAPSHOT_ALPHA_ID), false);
  assert.equal(
    resolveCurrentProfileProjection<
      CurrentProfileQueryRecord,
      CurrentProfileQueryRecord
    >(
      resolution,
      buildCurrentProfileRecord({
        snapshotId: PROFILE_SNAPSHOT_ALPHA_ID,
        updatedAt: "2026-03-12T15:00:00Z",
        sourceAssessmentIds: [ASSESSMENT_ALPHA_ID],
        sourceEventIds: [HISTORY_ALPHA_ID],
        topGoalIds: ["goal_sleep"],
        markdown: "current markdown",
        body: "current body",
      }),
      (currentProfile) => currentProfile.snapshotId,
    )?.snapshotId,
    PROFILE_SNAPSHOT_ALPHA_ID,
  );
  assert.equal(
    resolveCurrentProfileProjection<
      CurrentProfileQueryRecord,
      CurrentProfileQueryRecord
    >(
      resolution,
      buildCurrentProfileRecord({
        snapshotId: PROFILE_SNAPSHOT_BETA_ID,
        updatedAt: "2026-03-12T15:00:00Z",
        sourceAssessmentIds: [],
        sourceEventIds: [],
        topGoalIds: [],
        markdown: "stale markdown",
        body: "stale body",
      }),
      (currentProfile) => currentProfile.snapshotId,
    )?.snapshotId,
    PROFILE_SNAPSHOT_ALPHA_ID,
  );

  const emptyResolution = resolveCurrentProfileSnapshot<
    ProfileSnapshotQueryRecord,
    CurrentProfileQueryRecord
  >([], (snapshot) => ({
    snapshotId: snapshot.id,
    snapshotTimestamp: snapshot.recordedAt ?? snapshot.capturedAt,
  }), () => null);
  assert.equal(emptyResolution.latestSnapshotId, null);
  assert.equal(
    resolveCurrentProfileProjection<
      CurrentProfileQueryRecord,
      CurrentProfileQueryRecord
    >(emptyResolution, null, () => null),
    null,
  );

  let retained = 0;
  const matchingDocumentResult = resolveCurrentProfileDocument<
    CurrentProfileQueryRecord,
    CurrentProfileQueryRecord,
    string
  >(
    resolution,
    {
      status: "ok",
      currentProfile: buildCurrentProfileRecord({
        snapshotId: PROFILE_SNAPSHOT_ALPHA_ID,
        updatedAt: "2026-03-12T15:00:00Z",
        sourceAssessmentIds: [ASSESSMENT_ALPHA_ID],
        sourceEventIds: [HISTORY_ALPHA_ID],
        topGoalIds: ["goal_sleep"],
        markdown: "current markdown",
        body: "current body",
      }),
    },
    (currentProfile) => currentProfile.snapshotId,
    {
      retainDocumentCurrentProfile: () => {
        retained += 1;
      },
    },
  );
  const staleDocumentResult = resolveCurrentProfileDocument<
    CurrentProfileQueryRecord,
    CurrentProfileQueryRecord,
    string
  >(
    resolution,
    {
      status: "ok",
      currentProfile: buildCurrentProfileRecord({
        snapshotId: PROFILE_SNAPSHOT_BETA_ID,
        updatedAt: "2026-03-12T15:00:00Z",
        sourceAssessmentIds: [],
        sourceEventIds: [],
        topGoalIds: [],
        markdown: "stale markdown",
        body: "stale body",
      }),
    },
    (currentProfile) => currentProfile.snapshotId,
    {
      retainDocumentCurrentProfile: () => {
        retained += 10;
      },
    },
  );
  const missingDocumentResult = resolveCurrentProfileDocument<
    CurrentProfileQueryRecord,
    CurrentProfileQueryRecord,
    string
  >(
    resolution,
    { status: "missing" },
    (currentProfile) => currentProfile.snapshotId,
  );
  const parseFailedDocumentResult = resolveCurrentProfileDocument<
    CurrentProfileQueryRecord,
    CurrentProfileQueryRecord,
    string
  >(
    resolution,
    { status: "parse-failed", failure: "broken" },
    (currentProfile) => currentProfile.snapshotId,
  );
  const retainedFallback = fallbackCurrentProfileEntityFromSnapshotRecord(snapshotAlphaRecord!);
  const nullFallback = fallbackCurrentProfileEntity(
    assessmentAlpha!,
  );
  const materialized = materializeCurrentProfileDocumentFromSnapshotEntity(snapshotAlpha!);

  assert.equal(matchingDocumentResult.currentProfile?.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(staleDocumentResult.currentProfile?.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(missingDocumentResult.currentProfile?.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.deepEqual(parseFailedDocumentResult.failures, ["broken"]);
  assert.equal(retained, 1);
  assert.equal(retainedFallback?.family, "current_profile");
  assert.equal(nullFallback, null);
  assert.equal(materialized, null);

  let retainedWhenNoLatest = 0;
  const noLatestDocumentResult = resolveCurrentProfileDocument<
    CurrentProfileQueryRecord,
    CurrentProfileQueryRecord,
    string
  >(
    emptyResolution,
    {
      status: "ok",
      currentProfile: buildCurrentProfileRecord({
        snapshotId: "psnap_orphan",
        updatedAt: null,
        sourceAssessmentIds: [],
        sourceEventIds: [],
        topGoalIds: [],
        markdown: null,
        body: null,
      }),
    },
    (currentProfile) => currentProfile.snapshotId,
    {
      retainDocumentCurrentProfile: () => {
        retainedWhenNoLatest += 1;
      },
    },
  );
  assert.equal(noLatestDocumentResult.currentProfile, null);
  assert.equal(retainedWhenNoLatest, 1);

  const fallbackFromCapturedOnly = fallbackCurrentProfileEntityFromSnapshotRecord({
    id: "psnap_captured",
    capturedAt: "2026-03-13T14:00:00Z",
    recordedAt: null,
    status: "accepted",
    summary: null,
    sourceAssessmentIds: [],
    sourceEventIds: [],
    profile: {},
    relativePath: "ledger/profile-snapshots/2026/2026-03.jsonl",
  });
  assert.equal(fallbackFromCapturedOnly?.occurredAt, "2026-03-13T14:00:00Z");
  assert.equal(fallbackFromCapturedOnly?.title, "Current profile");
});

test("health readers and export-pack health keep the live read model aligned", async () => {
  const vaultRoot = await createVaultRoot("murph-query-coverage-health-");

  await writeVaultFile(
    vaultRoot,
    "ledger/assessments/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.assessment-response.v1",
        id: ASSESSMENT_ALPHA_ID,
        assessmentType: "intake",
        recordedAt: "2026-03-12T09:05:00Z",
        source: "import",
        title: "Alpha intake",
        questionnaireSlug: "sleep-intake",
        responses: {
          energy: "good",
        },
      }),
      JSON.stringify({
        schemaVersion: "murph.assessment-response.v1",
        id: ASSESSMENT_BETA_ID,
        assessmentType: "follow-up",
        recordedAt: "2026-03-12T09:05:00Z",
        source: "import",
        title: "Beta intake",
        questionnaireSlug: "sleep-intake",
        response: {
          energy: "better",
        },
      }),
      JSON.stringify({
        schemaVersion: "murph.assessment-response.v1",
        id: ASSESSMENT_BEFORE_ID,
        assessmentType: "follow-up",
        recordedAt: "2026-03-01T09:05:00Z",
        source: "import",
        title: "Before window",
      }),
      JSON.stringify({
        schemaVersion: "murph.assessment-response.v1",
        id: "asmt_undated",
        assessmentType: "follow-up",
        source: "import",
        title: "Undated",
      }),
    ].join("\n") + "\n",
  );
  await writeVaultFile(
    vaultRoot,
    "ledger/profile-snapshots/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.profile-snapshot.v1",
        id: PROFILE_SNAPSHOT_BETA_ID,
        profile: {
          narrative: {
            summary: "Beta summary",
          },
          goals: {
            topGoalIds: ["goal_sleep"],
          },
        },
        recordedAt: "2026-03-11T14:00:00Z",
        sourceAssessmentIds: [ASSESSMENT_BETA_ID],
      }),
      JSON.stringify({
        schemaVersion: "murph.profile-snapshot.v1",
        id: PROFILE_SNAPSHOT_ALPHA_ID,
        profile: {
          narrative: {
            summary: "Alpha summary",
          },
          goals: {
            topGoalIds: ["goal_sleep"],
          },
        },
        recordedAt: "2026-03-12T14:00:00Z",
        source: {
          assessmentId: ASSESSMENT_ALPHA_ID,
        },
        sourceEventIds: [HISTORY_ALPHA_ID],
      }),
      JSON.stringify({
        schemaVersion: "murph.profile-snapshot.v1",
        id: "psnap_before",
        profile: {
          narrative: {
            summary: "Before window",
          },
        },
        recordedAt: "2026-03-01T14:00:00Z",
      }),
    ].join("\n") + "\n",
  );
  await writeVaultFile(
    vaultRoot,
    "ledger/events/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: HISTORY_BETA_ID,
        kind: "encounter",
        occurredAt: "2026-03-12T08:00:00Z",
        source: "manual",
        title: "Beta encounter",
        relatedIds: [ASSESSMENT_BETA_ID],
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: HISTORY_ALPHA_ID,
        kind: "encounter",
        occurredAt: "2026-03-12T08:00:00Z",
        source: "manual",
        title: "Alpha encounter",
        relatedIds: [ASSESSMENT_ALPHA_ID],
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_before",
        kind: "encounter",
        occurredAt: "2026-03-01T08:00:00Z",
        title: "Before window",
      }),
    ].join("\n") + "\n",
  );
  await writeVaultFile(
    vaultRoot,
    "bank/goals/sleep-longer.md",
    [
      "---",
      "schemaVersion: hv/goal@v1",
      `goalId: goal_sleep`,
      "slug: sleep-longer",
      "title: Sleep longer",
      "status: active",
      "---",
      "",
      "# Sleep longer",
      "",
      "Aim for more consistent sleep.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/profile/current.md",
    [
      "---",
      "schemaVersion: murph.frontmatter.profile-current.v1",
      "docType: profile_current",
      `snapshotId: ${PROFILE_SNAPSHOT_ALPHA_ID}`,
      "updatedAt: 2026-03-12T15:00:00Z",
      "---",
      "",
      "# Current Profile",
      "",
      `Snapshot ID: \`${PROFILE_SNAPSHOT_ALPHA_ID}\``,
      "",
    ].join("\n"),
  );

  const allAssessments = await listAssessments(vaultRoot);
  const allHistory = await listHistoryEvents(vaultRoot);
  const allSnapshots = await listProfileSnapshots(vaultRoot);
  const currentProfile = await readCurrentProfile(vaultRoot);
  const healthRead = readHealthContext(vaultRoot, {
    from: "2026-03-10",
    to: "2026-03-12",
    experimentSlug: null,
  });
  const tolerantHealth = readHealthContextTolerant(vaultRoot, {
    from: "2026-03-10",
    to: "2026-03-12",
    experimentSlug: null,
  });

  assert.deepEqual(allAssessments.map((record) => record.id), [
    ASSESSMENT_ALPHA_ID,
    ASSESSMENT_BETA_ID,
    ASSESSMENT_BEFORE_ID,
    "asmt_undated",
  ]);
  assert.equal((await readAssessment(vaultRoot, ASSESSMENT_ALPHA_ID))?.title, "Alpha intake");
  assert.equal((await showAssessment(vaultRoot, "BETA INTAKE"))?.id, ASSESSMENT_BETA_ID);
  assert.equal((await readAssessment(vaultRoot, "missing")), null);
  assert.equal((await showAssessment(vaultRoot, "missing")), null);

  assert.deepEqual(allHistory.map((record) => record.id), [
    HISTORY_ALPHA_ID,
    HISTORY_BETA_ID,
    "evt_before",
  ]);
  assert.equal((await readHistoryEvent(vaultRoot, HISTORY_BETA_ID))?.title, "Beta encounter");
  assert.equal((await showHistoryEvent(vaultRoot, "alpha encounter"))?.id, HISTORY_ALPHA_ID);
  assert.equal((await readHistoryEvent(vaultRoot, "missing")), null);
  assert.equal((await showHistoryEvent(vaultRoot, "missing")), null);

  assert.deepEqual(allSnapshots.map((record) => record.id), [
    PROFILE_SNAPSHOT_ALPHA_ID,
    PROFILE_SNAPSHOT_BETA_ID,
    "psnap_before",
  ]);
  assert.equal((await readProfileSnapshot(vaultRoot, PROFILE_SNAPSHOT_BETA_ID))?.summary, "Beta summary");
  assert.equal((await showProfile(vaultRoot, PROFILE_SNAPSHOT_ALPHA_ID))?.id, "current");
  assert.equal((await showProfile(vaultRoot, "beta summary"))?.id, PROFILE_SNAPSHOT_BETA_ID);
  assert.equal((await showProfile(vaultRoot, "missing")), null);
  assert.equal(currentProfile?.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);

  assert.deepEqual(healthRead.health.assessments.map((record) => record.id), [
    ASSESSMENT_ALPHA_ID,
    ASSESSMENT_BETA_ID,
  ]);
  assert.deepEqual(healthRead.health.historyEvents.map((record) => record.id), [
    HISTORY_ALPHA_ID,
    HISTORY_BETA_ID,
  ]);
  assert.deepEqual(healthRead.health.profileSnapshots.map((record) => record.id), [
    PROFILE_SNAPSHOT_ALPHA_ID,
    PROFILE_SNAPSHOT_BETA_ID,
  ]);
  assert.equal(healthRead.health.currentProfile?.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal("id" in (healthRead.health.currentProfile ?? {}), false);
  assert.equal(healthRead.health.goals[0]?.slug, "sleep-longer");
  assert.deepEqual(healthRead.failures, []);
  assert.deepEqual(tolerantHealth, healthRead.health);
});

test("profile snapshot readers handle missing current profiles and lookup misses", async () => {
  const vaultRoot = await createVaultRoot("murph-query-coverage-profile-snapshots-");

  await writeVaultFile(
    vaultRoot,
    "ledger/profile-snapshots/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.profile-snapshot.v1",
        id: PROFILE_SNAPSHOT_ALPHA_ID,
        profile: {
          narrative: {
            summary: "Alpha summary",
          },
        },
        recordedAt: "2026-03-12T14:00:00Z",
        sourceAssessmentIds: [ASSESSMENT_ALPHA_ID],
      }),
    ].join("\n") + "\n",
  );

  assert.deepEqual((await listProfileSnapshots(vaultRoot)).map((record) => record.id), [
    PROFILE_SNAPSHOT_ALPHA_ID,
  ]);
  assert.equal(await readProfileSnapshot(vaultRoot, "missing"), null);
  assert.equal((await readCurrentProfile(vaultRoot))?.snapshotId, PROFILE_SNAPSHOT_ALPHA_ID);
  assert.equal(await showProfile(vaultRoot, "missing"), null);
});

test("health library graph handles summaries, humanized titles, and parse issues", async () => {
  const strictVaultRoot = await createVaultRoot("murph-query-coverage-library-strict-");
  const issueVaultRoot = await createVaultRoot("murph-query-coverage-library-issues-");

  const longBody = [
    "# Zeta Study",
    "",
    "This body text is intentionally long so the summary branch truncates it cleanly.",
    "It keeps going with enough repeated detail to exceed the 220 character summary limit.",
    "That makes the truncation behavior deterministic.",
  ].join(" ");

  await writeVaultFile(
    strictVaultRoot,
    "bank/library/zeta-study.md",
    [
      "---",
      "slug: zeta-study",
      "entityType: biomarker",
      "status: active",
      "---",
      "",
      longBody,
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    strictVaultRoot,
    "bank/library/alpha-habit.md",
    [
      "---",
      "slug: alpha-habit",
      "entity_type: domain",
      "summary: Explicit summary",
      "status: draft",
      "---",
      "",
      "# Alpha habit",
      "",
      "Short body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    issueVaultRoot,
    "bank/library/zeta-study.md",
    [
      "---",
      "slug: zeta-study",
      "entityType: biomarker",
      "status: active",
      "---",
      "",
      longBody,
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    issueVaultRoot,
    "bank/library/alpha-habit.md",
    [
      "---",
      "slug: alpha-habit",
      "entity_type: domain",
      "summary: Explicit summary",
      "status: draft",
      "---",
      "",
      "# Alpha habit",
      "",
      "Short body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    issueVaultRoot,
    "bank/library/invalid-type.md",
    [
      "---",
      "slug: invalid-type",
      "entityType: not_a_real_type",
      "---",
      "",
      "# Invalid type",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    issueVaultRoot,
    "bank/library/missing-slug.md",
    [
      "---",
      "entityType: biomarker",
      "---",
      "",
      "# Missing slug",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    issueVaultRoot,
    "bank/library/broken.md",
    [
      "---",
      "slug: broken",
      "entityType: biomarker",
      "# Missing closing delimiter",
    ].join("\n"),
  );

  const graph = await readHealthLibraryGraph(strictVaultRoot);
  const graphWithIssues = await readHealthLibraryGraphWithIssues(issueVaultRoot);

  assert.deepEqual(graph.nodes.map((node) => node.slug), ["alpha-habit", "zeta-study"]);
  assert.equal(graph.bySlug.get("alpha-habit")?.title, "Alpha Habit");
  assert.equal(graph.bySlug.get("alpha-habit")?.summary, "Explicit summary");
  assert.equal(graph.bySlug.get("alpha-habit")?.entityType, "domain");
  assert.equal(graph.bySlug.get("zeta-study")?.title, "Zeta Study");
  assert.equal(graph.bySlug.get("zeta-study")?.summary?.endsWith("..."), true);
  assert.equal(graph.bySlug.get("zeta-study")?.summary?.length, 220);
  assert.equal(graphWithIssues.graph.nodes.length, 2);
  assert.equal(graphWithIssues.issues.length, 1);
  assert.equal(graphWithIssues.issues[0]?.relativePath, "bank/library/broken.md");
  assert.equal(graphWithIssues.issues[0]?.parser, "frontmatter");
});

test("blood test readers keep blood-specific records and reject non-blood history", async () => {
  const vaultRoot = await createVaultRoot("murph-query-coverage-blood-");

  await writeVaultFile(
    vaultRoot,
    "ledger/events/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_blood_a",
        kind: "test",
        occurredAt: "2026-03-13T08:00:00Z",
        recordedAt: "2026-03-13T08:05:00Z",
        source: "import",
        title: "Functional panel",
        testName: "functional_panel",
        resultStatus: "mixed",
        testCategory: "blood",
        specimenType: "serum",
        labName: "Function Health",
        fastingStatus: "fasting",
        relatedIds: [ASSESSMENT_ALPHA_ID],
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_blood_b",
        kind: "test",
        occurredAt: "2026-03-13T08:00:00Z",
        recordedAt: "2026-03-13T08:06:00Z",
        source: "import",
        title: "Cardiometabolic panel",
        testName: "cardiometabolic_panel",
        specimenType: "plasma",
        resultStatus: "normal",
        labName: "Quest",
        fastingStatus: "non_fasting",
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_not_blood",
        kind: "test",
        occurredAt: "2026-03-13T08:00:00Z",
        source: "import",
        title: "Urine study",
        testName: "urine_study",
        testCategory: "urine",
        specimenType: "urine",
      }),
    ].join("\n") + "\n",
  );

  const directBloodFromCategory = toBloodTestRecord(
    {
      id: "evt_direct_category",
      kind: "test",
      occurredAt: "2026-03-13T09:00:00Z",
      title: "Direct category",
      testCategory: "blood",
      specimenType: "serum",
    },
    "ledger/events/2026/2026-03.jsonl",
  );
  const directBloodFromSpecimen = toBloodTestRecord(
    {
      id: "evt_direct_specimen",
      kind: "test",
      occurredAt: "2026-03-13T09:00:00Z",
      title: "Direct specimen",
      specimenType: "serum",
    },
    "ledger/events/2026/2026-03.jsonl",
  );
  const notBlood = toBloodTestRecord(
    {
      id: "evt_direct_other",
      kind: "test",
      occurredAt: "2026-03-13T09:00:00Z",
      title: "Direct other",
      specimenType: "urine",
    },
    "ledger/events/2026/2026-03.jsonl",
  );

  assert.ok(directBloodFromCategory);
  assert.ok(directBloodFromSpecimen);
  assert.equal(notBlood, null);
  assert.equal(directBloodFromCategory?.kind, "blood_test");
  assert.equal(directBloodFromSpecimen?.kind, "blood_test");

  const bloodTests = await listBloodTests(vaultRoot);
  assert.deepEqual(bloodTests.map((record) => record.id), ["evt_blood_a", "evt_blood_b"]);
  assert.equal((await readBloodTest(vaultRoot, "evt_blood_b"))?.labName, "Quest");
  assert.equal((await showBloodTest(vaultRoot, "functional_panel"))?.id, "evt_blood_a");
  assert.deepEqual(await listBloodTests(vaultRoot, { status: "mixed" }).then((records) => records.map((record) => record.id)), [
    "evt_blood_a",
  ]);
});

test("supplement readers keep legacy ingredients, derived compounds, and status filters deterministic", async () => {
  const vaultRoot = await createVaultRoot("murph-query-coverage-supplements-");

  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/liposomal-vitamin-c.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_new",
      "slug: liposomal-vitamin-c",
      "title: Liposomal Vitamin C",
      "status: active",
      "kind: supplement",
      "brand: LivOn Labs",
      "manufacturer: LivOn Laboratories",
      "ingredients:",
      "  -",
      "    compound: Vitamin C",
      "    label: Ascorbic acid",
      "    amount: 500",
      "    unit: mg",
      "  -",
      "    compound: Calcium",
      "    amount: 100",
      "    unit: mg",
      "---",
      "",
      "# Liposomal Vitamin C",
      "",
      "Vitamin C and calcium combo.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/electrolyte-c-mix.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_legacy",
      "slug: electrolyte-c-mix",
      "title: Electrolyte C Mix",
      "status: active",
      "kind: supplement",
      "substance: Vitamin C",
      "dose: 250",
      "unit: mg",
      "---",
      "",
      "# Electrolyte C Mix",
      "",
      "Legacy single-compound supplement.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/cold-support.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_stopped",
      "slug: cold-support",
      "title: Cold Support",
      "status: stopped",
      "kind: supplement",
      "ingredients:",
      "  -",
      "    compound: Vitamin C",
      "    amount: null",
      "    unit: mg",
      "---",
      "",
      "# Cold Support",
      "",
      "Stopped supplement.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/protocols/recovery/cold-shower.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_non_supplement",
      "slug: cold-shower",
      "title: Cold Shower",
      "status: active",
      "kind: recovery",
      "---",
      "",
      "# Cold Shower",
      "",
      "Not a supplement.",
      "",
    ].join("\n"),
  );

  const supplements = await listSupplements(vaultRoot);
  const compounds = await listSupplementCompounds(vaultRoot);
  const stoppedCompounds = await listSupplementCompounds(vaultRoot, { status: "stopped" });

  assert.deepEqual(supplements.map((record) => record.entity.id), [
    "prot_stopped",
    "prot_legacy",
    "prot_new",
  ]);
  assert.equal((await readSupplement(vaultRoot, "prot_new"))?.entity.kind, "supplement");
  assert.equal((await readSupplement(vaultRoot, "prot_non_supplement")), null);

  assert.deepEqual(compounds.map((record) => record.lookupId), [
    "calcium",
    "vitamin-c",
  ]);
  assert.equal((await showSupplementCompound(vaultRoot, "Ascorbic acid"))?.lookupId, "vitamin-c");
  assert.deepEqual(compounds.find((record) => record.lookupId === "vitamin-c")?.totals, [
    {
      unit: "mg",
      totalAmount: 750,
      sourceCount: 2,
      incomplete: false,
    },
  ]);
  assert.deepEqual(stoppedCompounds.map((record) => record.lookupId), ["vitamin-c"]);
  assert.deepEqual(stoppedCompounds[0]?.totals, [
    {
      unit: "mg",
      totalAmount: null,
      sourceCount: 1,
      incomplete: true,
    },
  ]);
  assert.equal((await showSupplementCompound(vaultRoot, "Vitamin C", { status: "stopped" }))?.lookupId, "vitamin-c");
});

test("registry readers sort by bank metadata and drop incomplete records", async () => {
  const vaultRoot = await createVaultRoot("murph-query-coverage-registries-");

  await writeVaultFile(
    vaultRoot,
    "bank/goals/goal-alpha.md",
    [
      "---",
      "goalId: goal_alpha",
      "title: Alpha goal",
      "priority: 2",
      "status: active",
      "---",
      "",
      "# Alpha goal",
      "",
      "Goal body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/goals/goal-beta.md",
    [
      "---",
      "goalId: goal_beta",
      "title: Beta goal",
      "priority: 1",
      "status: active",
      "---",
      "",
      "# Beta goal",
      "",
      "Goal body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/genetics/variant-alpha.md",
    [
      "---",
      "variantId: variant_alpha",
      "title: Zeta variant",
      "gene: MTHFR",
      "significance: risk_factor",
      "---",
      "",
      "# Zeta variant",
      "",
      "Variant body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/genetics/variant-beta.md",
    [
      "---",
      "variantId: variant_beta",
      "title: Alpha variant",
      "gene: APOE",
      "significance: risk_factor",
      "---",
      "",
      "# Alpha variant",
      "",
      "Variant body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/foods/food-alpha.md",
    [
      "---",
      "foodId: food_alpha",
      "title: Banana bowl",
      "status: active",
      "---",
      "",
      "# Banana bowl",
      "",
      "Food body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/foods/food-beta.md",
    [
      "---",
      "foodId: food_beta",
      "title: Apple bowl",
      "status: active",
      "---",
      "",
      "# Apple bowl",
      "",
      "Food body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    "bank/foods/food-missing-id.md",
    [
      "---",
      "title: Missing id",
      "status: active",
      "---",
      "",
      "# Missing id",
      "",
      "Food body.",
      "",
    ].join("\n"),
  );

  assert.deepEqual((await listRegistryRecords(vaultRoot, goalRegistryDefinition)).map((record) => record.entity.id), [
    "goal_beta",
    "goal_alpha",
  ]);
  assert.deepEqual((await listRegistryRecords(vaultRoot, geneticsRegistryDefinition)).map((record) => record.entity.id), [
    "variant_beta",
    "variant_alpha",
  ]);
  assert.deepEqual((await listRegistryRecords(vaultRoot, foodRegistryDefinition)).map((record) => record.entity.id), [
    "food_beta",
    "food_alpha",
  ]);
  assert.deepEqual(
    (await listRegistryRecords(vaultRoot, foodRegistryDefinition, { text: "missing" })).map((record) => record.entity.id),
    [],
  );
  assert.deepEqual(
    (await listRegistryRecords(vaultRoot, goalRegistryDefinition, { status: "inactive" })).map((record) => record.entity.id),
    [],
  );
});

test("registry priority helpers and protocol projection keep sort and self-link branches stable", () => {
  assert.equal(readPriority({ priority: 3 }, ["priority"]), 3);
  assert.equal(readPriority({ priority: "not numeric" }, ["priority"]), null);
  assert.equal(
    buildPriorityTitleComparator(
      { id: "alpha", slug: "alpha", status: "active", title: "Alpha", priority: 1 },
      { id: "beta", slug: "beta", status: "active", title: "Beta", priority: 1 },
    ) < 0,
    true,
  );

  const projected = projectRegistryEntity("protocol", {
    entity: {
      id: "prot_coverage",
      slug: "coverage-protocol",
      status: "active",
      title: "Coverage protocol",
    },
    document: {
      relativePath: "bank/protocols/supplements/coverage-protocol.md",
      markdown: "# Coverage protocol",
      body: "# Coverage protocol",
      attributes: {
        protocolId: "prot_coverage",
        goalId: "goal_coverage",
        relatedProtocolIds: ["prot_other"],
        status: "active",
        title: "Coverage protocol",
        kind: "supplement",
        updatedAt: "2026-03-12T10:00:00Z",
      },
    },
  });

  assert.deepEqual(projected.links, [
    { type: "supports_goal", targetId: "goal_coverage" },
    { type: "related_to", targetId: "prot_other" },
  ]);
  assert.deepEqual(projected.relatedIds, ["goal_coverage", "prot_other"]);
  assert.equal(projected.occurredAt, "2026-03-12T10:00:00Z");
});
