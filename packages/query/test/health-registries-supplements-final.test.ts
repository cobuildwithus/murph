import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test } from "vitest";

import type { CanonicalEntity } from "../src/canonical-entities.ts";
import { projectRegistryEntity } from "../src/health/projectors/registry.ts";
import type {
  FrontmatterObject,
  MarkdownDocumentRecord,
} from "../src/health/shared.ts";
import {
  allergyRecordFromEntity,
  allergyRegistryDefinition,
  buildPriorityTitleComparator,
  conditionRecordFromEntity,
  conditionRegistryDefinition,
  createProjectedRegistryQueries,
  createRegistryQueries,
  foodRecordFromEntity,
  foodRegistryDefinition,
  familyRecordFromEntity,
  familyRegistryDefinition,
  geneticsRecordFromEntity,
  geneticsRegistryDefinition,
  goalRecordFromEntity,
  goalRegistryDefinition,
  listProjectedRegistryRecords,
  listRegistryRecords,
  protocolRecordFromEntity,
  protocolRegistryDefinition,
  providerRecordFromEntity,
  providerRegistryDefinition,
  readPriority,
  readProjectedRegistryRecord,
  readRegistryRecord,
  recipeRecordFromEntity,
  recipeRegistryDefinition,
  showProjectedRegistryRecord,
  showRegistryRecord,
  toRegistryRecord,
  workoutFormatRecordFromEntity,
  workoutFormatRegistryDefinition,
} from "../src/health/registries.ts";
import type {
  RegistryDefinition,
  RegistryQueryEntity,
} from "../src/health/registries.ts";
import {
  listSupplementCompounds,
  listSupplements,
  readSupplement,
  showSupplement,
  showSupplementCompound,
} from "../src/health/supplements.ts";

const createdVaultRoots: string[] = [];

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

function documentRecord(
  relativePath: string,
  attributes: FrontmatterObject,
  body: string,
): MarkdownDocumentRecord {
  return {
    relativePath,
    markdown: body,
    body,
    attributes,
  };
}

function projectedRegistryEntity<TEntity extends RegistryQueryEntity>(
  kind: Parameters<typeof projectRegistryEntity>[0],
  document: MarkdownDocumentRecord,
  definition: RegistryDefinition<TEntity>,
): CanonicalEntity {
  const record = toRegistryRecord(document, definition);
  assert.ok(record);
  return projectRegistryEntity(kind, record);
}

async function seedCoverageVault(vaultRoot: string): Promise<void> {
  await writeVaultFile(
    vaultRoot,
    "bank/goals/sleep-quality.md",
    [
      "---",
      "schemaVersion: hv/goal@v1",
      "goalId: goal_sleep_quality",
      "slug: sleep-quality",
      "title: Sleep Quality",
      "status: active",
      "priority: 2",
      "---",
      "# Sleep Quality",
      "",
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
      "priority: 1",
      "---",
      "# Sleep Depth",
      "",
    ].join("\n"),
  );

  await writeVaultFile(
    vaultRoot,
    "bank/goals/missing-id.md",
    [
      "---",
      "schemaVersion: hv/goal@v1",
      "slug: missing-id",
      "title: Missing Id",
      "status: active",
      "---",
      "# Missing Id",
      "",
    ].join("\n"),
  );

  await writeVaultFile(
    vaultRoot,
    "bank/conditions/insomnia.md",
    [
      "---",
      "schemaVersion: hv/condition@v1",
      "conditionId: cond_insomnia",
      "slug: insomnia",
      "title: Insomnia",
      "clinicalStatus: active",
      "verificationStatus: confirmed",
      "assertedOn: 2026-03-01",
      "---",
      "# Insomnia",
      "",
    ].join("\n"),
  );

  await writeVaultFile(
    vaultRoot,
    "bank/allergies/peanut.md",
    [
      "---",
      "schemaVersion: hv/allergy@v1",
      "allergyId: alg_peanut",
      "slug: peanut",
      "title: Peanut",
      "status: active",
      "substance: Peanut",
      "---",
      "# Peanut",
      "",
    ].join("\n"),
  );

  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/liposomal-vitamin-c.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_vitamin_c",
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
      "    compound: Vitamin C",
      "    label: Inactive vitamin C",
      "    amount: 25",
      "    unit: mg",
      "    active: false",
      "---",
      "# Liposomal Vitamin C",
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
    "bank/protocols/supplements/punctuation-source.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_symbols",
      "slug: punctuation-source",
      "title: Symbol Source",
      "status: active",
      "kind: supplement",
      "ingredients:",
      "  -",
      "    compound: \"!!!\"",
      "    label: Symbols",
      "    amount: null",
      "    unit: null",
      "    active: true",
      "---",
      "# Symbol Source",
      "",
    ].join("\n"),
  );

  await writeVaultFile(
    vaultRoot,
    "bank/protocols/supplements/empty-supplement.md",
    [
      "---",
      "schemaVersion: hv/protocol@v1",
      "protocolId: prot_empty",
      "slug: empty-supplement",
      "title: Empty Supplement",
      "status: active",
      "kind: supplement",
      "ingredients: []",
      "---",
      "# Empty Supplement",
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

  await writeVaultFile(
    vaultRoot,
    "bank/foods/overnight-oats.md",
    [
      "---",
      "schemaVersion: hv/food@v1",
      "foodId: food_overnight_oats",
      "slug: overnight-oats",
      "title: Overnight Oats",
      "status: active",
      "serving: 1 bowl",
      "tags:",
      "  - breakfast",
      "attachedProtocolIds:",
      "  - prot_vitamin_c",
      "autoLogDaily:",
      "  time: 08:00",
      "---",
      "# Overnight Oats",
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
      "title: Salmon Rice Bowl",
      "status: saved",
      "servings: 2",
      "relatedGoalIds:",
      "  - goal_sleep_quality",
      "relatedConditionIds:",
      "  - cond_insomnia",
      "---",
      "# Salmon Rice Bowl",
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
      "title: Primary Care",
      "status: active",
      "specialty: primary-care",
      "aliases:",
      "  - doctor",
      "  - clinic",
      "---",
      "# Primary Care",
      "",
    ].join("\n"),
  );

  await writeVaultFile(
    vaultRoot,
    "bank/workout-formats/push-day-a.md",
    [
      "---",
      "schemaVersion: hv/workout-format@v1",
      "workoutFormatId: wfmt_push_day_a",
      "slug: push-day-a",
      "title: Push Day A",
      "status: active",
      "activityType: strength-training",
      "durationMinutes: 45",
      "templateText: Press day",
      "template:",
      "  blocks:",
      "    - press",
      "---",
      "# Push Day A",
      "",
    ].join("\n"),
  );

  await writeVaultFile(
    vaultRoot,
    "bank/family/mother.md",
    [
      "---",
      "schemaVersion: hv/family@v1",
      "familyMemberId: fam_mother",
      "slug: mother",
      "title: Mother",
      "status: active",
      "relationship: mother",
      "relatedVariantIds:",
      "  - var_mthfr",
      "---",
      "# Mother",
      "",
    ].join("\n"),
  );

  await writeVaultFile(
    vaultRoot,
    "bank/genetics/mthfr-c677t.md",
    [
      "---",
      "schemaVersion: hv/genetics@v1",
      "variantId: var_mthfr",
      "slug: mthfr-c677t",
      "title: MTHFR C677T",
      "status: active",
      "gene: MTHFR",
      "sourceFamilyMemberIds:",
      "  - fam_mother",
      "---",
      "# MTHFR C677T",
      "",
    ].join("\n"),
  );
}

test("registry queries cover the remaining projection and wrapper branches", async () => {
  const vaultRoot = await createVaultRoot("murph-query-registries-");
  await seedCoverageVault(vaultRoot);

  const goalQueries = createRegistryQueries(goalRegistryDefinition);
  const goalList = await goalQueries.list(vaultRoot, {
    status: ["", "active"],
    text: "sleep",
    limit: 1,
  });

  assert.deepEqual(goalList.map((record) => record.entity.id), ["goal_sleep_depth"]);
  assert.equal((await goalQueries.read(vaultRoot, "goal_sleep_quality"))?.entity.title, "Sleep Quality");
  assert.equal((await goalQueries.show(vaultRoot, "sleep-depth"))?.entity.id, "goal_sleep_depth");
  assert.equal(await goalQueries.show(vaultRoot, "missing"), null);
  assert.equal(
    (await readRegistryRecord(vaultRoot, goalRegistryDefinition, "goal_sleep_quality"))?.entity.slug,
    "sleep-quality",
  );
  assert.equal(
    (await showRegistryRecord(vaultRoot, goalRegistryDefinition, "Sleep Quality"))?.entity.id,
    "goal_sleep_quality",
  );

  assert.equal(readPriority({ priority: 3 }, ["priority"]), 3);
  assert.equal(readPriority({ priority: "skip" }, ["priority"]), null);
  assert.ok(
    buildPriorityTitleComparator(
      { id: "goal-a", priority: null, slug: "goal-a", status: null, title: "Alpha" },
      { id: "goal-b", priority: null, slug: "goal-b", status: null, title: "Beta" },
    ) < 0,
  );

  const goalRecord = projectedRegistryEntity(
    "goal",
    documentRecord(
      "bank/goals/sleep-quality.md",
      {
        goalId: "goal_sleep_quality",
        slug: "sleep-quality",
        title: "Sleep Quality",
        status: "active",
        priority: 2,
      },
      "# Sleep Quality",
    ),
    goalRegistryDefinition,
  );
  const depthRecord = projectedRegistryEntity(
    "goal",
    documentRecord(
      "bank/goals/sleep-depth.md",
      {
        goalId: "goal_sleep_depth",
        slug: "sleep-depth",
        title: "Sleep Depth",
        status: "active",
        priority: 1,
      },
      "# Sleep Depth",
    ),
    goalRegistryDefinition,
  );
  const missingGoalRecord = toRegistryRecord(
    documentRecord(
      "bank/goals/missing-id.md",
      {
        slug: "missing-id",
        title: "Missing Id",
        status: "active",
      },
      "# Missing Id",
    ),
    goalRegistryDefinition,
  );

  assert.equal(missingGoalRecord, null);

  const projectedGoalQueries = createProjectedRegistryQueries(
    goalRegistryDefinition,
    "goal",
    (entity) => {
      if (entity.entityId === "goal_sleep_depth") {
        return null;
      }

      return goalRecordFromEntity(entity);
    },
  );

  const projectedGoals = await projectedGoalQueries.list(vaultRoot, {
    text: "sleep",
    limit: 10,
  });

  assert.deepEqual(projectedGoals.map((record) => record.entity.id), ["goal_sleep_quality"]);
  assert.equal(
    (await projectedGoalQueries.read(vaultRoot, "goal_sleep_quality"))?.entity.title,
    "Sleep Quality",
  );
  assert.equal(
    (await projectedGoalQueries.show(vaultRoot, "sleep-quality"))?.entity.id,
    "goal_sleep_quality",
  );
  assert.deepEqual(
    await listProjectedRegistryRecords(
      vaultRoot,
      goalRegistryDefinition,
      "goal",
      (entity) => (entity.entityId === "goal_sleep_depth" ? null : goalRecordFromEntity(entity)),
      { limit: 10 },
    ),
    projectedGoals,
  );
  assert.equal(
    (await readProjectedRegistryRecord(
      vaultRoot,
      goalRegistryDefinition,
      "goal",
      (entity) => (entity.entityId === "goal_sleep_depth" ? null : goalRecordFromEntity(entity)),
      "goal_sleep_quality",
    ))?.entity.id,
    "goal_sleep_quality",
  );
  assert.equal(
    (await showProjectedRegistryRecord(
      vaultRoot,
      goalRegistryDefinition,
      "goal",
      (entity) => (entity.entityId === "goal_sleep_depth" ? null : goalRecordFromEntity(entity)),
      "sleep-quality",
    ))?.entity.id,
    "goal_sleep_quality",
  );

  assert.equal(goalRecordFromEntity(goalRecord)?.entity.id, "goal_sleep_quality");
  assert.equal(goalRecordFromEntity(depthRecord)?.entity.id, "goal_sleep_depth");
  assert.equal(
    goalRecordFromEntity({
      ...goalRecord,
      family: "protocol",
      recordClass: "bank",
    }),
    null,
  );

  const conditionRecord = projectedRegistryEntity(
    "condition",
    documentRecord(
      "bank/conditions/insomnia.md",
      {
        conditionId: "cond_insomnia",
        slug: "insomnia",
        title: "Insomnia",
        clinicalStatus: "active",
        verificationStatus: "confirmed",
        assertedOn: "2026-03-01",
      },
      "# Insomnia",
    ),
    conditionRegistryDefinition,
  );
  const allergyRecord = projectedRegistryEntity(
    "allergy",
    documentRecord(
      "bank/allergies/peanut.md",
      {
        allergyId: "alg_peanut",
        slug: "peanut",
        title: "Peanut",
        status: "active",
        substance: "Peanut",
      },
      "# Peanut",
    ),
    allergyRegistryDefinition,
  );
  const familyRecord = projectedRegistryEntity(
    "family",
    documentRecord(
      "bank/family/mother.md",
      {
        familyMemberId: "fam_mother",
        slug: "mother",
        title: "Mother",
        status: "active",
        relationship: "mother",
        relatedVariantIds: ["var_mthfr"],
      },
      "# Mother",
    ),
    familyRegistryDefinition,
  );
  const geneticsRecord = projectedRegistryEntity(
    "genetics",
    documentRecord(
      "bank/genetics/mthfr-c677t.md",
      {
        variantId: "var_mthfr",
        slug: "mthfr-c677t",
        title: "MTHFR C677T",
        status: "active",
        gene: "MTHFR",
        sourceFamilyMemberIds: ["fam_mother"],
      },
      "# MTHFR C677T",
    ),
    geneticsRegistryDefinition,
  );
  const protocolRecord = projectedRegistryEntity(
    "protocol",
    documentRecord(
      "bank/protocols/supplements/liposomal-vitamin-c.md",
      {
        protocolId: "prot_vitamin_c",
        slug: "liposomal-vitamin-c",
        title: "Liposomal Vitamin C",
        status: "active",
        kind: "supplement",
        brand: "LivOn Labs",
        manufacturer: "LivOn Laboratories",
        ingredients: [
          {
            compound: "Vitamin C",
            label: "Ascorbic acid",
            amount: 500,
            unit: "mg",
            active: true,
            note: null,
          },
          {
            compound: "Vitamin C",
            label: "Inactive vitamin C",
            amount: 25,
            unit: "mg",
            active: false,
            note: null,
          },
        ],
      },
      "# Liposomal Vitamin C",
    ),
    protocolRegistryDefinition,
  );
  const foodRecord = projectedRegistryEntity(
    "food",
    documentRecord(
      "bank/foods/overnight-oats.md",
      {
        foodId: "food_overnight_oats",
        slug: "overnight-oats",
        title: "Overnight Oats",
        status: "active",
        serving: "1 bowl",
        tags: ["breakfast"],
        attachedProtocolIds: ["prot_vitamin_c"],
        autoLogDaily: { time: "08:00" },
      },
      "# Overnight Oats",
    ),
    foodRegistryDefinition,
  );
  const recipeRecord = projectedRegistryEntity(
    "recipe",
    documentRecord(
      "bank/recipes/salmon-rice-bowl.md",
      {
        recipeId: "recipe_salmon_rice_bowl",
        slug: "salmon-rice-bowl",
        title: "Salmon Rice Bowl",
        status: "saved",
        servings: 2,
        relatedGoalIds: ["goal_sleep_quality"],
        relatedConditionIds: ["cond_insomnia"],
      },
      "# Salmon Rice Bowl",
    ),
    recipeRegistryDefinition,
  );
  const providerRecord = projectedRegistryEntity(
    "provider",
    documentRecord(
      "bank/providers/primary-care.md",
      {
        providerId: "prov_primary_care",
        slug: "primary-care",
        title: "Primary Care",
        status: "active",
        specialty: "primary-care",
        aliases: ["doctor", "clinic"],
      },
      "# Primary Care",
    ),
    providerRegistryDefinition,
  );
  const workoutFormatRecord = projectedRegistryEntity(
    "workout_format",
    documentRecord(
      "bank/workout-formats/push-day-a.md",
      {
        workoutFormatId: "wfmt_push_day_a",
        slug: "push-day-a",
        title: "Push Day A",
        status: "active",
        activityType: "strength-training",
        durationMinutes: 45,
        templateText: "Press day",
        template: { blocks: ["press"] },
      },
      "# Push Day A",
    ),
    workoutFormatRegistryDefinition,
  );

  assert.ok(conditionRecordFromEntity(conditionRecord));
  assert.ok(allergyRecordFromEntity(allergyRecord));
  assert.ok(familyRecordFromEntity(familyRecord));
  assert.ok(geneticsRecordFromEntity(geneticsRecord));
  assert.ok(protocolRecordFromEntity(protocolRecord));
  assert.ok(foodRecordFromEntity(foodRecord));
  assert.ok(recipeRecordFromEntity(recipeRecord));
  assert.ok(providerRecordFromEntity(providerRecord));
  assert.ok(workoutFormatRecordFromEntity(workoutFormatRecord));

  assert.equal(
    (await listRegistryRecords(vaultRoot, foodRegistryDefinition, { text: "overnight" })).length,
    1,
  );
});

test("supplement queries cover lookup, aggregation, and filtering branches", async () => {
  const vaultRoot = await createVaultRoot("murph-query-supplements-");
  await seedCoverageVault(vaultRoot);

  const supplements = await listSupplements(vaultRoot);
  const activeSupplements = await listSupplements(vaultRoot, {
    status: ["active"],
  });
  const stoppedSupplements = await listSupplements(vaultRoot, {
    status: "stopped",
  });

  assert.deepEqual(
    supplements.map((record) => record.entity.id),
    [
      "prot_empty",
      "prot_legacy_magnesium",
      "prot_vitamin_c",
      "prot_symbols",
    ],
  );
  assert.deepEqual(
    activeSupplements.map((record) => record.entity.id),
    [
      "prot_empty",
      "prot_vitamin_c",
      "prot_symbols",
    ],
  );
  assert.deepEqual(
    stoppedSupplements.map((record) => record.entity.id),
    ["prot_legacy_magnesium"],
  );

  assert.equal((await readSupplement(vaultRoot, "prot_vitamin_c"))?.entity.brand, "LivOn Labs");
  assert.equal(await readSupplement(vaultRoot, "prot_manual"), null);
  assert.equal((await showSupplement(vaultRoot, "liposomal vitamin c"))?.entity.id, "prot_vitamin_c");
  assert.equal(await showSupplement(vaultRoot, "missing supplement"), null);

  const compounds = await listSupplementCompounds(vaultRoot, {
    status: ["active", "stopped"],
  });
  const vitaminC = compounds.find((record) => record.compound === "Vitamin C") ?? null;
  const magnesium = compounds.find((record) => record.compound === "Magnesium") ?? null;
  const symbols = compounds.find((record) => record.compound === "!!!") ?? null;

  assert.deepEqual(compounds.map((record) => record.lookupId), ["!!!", "magnesium", "vitamin-c"]);
  assert.equal(vitaminC?.supplementCount, 1);
  assert.deepEqual(vitaminC?.sources.map((source) => source.label), ["Ascorbic acid"]);
  assert.deepEqual(vitaminC?.totals, [
    {
      unit: "mg",
      totalAmount: 500,
      sourceCount: 1,
      incomplete: false,
    },
  ]);
  assert.equal(magnesium?.supplementCount, 1);
  assert.deepEqual(magnesium?.supplementIds, ["prot_legacy_magnesium"]);
  assert.deepEqual(magnesium?.totals, [
    {
      unit: "mg",
      totalAmount: 250,
      sourceCount: 1,
      incomplete: false,
    },
  ]);
  assert.equal(symbols?.lookupId, "!!!");
  assert.deepEqual(symbols?.totals, [
    {
      unit: null,
      totalAmount: null,
      sourceCount: 1,
      incomplete: true,
    },
  ]);

  assert.equal(
    (await showSupplementCompound(vaultRoot, "Ascorbic acid", { status: "active" }))?.compound,
    "Vitamin C",
  );
  assert.equal(
    (await showSupplementCompound(vaultRoot, "Legacy Magnesium", { status: "stopped" }))?.compound,
    "Magnesium",
  );
  assert.equal(
    (await showSupplementCompound(vaultRoot, "Symbols", { status: "active" }))?.compound,
    "!!!",
  );
  assert.equal(await showSupplementCompound(vaultRoot, "missing compound"), null);
});
