import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test, vi } from "vitest";

import {
  buildHealthContextFromVault,
  readHealthContext,
} from "../src/export-pack-health.ts";
import { type CanonicalEntity, resolveCanonicalRecordClass } from "../src/canonical-entities.ts";
import * as canonicalCollector from "../src/health/canonical-collector.ts";
import { type CanonicalHealthEntityCollection } from "../src/health/canonical-collector.ts";
import {
  listBloodTests,
  readBloodTest,
  showBloodTest,
  toBloodTestRecord,
} from "../src/health/blood-tests.ts";
import { createVaultReadModel } from "../src/model.ts";
import * as model from "../src/model.ts";

const createdVaultRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();

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
  entityId: string,
  family: CanonicalEntity["family"],
  kind: string,
  pathValue: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  return {
    entityId,
    primaryLookupId: entityId,
    lookupIds: [entityId],
    family,
    recordClass: resolveCanonicalRecordClass(family),
    kind,
    status: null,
    occurredAt: null,
    date: null,
    path: pathValue,
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

function buildHealthCollection(): CanonicalHealthEntityCollection {
  const assessments = [
    createEntity(
      "asmt_imported_only",
      "assessment",
      "assessment",
      "ledger/assessments/2026/2026-03.jsonl",
      {
        title: "Imported only assessment",
        attributes: {
          assessmentType: "intake",
          importedAt: "2026-03-12T09:00:00Z",
          source: "import",
          questionnaireSlug: "sleep-intake",
          responses: {
            energy: "good",
          },
        },
      },
    ),
    createEntity(
      "asmt_valid",
      "assessment",
      "assessment",
      "ledger/assessments/2026/2026-03.jsonl",
      {
        title: "Recorded assessment",
        attributes: {
          assessmentType: "follow-up",
          recordedAt: "2026-03-13T09:00:00Z",
          source: "import",
          responses: {
            energy: "better",
          },
        },
      },
    ),
    createEntity(
      "asmt_missing_date",
      "assessment",
      "assessment",
      "ledger/assessments/2026/2026-03.jsonl",
      {
        title: "Undated assessment",
        attributes: {
          assessmentType: "follow-up",
          source: "import",
        },
      },
    ),
    createEntity(
      "asmt_future",
      "assessment",
      "assessment",
      "ledger/assessments/2026/2026-03.jsonl",
      {
        title: "Future assessment",
        attributes: {
          assessmentType: "follow-up",
          recordedAt: "2026-04-01T09:00:00Z",
          source: "import",
        },
      },
    ),
  ];

  const healthEvents = [
    createEntity(
      "evt_gamma",
      "event",
      "encounter",
      "ledger/events/2026/2026-03.jsonl",
      {
        occurredAt: "2026-03-14T12:00:00Z",
        title: "Gamma encounter",
        status: "completed",
        body: "Gamma encounter summary.",
        attributes: {
          recordedAt: "2026-03-14T12:15:00Z",
          source: "manual",
          note: "Gamma encounter summary.",
        },
        tags: ["visit"],
      },
    ),
    createEntity(
      "evt_alpha",
      "event",
      "encounter",
      "ledger/events/2026/2026-03.jsonl",
      {
        occurredAt: "2026-03-13T12:00:00Z",
        title: "Alpha encounter",
        status: "completed",
        body: "Alpha encounter summary.",
        attributes: {
          recordedAt: "2026-03-13T12:15:00Z",
          source: "manual",
          note: "Alpha encounter summary.",
        },
        tags: ["visit"],
      },
    ),
    createEntity(
      "evt_before",
      "event",
      "encounter",
      "ledger/events/2026/2026-03.jsonl",
      {
        occurredAt: "2026-02-28T12:00:00Z",
        title: "Before window",
        status: "completed",
        attributes: {
          recordedAt: "2026-02-28T12:15:00Z",
          source: "manual",
        },
      },
    ),
    createEntity(
      "evt_invalid",
      "event",
      "encounter",
      "ledger/events/2026/2026-03.jsonl",
      {
        occurredAt: "not-a-date",
        title: "Invalid encounter",
        status: "completed",
        attributes: {
          recordedAt: "2026-03-15T12:15:00Z",
          source: "manual",
        },
      },
    ),
    createEntity(
      "evt_invalid_family",
      "assessment",
      "assessment",
      "ledger/events/2026/2026-03.jsonl",
      {
        title: "Invalid family encounter",
        attributes: {
          recordedAt: "2026-03-15T12:15:00Z",
          source: "manual",
        },
      },
    ),
  ];

  const goals = [
    createEntity("goal_alpha", "goal", "goal", "bank/goals/improve-sleep.md", {
      lookupIds: ["goal_alpha", "improve-sleep"],
      title: "Improve sleep",
      status: "active",
      body: "# Improve sleep\n\nGoal body.",
      attributes: {
        goalId: "goal_alpha",
        slug: "improve-sleep",
        title: "Improve sleep",
        status: "active",
      },
    }),
  ];

  const conditions = [
    createEntity("cond_alpha", "condition", "condition", "bank/conditions/condition-alpha.md", {
      lookupIds: ["cond_alpha"],
      title: "Condition alpha",
      status: "active",
      body: "# Condition alpha\n\nCondition body.",
      attributes: {
        conditionId: "cond_alpha",
        slug: "condition-alpha",
        title: "Condition alpha",
        clinicalStatus: "active",
      },
    }),
  ];

  const allergies = [
    createEntity("alg_alpha", "allergy", "allergy", "bank/allergies/penicillin.md", {
      lookupIds: ["alg_alpha", "penicillin"],
      title: "Penicillin",
      status: "active",
      body: "# Penicillin\n\nAllergy body.",
      attributes: {
        allergyId: "alg_alpha",
        slug: "penicillin",
        title: "Penicillin",
        status: "active",
      },
    }),
  ];

  const protocols = [
    createEntity(
      "prot_alpha",
      "protocol",
      "supplement",
      "bank/protocols/supplements/magnesium-glycinate.md",
      {
        lookupIds: ["prot_alpha", "magnesium-glycinate"],
        title: "Magnesium glycinate",
        status: "active",
        body: "# Magnesium glycinate\n\nProtocol body.",
        attributes: {
          protocolId: "prot_alpha",
          slug: "magnesium-glycinate",
          title: "Magnesium glycinate",
          status: "active",
          kind: "supplement",
        },
      },
    ),
  ];

  const familyMembers = [
    createEntity("fam_alpha", "family", "family", "bank/family/mother.md", {
      lookupIds: ["fam_alpha", "mother"],
      title: "Mother",
      status: null,
      body: "# Mother\n\nFamily body.",
      attributes: {
        familyMemberId: "fam_alpha",
        slug: "mother",
        title: "Mother",
        relationship: "mother",
      },
    }),
  ];

  const geneticVariants = [
    createEntity("var_alpha", "genetics", "genetics", "bank/genetics/mthfr-c677t.md", {
      lookupIds: ["var_alpha", "mthfr-c677t"],
      title: "MTHFR C677T",
      status: "observed",
      body: "# MTHFR C677T\n\nVariant body.",
      attributes: {
        variantId: "var_alpha",
        slug: "mthfr-c677t",
        title: "MTHFR C677T",
        significance: "risk_factor",
      },
    }),
  ];

  const markdownByPath = new Map<string, string>([
    ["bank/goals/improve-sleep.md", "---\ngoalId: goal_alpha\nslug: improve-sleep\n---\n# Improve sleep\n"],
    [
      "bank/conditions/condition-alpha.md",
      "---\nconditionId: cond_alpha\nslug: condition-alpha\n---\n# Condition alpha\n",
    ],
    ["bank/allergies/penicillin.md", "---\nallergyId: alg_alpha\nslug: penicillin\n---\n# Penicillin\n"],
    [
      "bank/protocols/supplements/magnesium-glycinate.md",
      "---\nprotocolId: prot_alpha\nslug: magnesium-glycinate\n---\n# Magnesium glycinate\n",
    ],
    ["bank/family/mother.md", "---\nfamilyMemberId: fam_alpha\nslug: mother\n---\n# Mother\n"],
    [
      "bank/genetics/mthfr-c677t.md",
      "---\nvariantId: var_alpha\nslug: mthfr-c677t\n---\n# MTHFR C677T\n",
    ],
  ]);

  return {
    assessments,
    goals,
    conditions,
    allergies,
    protocols,
    familyMembers,
    geneticVariants,
    foods: [],
    recipes: [],
    providers: [],
    workoutFormats: [],
    entities: [
      ...assessments,
      ...healthEvents,
      ...goals,
      ...conditions,
      ...allergies,
      ...protocols,
      ...familyMembers,
      ...geneticVariants,
    ].sort((left, right) => left.entityId.localeCompare(right.entityId)),
    failures: [
      {
        ok: false,
        parser: "frontmatter",
        relativePath: "bank/conditions/broken.md",
        reason: "Broken frontmatter.",
      },
    ],
    markdownByPath,
  };
}

test("export pack health strips transient fields, sorts deterministically, and respects date windows", async () => {
  const collectCanonicalEntitiesMock = vi.spyOn(
    canonicalCollector,
    "collectCanonicalEntities",
  );
  const readVaultMock = vi.spyOn(model, "readVault");
  const collection = buildHealthCollection();
  const vault = createVaultReadModel({
    vaultRoot: "/virtual/vault",
    entities: collection.entities,
  });

  // @ts-expect-error Vitest infers the async overload for the spied collector.
  collectCanonicalEntitiesMock.mockReturnValueOnce(collection);
  readVaultMock.mockResolvedValueOnce(vault);

  const healthRead = await readHealthContext("/virtual/vault", {
    from: "2026-03-01",
    to: "2026-03-31",
    experimentSlug: null,
  });

  // @ts-expect-error Vitest infers the async overload for the spied collector.
  collectCanonicalEntitiesMock.mockReturnValueOnce(collection);

  const projectedHealth = buildHealthContextFromVault(vault, {
    from: "2026-03-01",
    to: "2026-03-31",
    experimentSlug: null,
  });

  assert.deepEqual(
    healthRead.health.assessments.map((record) => record.id),
    ["asmt_valid", "asmt_imported_only"],
  );
  assert.equal(healthRead.health.assessments[1]?.recordedAt, "2026-03-12T09:00:00Z");
  assert.deepEqual(
    healthRead.health.healthEvents.map((record) => record.id),
    ["evt_gamma", "evt_alpha"],
  );
  assert.equal(healthRead.health.healthEvents[0]?.kind, "encounter");
  assert.equal(healthRead.health.goals[0]?.slug, "improve-sleep");
  assert.equal(healthRead.health.conditions[0]?.slug, "cond_alpha");
  assert.equal(healthRead.health.allergies[0]?.slug, "penicillin");
  assert.equal(healthRead.health.protocols[0]?.slug, "magnesium-glycinate");
  assert.equal(healthRead.health.familyMembers[0]?.slug, "mother");
  assert.equal(healthRead.health.geneticVariants[0]?.slug, "mthfr-c677t");
  assert.deepEqual(healthRead.failures, collection.failures);
  assert.deepEqual(projectedHealth.goals.map((record) => record.slug), ["improve-sleep"]);
});

test("blood test helpers keep only blood-like records and support deterministic lookups", async () => {
  const vaultRoot = await createVaultRoot("murph-query-blood-");

  await writeVaultFile(
    vaultRoot,
    "ledger/events/2026/2026-03.jsonl",
    [
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_blood_category",
        kind: "test",
        occurredAt: "2026-03-14T08:00:00Z",
        recordedAt: "2026-03-14T08:05:00Z",
        source: "import",
        title: "Functional panel",
        testName: "functional_panel",
        resultStatus: "mixed",
        testCategory: "blood",
        specimenType: "urine",
        labName: "Function Health",
        labPanelId: "panel_123",
        fastingStatus: "fasting",
        tags: ["lab"],
        relatedIds: ["goal_alpha"],
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_blood_specimen",
        kind: "test",
        occurredAt: "2026-03-13T08:00:00Z",
        recordedAt: "2026-03-13T08:05:00Z",
        source: "import",
        title: "Cardiometabolic panel",
        testName: "cardiometabolic_panel",
        status: "normal",
        specimenType: "serum",
        labName: "Quest",
        labPanelId: "panel_456",
        fastingStatus: "non_fasting",
      }),
      JSON.stringify({
        schemaVersion: "murph.event.v1",
        id: "evt_not_blood",
        kind: "test",
        occurredAt: "2026-03-12T08:00:00Z",
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
      occurredAt: "2026-03-15T09:00:00Z",
      title: "Direct category",
      testCategory: "blood",
      specimenType: "serum",
      resultStatus: "mixed",
    },
    "ledger/events/2026/2026-03.jsonl",
  );
  const directBloodFromSpecimen = toBloodTestRecord(
    {
      id: "evt_direct_specimen",
      kind: "test",
      occurredAt: "2026-03-15T09:00:00Z",
      title: "Direct specimen",
      specimenType: "serum",
      status: "normal",
    },
    "ledger/events/2026/2026-03.jsonl",
  );
  const directOtherBloodKind = toBloodTestRecord(
    {
      id: "evt_direct_encounter",
      kind: "encounter",
      occurredAt: "2026-03-15T09:00:00Z",
      title: "Direct encounter",
      testCategory: "blood",
      specimenType: "serum",
    },
    "ledger/events/2026/2026-03.jsonl",
  );
  const directNotBlood = toBloodTestRecord(
    {
      id: "evt_direct_other",
      kind: "test",
      occurredAt: "2026-03-15T09:00:00Z",
      title: "Direct other",
      testCategory: "urine",
      specimenType: "urine",
    },
    "ledger/events/2026/2026-03.jsonl",
  );

  assert.ok(directBloodFromCategory);
  assert.ok(directBloodFromSpecimen);
  assert.equal(directOtherBloodKind, null);
  assert.equal(directNotBlood, null);
  assert.equal(directBloodFromCategory?.status, "mixed");
  assert.equal(directBloodFromSpecimen?.status, "normal");

  const allBloodTests = await listBloodTests(vaultRoot);
  const filteredBloodTests = await listBloodTests(vaultRoot, {
    from: "2026-03-14",
    to: "2026-03-14",
    limit: 1,
  });
  const mixedBloodTests = await listBloodTests(vaultRoot, {
    status: "mixed",
    text: "Function Health",
  });

  assert.deepEqual(allBloodTests.map((record) => record.id), [
    "evt_blood_category",
    "evt_blood_specimen",
  ]);
  assert.deepEqual(filteredBloodTests.map((record) => record.id), [
    "evt_blood_category",
  ]);
  assert.deepEqual(mixedBloodTests.map((record) => record.id), [
    "evt_blood_category",
  ]);
  assert.equal((await readBloodTest(vaultRoot, "evt_blood_category"))?.labName, "Function Health");
  assert.equal(await readBloodTest(vaultRoot, "missing"), null);
  assert.equal((await showBloodTest(vaultRoot, "panel_456"))?.id, "evt_blood_specimen");
  assert.equal((await showBloodTest(vaultRoot, "functional_panel"))?.id, "evt_blood_category");
  assert.equal(await showBloodTest(vaultRoot, "missing"), null);
});
