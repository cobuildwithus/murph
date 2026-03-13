import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { buildExportPack, readVault, showProfile } from "../src/index.js";
import { readHealthContext } from "../src/export-pack-health.js";
import { listAssessments } from "../src/health/assessments.js";

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
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-query-health-"));
  const currentProfileSnapshotId = options.currentProfileSnapshotId ?? "psnap_stale";

  await writeVaultFile(
    vaultRoot,
    "ledger/assessments/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "hb.assessment-response.v1",
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
            schemaVersion: "hb.assessment-response.v1",
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
            schemaVersion: "hb.assessment-response.v1",
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
            schemaVersion: "hb.assessment-response.v1",
            id: "asmt_health_before",
            assessmentType: "historical",
            recordedAt: "2026-02-20T08:00:00Z",
            source: "import",
          })
        : null,
      options.includeAlternateRecords
        ? JSON.stringify({
            schemaVersion: "hb.assessment-response.v1",
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
        schemaVersion: "hb.profile-snapshot.v1",
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
            schemaVersion: "hb.profile-snapshot.v1",
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
            schemaVersion: "hb.profile-snapshot.v1",
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
        schemaVersion: "hb.event.v1",
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
            schemaVersion: "hb.event.v1",
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
schemaVersion: hb.frontmatter.profile-current.v1
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
    "bank/regimens/supplements/magnesium-glycinate.md",
    `---
schemaVersion: hv/regimen@v1
regimenId: reg_01
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

    const recordsPayload = JSON.parse(recordsFile.contents) as Array<{ id: string }>;
    assert.ok(Array.isArray(recordsPayload));
    assert.deepEqual(recordsPayload.map((entry) => entry.id), ["evt_health_01"]);
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

    const vault = await readVault(vaultRoot);
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
    await writeVaultFile(
      vaultRoot,
      "bank/profile/current.md",
      `---
schemaVersion: hb.frontmatter.profile-current.v1
snapshotId psnap_health_01
---
# Current Profile
`,
    );

    const vault = await readVault(vaultRoot);
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
        schemaVersion: "hb.profile-snapshot.v1",
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
        schemaVersion: "hb.event.v1",
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
schemaVersion: hb.frontmatter.profile-current.v1
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
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "healthybob-query-health-empty-"));

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
