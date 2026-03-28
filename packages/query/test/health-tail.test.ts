import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  buildExportPack,
  buildTimeline,
  getVaultEntities,
  listBloodTests,
  listEntities,
  listHistoryEvents,
  listProfileSnapshots,
  listRecords,
  listSupplementCompounds,
  listSupplements,
  readCurrentProfile,
  lookupEntityById,
  readVault,
  readVaultTolerant,
  searchVault,
  showBloodTest,
  showSupplementCompound,
  showProfile,
} from "../src/index.ts";
import { collectCanonicalEntities } from "../src/health/canonical-collector.ts";
import { ALL_VAULT_RECORD_TYPES } from "../src/model.ts";
import { readHealthContext } from "../src/export-pack-health.ts";
import { listAssessments } from "../src/health/assessments.ts";
import {
  resolveCurrentProfileRecord,
  selectAssessmentRecords,
  selectHistoryRecords,
  selectProfileSnapshotRecords,
} from "../src/health/projections.ts";
import type { VaultReadModel, VaultRecord } from "../src/model.ts";

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

async function appendVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  });
  await writeFile(path.join(vaultRoot, relativePath), contents, {
    encoding: "utf8",
    flag: "a",
  });
}

async function createHealthVault(options: {
  currentProfileSnapshotId?: string;
  includeAlternateRecords?: boolean;
} = {}): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-health-"));
  const currentProfileSnapshotId = options.currentProfileSnapshotId ?? "psnap_stale";

  await writeVaultFile(
    vaultRoot,
    "ledger/assessments/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.assessment-response.v1",
        id: "asmt_health_01",
        assessmentType: "full-intake",
        recordedAt: "2026-03-12T13:00:00Z",
        importedAt: "2026-03-12T13:05:00Z",
        source: "import",
        rawPath: "raw/assessments/2026/03/asmt_health_01/source.json",
        title: "Comprehensive intake questionnaire",
        questionnaireSlug: "health-history-intake",
        responses: {
          sleep: {
            averageHours: 6.5,
          },
        },
        relatedIds: ["goal_sleep_01"],
      }),
      options.includeAlternateRecords
        ? JSON.stringify({
            schemaVersion: "murph.assessment-response.v1",
            id: "asmt_health_00",
            assessmentType: "follow-up",
            recordedAt: "2026-03-01T08:00:00Z",
            source: "import",
            response: {
              energy: "improving",
            },
          })
        : null,
      options.includeAlternateRecords
        ? JSON.stringify({
            schemaVersion: "murph.assessment-response.v1",
            id: "asmt_health_missing_date",
            assessmentType: "partial",
            source: "import",
            responses: {
              notes: "Missing date should be filtered from date-scoped exports.",
            },
          })
        : null,
      options.includeAlternateRecords
        ? JSON.stringify({
            schemaVersion: "murph.assessment-response.v1",
            id: "asmt_health_before",
            assessmentType: "historical",
            recordedAt: "2026-02-20T08:00:00Z",
            source: "import",
          })
        : null,
      options.includeAlternateRecords
        ? JSON.stringify({
            schemaVersion: "murph.assessment-response.v1",
            id: "asmt_health_undated",
            assessmentType: "undated",
            source: "import",
          })
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n") + "\n",
  );

  await writeVaultFile(
    vaultRoot,
    "ledger/profile-snapshots/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.profile-snapshot.v1",
        id: "psnap_health_01",
        recordedAt: "2026-03-12T14:00:00Z",
        source: "assessment_projection",
        sourceAssessmentIds: ["asmt_health_01"],
        profile: {
          topGoalIds: ["goal_sleep_01"],
          sleep: {
            averageHours: 6.5,
          },
        },
      }),
      options.includeAlternateRecords
        ? JSON.stringify({
            schemaVersion: "murph.profile-snapshot.v1",
            id: "psnap_health_00",
            recordedAt: "2026-03-01T09:00:00Z",
            source: {
              kind: "projection",
              assessmentId: "asmt_health_00",
            },
            profile: {
              topGoalIds: ["goal_sleep_legacy"],
            },
          })
        : null,
      options.includeAlternateRecords
        ? JSON.stringify({
            schemaVersion: "murph.profile-snapshot.v1",
            id: "psnap_health_missing_date",
            source: "manual",
            profile: {
              topGoalIds: ["goal_missing_date"],
            },
          })
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n") + "\n",
  );

  await writeVaultFile(
    vaultRoot,
    "ledger/events/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_health_01",
        kind: "encounter",
        occurredAt: "2026-03-12T12:45:00Z",
        recordedAt: "2026-03-12T12:50:00Z",
        source: "manual",
        title: "Sleep medicine intake visit",
        relatedIds: ["goal_sleep_01", "cond_sleep_01"],
      }),
      options.includeAlternateRecords
        ? JSON.stringify({
            schemaVersion: "murph.event.v1",
            id: "evt_note_ignored",
            kind: "note",
            occurredAt: "2026-03-12T15:00:00Z",
            title: "Ignored note event",
          })
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n") + "\n",
  );

  await writeVaultFile(
    vaultRoot,
    "bank/profile/current.md",
    `---
schemaVersion: murph.frontmatter.profile-current.v1
docType: profile_current
snapshotId: ${currentProfileSnapshotId}
updatedAt: 2026-03-01T00:00:00Z
---
# Current Profile

Snapshot ID: \`${currentProfileSnapshotId}\`
`,
  );

  await writeVaultFile(
    vaultRoot,
    "bank/goals/improve-sleep.md",
    `---
schemaVersion: hv/goal@v1
goalId: goal_sleep_01
slug: improve-sleep
title: Improve sleep quality and duration
status: active
horizon: long_term
priority: 1
---
# Improve sleep quality and duration
`,
  );

  if (options.includeAlternateRecords) {
    await writeVaultFile(
      vaultRoot,
      "bank/goals/ignored.md",
      `---
schemaVersion: hv/goal@v1
title: Missing id should be ignored
---
# Ignored
`,
    );
  }

  await writeVaultFile(
    vaultRoot,
    "bank/conditions/insomnia-symptoms.md",
    `---
schemaVersion: hv/condition@v1
conditionId: cond_sleep_01
slug: insomnia-symptoms
title: Insomnia symptoms
clinicalStatus: active
---
# Insomnia symptoms
`,
  );

  await writeVaultFile(
    vaultRoot,
    "bank/allergies/penicillin.md",
    `---
schemaVersion: hv/allergy@v1
allergyId: alg_01
slug: penicillin
title: Penicillin
status: active
---
# Penicillin
`,
  );

  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/magnesium-glycinate.md",
    `---
schemaVersion: hv/protocol@v1
protocolId: prot_01
slug: magnesium-glycinate
title: Magnesium glycinate
status: active
kind: supplement
---
# Magnesium glycinate
`,
  );

  await writeVaultFile(
    vaultRoot,
    "bank/family/mother.md",
    `---
schemaVersion: hv/family@v1
familyMemberId: fam_01
slug: mother
title: Mother
relationship: mother
updatedAt: 2026-03-12
---
# Mother
`,
  );

  await writeVaultFile(
    vaultRoot,
    "bank/genetics/mthfr-c677t.md",
    `---
schemaVersion: hv/genetics@v1
variantId: var_01
slug: mthfr-c677t
title: MTHFR C677T
significance: risk_factor
updatedAt: 2026-03-12
---
# MTHFR C677T
`,
  );

  return vaultRoot;
}

test("supplement queries project product metadata and aggregate overlapping compounds", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-supplements-"));

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/protocols/supplements/liposomal-vitamin-c.md",
      `---
schemaVersion: hv/protocol@v1
protocolId: prot_new
slug: liposomal-vitamin-c
title: Liposomal Vitamin C
status: active
kind: supplement
startedOn: 2026-03-01
brand: LivOn Labs
manufacturer: LivOn Laboratories
servingSize: 1 packet
ingredients:
  -
    compound: Vitamin C
    label: Ascorbic acid
    amount: 500
    unit: mg
  -
    compound: Phosphatidylcholine
    amount: 1200
    unit: mg
---
# Liposomal Vitamin C
`,
    );

    await writeVaultFile(
      vaultRoot,
      "bank/protocols/supplements/electrolyte-c-mix.md",
      `---
schemaVersion: hv/protocol@v1
protocolId: prot_legacy
slug: electrolyte-c-mix
title: Electrolyte C Mix
status: active
kind: supplement
startedOn: 2026-03-02
substance: Vitamin C
dose: 250
unit: mg
schedule: post-training
---
# Electrolyte C Mix
`,
    );

    await writeVaultFile(
      vaultRoot,
      "bank/protocols/supplements/cold-support.md",
      `---
schemaVersion: hv/protocol@v1
protocolId: prot_stopped
slug: cold-support
title: Cold Support
status: stopped
kind: supplement
startedOn: 2026-01-15
stoppedOn: 2026-02-01
ingredients:
  -
    compound: Vitamin C
    amount: 1000
    unit: mg
---
# Cold Support
`,
    );

    const supplements = await listSupplements(vaultRoot);
    const activeCompounds = await listSupplementCompounds(vaultRoot);
    const vitaminC = await showSupplementCompound(vaultRoot, "vitamin-c");
    const stoppedVitaminC = await showSupplementCompound(vaultRoot, "Vitamin C", {
      status: "stopped",
    });
    const liposomal = supplements.find((record) => record.id === "prot_new") ?? null;

    assert.equal(supplements.length, 3);
    assert.equal(liposomal?.brand, "LivOn Labs");
    assert.equal(liposomal?.manufacturer, "LivOn Laboratories");
    assert.equal(liposomal?.servingSize, "1 packet");
    assert.deepEqual(liposomal?.ingredients, [
      {
        compound: "Vitamin C",
        label: "Ascorbic acid",
        amount: 500,
        unit: "mg",
        active: true,
        note: null,
      },
      {
        compound: "Phosphatidylcholine",
        label: null,
        amount: 1200,
        unit: "mg",
        active: true,
        note: null,
      },
    ]);
    assert.deepEqual(
      activeCompounds.map((record) => record.lookupId),
      ["phosphatidylcholine", "vitamin-c"],
    );
    assert.deepEqual(vitaminC?.totals, [
      {
        unit: "mg",
        totalAmount: 750,
        sourceCount: 2,
        incomplete: false,
      },
    ]);
    assert.equal(vitaminC?.supplementCount, 2);
    assert.deepEqual(vitaminC?.supplementIds, ["prot_legacy", "prot_new"]);
    assert.deepEqual(
      vitaminC?.sources.map((source) => source.supplementId),
      ["prot_legacy", "prot_new"],
    );
    assert.equal(vitaminC?.sources[1]?.brand, "LivOn Labs");
    assert.deepEqual(stoppedVitaminC?.totals, [
      {
        unit: "mg",
        totalAmount: 1000,
        sourceCount: 1,
        incomplete: false,
      },
    ]);
    assert.equal(stoppedVitaminC?.supplementCount, 1);
    assert.deepEqual(stoppedVitaminC?.supplementIds, ["prot_stopped"]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

function createRecord(overrides: Partial<VaultRecord> & Pick<VaultRecord, "displayId" | "recordType">): VaultRecord {
  const hasTitle = Object.prototype.hasOwnProperty.call(overrides, "title");
  const hasKind = Object.prototype.hasOwnProperty.call(overrides, "kind");
  const hasStatus = Object.prototype.hasOwnProperty.call(overrides, "status");
  const hasStream = Object.prototype.hasOwnProperty.call(overrides, "stream");
  const hasExperimentSlug = Object.prototype.hasOwnProperty.call(overrides, "experimentSlug");

  return {
    displayId: overrides.displayId,
    primaryLookupId: overrides.primaryLookupId ?? overrides.displayId,
    lookupIds: overrides.lookupIds ?? [overrides.displayId],
    recordType: overrides.recordType,
    sourcePath: overrides.sourcePath ?? `${overrides.recordType}/${overrides.displayId}`,
    sourceFile: overrides.sourceFile ?? `${overrides.recordType}/${overrides.displayId}`,
    occurredAt: overrides.occurredAt ?? null,
    date: overrides.date ?? null,
    kind: hasKind ? overrides.kind ?? null : overrides.recordType,
    status: hasStatus ? overrides.status ?? null : null,
    stream: hasStream ? overrides.stream ?? null : null,
    experimentSlug: hasExperimentSlug ? overrides.experimentSlug ?? null : null,
    title: hasTitle ? overrides.title ?? null : overrides.displayId,
    tags: overrides.tags ?? [],
    data: overrides.data ?? {},
    body: overrides.body ?? null,
    frontmatter: overrides.frontmatter ?? null,
    relatedIds: overrides.relatedIds,
  };
}

function createManualVault(records: VaultRecord[]): VaultReadModel {
  return {
    format: "murph.query.v1",
    vaultRoot: "manual-vault",
    metadata: null,
    entities: records.map((record) => ({
      entityId: record.displayId,
      primaryLookupId: record.primaryLookupId,
      lookupIds: record.lookupIds,
      family: record.recordType,
      kind: record.kind ?? record.recordType,
      status: record.status ?? null,
      occurredAt: record.occurredAt,
      date: record.date,
      path: record.sourcePath,
      title: record.title,
      body: record.body,
      attributes: record.data,
      frontmatter: record.frontmatter,
      relatedIds: record.relatedIds ?? [],
      stream: record.stream,
      experimentSlug: record.experimentSlug,
      tags: record.tags,
    })),
    coreDocument: records.find((record) => record.recordType === "core") ?? null,
    experiments: records.filter((record) => record.recordType === "experiment"),
    journalEntries: records.filter((record) => record.recordType === "journal"),
    events: records.filter((record) => record.recordType === "event"),
    samples: records.filter((record) => record.recordType === "sample"),
    audits: records.filter((record) => record.recordType === "audit"),
    assessments: records.filter((record) => record.recordType === "assessment"),
    profileSnapshots: records.filter((record) => record.recordType === "profile_snapshot"),
    currentProfile: records.find((record) => record.recordType === "current_profile") ?? null,
    goals: records.filter((record) => record.recordType === "goal"),
    conditions: records.filter((record) => record.recordType === "condition"),
    allergies: records.filter((record) => record.recordType === "allergy"),
    protocols: records.filter((record) => record.recordType === "protocol"),
    history: records.filter((record) => record.recordType === "history"),
    familyMembers: records.filter((record) => record.recordType === "family"),
    geneticVariants: records.filter((record) => record.recordType === "genetics"),
    records,
  };
}

test("showProfile derives the current profile from the latest snapshot when the markdown page is stale", async () => {
  const vaultRoot = await createHealthVault();

  try {
    const current = await showProfile(vaultRoot, "current");

    assert.ok(current);
    assert.equal(current.id, "current");
    if (!("snapshotId" in current)) {
      throw new Error("Expected the derived current-profile record.");
    }
    assert.equal(current.snapshotId, "psnap_health_01");
    assert.deepEqual(current.topGoalIds, ["goal_sleep_01"]);
    assert.equal(current.markdown, null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readCurrentProfile falls back to the latest snapshot when current-profile markdown is malformed", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
  });

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/profile/current.md",
      `---
schemaVersion: murph.frontmatter.profile-current.v1
snapshotId psnap_health_01
---
# Current Profile
`,
    );

    const current = await readCurrentProfile(vaultRoot);

    assert.ok(current);
    assert.equal(current.snapshotId, "psnap_health_01");
    assert.deepEqual(current.topGoalIds, ["goal_sleep_01"]);
    assert.equal(current.markdown, null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readCurrentProfile retains the raw current-profile markdown when the document matches the latest snapshot", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
  });

  try {
    const current = await readCurrentProfile(vaultRoot);

    assert.ok(current);
    assert.equal(current.snapshotId, "psnap_health_01");
    assert.match(current.markdown ?? "", /^---\n/);
    assert.match(current.markdown ?? "", /docType: profile_current/);
    assert.match(current.markdown ?? "", /updatedAt: 2026-03-01T00:00:00Z/);
    assert.match(current.body ?? "", /^# Current Profile/);
    assert.notEqual(current.markdown, current.body);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("dedicated health readers stay aligned with the shared canonical collector selectors", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
    includeAlternateRecords: true,
  });

  try {
    const collected = await collectCanonicalEntities(vaultRoot, {
      mode: "strict-async",
    });

    assert.deepEqual(
      await listAssessments(vaultRoot),
      selectAssessmentRecords(collected.assessments),
    );
    assert.deepEqual(
      await listHistoryEvents(vaultRoot),
      selectHistoryRecords(collected.history),
    );
    assert.deepEqual(
      await listProfileSnapshots(vaultRoot),
      selectProfileSnapshotRecords(collected.profileSnapshots),
    );
    assert.deepEqual(
      await readCurrentProfile(vaultRoot),
      resolveCurrentProfileRecord(
        collected.currentProfile,
        collected.markdownByPath,
      ),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("strict narrow health readers ignore malformed unrelated registry markdown", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
    includeAlternateRecords: true,
  });

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/genetics/broken.md",
      `---
schemaVersion: hv/genetics@v1
variantId: var_broken
slug broken-frontmatter
---
# Broken
`,
    );

    assert.deepEqual(
      (await listAssessments(vaultRoot)).map((record) => record.id),
      ["asmt_health_01", "asmt_health_00", "asmt_health_before", "asmt_health_missing_date", "asmt_health_undated"],
    );
    assert.deepEqual(
      (await listHistoryEvents(vaultRoot)).map((record) => record.id),
      ["evt_health_01"],
    );
    assert.deepEqual(
      (await listProfileSnapshots(vaultRoot)).map((record) => record.id),
      ["psnap_health_01", "psnap_health_00", "psnap_health_missing_date"],
    );
    assert.equal((await readCurrentProfile(vaultRoot))?.snapshotId, "psnap_health_01");
    await assert.rejects(
      () => readVault(vaultRoot),
      /Failed to parse frontmatter at bank\/genetics\/broken\.md:/,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("profile snapshot list accepts day-only date bounds for recorded timestamps", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
    includeAlternateRecords: true,
  });

  try {
    const snapshots = await listProfileSnapshots(vaultRoot, {
      from: "2026-03-12",
      to: "2026-03-12",
    });

    assert.deepEqual(
      snapshots.map((record) => record.id),
      ["psnap_health_01"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("profile snapshot recency tie-break stays aligned between listing and current-profile fallback", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_stale",
  });

  try {
    await writeVaultFile(
      vaultRoot,
      "ledger/profile-snapshots/2026/2026-03.jsonl",
      [
        JSON.stringify({
          schemaVersion: "murph.profile-snapshot.v1",
          id: "psnap_same_01",
          recordedAt: "2026-03-12T14:00:00Z",
          sourceAssessmentIds: ["asmt_health_01"],
          profile: {
            topGoalIds: ["goal_same_01"],
          },
        }),
        JSON.stringify({
          schemaVersion: "murph.profile-snapshot.v1",
          id: "psnap_same_02",
          recordedAt: "2026-03-12T14:00:00Z",
          sourceEventIds: ["evt_health_01"],
          profile: {
            topGoalIds: ["goal_same_02"],
          },
        }),
      ].join("\n") + "\n",
    );

    const snapshots = await listProfileSnapshots(vaultRoot);
    const current = await readCurrentProfile(vaultRoot);

    assert.deepEqual(
      snapshots.map((record) => record.id),
      ["psnap_same_01", "psnap_same_02"],
    );
    assert.equal(current?.snapshotId, "psnap_same_01");
    assert.deepEqual(current?.sourceAssessmentIds, ["asmt_health_01"]);
    assert.deepEqual(current?.topGoalIds, ["goal_same_01"]);
    assert.equal(current?.markdown, null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("blood tests can be queried through dedicated helpers while remaining canonical history events", async () => {
  const vaultRoot = await createHealthVault();

  try {
    await appendVaultFile(
      vaultRoot,
      "ledger/events/2026/2026-03.jsonl",
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_blood_01",
        kind: "test",
        occurredAt: "2026-03-13T08:00:00Z",
        recordedAt: "2026-03-13T08:05:00Z",
        dayKey: "2026-03-13",
        source: "import",
        title: "Functional health panel",
        testName: "functional_health_panel",
        resultStatus: "mixed",
        testCategory: "blood",
        specimenType: "serum",
        labName: "Function Health",
        fastingStatus: "fasting",
        results: [
          {
            analyte: "Apolipoprotein B",
            value: 87,
            unit: "mg/dL",
            flag: "normal",
          },
          {
            analyte: "LDL Cholesterol",
            value: 134,
            unit: "mg/dL",
            flag: "high",
          },
        ],
        tags: ["lab", "lipids"],
        relatedIds: ["goal_sleep_01"],
      })}\n`,
    );

    const listResult = await listBloodTests(vaultRoot, {
      status: "mixed",
    });
    const showResult = await showBloodTest(vaultRoot, "evt_blood_01");
    const vault = await readVault(vaultRoot);
    const bloodEntity = lookupEntityById(vault, "evt_blood_01");

    assert.equal(listResult.length, 1);
    assert.equal(listResult[0]?.kind, "blood_test");
    assert.equal(listResult[0]?.status, "mixed");
    assert.equal(listResult[0]?.labName, "Function Health");
    assert.equal(listResult[0]?.specimenType, "serum");
    assert.equal(listResult[0]?.data.testCategory, "blood");
    assert.equal(showResult?.id, "evt_blood_01");
    assert.equal(showResult?.testName, "functional_health_panel");
    assert.equal(showResult?.status, "mixed");
    assert.equal(showResult?.labName, "Function Health");
    assert.equal(bloodEntity?.kind, "test");
    assert.equal(bloodEntity?.status, "mixed");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault promotes health families into the shared search and timeline projection", async () => {
  const vaultRoot = await createHealthVault();

  try {
    const vault = await readVault(vaultRoot);
    const searchResult = searchVault(vault, "sleep", {
      recordTypes: ["history", "assessment", "goal"],
    });
    const timeline = buildTimeline(vault, {
      from: "2026-03-12",
      to: "2026-03-12",
    });

    assert.deepEqual(
      new Set(vault.records.map((record) => record.recordType)),
      new Set([
        "allergy",
        "assessment",
        "condition",
        "current_profile",
        "family",
        "genetics",
        "goal",
        "history",
        "profile_snapshot",
        "protocol",
      ]),
    );
    assert.deepEqual(
      new Set(searchResult.hits.map((hit) => hit.recordType)),
      new Set(["history", "assessment", "goal"]),
    );
    assert.deepEqual(
      new Set(timeline.map((entry) => entry.entryType)),
      new Set(["assessment", "history", "profile_snapshot"]),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("canonical entity helpers filter projected health families and preserve legacy record defaults", () => {
  const records = [
    createRecord({
      displayId: "asmt_manual_01",
      recordType: "assessment",
      occurredAt: "2026-03-12T09:00:00Z",
      date: "2026-03-12",
      kind: "assessment",
      status: "accepted",
      title: "Mood follow-up",
      tags: ["sleep", "health"],
      data: {
        assessmentType: "mood",
        relatedIds: ["goal_manual_01"],
      },
    }),
    createRecord({
      displayId: "goal_manual_01",
      recordType: "goal",
      lookupIds: ["goal_manual_01", "improve-sleep"],
      date: "2026-03-12",
      status: "active",
      title: "Improve sleep consistency",
      tags: ["sleep"],
      data: {
        slug: "improve-sleep",
        status: "active",
      },
    }),
    createRecord({
      displayId: "sample_manual_01",
      recordType: "sample",
      occurredAt: "2026-03-12T07:00:00Z",
      date: "2026-03-12",
      stream: "glucose",
      title: "glucose sample",
      tags: ["glucose"],
      data: {
        value: 91,
        unit: "mg_dL",
      },
    }),
  ];
  const vault = createManualVault(records);

  assert.deepEqual(
    getVaultEntities(vault).map((entity) => entity.family),
    ["assessment", "goal", "sample"],
  );
  assert.equal(lookupEntityById(vault, "improve-sleep")?.entityId, "goal_manual_01");
  assert.equal(lookupEntityById(vault, "  ")?.entityId, undefined);
  assert.deepEqual(
    listEntities(vault, {
      families: ["assessment"],
      statuses: ["accepted"],
      tags: ["sleep"],
      from: "2026-03-12",
      to: "2026-03-12",
      text: "mood",
    }).map((entity) => entity.entityId),
    ["asmt_manual_01"],
  );
  assert.deepEqual(
    listEntities(vault, {
      streams: ["glucose"],
      from: "2026-03-12",
      to: "2026-03-12",
      text: "mg_dl",
    }).map((entity) => entity.entityId),
    ["sample_manual_01"],
  );
  assert.deepEqual(
    listRecords(vault).map((record) => record.recordType),
    ["assessment", "goal", "sample"],
  );
  assert.deepEqual(
    listRecords(vault, {
      recordTypes: [...ALL_VAULT_RECORD_TYPES],
    }).map((record) => record.recordType),
    ["assessment", "goal", "sample"],
  );
  assert.deepEqual(
    listRecords(vault, {
      recordTypes: ["assessment", "goal"],
      text: "sleep",
    }).map((record) => record.displayId),
    ["goal_manual_01"],
  );
});

test("readVault rejects malformed health inputs in the strict shared collector", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
    includeAlternateRecords: true,
  });

  try {
    await rm(path.join(vaultRoot, "bank/profile/current.md"), { force: true });
    await appendVaultFile(
      vaultRoot,
      "ledger/profile-snapshots/2026/2026-03.jsonl",
      "{this is not valid json}\n",
    );
    await writeVaultFile(
      vaultRoot,
      "bank/conditions/broken.md",
      `---
schemaVersion: hv/condition@v1
conditionId cond_broken
---
# Broken
`,
    );

    await assert.rejects(
      () => readVault(vaultRoot),
      /Failed to parse JSONL at ledger\/profile-snapshots\/2026\/2026-03\.jsonl:4:/,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVaultTolerant falls back to the latest snapshot when current profile is missing and skips malformed health inputs", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
    includeAlternateRecords: true,
  });

  try {
    await rm(path.join(vaultRoot, "bank/profile/current.md"), { force: true });
    await appendVaultFile(
      vaultRoot,
      "ledger/profile-snapshots/2026/2026-03.jsonl",
      "{this is not valid json}\n",
    );
    await writeVaultFile(
      vaultRoot,
      "bank/conditions/broken.md",
      `---
schemaVersion: hv/condition@v1
conditionId cond_broken
---
# Broken
`,
    );

    const vault = await readVaultTolerant(vaultRoot);

    assert.equal(vault.currentProfile?.displayId, "current");
    assert.equal(vault.currentProfile?.data.snapshotId, "psnap_health_01");
    assert.deepEqual(
      vault.profileSnapshots.map((record) => record.displayId),
      ["psnap_health_00", "psnap_health_01", "psnap_health_missing_date"],
    );
    assert.deepEqual(
      vault.conditions.map((record) => record.displayId),
      ["cond_sleep_01"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault rejects malformed current-profile frontmatter in the strict shared collector", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
  });

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/profile/current.md",
      `---
schemaVersion: murph.frontmatter.profile-current.v1
snapshotId psnap_health_01
---
# Current Profile
`,
    );

    await assert.rejects(
      () => readVault(vaultRoot),
      /Failed to parse frontmatter at bank\/profile\/current\.md:/,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault rejects malformed registry frontmatter in the strict shared collector", async () => {
  const vaultRoot = await createHealthVault();

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/conditions/broken.md",
      `---
schemaVersion: hv/condition@v1
conditionId cond_broken
---
# Broken
`,
    );

    await assert.rejects(
      () => readVault(vaultRoot),
      /Failed to parse frontmatter at bank\/conditions\/broken\.md:/,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("buildTimeline applies health-specific fallbacks, related-id defaults, and toggles", () => {
  const vault = createManualVault([
    createRecord({
      displayId: "journal_manual_01",
      recordType: "journal",
      occurredAt: "2026-03-12T21:00:00Z",
      date: "2026-03-12",
      title: "Daily journal",
    }),
    createRecord({
      displayId: "event_manual_01",
      recordType: "event",
      date: "2026-03-12",
      kind: null,
      stream: "glucose",
      title: null,
      lookupIds: ["event_manual_01", "evt_lookup"],
    }),
    createRecord({
      displayId: "assessment_manual_01",
      recordType: "assessment",
      date: "2026-03-12",
      kind: null,
      title: null,
      lookupIds: ["assessment_manual_01", "goal_manual_01"],
      data: {
        assessmentType: "Mood check",
      },
    }),
    createRecord({
      displayId: "assessment_skip",
      recordType: "assessment",
      occurredAt: null,
      date: null,
      title: "Skipped assessment",
    }),
    createRecord({
      displayId: "history_manual_01",
      recordType: "history",
      date: "2026-03-12",
      kind: null,
      title: null,
      lookupIds: ["history_manual_01", "evt_health_lookup"],
    }),
    createRecord({
      displayId: "history_skip",
      recordType: "history",
      occurredAt: null,
      date: null,
      title: "Skipped history",
    }),
    createRecord({
      displayId: "snapshot_manual_01",
      recordType: "profile_snapshot",
      date: "2026-03-12",
      kind: null,
      title: null,
      lookupIds: ["snapshot_manual_01", "psnap_lookup"],
    }),
    createRecord({
      displayId: "snapshot_skip",
      recordType: "profile_snapshot",
      occurredAt: null,
      date: null,
      title: "Skipped snapshot",
    }),
    createRecord({
      displayId: "sample_manual_01",
      recordType: "sample",
      occurredAt: "2026-03-12T06:00:00Z",
      date: "2026-03-12",
      stream: "glucose",
      data: {
        value: 92,
        unit: "mg_dL",
      },
    }),
    createRecord({
      displayId: "sample_skip",
      recordType: "sample",
      occurredAt: null,
      date: null,
      stream: null,
    }),
  ]);

  const limitedHealthTimeline = buildTimeline(vault, {
    includeJournal: false,
    includeEvents: false,
    includeDailySampleSummaries: false,
    limit: 0,
  });

  assert.deepEqual(limitedHealthTimeline.map((entry) => entry.id), ["assessment_manual_01"]);
  assert.equal(limitedHealthTimeline[0]?.title, "Mood check");
  assert.deepEqual(limitedHealthTimeline[0]?.relatedIds, ["assessment_manual_01", "goal_manual_01"]);

  const filteredTimeline = buildTimeline(vault, {
    kinds: ["assessment", "history", "sample_summary"],
    streams: ["glucose"],
    includeJournal: false,
    includeProfileSnapshots: false,
    limit: 999,
  });

  assert.deepEqual(
    filteredTimeline.map((entry) => [entry.id, entry.entryType, entry.occurredAt, entry.title]),
    [
      ["assessment_manual_01", "assessment", "2026-03-12T12:00:00Z", "Mood check"],
      ["sample-summary:2026-03-12:glucose:mg_dL", "sample_summary", "2026-03-12T06:00:00Z", "glucose daily summary"],
      ["history_manual_01", "history", "2026-03-12T00:00:00Z", "history"],
    ],
  );
});

test("buildExportPack preserves the five-file pack while embedding health context", async () => {
  const vaultRoot = await createHealthVault();

  try {
    const vault = await readVault(vaultRoot);
    const pack = buildExportPack(vault, {
      from: "2026-03-01",
      to: "2026-03-31",
      packId: "health-pack",
      generatedAt: "2026-03-13T12:00:00.000Z",
    });
    const narrowPack = buildExportPack(vault, {
      from: "2026-03-01",
      to: "2026-03-05",
      packId: "health-pack-narrow",
      generatedAt: "2026-03-13T12:00:00.000Z",
    });

    assert.equal(pack.files.length, 5);
    assert.equal(pack.manifest.fileCount, 5);
    assert.equal(pack.manifest.assessmentCount, 1);
    assert.equal(pack.manifest.profileSnapshotCount, 1);
    assert.equal(pack.manifest.historyEventCount, 1);
    assert.equal(pack.manifest.bankPageCount, 6);
    assert.equal(pack.health.currentProfile?.snapshotId, "psnap_health_01");
    assert.equal(narrowPack.health.profileSnapshots.length, 0);
    assert.equal(narrowPack.health.currentProfile?.snapshotId, "psnap_health_01");

    const questionPackFile = pack.files.find((file) => file.path.endsWith("question-pack.json"));
    const recordsFile = pack.files.find((file) => file.path.endsWith("records.json"));
    const assistantFile = pack.files.find((file) => file.path.endsWith("assistant-context.md"));

    assert.ok(questionPackFile);
    assert.ok(recordsFile);
    assert.ok(assistantFile);

    const questionPackPayload = JSON.parse(questionPackFile.contents) as {
      context: {
        health: {
          assessments: Array<{ id: string }>;
          goals: Array<{ id: string }>;
          historyEvents: Array<{ id: string }>;
          currentProfile: { snapshotId: string | null } | null;
        };
      };
      questions: string[];
    };

    assert.deepEqual(
      questionPackPayload.context.health.assessments.map((entry) => entry.id),
      ["asmt_health_01"],
    );
    assert.deepEqual(
      questionPackPayload.context.health.goals.map((entry) => entry.id),
      ["goal_sleep_01"],
    );
    assert.deepEqual(
      questionPackPayload.context.health.historyEvents.map((entry) => entry.id),
      ["evt_health_01"],
    );
    assert.equal(questionPackPayload.context.health.currentProfile?.snapshotId, "psnap_health_01");
    assert.ok(
      questionPackPayload.questions.some((question) =>
        question.includes("intake-assessment answers"),
      ),
    );

    const recordsPayload = JSON.parse(recordsFile.contents) as Array<{ displayId: string }>;
    assert.ok(Array.isArray(recordsPayload));
    assert.deepEqual(recordsPayload.map((entry) => entry.displayId), ["evt_health_01"]);
    assert.match(assistantFile.contents, /## Intake Assessments/);
    assert.match(assistantFile.contents, /## Current Profile/);
    assert.match(assistantFile.contents, /## Health History/);
    assert.match(assistantFile.contents, /## Health Registries/);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("buildExportPack keeps matching current-profile markdown and ignores malformed health artifacts", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
    includeAlternateRecords: true,
  });

  try {
    const vault = await readVault(vaultRoot);
    await appendVaultFile(
      vaultRoot,
      "ledger/assessments/2026/2026-03.jsonl",
      "{this is not valid json}\n",
    );
    await writeVaultFile(
      vaultRoot,
      "bank/genetics/broken.md",
      `---
schemaVersion: hv/genetics@v1
variantId: var_broken
slug broken-frontmatter
---
# Broken
`,
    );

    const healthRead = readHealthContext(vaultRoot, {
      from: "2026-03-01",
      to: "2026-03-31",
      experimentSlug: null,
    });
    const pack = buildExportPack(vault, {
      from: "2026-03-01",
      to: "2026-03-31",
      packId: "health-pack-matching-current",
      generatedAt: "2026-03-13T12:00:00.000Z",
    });

    assert.equal(pack.health.assessments.length, 2);
    assert.equal(pack.health.profileSnapshots.length, 2);
    assert.equal(pack.health.historyEvents.length, 1);
    assert.equal(pack.health.goals.length, 1);
    assert.deepEqual(
      pack.health.geneticVariants.map((entry) => entry.id),
      ["var_01"],
    );
    assert.equal(pack.health.currentProfile?.snapshotId, "psnap_health_01");
    assert.deepEqual(pack.health.profileSnapshots[1]?.sourceAssessmentIds, ["asmt_health_00"]);
    assert.match(pack.health.currentProfile?.markdown ?? "", /Snapshot ID: `psnap_health_01`/);
    assert.deepEqual(
      healthRead.failures.map((failure) => ({
        parser: failure.parser,
        relativePath: failure.relativePath,
        lineNumber: failure.lineNumber ?? null,
      })),
      [
        {
          parser: "json",
          relativePath: "ledger/assessments/2026/2026-03.jsonl",
          lineNumber: 6,
        },
        {
          parser: "frontmatter",
          relativePath: "bank/genetics/broken.md",
          lineNumber: null,
        },
      ],
    );

    const assistantFile = pack.files.find((file) => file.path.endsWith("assistant-context.md"));

    assert.ok(assistantFile);
    assert.match(assistantFile.contents, /### Goals/);
    assert.match(assistantFile.contents, /Ignored note event/);
    assert.doesNotMatch(assistantFile.contents, /Missing id should be ignored/);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("health query readers surface actionable parse failures while export-pack reads stay tolerant", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
    includeAlternateRecords: true,
  });

  try {
    await appendVaultFile(
      vaultRoot,
      "ledger/assessments/2026/2026-03.jsonl",
      "{this is not valid json}\n",
    );

    await assert.rejects(
      () => listAssessments(vaultRoot),
      /Failed to parse JSONL at ledger\/assessments\/2026\/2026-03\.jsonl:6:/,
    );

    const healthRead = readHealthContext(vaultRoot, {
      from: "2026-03-01",
      to: "2026-03-31",
      experimentSlug: null,
    });

    assert.deepEqual(
      healthRead.health.assessments.map((entry) => entry.id),
      ["asmt_health_01", "asmt_health_00"],
    );
    assert.equal(healthRead.failures[0]?.parser, "json");
    assert.equal(
      healthRead.failures[0]?.relativePath,
      "ledger/assessments/2026/2026-03.jsonl",
    );
    assert.equal(healthRead.failures[0]?.lineNumber, 6);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("buildExportPack falls back to the latest snapshot when current-profile markdown is malformed", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
  });

  try {
    const vault = await readVault(vaultRoot);
    await writeVaultFile(
      vaultRoot,
      "bank/profile/current.md",
      `---
schemaVersion: murph.frontmatter.profile-current.v1
snapshotId psnap_health_01
---
# Current Profile
`,
    );

    const healthRead = readHealthContext(vaultRoot, {
      from: "2026-03-01",
      to: "2026-03-31",
      experimentSlug: null,
    });
    const pack = buildExportPack(vault, {
      from: "2026-03-01",
      to: "2026-03-31",
      packId: "health-pack-malformed-current",
      generatedAt: "2026-03-13T12:00:00.000Z",
    });

    assert.equal(pack.health.currentProfile?.snapshotId, "psnap_health_01");
    assert.equal(pack.health.currentProfile?.markdown, null);
    assert.deepEqual(
      healthRead.failures.map((failure) => failure.relativePath),
      ["bank/profile/current.md"],
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("tolerant async collector preserves fallback and failure ordering for malformed current-profile and registry markdown", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
  });

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/profile/current.md",
      `---
schemaVersion: murph.frontmatter.profile-current.v1
snapshotId psnap_health_01
---
# Current Profile
`,
    );
    await writeVaultFile(
      vaultRoot,
      "bank/conditions/broken.md",
      `---
schemaVersion: hv/condition@v1
conditionId cond_broken
---
# Broken
`,
    );

    const collected = await collectCanonicalEntities(vaultRoot, {
      mode: "tolerant-async",
    });

    assert.equal(collected.currentProfile?.entityId, "current");
    assert.equal(collected.currentProfile?.attributes.snapshotId, "psnap_health_01");
    assert.deepEqual(
      collected.conditions.map((entity) => entity.entityId),
      ["cond_sleep_01"],
    );
    assert.deepEqual(
      collected.failures.map((failure) => failure.relativePath),
      ["bank/profile/current.md", "bank/conditions/broken.md"],
    );
    assert.equal(collected.markdownByPath.has("bank/profile/current.md"), false);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("buildExportPack date filters exclude older health slices while keeping current profile derivation", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
    includeAlternateRecords: true,
  });

  try {
    const vault = await readVault(vaultRoot);
    const pack = buildExportPack(vault, {
      from: "2026-03-05",
      to: "2026-03-31",
      packId: "health-pack-filtered",
      generatedAt: "2026-03-13T12:00:00.000Z",
    });

    assert.deepEqual(pack.health.assessments.map((entry) => entry.id), ["asmt_health_01"]);
    assert.deepEqual(pack.health.profileSnapshots.map((entry) => entry.id), ["psnap_health_01"]);
    assert.equal(pack.health.currentProfile?.snapshotId, "psnap_health_01");
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("buildExportPack trims health export strings and drops non-string array entries", async () => {
  const vaultRoot = await createHealthVault({
    currentProfileSnapshotId: "psnap_health_01",
  });

  try {
    await writeVaultFile(
      vaultRoot,
      "ledger/profile-snapshots/2026/2026-03.jsonl",
      `${JSON.stringify({
        schemaVersion: "murph.profile-snapshot.v1",
        id: "psnap_health_01",
        recordedAt: "2026-03-12T14:00:00Z",
        source: "  assessment_projection  ",
        sourceAssessmentIds: ["  asmt_health_01  ", "", 42],
        sourceEventIds: ["  evt_health_01  ", null],
        profile: {
          topGoalIds: ["  goal_sleep_01  ", "", 42],
        },
      })}\n`,
    );

    await writeVaultFile(
      vaultRoot,
      "ledger/events/2026/2026-03.jsonl",
      `${JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_health_01",
        kind: "  encounter  ",
        occurredAt: "2026-03-12T12:45:00Z",
        recordedAt: "2026-03-12T12:50:00Z",
        source: "  manual  ",
        title: "  Sleep medicine intake visit  ",
        tags: ["  endocrine  ", "", 1],
        relatedIds: ["  goal_sleep_01  ", " cond_sleep_01 ", null],
      })}\n`,
    );

    await writeVaultFile(
      vaultRoot,
      "bank/profile/current.md",
      `---
schemaVersion: murph.frontmatter.profile-current.v1
docType: profile_current
snapshotId: psnap_health_01
updatedAt: " 2026-03-12T14:00:00Z "
topGoalIds:
  - "  goal_sleep_01  "
  - ""
---
# Current Profile

Snapshot ID: \`psnap_health_01\`
`,
    );

    const vault = await readVault(vaultRoot);
    const pack = buildExportPack(vault, {
      from: "2026-03-01",
      to: "2026-03-31",
      packId: "health-pack-normalized",
      generatedAt: "2026-03-13T12:00:00.000Z",
    });

    assert.deepEqual(pack.health.profileSnapshots[0]?.sourceAssessmentIds, ["asmt_health_01"]);
    assert.deepEqual(pack.health.profileSnapshots[0]?.sourceEventIds, ["evt_health_01"]);
    assert.equal(pack.health.profileSnapshots[0]?.source, "assessment_projection");
    assert.equal(pack.health.historyEvents[0]?.kind, "encounter");
    assert.equal(pack.health.historyEvents[0]?.title, "Sleep medicine intake visit");
    assert.equal(pack.health.historyEvents[0]?.source, "manual");
    assert.deepEqual(pack.health.historyEvents[0]?.tags, ["endocrine"]);
    assert.deepEqual(pack.health.historyEvents[0]?.relatedIds, ["goal_sleep_01", "cond_sleep_01"]);
    assert.deepEqual(pack.health.currentProfile?.topGoalIds, ["goal_sleep_01"]);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("buildExportPack tolerates vaults with no health directories", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-health-empty-"));

  try {
    const vault = await readVault(vaultRoot);
    const pack = buildExportPack(vault, {
      from: "2026-03-01",
      to: "2026-03-31",
      packId: "health-pack-empty",
      generatedAt: "2026-03-13T12:00:00.000Z",
    });

    assert.equal(pack.health.assessments.length, 0);
    assert.equal(pack.health.profileSnapshots.length, 0);
    assert.equal(pack.health.historyEvents.length, 0);
    assert.equal(pack.health.currentProfile, null);
    assert.equal(pack.manifest.bankPageCount, 0);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("standalone current-profile markdown does not resolve without a latest snapshot", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-health-orphan-current-"));

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/profile/current.md",
      `---
schemaVersion: murph.frontmatter.profile-current.v1
docType: profile_current
snapshotId: psnap_orphan_01
updatedAt: 2026-03-12T14:00:00Z
---
# Current Profile

Snapshot ID: \`psnap_orphan_01\`
`,
    );

    assert.equal(await readCurrentProfile(vaultRoot), null);
    assert.equal((await readVault(vaultRoot)).currentProfile, null);
    assert.equal((await readVaultTolerant(vaultRoot)).currentProfile, null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("tolerant collector retains orphan current-profile markdown while returning no current profile", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-health-orphan-current-"));

  try {
    await writeVaultFile(
      vaultRoot,
      "bank/profile/current.md",
      `---
schemaVersion: murph.frontmatter.profile-current.v1
docType: profile_current
snapshotId: psnap_orphan_01
updatedAt: 2026-03-12T14:00:00Z
---
# Current Profile

Snapshot ID: \`psnap_orphan_01\`
`,
    );

    const collected = collectCanonicalEntities(vaultRoot, { mode: "tolerant-sync" });

    assert.equal(collected.currentProfile, null);
    assert.equal(collected.failures.length, 0);
    assert.match(
      collected.markdownByPath.get("bank/profile/current.md") ?? "",
      /Snapshot ID: `psnap_orphan_01`/,
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
