import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault, readJsonlRecords, VaultError } from "../src/index.js";
import { listWriteOperationMetadataPaths, readStoredWriteOperation } from "../src/operations/index.js";
import {
  listAllergies,
  listConditions,
  listFoods,
  listGoals,
  listProviders,
  listRecipes,
  listRegimenItems,
  readAllergy,
  readCondition,
  readFood,
  readGoal,
  readProvider,
  readRecipe,
  readRegimenItem,
  stopRegimenItem,
  upsertAllergy,
  upsertCondition,
  upsertFood,
  upsertGoal,
  upsertProvider,
  upsertRecipe,
  upsertRegimenItem,
} from "../src/bank/index.js";

type AuditLikeRecord = {
  action?: string;
  commandName?: string;
  changes?: Array<{
    op?: string;
  }>;
};

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function selectAuditMetadata(records: unknown[], action: string): Array<{
  action: string | undefined;
  commandName: string | undefined;
  op: string | undefined;
}> {
  return records
    .filter(
      (record): record is AuditLikeRecord =>
        typeof record === "object" &&
        record !== null &&
        (record as AuditLikeRecord).action === action,
    )
    .map((record) => ({
      action: record.action,
      commandName: record.commandName,
      op: record.changes?.[0]?.op,
    }));
}

test("goals support multiple active records and preserve relationships in markdown registries", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-goals");
  await initializeVault({ vaultRoot });

  const primary = await upsertGoal({
    vaultRoot,
    title: "Improve fasting glucose",
    status: "active",
    horizon: "medium_term",
    priority: 8,
    window: {
      startAt: "2026-03-01",
      targetAt: "2026-06-01",
    },
    domains: ["Metabolic Health", "Sleep"],
  });
  const secondary = await upsertGoal({
    vaultRoot,
    title: "Lift three days per week",
    status: "active",
    horizon: "ongoing",
    priority: 6,
    window: {
      startAt: "2026-03-05",
    },
    parentGoalId: primary.record.goalId,
    relatedGoalIds: [primary.record.goalId],
    relatedExperimentIds: ["exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
  });

  const listed = await listGoals(vaultRoot);
  const updated = await upsertGoal({
    vaultRoot,
    goalId: secondary.record.goalId,
  });
  const refreshedByTitle = await upsertGoal({
    vaultRoot,
    title: "Lift three days per week",
  });
  const read = await readGoal({
    vaultRoot,
    goalId: secondary.record.goalId,
  });
  const goalAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: updated.auditPath,
  });
  const goalOperations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );

  assert.equal(primary.created, true);
  assert.equal(secondary.created, true);
  assert.equal(updated.created, false);
  assert.equal(refreshedByTitle.created, false);
  assert.equal(refreshedByTitle.record.goalId, secondary.record.goalId);
  assert.equal(listed.length, 2);
  assert.equal(read.title, secondary.record.title);
  assert.equal(read.parentGoalId, primary.record.goalId);
  assert.deepEqual(read.relatedGoalIds, [primary.record.goalId]);
  assert.deepEqual(read.relatedExperimentIds, ["exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"]);
  assert.equal(read.priority, 6);
  assert.equal(read.window.startAt, "2026-03-05");
  assert.deepEqual(primary.record.domains, ["metabolic-health", "sleep"]);
  assert.match(read.markdown, /## Related Experiments/);
  assert.deepEqual(selectAuditMetadata(goalAuditRecords, "goal_upsert"), [
    { action: "goal_upsert", commandName: "core.upsertGoal", op: "create" },
    { action: "goal_upsert", commandName: "core.upsertGoal", op: "create" },
    { action: "goal_upsert", commandName: "core.upsertGoal", op: "update" },
    { action: "goal_upsert", commandName: "core.upsertGoal", op: "update" },
  ]);
  assert.equal(goalOperations.filter((operation) => operation.operationType === "goal_upsert").length, 4);
  assert.ok(goalOperations.every((operation) => operation.status === "committed"));
});

test("goal id-or-slug resolution preserves conflict, missing, and read-preference behavior", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-goal-resolution");
  await initializeVault({ vaultRoot });

  const first = await upsertGoal({
    vaultRoot,
    title: "Build aerobic base",
    window: {
      startAt: "2026-03-01",
    },
  });
  const second = await upsertGoal({
    vaultRoot,
    title: "Increase lean mass",
    window: {
      startAt: "2026-03-02",
    },
  });

  await assert.rejects(
    () =>
      upsertGoal({
        vaultRoot,
        goalId: first.record.goalId,
        slug: second.record.slug,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_GOAL_CONFLICT" &&
      error.message === "Goal id and slug resolve to different records.",
  );

  const readByConflictingSelectors = await readGoal({
    vaultRoot,
    goalId: first.record.goalId,
    slug: second.record.slug,
  });

  assert.equal(readByConflictingSelectors.goalId, first.record.goalId);

  await assert.rejects(
    () =>
      readGoal({
        vaultRoot,
        slug: "missing-goal",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_GOAL_MISSING" &&
      error.message === "Goal was not found.",
  );
});

test("providers and recipes use first-class markdown registry reads without changing selector behavior", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-provider-recipe-registry");
  await initializeVault({ vaultRoot });

  const createdProvider = await upsertProvider({
    vaultRoot,
    title: "Labcorp",
    slug: "labcorp",
    status: "active",
    specialty: "lab",
    organization: "Labcorp",
    note: "Primary lab partner.",
    body: "# Labcorp\n\nPrimary lab partner.\n",
  });
  const renamedProvider = await upsertProvider({
    vaultRoot,
    providerId: createdProvider.providerId,
    slug: "labcorp-west",
    title: "Labcorp West",
    status: "active",
    specialty: "lab",
    organization: "Labcorp",
    note: "Primary lab partner.",
    body: "# Labcorp West\n\nPrimary lab partner.\n",
  });
  const secondProvider = await upsertProvider({
    vaultRoot,
    title: "Quest Diagnostics",
    slug: "quest-diagnostics",
    status: "active",
  });
  const createdRecipe = await upsertRecipe({
    vaultRoot,
    title: "Sheet Pan Salmon Bowls",
    slug: "sheet-pan-salmon-bowls",
    status: "saved",
    cuisine: "mediterranean",
    dishType: "dinner",
    summary: "A reliable high-protein salmon bowl with roasted vegetables and rice.",
    ingredients: ["2 salmon fillets", "2 cups cooked rice"],
    steps: ["Roast the broccoli.", "Add the salmon and finish roasting."],
  });

  const listedProviders = await listProviders(vaultRoot);
  const readProviderById = await readProvider({
    vaultRoot,
    providerId: createdProvider.providerId,
  });
  const readProviderBySlug = await readProvider({
    vaultRoot,
    slug: "labcorp-west",
  });
  const listedRecipes = await listRecipes(vaultRoot);
  const readRecipeById = await readRecipe({
    vaultRoot,
    recipeId: createdRecipe.record.recipeId,
  });
  const readRecipeBySlug = await readRecipe({
    vaultRoot,
    slug: "sheet-pan-salmon-bowls",
  });

  assert.equal(createdProvider.created, true);
  assert.equal(renamedProvider.created, false);
  assert.equal(renamedProvider.relativePath, "bank/providers/labcorp-west.md");
  assert.equal(listedProviders.length, 2);
  assert.equal(readProviderById.providerId, createdProvider.providerId);
  assert.equal(readProviderById.slug, "labcorp-west");
  assert.equal(readProviderBySlug.providerId, createdProvider.providerId);
  assert.equal(readProviderBySlug.title, "Labcorp West");
  assert.equal(listedProviders[0]?.providerId, createdProvider.providerId);
  assert.equal(listedProviders[1]?.providerId, secondProvider.providerId);
  assert.equal(listedRecipes.length, 1);
  assert.equal(readRecipeById.recipeId, createdRecipe.record.recipeId);
  assert.equal(readRecipeById.slug, "sheet-pan-salmon-bowls");
  assert.equal(readRecipeBySlug.recipeId, createdRecipe.record.recipeId);
  assert.equal(readRecipeBySlug.title, "Sheet Pan Salmon Bowls");

  await assert.rejects(
    () =>
      upsertProvider({
        vaultRoot,
        providerId: createdProvider.providerId,
        slug: secondProvider.relativePath
          .replace("bank/providers/", "")
          .replace(".md", ""),
        title: "Labcorp West",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "HB_PROVIDER_CONFLICT",
  );
});

test("foods use first-class markdown registry reads for regular meals and staples", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-food-registry");
  await initializeVault({ vaultRoot });

  const createdFood = await upsertFood({
    vaultRoot,
    title: "Regular Acai Bowl",
    slug: "regular-acai-bowl",
    status: "active",
    kind: "acai bowl",
    vendor: "Neighborhood Acai Bar",
    aliases: ["regular acai bowl", "usual acai bowl"],
    ingredients: ["acai base", "banana", "granola"],
    tags: ["breakfast", "favorite"],
    note: "Typical order includes extra granola.",
  });
  const renamedFood = await upsertFood({
    vaultRoot,
    foodId: createdFood.record.foodId,
    slug: "usual-acai-bowl",
    title: "Usual Acai Bowl",
    status: "active",
    kind: "acai bowl",
    vendor: "Neighborhood Acai Bar",
    aliases: ["regular acai bowl", "usual acai bowl"],
    ingredients: ["acai base", "banana", "granola"],
    tags: ["breakfast", "favorite"],
    note: "Typical order includes extra granola.",
  });
  const secondFood = await upsertFood({
    vaultRoot,
    title: "Purely Elizabeth Granola",
    slug: "purely-elizabeth-granola",
    status: "archived",
    kind: "granola",
    brand: "Purely Elizabeth",
  });

  const listedFoods = await listFoods(vaultRoot);
  const readFoodById = await readFood({
    vaultRoot,
    foodId: createdFood.record.foodId,
  });
  const readFoodBySlug = await readFood({
    vaultRoot,
    slug: createdFood.record.slug,
  });
  const foodMarkdown = await fs.readFile(
    path.join(vaultRoot, renamedFood.record.relativePath),
    "utf8",
  );

  assert.equal(createdFood.created, true);
  assert.equal(renamedFood.created, false);
  assert.equal(renamedFood.record.relativePath, createdFood.record.relativePath);
  assert.equal(renamedFood.record.slug, createdFood.record.slug);
  assert.equal(listedFoods.length, 2);
  assert.equal(readFoodById.foodId, createdFood.record.foodId);
  assert.equal(readFoodById.slug, createdFood.record.slug);
  assert.equal(readFoodBySlug.foodId, createdFood.record.foodId);
  assert.equal(readFoodBySlug.title, "Usual Acai Bowl");
  assert.equal(listedFoods[0]?.foodId, secondFood.record.foodId);
  assert.equal(listedFoods[1]?.foodId, createdFood.record.foodId);
  assert.match(foodMarkdown, /foodId:/u);
  assert.match(foodMarkdown, /## Aliases/u);
  assert.match(foodMarkdown, /## Ingredients/u);

  await assert.rejects(
    () =>
      upsertFood({
        vaultRoot,
        foodId: createdFood.record.foodId,
        slug: secondFood.record.relativePath.replace("bank/foods/", "").replace(".md", ""),
        title: "Usual Acai Bowl",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FOOD_CONFLICT",
  );

  await assert.rejects(
    () =>
      readFood({
        vaultRoot,
        slug: "missing-food",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_FOOD_MISSING" &&
      error.message === "Food was not found.",
  );
});

test("conditions and allergies are stored as deterministic markdown registry pages", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-conditions");
  await initializeVault({ vaultRoot });

  const goal = await upsertGoal({
    vaultRoot,
    title: "Reduce migraine frequency",
    window: {
      startAt: "2026-03-01",
    },
  });
  const regimen = await upsertRegimenItem({
    vaultRoot,
    title: "Magnesium glycinate",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-03",
    dose: 200,
    unit: "mg",
    schedule: "nightly",
  });
  const condition = await upsertCondition({
    vaultRoot,
    title: "Migraine",
    clinicalStatus: "active",
    verificationStatus: "confirmed",
    assertedOn: "2024-05-01",
    bodySites: ["head"],
    relatedGoalIds: [goal.record.goalId],
    relatedRegimenIds: [regimen.record.regimenId],
    note: "Likely worsened by sleep disruption.",
  });
  const allergy = await upsertAllergy({
    vaultRoot,
    title: "Penicillin allergy",
    substance: "penicillin",
    status: "active",
    criticality: "high",
    reaction: "rash",
    recordedOn: "2018-04-10",
    relatedConditionIds: [condition.record.conditionId],
    note: "Avoid beta-lactam exposure until formally reviewed.",
  });

  const conditions = await listConditions(vaultRoot);
  const allergies = await listAllergies(vaultRoot);
  const readConditionRecord = await readCondition({
    vaultRoot,
    slug: condition.record.slug,
  });
  const readAllergyRecord = await readAllergy({
    vaultRoot,
    allergyId: allergy.record.allergyId,
  });
  const patchedCondition = await upsertCondition({
    vaultRoot,
    conditionId: condition.record.conditionId,
  });
  const patchedAllergy = await upsertAllergy({
    vaultRoot,
    allergyId: allergy.record.allergyId,
  });
  const conditionAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: patchedCondition.auditPath,
  });
  const allergyAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: patchedAllergy.auditPath,
  });

  assert.equal(conditions.length, 1);
  assert.equal(allergies.length, 1);
  assert.equal(patchedCondition.record.title, condition.record.title);
  assert.equal(patchedAllergy.record.title, allergy.record.title);
  assert.deepEqual(readConditionRecord.relatedGoalIds, [goal.record.goalId]);
  assert.deepEqual(readAllergyRecord.relatedConditionIds, [condition.record.conditionId]);
  assert.match(readConditionRecord.markdown, /## Related Regimens/);
  assert.match(readAllergyRecord.markdown, /## Related Conditions/);
  assert.deepEqual(patchedCondition.record.relatedGoalIds, [goal.record.goalId]);
  assert.deepEqual(patchedCondition.record.relatedRegimenIds, [regimen.record.regimenId]);
  assert.equal(patchedCondition.record.note, "Likely worsened by sleep disruption.");
  assert.deepEqual(patchedAllergy.record.relatedConditionIds, [condition.record.conditionId]);
  assert.equal(patchedAllergy.record.substance, "penicillin");
  assert.equal(
    conditionAuditRecords.filter((record) => (record as { action?: string }).action === "condition_upsert").length,
    2,
  );
  assert.equal(
    allergyAuditRecords.filter((record) => (record as { action?: string }).action === "allergy_upsert").length,
    2,
  );

  const operations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );
  const conditionOperations = operations.filter((operation) => operation.operationType === "condition_upsert");
  const allergyOperations = operations.filter((operation) => operation.operationType === "allergy_upsert");

  assert.equal(conditionOperations.length, 2);
  assert.ok(conditionOperations.every((operation) => operation.status === "committed"));
  assert.equal(allergyOperations.length, 2);
  assert.ok(allergyOperations.every((operation) => operation.status === "committed"));
});

test("condition and allergy id-or-slug resolution preserves conflict, missing, and read-preference behavior", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-condition-allergy-resolution");
  await initializeVault({ vaultRoot });

  const firstCondition = await upsertCondition({
    vaultRoot,
    title: "Migraine",
  });
  const secondCondition = await upsertCondition({
    vaultRoot,
    title: "Asthma",
  });

  await assert.rejects(
    () =>
      upsertCondition({
        vaultRoot,
        conditionId: firstCondition.record.conditionId,
        slug: secondCondition.record.slug,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_CONDITION_CONFLICT" &&
      error.message === "Condition id and slug resolve to different records.",
  );

  const readConditionByConflictingSelectors = await readCondition({
    vaultRoot,
    conditionId: firstCondition.record.conditionId,
    slug: secondCondition.record.slug,
  });

  assert.equal(readConditionByConflictingSelectors.conditionId, firstCondition.record.conditionId);

  await assert.rejects(
    () =>
      readCondition({
        vaultRoot,
        slug: "missing-condition",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_CONDITION_MISSING" &&
      error.message === "Condition was not found.",
  );

  const firstAllergy = await upsertAllergy({
    vaultRoot,
    title: "Peanut allergy",
    substance: "peanut",
  });
  const secondAllergy = await upsertAllergy({
    vaultRoot,
    title: "Shellfish allergy",
    substance: "shellfish",
  });

  await assert.rejects(
    () =>
      upsertAllergy({
        vaultRoot,
        allergyId: firstAllergy.record.allergyId,
        slug: secondAllergy.record.slug,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_ALLERGY_CONFLICT" &&
      error.message === "Allergy id and slug resolve to different records.",
  );

  const readAllergyByConflictingSelectors = await readAllergy({
    vaultRoot,
    allergyId: firstAllergy.record.allergyId,
    slug: secondAllergy.record.slug,
  });

  assert.equal(readAllergyByConflictingSelectors.allergyId, firstAllergy.record.allergyId);

  await assert.rejects(
    () =>
      readAllergy({
        vaultRoot,
        slug: "missing-allergy",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_ALLERGY_MISSING" &&
      error.message === "Allergy was not found.",
  );
});

test("regimens support medication and supplement groups plus stop handling", async () => {
  const vaultRoot = await makeTempDirectory("healthybob-regimens");
  await initializeVault({ vaultRoot });

  const medication = await upsertRegimenItem({
    vaultRoot,
    title: "Metformin XR",
    kind: "medication",
    status: "active",
    startedOn: "2026-02-01",
    substance: "metformin",
    dose: 500,
    unit: "mg",
    schedule: "with dinner",
  });
  const supplement = await upsertRegimenItem({
    vaultRoot,
    title: "Fish oil",
    kind: "supplement",
    status: "active",
    startedOn: "2026-02-15",
    substance: "omega-3",
    dose: 1000,
    unit: "mg",
    schedule: "with breakfast",
    brand: "Nordic Naturals",
    manufacturer: "Nordic Naturals",
    servingSize: "2 softgels",
    ingredients: [
      {
        compound: "EPA",
        label: "Eicosapentaenoic acid",
        amount: 600,
        unit: "mg",
      },
      {
        compound: "DHA",
        label: "Docosahexaenoic acid",
        amount: 400,
        unit: "mg",
      },
    ],
  });
  const stopped = await stopRegimenItem({
    vaultRoot,
    regimenId: medication.record.regimenId,
    stoppedOn: "2026-03-20",
  });

  const listed = await listRegimenItems(vaultRoot);
  const readMedication = await readRegimenItem({
    vaultRoot,
    regimenId: medication.record.regimenId,
  });
  const readSupplement = await readRegimenItem({
    vaultRoot,
    slug: supplement.record.slug,
    group: "supplement",
  });
  const patchedSupplement = await upsertRegimenItem({
    vaultRoot,
    regimenId: supplement.record.regimenId,
  });
  const regimenAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: patchedSupplement.auditPath,
  });
  const stopAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: stopped.auditPath,
  });
  const regimenOperations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );

  assert.equal(listed.length, 2);
  assert.equal(readMedication.group, "medication");
  assert.equal(readSupplement.group, "supplement");
  assert.equal(readSupplement.brand, "Nordic Naturals");
  assert.equal(readSupplement.manufacturer, "Nordic Naturals");
  assert.equal(readSupplement.servingSize, "2 softgels");
  assert.deepEqual(
    readSupplement.ingredients?.map((ingredient) => ({
      compound: ingredient.compound,
      label: ingredient.label,
      amount: ingredient.amount,
      unit: ingredient.unit,
    })),
    [
      {
        compound: "EPA",
        label: "Eicosapentaenoic acid",
        amount: 600,
        unit: "mg",
      },
      {
        compound: "DHA",
        label: "Docosahexaenoic acid",
        amount: 400,
        unit: "mg",
      },
    ],
  );
  assert.equal(stopped.record.status, "stopped");
  assert.equal(stopped.record.stoppedOn, "2026-03-20");
  assert.equal(patchedSupplement.record.title, supplement.record.title);
  assert.equal(patchedSupplement.record.schedule, "with breakfast");
  assert.equal(patchedSupplement.record.startedOn, "2026-02-15");
  assert.equal(patchedSupplement.record.brand, "Nordic Naturals");
  assert.equal(patchedSupplement.record.servingSize, "2 softgels");
  assert.match(stopped.record.relativePath, /^bank\/regimens\/medication\//);
  assert.match(readMedication.markdown, /Stopped on: 2026-03-20/);
  assert.match(readSupplement.markdown, /## Product/);
  assert.match(readSupplement.markdown, /Brand: Nordic Naturals/);
  assert.match(readSupplement.markdown, /Serving size: 2 softgels/);
  assert.match(readSupplement.markdown, /## Ingredients/);
  assert.match(readSupplement.markdown, /EPA — 600 mg/);
  assert.match(readSupplement.markdown, /DHA — 400 mg/);
  assert.deepEqual(selectAuditMetadata(regimenAuditRecords, "regimen_upsert"), [
    { action: "regimen_upsert", commandName: "core.upsertRegimenItem", op: "create" },
    { action: "regimen_upsert", commandName: "core.upsertRegimenItem", op: "create" },
    { action: "regimen_upsert", commandName: "core.upsertRegimenItem", op: "update" },
  ]);
  assert.deepEqual(selectAuditMetadata(stopAuditRecords, "regimen_stop"), [
    { action: "regimen_stop", commandName: "core.stopRegimenItem", op: "update" },
  ]);
  assert.equal(regimenOperations.filter((operation) => operation.operationType === "regimen_upsert").length, 3);
  assert.equal(regimenOperations.filter((operation) => operation.operationType === "regimen_stop").length, 1);
  assert.ok(regimenOperations.every((operation) => operation.status === "committed"));
});
