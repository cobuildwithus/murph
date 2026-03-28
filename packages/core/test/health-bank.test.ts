import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault, readJsonlRecords, VaultError } from "../src/index.ts";
import { resolveAuditShardPath } from "../src/audit.ts";
import { listWriteOperationMetadataPaths, readStoredWriteOperation } from "../src/operations/index.ts";
import {
  deleteFood,
  deleteProvider,
  deleteRecipe,
  listAllergies,
  listConditions,
  listFoods,
  listGoals,
  listProviders,
  listRecipes,
  listWorkoutFormats,
  listProtocolItems,
  readAllergy,
  readCondition,
  readFood,
  readGoal,
  readProvider,
  readRecipe,
  readWorkoutFormat,
  readProtocolItem,
  stopProtocolItem,
  upsertAllergy,
  upsertCondition,
  upsertFood,
  upsertGoal,
  upsertProvider,
  upsertRecipe,
  upsertWorkoutFormat,
  upsertProtocolItem,
} from "../src/bank/index.ts";

type AuditLikeRecord = {
  action?: string;
  commandName?: string;
  targetIds?: string[];
  changes?: Array<{
    op?: string;
    path?: string;
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
  const vaultRoot = await makeTempDirectory("murph-goals");
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
  assert.deepEqual(read.links, [
    {
      type: "parent_goal",
      targetId: primary.record.goalId,
    },
    {
      type: "related_goal",
      targetId: primary.record.goalId,
    },
    {
      type: "related_experiment",
      targetId: "exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    },
  ]);
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

test("goal updates can clear shared relation fields without leaving stale links behind", async () => {
  const vaultRoot = await makeTempDirectory("murph-goal-clear-links");
  await initializeVault({ vaultRoot });

  const parent = await upsertGoal({
    vaultRoot,
    title: "Improve sleep routine",
    window: {
      startAt: "2026-03-01",
    },
  });
  const related = await upsertGoal({
    vaultRoot,
    title: "Lift consistently",
    window: {
      startAt: "2026-03-02",
    },
  });
  const goal = await upsertGoal({
    vaultRoot,
    title: "Recover better",
    window: {
      startAt: "2026-03-03",
    },
    parentGoalId: parent.record.goalId,
    relatedGoalIds: [related.record.goalId],
    relatedExperimentIds: ["exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
  });

  const cleared = await upsertGoal({
    vaultRoot,
    goalId: goal.record.goalId,
    parentGoalId: null,
    relatedGoalIds: [],
    relatedExperimentIds: [],
  });
  const read = await readGoal({
    vaultRoot,
    goalId: goal.record.goalId,
  });

  assert.equal(cleared.created, false);
  assert.equal(read.parentGoalId, null);
  assert.equal(read.relatedGoalIds, undefined);
  assert.equal(read.relatedExperimentIds, undefined);
  assert.deepEqual(read.links, []);
  assert.match(read.markdown, /Parent goal: none/);
  assert.match(read.markdown, /## Related Goals[\s\S]*- none/);
  assert.match(read.markdown, /## Related Experiments[\s\S]*- none/);
  assert.doesNotMatch(read.markdown, new RegExp(parent.record.goalId));
  assert.doesNotMatch(read.markdown, new RegExp(related.record.goalId));
  assert.doesNotMatch(read.markdown, /exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8/);
});

test("goal reads reject non-canonical frontmatter after the hard cut", async () => {
  const vaultRoot = await makeTempDirectory("murph-goal-strict-frontmatter");
  await initializeVault({ vaultRoot });

  const goalId = "goal_01JNYB6M9A6W4K2N8P3Q7R5S4T";
  const relativePath = "bank/goals/legacy-goal.md";

  await fs.writeFile(
    path.join(vaultRoot, relativePath),
    [
      "---",
      "schemaVersion: murph.frontmatter.goal.v1",
      "docType: goal",
      `goalId: ${goalId}`,
      "slug: legacy-goal",
      "title: Legacy goal",
      "window:",
      "  startAt: 2026-03-12",
      "owner: coach",
      "---",
      "",
      "# Legacy goal",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      readGoal({
        vaultRoot,
        goalId,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_GOAL" &&
      error.message === "Goal registry document has an unexpected shape.",
  );
});

test("goal id-or-slug resolution preserves conflict, missing, and read-preference behavior", async () => {
  const vaultRoot = await makeTempDirectory("murph-goal-resolution");
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
  const vaultRoot = await makeTempDirectory("murph-provider-recipe-registry");
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
    ingredients: ["2 cups cooked rice", "2 salmon fillets", "2 cups cooked rice"],
    steps: [
      "Add the salmon and finish roasting.",
      "Roast the broccoli.",
      "Add the salmon and finish roasting.",
    ],
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
  assert.deepEqual(readRecipeById.ingredients, ["2 cups cooked rice", "2 salmon fillets"]);
  assert.deepEqual(readRecipeById.steps, [
    "Add the salmon and finish roasting.",
    "Roast the broccoli.",
  ]);
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
      error instanceof VaultError && error.code === "PROVIDER_CONFLICT",
  );
});

test("markdown registry helpers keep provider and recipe rename writes on the shared canonical path", async () => {
  const vaultRoot = await makeTempDirectory("murph-markdown-registry-write-seam");
  await initializeVault({ vaultRoot });

  const provider = await upsertProvider({
    vaultRoot,
    title: "Northwest Labs",
    slug: "northwest-labs",
    status: "active",
    body: "# Northwest Labs\n",
  });
  const renamedProvider = await upsertProvider({
    vaultRoot,
    providerId: provider.providerId,
    title: "Northwest Labs West",
    slug: "northwest-labs-west",
    status: "active",
    body: "# Northwest Labs West\n",
  });
  const recipe = await upsertRecipe({
    vaultRoot,
    title: "Tahini Salmon Bowl",
    slug: "tahini-salmon-bowl",
    status: "saved",
    ingredients: ["salmon", "rice"],
    steps: ["Roast the salmon."],
  });
  const renamedRecipe = await upsertRecipe({
    vaultRoot,
    recipeId: recipe.record.recipeId,
    title: "Tahini Salmon Bowl",
    slug: "usual-tahini-salmon-bowl",
    allowSlugRename: true,
    status: "saved",
    ingredients: ["salmon", "rice"],
    steps: ["Roast the salmon."],
  });
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: resolveAuditShardPath(new Date()),
  });
  const operations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );

  await assert.rejects(() =>
    fs.access(path.join(vaultRoot, "bank/providers/northwest-labs.md")));
  await assert.rejects(() =>
    fs.access(path.join(vaultRoot, "bank/recipes/tahini-salmon-bowl.md")));

  assert.equal(renamedProvider.created, false);
  assert.equal(renamedProvider.relativePath, "bank/providers/northwest-labs-west.md");
  assert.equal(renamedRecipe.created, false);
  assert.equal(renamedRecipe.record.relativePath, "bank/recipes/usual-tahini-salmon-bowl.md");
  assert.deepEqual(selectAuditMetadata(auditRecords, "provider_upsert"), [
    { action: "provider_upsert", commandName: "core.upsertProvider", op: "create" },
    { action: "provider_upsert", commandName: "core.upsertProvider", op: "update" },
  ]);
  assert.deepEqual(selectAuditMetadata(auditRecords, "recipe_upsert"), [
    { action: "recipe_upsert", commandName: "core.upsertRecipe", op: "create" },
    { action: "recipe_upsert", commandName: "core.upsertRecipe", op: "update" },
  ]);
  assert.deepEqual(
    auditRecords
      .filter(
        (record): record is AuditLikeRecord =>
          typeof record === "object" &&
          record !== null &&
          (record as AuditLikeRecord).action === "provider_upsert",
      )
      .map((record) => ({
        path: record.changes?.[0]?.path,
        targetId: record.targetIds?.[0],
      })),
    [
      {
        path: "bank/providers/northwest-labs.md",
        targetId: provider.providerId,
      },
      {
        path: "bank/providers/northwest-labs-west.md",
        targetId: provider.providerId,
      },
    ],
  );
  assert.deepEqual(
    auditRecords
      .filter(
        (record): record is AuditLikeRecord =>
          typeof record === "object" &&
          record !== null &&
          (record as AuditLikeRecord).action === "recipe_upsert",
      )
      .map((record) => ({
        path: record.changes?.[0]?.path,
        targetId: record.targetIds?.[0],
      })),
    [
      {
        path: "bank/recipes/tahini-salmon-bowl.md",
        targetId: recipe.record.recipeId,
      },
      {
        path: "bank/recipes/usual-tahini-salmon-bowl.md",
        targetId: recipe.record.recipeId,
      },
    ],
  );
  assert.equal(operations.filter((operation) => operation.operationType === "provider_upsert").length, 2);
  assert.equal(operations.filter((operation) => operation.operationType === "recipe_upsert").length, 2);
  assert.ok(operations.every((operation) => operation.status === "committed"));
});

test("food, provider, and recipe deletes remove the markdown registry record cleanly", async () => {
  const vaultRoot = await makeTempDirectory("murph-bank-deletes");
  await initializeVault({ vaultRoot });

  const provider = await upsertProvider({
    vaultRoot,
    title: "Labcorp",
    slug: "labcorp",
    status: "active",
    body: "# Labcorp\n",
  });
  const food = await upsertFood({
    vaultRoot,
    title: "Regular Acai Bowl",
    slug: "regular-acai-bowl",
    status: "active",
  });
  const recipe = await upsertRecipe({
    vaultRoot,
    title: "Sheet Pan Salmon Bowls",
    slug: "sheet-pan-salmon-bowls",
    status: "saved",
    ingredients: ["2 salmon fillets"],
    steps: ["Roast the salmon."],
  });

  const deletedProvider = await deleteProvider({
    vaultRoot,
    providerId: provider.providerId,
  });
  const deletedFood = await deleteFood({
    vaultRoot,
    foodId: food.record.foodId,
  });
  const deletedRecipe = await deleteRecipe({
    vaultRoot,
    recipeId: recipe.record.recipeId,
  });
  const operations = await Promise.all(
    (await listWriteOperationMetadataPaths(vaultRoot)).map((relativePath) =>
      readStoredWriteOperation(vaultRoot, relativePath),
    ),
  );

  assert.equal(deletedProvider.providerId, provider.providerId);
  assert.equal(deletedProvider.deleted, true);
  assert.equal(deletedFood.foodId, food.record.foodId);
  assert.equal(deletedFood.deleted, true);
  assert.equal(deletedRecipe.recipeId, recipe.record.recipeId);
  assert.equal(deletedRecipe.deleted, true);

  await assert.rejects(() =>
    fs.access(path.join(vaultRoot, deletedProvider.relativePath)));
  await assert.rejects(() =>
    fs.access(path.join(vaultRoot, deletedFood.relativePath)));
  await assert.rejects(() =>
    fs.access(path.join(vaultRoot, deletedRecipe.relativePath)));

  await assert.rejects(
    () =>
      readProvider({
        vaultRoot,
        providerId: provider.providerId,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "PROVIDER_MISSING",
  );
  await assert.rejects(
    () =>
      readFood({
        vaultRoot,
        foodId: food.record.foodId,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_FOOD_MISSING",
  );
  await assert.rejects(
    () =>
      readRecipe({
        vaultRoot,
        recipeId: recipe.record.recipeId,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_RECIPE_MISSING",
  );
  assert.deepEqual(
    operations
      .filter((operation) => operation.operationType === "provider_delete")
      .map((operation) => ({
        status: operation.status,
        actions: operation.actions.map((action) => ({
          kind: action.kind,
          state: action.state,
          effect: action.effect,
          targetRelativePath: action.targetRelativePath,
        })),
      })),
    [
      {
        status: "committed",
        actions: [
          {
            kind: "delete",
            state: "applied",
            effect: "delete",
            targetRelativePath: deletedProvider.relativePath,
          },
        ],
      },
    ],
  );
  assert.deepEqual(
    operations
      .filter((operation) => operation.operationType === "recipe_delete")
      .map((operation) => ({
        status: operation.status,
        actions: operation.actions.map((action) => ({
          kind: action.kind,
          state: action.state,
          effect: action.effect,
          targetRelativePath: action.targetRelativePath,
        })),
      })),
    [
      {
        status: "committed",
        actions: [
          {
            kind: "delete",
            state: "applied",
            effect: "delete",
            targetRelativePath: deletedRecipe.relativePath,
          },
        ],
      },
    ],
  );
});

test("providers surface renamed slug and frontmatter validation codes", async () => {
  const vaultRoot = await makeTempDirectory("murph-provider-errors");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertProvider({
        vaultRoot,
        title: "Broken Provider",
        slug: "!!!",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "PROVIDER_SLUG_INVALID",
  );

  await fs.mkdir(path.join(vaultRoot, "bank/providers"), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, "bank/providers/broken.md"),
    [
      "---",
      "providerId: prov_01JNV422Y2M5ZBV64ZP4N1DRB1",
      "slug: broken",
      "---",
      "# Broken Provider",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      readProvider({
        vaultRoot,
        slug: "broken",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "PROVIDER_FRONTMATTER_INVALID",
  );
});

test("foods use first-class markdown registry reads for regular meals and staples", async () => {
  const vaultRoot = await makeTempDirectory("murph-food-registry");
  await initializeVault({ vaultRoot });

  const createdFood = await upsertFood({
    vaultRoot,
    title: "Regular Acai Bowl",
    slug: "regular-acai-bowl",
    status: "active",
    kind: "acai bowl",
    vendor: "Neighborhood Acai Bar",
    aliases: ["usual acai bowl", "regular acai bowl", "usual acai bowl"],
    ingredients: ["banana", "acai base", "banana", "granola"],
    tags: ["breakfast", "favorite"],
    note: "Typical order includes extra granola.",
    autoLogDaily: {
      time: "08:00",
    },
  });
  const renamedFood = await upsertFood({
    vaultRoot,
    foodId: createdFood.record.foodId,
    slug: "usual-acai-bowl",
    title: "Usual Acai Bowl",
    status: "active",
    kind: "acai bowl",
    vendor: "Neighborhood Acai Bar",
    aliases: ["usual acai bowl", "regular acai bowl", "usual acai bowl"],
    ingredients: ["banana", "acai base", "banana", "granola"],
    tags: ["breakfast", "favorite"],
    note: "Typical order includes extra granola.",
    autoLogDaily: {
      time: "08:00",
    },
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
  assert.deepEqual(readFoodById.aliases, ["usual acai bowl", "regular acai bowl"]);
  assert.deepEqual(readFoodById.ingredients, ["banana", "acai base", "granola"]);
  assert.deepEqual(readFoodById.autoLogDaily, {
    time: "08:00",
  });
  assert.equal(readFoodBySlug.foodId, createdFood.record.foodId);
  assert.equal(readFoodBySlug.title, "Usual Acai Bowl");
  assert.deepEqual(readFoodBySlug.autoLogDaily, {
    time: "08:00",
  });
  assert.equal(listedFoods[0]?.foodId, secondFood.record.foodId);
  assert.equal(listedFoods[1]?.foodId, createdFood.record.foodId);
  assert.match(foodMarkdown, /foodId:/u);
  assert.match(foodMarkdown, /autoLogDaily:/u);
  assert.match(foodMarkdown, /## Aliases/u);
  assert.match(foodMarkdown, /## Ingredients/u);
  assert.match(foodMarkdown, /Auto-log daily/u);
  assert.doesNotMatch(foodMarkdown, /^attachedProtocolRefs:/mu);

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

test("food and recipe text-list normalization preserves validation messages and clear semantics", async () => {
  const vaultRoot = await makeTempDirectory("murph-bank-text-list-validation");
  await initializeVault({ vaultRoot });

  const createdFood = await upsertFood({
    vaultRoot,
    title: "Validation Smoothie",
    ingredients: ["banana", "protein powder"],
    aliases: ["usual smoothie"],
  });
  const createdRecipe = await upsertRecipe({
    vaultRoot,
    title: "Validation Bowl",
    ingredients: ["rice"],
    steps: ["Cook the rice."],
  });

  await assert.rejects(
    () =>
      upsertFood({
        vaultRoot,
        title: "Broken Food",
        aliases: "usual smoothie" as unknown as string[],
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "aliases must be an array.",
  );

  await assert.rejects(
    () =>
      upsertFood({
        vaultRoot,
        title: "Too Many Ingredients",
        ingredients: Array.from({ length: 101 }, (_, index) => `ingredient ${index}`),
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "ingredients exceeds the maximum item count.",
  );

  await assert.rejects(
    () =>
      upsertFood({
        vaultRoot,
        title: "Too Long Ingredient",
        ingredients: ["a".repeat(4001)],
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "ingredients[0] exceeds the maximum length.",
  );

  await assert.rejects(
    () =>
      upsertRecipe({
        vaultRoot,
        title: "Broken Recipe",
        steps: "Mix everything." as unknown as string[],
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "steps must be an array.",
  );

  await assert.rejects(
    () =>
      upsertRecipe({
        vaultRoot,
        title: "Too Many Recipe Ingredients",
        ingredients: Array.from({ length: 101 }, (_, index) => `ingredient ${index}`),
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "ingredients exceeds the maximum item count.",
  );

  await assert.rejects(
    () =>
      upsertRecipe({
        vaultRoot,
        title: "Blank Recipe Step",
        steps: ["   "],
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "steps[0] is required.",
  );

  await upsertFood({
    vaultRoot,
    foodId: createdFood.record.foodId,
    title: createdFood.record.title,
    aliases: null as unknown as string[] | undefined,
    ingredients: [] as string[],
  });
  await upsertRecipe({
    vaultRoot,
    recipeId: createdRecipe.record.recipeId,
    title: createdRecipe.record.title,
    ingredients: [] as string[],
    steps: null as unknown as string[] | undefined,
  });

  const clearedFood = await readFood({
    vaultRoot,
    foodId: createdFood.record.foodId,
  });
  const clearedRecipe = await readRecipe({
    vaultRoot,
    recipeId: createdRecipe.record.recipeId,
  });

  assert.equal(clearedFood.aliases, undefined);
  assert.equal(clearedFood.ingredients, undefined);
  assert.equal(clearedRecipe.ingredients, undefined);
  assert.equal(clearedRecipe.steps, undefined);
});

test("workout formats use first-class markdown registry reads for repeated sessions", async () => {
  const vaultRoot = await makeTempDirectory("murph-workout-format-registry");
  await initializeVault({ vaultRoot });

  const createdFormat = await upsertWorkoutFormat({
    vaultRoot,
    title: "Upper Body A",
    slug: "upper-body-a",
    status: "active",
    summary: "Default upper-body strength session I repeat most weeks.",
    activityType: "strength training",
    durationMinutes: 45,
    strengthExercises: [
      {
        exercise: "pushups",
        setCount: 4,
        repsPerSet: 20,
      },
      {
        exercise: "incline bench",
        setCount: 4,
        repsPerSet: 12,
        load: 65,
        loadUnit: "lb",
        loadDescription: "45 lb bar plus 10 lb plates on both sides",
      },
    ],
    tags: ["gym", "strength"],
    note: "Usual upper-body session.",
  });
  const updatedFormat = await upsertWorkoutFormat({
    vaultRoot,
    workoutFormatId: createdFormat.record.workoutFormatId,
    title: "Upper Body A",
    summary: "Default upper-body lift with push and incline bench work.",
    activityType: "strength-training",
    durationMinutes: 50,
    strengthExercises: [
      {
        exercise: "pushups",
        setCount: 4,
        repsPerSet: 20,
      },
      {
        exercise: "incline bench",
        setCount: 5,
        repsPerSet: 10,
        load: 65,
        loadUnit: "lb",
        loadDescription: "45 lb bar plus 10 lb plates on both sides",
      },
    ],
    tags: ["gym", "strength"],
    note: "Usual upper-body session.",
  });
  const secondFormat = await upsertWorkoutFormat({
    vaultRoot,
    title: "Half Marathon",
    slug: "half-marathon",
    status: "archived",
    activityType: "running",
    distanceKm: 21.1,
    tags: ["race"],
  });

  const listedFormats = await listWorkoutFormats(vaultRoot);
  const readFormatById = await readWorkoutFormat({
    vaultRoot,
    workoutFormatId: createdFormat.record.workoutFormatId,
  });
  const readFormatBySlug = await readWorkoutFormat({
    vaultRoot,
    slug: createdFormat.record.slug,
  });
  const workoutFormatMarkdown = await fs.readFile(
    path.join(vaultRoot, updatedFormat.record.relativePath),
    "utf8",
  );

  assert.equal(createdFormat.created, true);
  assert.equal(updatedFormat.created, false);
  assert.equal(updatedFormat.record.relativePath, createdFormat.record.relativePath);
  assert.equal(updatedFormat.record.slug, createdFormat.record.slug);
  assert.equal(listedFormats.length, 2);
  assert.equal(readFormatById.workoutFormatId, createdFormat.record.workoutFormatId);
  assert.equal(readFormatById.activityType, "strength-training");
  assert.equal(readFormatById.durationMinutes, 50);
  assert.equal(readFormatBySlug.workoutFormatId, createdFormat.record.workoutFormatId);
  assert.equal(readFormatBySlug.summary, "Default upper-body lift with push and incline bench work.");
  assert.equal(listedFormats[0]?.workoutFormatId, secondFormat.record.workoutFormatId);
  assert.equal(listedFormats[1]?.workoutFormatId, createdFormat.record.workoutFormatId);
  assert.match(workoutFormatMarkdown, /workoutFormatId:/u);
  assert.match(workoutFormatMarkdown, /activityType: strength-training/u);
  assert.match(workoutFormatMarkdown, /## Strength Exercises/u);
  assert.match(workoutFormatMarkdown, /Default duration/u);

  await assert.rejects(
    () =>
      upsertWorkoutFormat({
        vaultRoot,
        workoutFormatId: createdFormat.record.workoutFormatId,
        slug: secondFormat.record.relativePath
          .replace("bank/workout-formats/", "")
          .replace(".md", ""),
        title: "Upper Body A",
        activityType: "strength-training",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "VAULT_WORKOUT_FORMAT_CONFLICT",
  );

  await assert.rejects(
    () =>
      readWorkoutFormat({
        vaultRoot,
        slug: "missing-workout-format",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_WORKOUT_FORMAT_MISSING" &&
      error.message === "Workout format was not found.",
  );
});

test("conditions and allergies are stored as deterministic markdown registry pages", async () => {
  const vaultRoot = await makeTempDirectory("murph-conditions");
  await initializeVault({ vaultRoot });

  const goal = await upsertGoal({
    vaultRoot,
    title: "Reduce migraine frequency",
    window: {
      startAt: "2026-03-01",
    },
  });
  const protocol = await upsertProtocolItem({
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
    relatedProtocolIds: [protocol.record.protocolId],
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
  assert.match(readConditionRecord.markdown, /## Related Protocols/);
  assert.match(readAllergyRecord.markdown, /## Related Conditions/);
  assert.deepEqual(patchedCondition.record.relatedGoalIds, [goal.record.goalId]);
  assert.deepEqual(patchedCondition.record.relatedProtocolIds, [protocol.record.protocolId]);
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
  const vaultRoot = await makeTempDirectory("murph-condition-allergy-resolution");
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

test("protocols support medication and supplement groups plus stop handling", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocols");
  await initializeVault({ vaultRoot });

  const medication = await upsertProtocolItem({
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
  const supplement = await upsertProtocolItem({
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
  const stopped = await stopProtocolItem({
    vaultRoot,
    protocolId: medication.record.protocolId,
    stoppedOn: "2026-03-20",
  });

  const listed = await listProtocolItems(vaultRoot);
  const readMedication = await readProtocolItem({
    vaultRoot,
    protocolId: medication.record.protocolId,
  });
  const readSupplement = await readProtocolItem({
    vaultRoot,
    slug: supplement.record.slug,
    group: "supplement",
  });
  const protocolMarkdown = await fs.readFile(
    path.join(vaultRoot, supplement.record.relativePath),
    "utf8",
  );
  const patchedSupplement = await upsertProtocolItem({
    vaultRoot,
    protocolId: supplement.record.protocolId,
  });
  const protocolAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: patchedSupplement.auditPath,
  });
  const stopAuditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: stopped.auditPath,
  });
  const protocolOperations = await Promise.all(
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
  assert.match(stopped.record.relativePath, /^bank\/protocols\/medication\//);
  assert.match(readMedication.markdown, /Stopped on: 2026-03-20/);
  assert.match(readSupplement.markdown, /## Product/);
  assert.match(readSupplement.markdown, /Brand: Nordic Naturals/);
  assert.match(readSupplement.markdown, /Serving size: 2 softgels/);
  assert.match(readSupplement.markdown, /## Ingredients/);
  assert.match(readSupplement.markdown, /EPA — 600 mg/);
  assert.match(readSupplement.markdown, /DHA — 400 mg/);
  assert.doesNotMatch(protocolMarkdown, /^group:/mu);
  assert.deepEqual(selectAuditMetadata(protocolAuditRecords, "protocol_upsert"), [
    { action: "protocol_upsert", commandName: "core.upsertProtocolItem", op: "create" },
    { action: "protocol_upsert", commandName: "core.upsertProtocolItem", op: "create" },
    { action: "protocol_upsert", commandName: "core.upsertProtocolItem", op: "update" },
  ]);
  assert.deepEqual(selectAuditMetadata(stopAuditRecords, "protocol_stop"), [
    { action: "protocol_stop", commandName: "core.stopProtocolItem", op: "update" },
  ]);
  assert.equal(protocolOperations.filter((operation) => operation.operationType === "protocol_upsert").length, 3);
  assert.equal(protocolOperations.filter((operation) => operation.operationType === "protocol_stop").length, 1);
  assert.ok(protocolOperations.every((operation) => operation.status === "committed"));
});

test("protocol reads with conflicting protocolId and slug currently return the first sorted selector match", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-read-conflict");
  await initializeVault({ vaultRoot });

  const medication = await upsertProtocolItem({
    vaultRoot,
    title: "Magnesium glycinate medication",
    slug: "magnesium-glycinate",
    kind: "medication",
    status: "active",
    startedOn: "2026-02-01",
  });
  const supplement = await upsertProtocolItem({
    vaultRoot,
    title: "Magnesium glycinate supplement",
    slug: "magnesium-glycinate-supplement",
    kind: "supplement",
    status: "active",
    startedOn: "2026-02-02",
  });

  const readByConflictingSelectors = await readProtocolItem({
    vaultRoot,
    protocolId: supplement.record.protocolId,
    slug: medication.record.slug,
  });

  assert.equal(readByConflictingSelectors.protocolId, medication.record.protocolId);
  assert.equal(readByConflictingSelectors.group, "medication");
});

test("protocol reads reject ambiguous slugs across groups unless group is supplied", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-read-ambiguous-slug");
  await initializeVault({ vaultRoot });

  await upsertProtocolItem({
    vaultRoot,
    title: "Electrolyte support medication",
    slug: "electrolyte-support",
    kind: "medication",
    group: "medication",
    status: "active",
    startedOn: "2026-02-01",
  });
  const supplement = await upsertProtocolItem({
    vaultRoot,
    title: "Electrolyte support supplement",
    slug: "electrolyte-support",
    kind: "supplement",
    group: "supplement",
    status: "active",
    startedOn: "2026-02-02",
  });

  await assert.rejects(
    () =>
      readProtocolItem({
        vaultRoot,
        slug: "electrolyte-support",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_PROTOCOL_CONFLICT" &&
      error.message === "slug resolves to multiple protocol records; include group.",
  );

  const readSupplement = await readProtocolItem({
    vaultRoot,
    slug: "electrolyte-support",
    group: "supplement",
  });

  assert.equal(readSupplement.protocolId, supplement.record.protocolId);
  assert.equal(readSupplement.group, "supplement");
});

test("protocol upserts reject ambiguous slugs across groups unless protocolId or group is supplied", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-upsert-ambiguous-slug");
  await initializeVault({ vaultRoot });

  await upsertProtocolItem({
    vaultRoot,
    title: "Vitamin D medication",
    slug: "vitamin-d",
    kind: "medication",
    group: "medication",
    status: "active",
    startedOn: "2026-02-01",
  });
  await upsertProtocolItem({
    vaultRoot,
    title: "Vitamin D supplement",
    slug: "vitamin-d",
    kind: "supplement",
    group: "supplement",
    status: "active",
    startedOn: "2026-02-02",
  });

  await assert.rejects(
    () =>
      upsertProtocolItem({
        vaultRoot,
        slug: "vitamin-d",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_PROTOCOL_CONFLICT" &&
      error.message === "slug resolves to multiple protocol records; include group or protocolId.",
  );
});
