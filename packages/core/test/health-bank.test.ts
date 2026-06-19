import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test, vi } from "vitest";

import { SUPPLEMENT_INGREDIENTS_MAX_ITEMS } from "@murphai/contracts";

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
  listRegimens,
  readAllergy,
  readCondition,
  readFood,
  readGoal,
  readProvider,
  readRecipe,
  readWorkoutFormat,
  readRegimen,
  stopRegimen,
  upsertAllergy,
  upsertCondition,
  upsertFood,
  upsertGoal,
  upsertProvider,
  upsertRecipe,
  upsertWorkoutFormat,
  upsertRegimen,
  type GoalMetricTarget,
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

function invalidTestValue<T>(value: unknown): T {
  return value as T;
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
    parentGoalId: primary.record.entity.goalId,
    relatedGoalIds: [primary.record.entity.goalId],
    relatedExperimentIds: ["exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
  });

  const listed = await listGoals(vaultRoot);
  const updated = await upsertGoal({
    vaultRoot,
    goalId: secondary.record.entity.goalId,
  });
  const refreshedByTitle = await upsertGoal({
    vaultRoot,
    title: "Lift three days per week",
  });
  const read = await readGoal({
    vaultRoot,
    goalId: secondary.record.entity.goalId,
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
  assert.equal(refreshedByTitle.record.entity.goalId, secondary.record.entity.goalId);
  assert.equal(listed.length, 2);
  assert.equal(read.entity.title, secondary.record.entity.title);
  assert.equal(read.entity.parentGoalId, primary.record.entity.goalId);
  assert.deepEqual(read.entity.relatedGoalIds, [primary.record.entity.goalId]);
  assert.deepEqual(read.entity.relatedExperimentIds, ["exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"]);
  assert.deepEqual(read.entity.links, [
    {
      type: "parent_goal",
      targetId: primary.record.entity.goalId,
    },
    {
      type: "related_goal",
      targetId: primary.record.entity.goalId,
    },
    {
      type: "related_experiment",
      targetId: "exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    },
  ]);
  assert.equal(read.entity.priority, 6);
  assert.equal(read.entity.window.startAt, "2026-03-05");
  assert.deepEqual(primary.record.entity.domains, ["metabolic-health", "sleep"]);
  assert.match(read.document.markdown, /## Related Experiments/);
  assert.deepEqual(selectAuditMetadata(goalAuditRecords, "goal_upsert"), [
    { action: "goal_upsert", commandName: "core.upsertGoal", op: "create" },
    { action: "goal_upsert", commandName: "core.upsertGoal", op: "create" },
    { action: "goal_upsert", commandName: "core.upsertGoal", op: "update" },
    { action: "goal_upsert", commandName: "core.upsertGoal", op: "update" },
  ]);
  assert.equal(goalOperations.filter((operation) => operation.operationType === "goal_upsert").length, 4);
  assert.ok(goalOperations.every((operation) => operation.status === "committed"));
});

test("goals default start dates from the vault timezone only when missing", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-12T16:30:00.000Z"));

  try {
    const vaultRoot = await makeTempDirectory("murph-goal-local-day");
    await initializeVault({ vaultRoot, timezone: "Asia/Kuala_Lumpur" });

    const goal = await upsertGoal({
      vaultRoot,
      goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S4Z",
      title: "Default local day",
    });

    assert.equal(goal.record.entity.window.startAt, "2026-03-13");

    const explicitGoal = await upsertGoal({
      vaultRoot,
      goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S50",
      title: "Explicit local day",
      window: {
        startAt: "2026-03-01",
      },
    });

    vi.setSystemTime(new Date("2026-03-13T16:30:00.000Z"));

    const updatedExplicitGoal = await upsertGoal({
      vaultRoot,
      goalId: explicitGoal.record.entity.goalId,
      status: "paused",
    });

    assert.equal(explicitGoal.record.entity.window.startAt, "2026-03-01");
    assert.equal(updatedExplicitGoal.record.entity.window.startAt, "2026-03-01");
  } finally {
    vi.useRealTimers();
  }
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
    parentGoalId: parent.record.entity.goalId,
    relatedGoalIds: [related.record.entity.goalId],
    relatedExperimentIds: ["exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8"],
  });

  const cleared = await upsertGoal({
    vaultRoot,
    goalId: goal.record.entity.goalId,
    parentGoalId: null,
    relatedGoalIds: [],
    relatedExperimentIds: [],
  });
  const read = await readGoal({
    vaultRoot,
    goalId: goal.record.entity.goalId,
  });

  assert.equal(cleared.created, false);
  assert.equal(read.entity.parentGoalId, null);
  assert.equal(read.entity.relatedGoalIds, undefined);
  assert.equal(read.entity.relatedExperimentIds, undefined);
  assert.deepEqual(read.entity.links, []);
  assert.match(read.document.markdown, /Parent goal: none/);
  assert.match(read.document.markdown, /## Related Goals[\s\S]*- none/);
  assert.match(read.document.markdown, /## Related Experiments[\s\S]*- none/);
  assert.doesNotMatch(read.document.markdown, new RegExp(parent.record.entity.goalId));
  assert.doesNotMatch(read.document.markdown, new RegExp(related.record.entity.goalId));
  assert.doesNotMatch(read.document.markdown, /exp_01JNW7YJ7MNE7M9Q2QWQK4Z3F8/);

  const relinked = await upsertGoal({
    vaultRoot,
    goalId: goal.record.entity.goalId,
    links: [
      {
        type: "related_goal",
        targetId: related.record.entity.goalId,
      },
    ],
  });
  assert.deepEqual(relinked.record.entity.relatedGoalIds, [related.record.entity.goalId]);

  const clearedByNull = await upsertGoal({
    vaultRoot,
    goalId: goal.record.entity.goalId,
    links: null,
  });
  assert.equal(clearedByNull.created, false);
  assert.equal(clearedByNull.record.entity.parentGoalId, null);
  assert.equal(clearedByNull.record.entity.relatedGoalIds, undefined);
  assert.equal(clearedByNull.record.entity.relatedExperimentIds, undefined);
  assert.deepEqual(clearedByNull.record.entity.links, []);
});

test("goal upserts preserve metric targets in canonical frontmatter", async () => {
  const vaultRoot = await makeTempDirectory("murph-goal-metric-targets");
  await initializeVault({ vaultRoot });
  const metricTargets: GoalMetricTarget[] = [
    {
      targetId: "fasting-glucose-under-90",
      kind: "metric",
      metricKey: "fasting-glucose",
      biomarkerKey: "biomarker:glucose",
      comparator: "<=",
      value: 90,
      unit: "mg/dL",
      evaluation: { kind: "latest-lab" },
      selectionPolicyOverride: {
        kind: "latest-lab",
        preferCollectedAt: true,
        preferFasting: true,
        staleAfterDays: 120,
      },
      startAt: "2026-03-01",
      targetAt: "2026-06-01",
      note: "Use fasting lab draws only.",
    },
  ];

  const created = await upsertGoal({
    vaultRoot,
    title: "Lower fasting glucose",
    window: {
      startAt: "2026-03-01",
      targetAt: "2026-06-01",
    },
    metricTargets,
  });
  const updated = await upsertGoal({
    vaultRoot,
    goalId: created.record.entity.goalId,
    status: "paused",
  });
  const read = await readGoal({
    vaultRoot,
    goalId: created.record.entity.goalId,
  });

  assert.equal(updated.created, false);
  assert.deepEqual(updated.record.entity.metricTargets, metricTargets);
  assert.deepEqual(read.entity.metricTargets, metricTargets);
  assert.match(read.document.markdown, /metricTargets:/);
  assert.match(read.document.markdown, /targetId: fasting-glucose-under-90/);
});

test("goal upserts merge concurrent partial updates with the latest record", async () => {
  const vaultRoot = await makeTempDirectory("murph-goal-concurrent-upsert");
  await initializeVault({ vaultRoot });
  const metricTargets: GoalMetricTarget[] = [
    {
      targetId: "sleep-duration-over-7-hours",
      kind: "metric",
      metricKey: "sleep-duration",
      comparator: ">=",
      value: 7,
      unit: "h",
      evaluation: { kind: "rolling-window", statistic: "mean", windowDays: 7 },
    },
  ];

  const created = await upsertGoal({
    vaultRoot,
    title: "Sleep consistently",
    window: {
      startAt: "2026-03-01",
    },
    status: "active",
    horizon: "medium_term",
    priority: 5,
  });

  await Promise.all([
    upsertGoal({
      vaultRoot,
      goalId: created.record.entity.goalId,
      status: "paused",
    }),
    upsertGoal({
      vaultRoot,
      goalId: created.record.entity.goalId,
      horizon: "long_term",
    }),
    upsertGoal({
      vaultRoot,
      goalId: created.record.entity.goalId,
      priority: 9,
    }),
    upsertGoal({
      vaultRoot,
      goalId: created.record.entity.goalId,
      window: {
        targetAt: "2026-06-01",
      },
    }),
    upsertGoal({
      vaultRoot,
      goalId: created.record.entity.goalId,
      domains: ["Sleep"],
    }),
    upsertGoal({
      vaultRoot,
      goalId: created.record.entity.goalId,
      metricTargets,
    }),
  ]);

  const persisted = await readGoal({
    vaultRoot,
    goalId: created.record.entity.goalId,
  });

  assert.equal(persisted.entity.title, "Sleep consistently");
  assert.equal(persisted.entity.status, "paused");
  assert.equal(persisted.entity.horizon, "long_term");
  assert.equal(persisted.entity.priority, 9);
  assert.equal(persisted.entity.window.startAt, "2026-03-01");
  assert.equal(persisted.entity.window.targetAt, "2026-06-01");
  assert.deepEqual(persisted.entity.domains, ["sleep"]);
  assert.deepEqual(persisted.entity.metricTargets, metricTargets);
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
        goalId: first.record.entity.goalId,
        slug: second.record.entity.slug,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_GOAL_CONFLICT" &&
      error.message === "Goal id and slug resolve to different records.",
  );

  const readByConflictingSelectors = await readGoal({
    vaultRoot,
    goalId: first.record.entity.goalId,
    slug: second.record.entity.slug,
  });

  assert.equal(readByConflictingSelectors.entity.goalId, first.record.entity.goalId);

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

test("goals normalize repeated links and reject self-referential windows", async () => {
  const vaultRoot = await makeTempDirectory("murph-goal-link-normalization");
  await initializeVault({ vaultRoot });

  const parent = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S4A",
    title: "Parent goal",
    window: {
      startAt: "2026-03-01",
    },
  });
  const peer = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S4B",
    title: "Peer goal",
    window: {
      startAt: "2026-03-02",
    },
  });
  const goal = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S4C",
    title: "Recovery goal",
    window: {
      startAt: "2026-03-03",
      targetAt: "2026-03-10",
    },
    parentGoalId: parent.record.entity.goalId,
    relatedGoalIds: [peer.record.entity.goalId, peer.record.entity.goalId],
    relatedExperimentIds: ["exp_01JNYB6M9A6W4K2N8P3Q7R5S4B", "exp_01JNYB6M9A6W4K2N8P3Q7R5S4A"],
  });
  const read = await readGoal({
    vaultRoot,
    goalId: goal.record.entity.goalId,
  });

  assert.deepEqual(read.entity.parentGoalId, parent.record.entity.goalId);
  assert.deepEqual(read.entity.relatedGoalIds, [peer.record.entity.goalId]);
  assert.deepEqual(read.entity.relatedExperimentIds, [
    "exp_01JNYB6M9A6W4K2N8P3Q7R5S4A",
    "exp_01JNYB6M9A6W4K2N8P3Q7R5S4B",
  ]);
  assert.deepEqual(read.entity.links, [
    {
      type: "parent_goal",
      targetId: parent.record.entity.goalId,
    },
    {
      type: "related_goal",
      targetId: peer.record.entity.goalId,
    },
    {
      type: "related_experiment",
      targetId: "exp_01JNYB6M9A6W4K2N8P3Q7R5S4A",
    },
    {
      type: "related_experiment",
      targetId: "exp_01JNYB6M9A6W4K2N8P3Q7R5S4B",
    },
  ]);
  assert.match(read.document.markdown, /## Related Experiments/);

  await assert.rejects(
    () =>
      upsertGoal({
        vaultRoot,
        goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S4D",
        title: "Invalid parent",
        window: {
          startAt: "2026-03-04",
        },
        parentGoalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S4D",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "parentGoalId may not equal goalId.",
  );

  await assert.rejects(
    () =>
      upsertGoal({
        vaultRoot,
        goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S4E",
        title: "Invalid related goal",
        window: {
          startAt: "2026-03-04",
        },
        relatedGoalIds: ["goal_01JNYB6M9A6W4K2N8P3Q7R5S4E"],
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "relatedGoalIds may not include goalId.",
  );

  await assert.rejects(
    () =>
      upsertGoal({
        vaultRoot,
        title: "Mismatched explicit related link",
        window: {
          startAt: "2026-03-04",
        },
        links: invalidTestValue<Parameters<typeof upsertGoal>[0]["links"]>([
          {
            type: "related_goal",
            targetId: "exp_01JNYB6M9A6W4K2N8P3Q7R5S4F",
          },
        ]),
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "links.targetId[0] must match goal_<ULID>.",
  );
  assert.equal((await listGoals(vaultRoot)).length, 3);

  await assert.rejects(
    () =>
      upsertGoal({
        vaultRoot,
        title: "Backwards window",
        window: {
          startAt: "2026-03-10",
          targetAt: "2026-03-09",
        },
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "window.targetAt must be on or after startAt.",
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

test("provider upserts serialize registry selection for concurrent slug creates", async () => {
  const vaultRoot = await makeTempDirectory("murph-provider-concurrent-upsert");
  await initializeVault({ vaultRoot });

  const [firstProvider, secondProvider] = await Promise.all([
    upsertProvider({
      vaultRoot,
      title: "Labcorp",
      slug: "labcorp",
      status: "active",
      note: "First concurrent create.",
    }),
    upsertProvider({
      vaultRoot,
      title: "Labcorp",
      slug: "labcorp",
      status: "active",
      note: "Second concurrent create.",
    }),
  ]);

  const listedProviders = await listProviders(vaultRoot);

  assert.equal(listedProviders.length, 1);
  assert.equal(firstProvider.providerId, secondProvider.providerId);
  assert.equal(firstProvider.relativePath, "bank/providers/labcorp.md");
  assert.equal(secondProvider.relativePath, "bank/providers/labcorp.md");
  assert.deepEqual(
    [firstProvider.created, secondProvider.created].sort(),
    [false, true],
  );
  assert.equal(listedProviders[0]?.providerId, firstProvider.providerId);
  assert.equal(listedProviders[0]?.slug, "labcorp");
});

test("recipes normalize repeated related links and clear them on update", async () => {
  const vaultRoot = await makeTempDirectory("murph-recipe-link-normalization");
  await initializeVault({ vaultRoot });

  const goalA = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S5A",
    title: "Goal A",
    window: {
      startAt: "2026-03-01",
    },
  });
  const goalB = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S5B",
    title: "Goal B",
    window: {
      startAt: "2026-03-02",
    },
  });
  const conditionA = await upsertCondition({
    vaultRoot,
    conditionId: "cond_01JNYB6M9A6W4K2N8P3Q7R5S5A",
    title: "Condition A",
    clinicalStatus: "active",
  });
  const conditionB = await upsertCondition({
    vaultRoot,
    conditionId: "cond_01JNYB6M9A6W4K2N8P3Q7R5S5B",
    title: "Condition B",
    clinicalStatus: "active",
  });

  const created = await upsertRecipe({
    vaultRoot,
    recipeId: "rcp_01JNYB6M9A6W4K2N8P3Q7R5S5A",
    title: "Recovery bowl",
    slug: "recovery-bowl",
    status: "saved",
    summary: "A simple post-workout bowl.",
    ingredients: ["rice", "salmon"],
    steps: ["Cook the rice.", "Add the salmon."],
    relatedGoalIds: [goalB.record.entity.goalId, goalA.record.entity.goalId, goalA.record.entity.goalId],
    relatedConditionIds: [
      conditionB.record.entity.conditionId,
      conditionA.record.entity.conditionId,
      conditionA.record.entity.conditionId,
    ],
  });
  const read = await readRecipe({
    vaultRoot,
    recipeId: created.record.recipeId,
  });
  const cleared = await upsertRecipe({
    vaultRoot,
    recipeId: created.record.recipeId,
    relatedGoalIds: [],
    relatedConditionIds: [],
  });
  const clearedRead = await readRecipe({
    vaultRoot,
    recipeId: created.record.recipeId,
  });

  assert.deepEqual(created.record.relatedGoalIds, [
    goalA.record.entity.goalId,
    goalB.record.entity.goalId,
  ]);
  assert.deepEqual(created.record.relatedConditionIds, [
    conditionA.record.entity.conditionId,
    conditionB.record.entity.conditionId,
  ]);
  assert.deepEqual(read.links, [
    {
      type: "supports_goal",
      targetId: goalA.record.entity.goalId,
    },
    {
      type: "supports_goal",
      targetId: goalB.record.entity.goalId,
    },
    {
      type: "addresses_condition",
      targetId: conditionA.record.entity.conditionId,
    },
    {
      type: "addresses_condition",
      targetId: conditionB.record.entity.conditionId,
    },
  ]);
  assert.match(read.markdown, /## Related Goals/);
  assert.match(read.markdown, /## Related Conditions/);
  assert.equal(cleared.created, false);
  assert.equal(clearedRead.relatedGoalIds, undefined);
  assert.equal(clearedRead.relatedConditionIds, undefined);
  assert.deepEqual(clearedRead.links, []);
  assert.match(clearedRead.markdown, /## Related Goals[\s\S]*- none/);
  assert.match(clearedRead.markdown, /## Related Conditions[\s\S]*- none/);

  const linkedRecipe = await upsertRecipe({
    vaultRoot,
    recipeId: "rcp_01JNYB6M9A6W4K2N8P3Q7R5S5B",
    title: "Linked bowl",
    slug: "linked-bowl",
    status: "saved",
    ingredients: ["rice"],
    steps: ["Cook the rice."],
    links: [
      {
        type: "addresses_condition",
        targetId: conditionB.record.entity.conditionId,
      },
      {
        type: "supports_goal",
        targetId: goalB.record.entity.goalId,
      },
      {
        type: "supports_goal",
        targetId: goalA.record.entity.goalId,
      },
      {
        type: "supports_goal",
        targetId: goalA.record.entity.goalId,
      },
    ],
  });
  const linkedRecipeRead = await readRecipe({
    vaultRoot,
    recipeId: linkedRecipe.record.recipeId,
  });

  assert.deepEqual(linkedRecipeRead.links, [
    {
      type: "supports_goal",
      targetId: goalA.record.entity.goalId,
    },
    {
      type: "supports_goal",
      targetId: goalB.record.entity.goalId,
    },
    {
      type: "addresses_condition",
      targetId: conditionB.record.entity.conditionId,
    },
  ]);
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
        changes: record.changes?.map((change) => ({
          path: change.path,
          op: change.op,
        })),
        targetId: record.targetIds?.[0],
      })),
    [
      {
        changes: [
          {
            path: "bank/providers/northwest-labs.md",
            op: "create",
          },
        ],
        targetId: provider.providerId,
      },
      {
        changes: [
          {
            path: "bank/providers/northwest-labs-west.md",
            op: "update",
          },
          {
            path: "bank/providers/northwest-labs.md",
            op: "delete",
          },
        ],
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
  const auditRelativePath = resolveAuditShardPath(new Date());
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
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: auditRelativePath,
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
  assert.deepEqual(selectAuditMetadata(auditRecords, "provider_delete"), [
    { action: "provider_delete", commandName: "core.deleteProvider", op: "delete" },
  ]);
  assert.deepEqual(selectAuditMetadata(auditRecords, "food_delete"), [
    { action: "food_delete", commandName: "core.deleteFood", op: "delete" },
  ]);
  assert.deepEqual(selectAuditMetadata(auditRecords, "recipe_delete"), [
    { action: "recipe_delete", commandName: "core.deleteRecipe", op: "delete" },
  ]);
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
          {
            kind: "jsonl_append",
            state: "applied",
            effect: "append",
            targetRelativePath: auditRelativePath,
          },
        ],
      },
    ],
  );
  assert.deepEqual(
    operations
      .filter((operation) => operation.operationType === "food_delete")
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
            targetRelativePath: deletedFood.relativePath,
          },
          {
            kind: "jsonl_append",
            state: "applied",
            effect: "append",
            targetRelativePath: auditRelativePath,
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
          {
            kind: "jsonl_append",
            state: "applied",
            effect: "append",
            targetRelativePath: auditRelativePath,
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
    serving: "1 bowl",
    nutrition: {
      perServing: {
        calories: 540,
        proteinGrams: 11,
        carbsGrams: 68,
        fatGrams: 24,
        fiberGrams: 11,
      },
      provenance: {
        source: "label",
        confidence: "medium",
        sourceDetail: "Menu board plus saved toppings.",
      },
    },
    aliases: ["usual acai bowl", "regular acai bowl", "usual acai bowl"],
    ingredients: ["banana", "acai base", "banana", "granola"],
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
    serving: "1 bowl",
    nutrition: {
      perServing: {
        calories: 540,
        proteinGrams: 11,
        carbsGrams: 68,
        fatGrams: 24,
        fiberGrams: 11,
      },
      provenance: {
        source: "label",
        confidence: "medium",
        sourceDetail: "Menu board plus saved toppings.",
      },
    },
    aliases: ["usual acai bowl", "regular acai bowl", "usual acai bowl"],
    ingredients: ["banana", "acai base", "banana", "granola"],
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
  assert.deepEqual(readFoodById.aliases, ["usual acai bowl", "regular acai bowl"]);
  assert.deepEqual(readFoodById.ingredients, ["banana", "acai base", "granola"]);
  assert.deepEqual(readFoodById.nutrition, {
    perServing: {
      calories: 540,
      proteinGrams: 11,
      carbsGrams: 68,
      fatGrams: 24,
      fiberGrams: 11,
    },
    provenance: {
      source: "label",
      confidence: "medium",
      sourceDetail: "Menu board plus saved toppings.",
    },
  });
  assert.equal(readFoodBySlug.foodId, createdFood.record.foodId);
  assert.equal(readFoodBySlug.title, "Usual Acai Bowl");
  assert.equal(readFoodBySlug.nutrition?.perServing?.calories, 540);
  assert.equal(listedFoods[0]?.foodId, secondFood.record.foodId);
  assert.equal(listedFoods[1]?.foodId, createdFood.record.foodId);
  assert.match(foodMarkdown, /foodId:/u);
  assert.doesNotMatch(foodMarkdown, /autoLogDaily:/u);
  assert.match(foodMarkdown, /nutrition:/u);
  assert.match(foodMarkdown, /## Aliases/u);
  assert.match(foodMarkdown, /## Ingredients/u);
  assert.match(foodMarkdown, /## Nutrition per serving/u);
  assert.doesNotMatch(foodMarkdown, /Auto-log daily/u);
  assert.doesNotMatch(foodMarkdown, /^attachedRegimenRefs:/mu);

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
        aliases: invalidTestValue<string[]>("usual smoothie"),
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
        steps: invalidTestValue<string[]>("Mix everything."),
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
    aliases: invalidTestValue<string[] | undefined>(null),
    ingredients: [] as string[],
  });
  await upsertRecipe({
    vaultRoot,
    recipeId: createdRecipe.record.recipeId,
    title: createdRecipe.record.title,
    ingredients: [] as string[],
    steps: invalidTestValue<string[] | undefined>(null),
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
    template: {
      routineNote: "Usual upper-body session.",
      exercises: [
        {
          name: "pushups",
          order: 1,
          mode: "bodyweight",
          plannedSets: [
            { order: 1, targetReps: 20 },
            { order: 2, targetReps: 20 },
            { order: 3, targetReps: 20 },
            { order: 4, targetReps: 20 },
          ],
        },
        {
          name: "incline bench",
          order: 2,
          mode: "weight_reps",
          note: "45 lb bar plus 10 lb plates on both sides",
          plannedSets: [
            { order: 1, targetReps: 12, targetWeight: 65, targetWeightUnit: "lb" },
            { order: 2, targetReps: 12, targetWeight: 65, targetWeightUnit: "lb" },
            { order: 3, targetReps: 12, targetWeight: 65, targetWeightUnit: "lb" },
            { order: 4, targetReps: 12, targetWeight: 65, targetWeightUnit: "lb" },
          ],
        },
      ],
    },
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
    template: {
      routineNote: "Usual upper-body session.",
      exercises: [
        {
          name: "pushups",
          order: 1,
          mode: "bodyweight",
          plannedSets: [
            { order: 1, targetReps: 20 },
            { order: 2, targetReps: 20 },
            { order: 3, targetReps: 20 },
            { order: 4, targetReps: 20 },
          ],
        },
        {
          name: "incline bench",
          order: 2,
          mode: "weight_reps",
          note: "45 lb bar plus 10 lb plates on both sides",
          plannedSets: [
            { order: 1, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
            { order: 2, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
            { order: 3, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
            { order: 4, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
            { order: 5, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
          ],
        },
      ],
    },
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
    template: {
      routineNote: "Archived race template.",
      exercises: [],
    },
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
  assert.match(workoutFormatMarkdown, /## Template Exercises/u);
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

test("workout format upserts merge concurrent partial updates with the latest record", async () => {
  const vaultRoot = await makeTempDirectory("murph-workout-format-concurrent-upsert");
  await initializeVault({ vaultRoot });

  const createdFormat = await upsertWorkoutFormat({
    vaultRoot,
    workoutFormatId: "wfmt_01JNYB6M9A6W4K2N8P3Q7R5S5A",
    title: "Concurrent Lift",
    slug: "concurrent-lift",
    status: "active",
    summary: "Base session.",
    activityType: "strength training",
    durationMinutes: 40,
    template: {
      routineNote: "Keep the base routine intact.",
      exercises: [],
    },
    tags: ["base"],
    note: "Original note.",
  });

  await Promise.all([
    upsertWorkoutFormat({
      vaultRoot,
      workoutFormatId: createdFormat.record.workoutFormatId,
      durationMinutes: 55,
    }),
    upsertWorkoutFormat({
      vaultRoot,
      workoutFormatId: createdFormat.record.workoutFormatId,
      distanceKm: 5,
    }),
    upsertWorkoutFormat({
      vaultRoot,
      workoutFormatId: createdFormat.record.workoutFormatId,
      tags: ["base", "concurrent"],
    }),
    upsertWorkoutFormat({
      vaultRoot,
      workoutFormatId: createdFormat.record.workoutFormatId,
      note: "Concurrent note.",
    }),
    upsertWorkoutFormat({
      vaultRoot,
      workoutFormatId: createdFormat.record.workoutFormatId,
      templateText: "Concurrent workout text.",
    }),
  ]);

  const persisted = await readWorkoutFormat({
    vaultRoot,
    workoutFormatId: createdFormat.record.workoutFormatId,
  });

  assert.equal(persisted.title, "Concurrent Lift");
  assert.equal(persisted.activityType, "strength-training");
  assert.equal(persisted.durationMinutes, 55);
  assert.equal(persisted.distanceKm, 5);
  assert.deepEqual(persisted.tags, ["base", "concurrent"]);
  assert.equal(persisted.note, "Concurrent note.");
  assert.equal(persisted.templateText, "Concurrent workout text.");
  assert.equal(persisted.template?.routineNote, "Keep the base routine intact.");
});

test("workout formats require first-class ids and fields", async () => {
  const vaultRoot = await makeTempDirectory("murph-legacy-workout-format");
  await initializeVault({ vaultRoot });

  await fs.writeFile(
    path.join(vaultRoot, "bank/workout-formats/garage-day.md"),
    `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
slug: garage-day
title: Garage Day
status: active
activityType: strength-training
durationMinutes: 40
template:
  exercises: []
templateText: Garage day template.
---
# Garage Day
`,
    "utf8",
  );

  await assert.rejects(
    () =>
      readWorkoutFormat({
        vaultRoot,
        slug: "garage-day",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "workoutFormatId is required.",
  );

  await assert.rejects(
    () => listWorkoutFormats(vaultRoot),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "workoutFormatId is required.",
  );
});

test("workout formats normalize blank status and rich template formatting", async () => {
  const vaultRoot = await makeTempDirectory("murph-workout-format-rich-template");
  await initializeVault({ vaultRoot });
  const blankStatus = " ".repeat(3);

  const created = await upsertWorkoutFormat({
    vaultRoot,
    workoutFormatId: "wfmt_01JNYB6M9A6W4K2N8P3Q7R5S5A",
    title: "Accessory day",
    slug: "accessory-day",
    // @ts-expect-error Intentional runtime fallback case for blank status normalization.
    status: blankStatus,
    activityType: "strength training",
    durationMinutes: 35,
    template: {
      routineNote: "Use comfortable loads.",
      exercises: [
        {
          name: "carry",
          order: 2,
          groupId: "upper-body",
          plannedSets: [
            {
              order: 1,
              type: "warmup",
              targetDurationSeconds: 60,
            },
            {
              order: 2,
              targetDistanceMeters: 100,
              targetRpe: 8,
            },
          ],
        },
        {
          name: "row",
          order: 1,
          mode: "weight_reps",
          plannedSets: [
            {
              order: 1,
              targetReps: 12,
              targetWeight: 40,
              targetWeightUnit: "lb",
            },
            {
              order: 2,
            },
          ],
        },
      ],
    },
    templateText: "Original session text.",
    note: "Keep the weight controlled.",
  });
  const read = await readWorkoutFormat({
    vaultRoot,
    workoutFormatId: created.record.workoutFormatId,
  });

  assert.equal(created.record.status, "active");
  assert.equal(read.status, "active");
  assert.match(read.markdown, /## Template Exercises/);
  assert.match(read.markdown, /carry \[upper-body\]: warmup · 60s; 100m · RPE 8/);
  assert.match(read.markdown, /row \(weight_reps\): 12 reps · 40 lb; set 2/);
  assert.match(read.markdown, /## Saved workout text/);
  assert.match(read.markdown, /Default duration: 35 min/);

  await assert.rejects(
    () =>
      upsertWorkoutFormat({
        vaultRoot,
        title: "Broken activity type",
        activityType: "!!!",
        template: {
          exercises: [],
        },
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "slug could not be normalized to a slug.",
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
  const regimen = await upsertRegimen({
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
    relatedGoalIds: [goal.record.entity.goalId],
    relatedRegimenIds: [regimen.record.entity.regimenId],
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
    relatedConditionIds: [condition.record.entity.conditionId],
    note: "Avoid beta-lactam exposure until formally reviewed.",
  });

  const conditions = await listConditions(vaultRoot);
  const allergies = await listAllergies(vaultRoot);
  const readConditionRecord = await readCondition({
    vaultRoot,
    slug: condition.record.entity.slug,
  });
  const readAllergyRecord = await readAllergy({
    vaultRoot,
    allergyId: allergy.record.entity.allergyId,
  });
  const patchedCondition = await upsertCondition({
    vaultRoot,
    conditionId: condition.record.entity.conditionId,
  });
  const patchedAllergy = await upsertAllergy({
    vaultRoot,
    allergyId: allergy.record.entity.allergyId,
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
  assert.equal(patchedCondition.record.entity.title, condition.record.entity.title);
  assert.equal(patchedAllergy.record.entity.title, allergy.record.entity.title);
  assert.deepEqual(readConditionRecord.entity.relatedGoalIds, [goal.record.entity.goalId]);
  assert.deepEqual(readConditionRecord.entity.links, [
    {
      type: "related_goal",
      targetId: goal.record.entity.goalId,
    },
    {
      type: "related_regimen",
      targetId: regimen.record.entity.regimenId,
    },
  ]);
  assert.deepEqual(readAllergyRecord.entity.relatedConditionIds, [condition.record.entity.conditionId]);
  assert.deepEqual(readAllergyRecord.entity.links, [
    {
      type: "related_condition",
      targetId: condition.record.entity.conditionId,
    },
  ]);
  assert.match(readConditionRecord.document.markdown, /## Related Regimens/);
  assert.match(readAllergyRecord.document.markdown, /## Related Conditions/);
  assert.deepEqual(patchedCondition.record.entity.relatedGoalIds, [goal.record.entity.goalId]);
  assert.deepEqual(patchedCondition.record.entity.relatedRegimenIds, [regimen.record.entity.regimenId]);
  assert.deepEqual(patchedCondition.record.entity.links, [
    {
      type: "related_goal",
      targetId: goal.record.entity.goalId,
    },
    {
      type: "related_regimen",
      targetId: regimen.record.entity.regimenId,
    },
  ]);
  assert.equal(patchedCondition.record.entity.note, "Likely worsened by sleep disruption.");
  assert.deepEqual(patchedAllergy.record.entity.relatedConditionIds, [condition.record.entity.conditionId]);
  assert.deepEqual(patchedAllergy.record.entity.links, [
    {
      type: "related_condition",
      targetId: condition.record.entity.conditionId,
    },
  ]);
  assert.equal(patchedAllergy.record.entity.substance, "penicillin");
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

test("condition and allergy updates clear normalized relations without leaving stale markdown", async () => {
  const vaultRoot = await makeTempDirectory("murph-condition-allergy-clear-links");
  await initializeVault({ vaultRoot });

  const goal = await upsertGoal({
    vaultRoot,
    title: "Reduce migraine frequency",
    window: {
      startAt: "2026-03-01",
    },
  });
  const regimen = await upsertRegimen({
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
    relatedGoalIds: [goal.record.entity.goalId],
    relatedRegimenIds: [regimen.record.entity.regimenId],
    note: "Likely worsened by sleep disruption.",
  });
  const allergy = await upsertAllergy({
    vaultRoot,
    title: "Penicillin allergy",
    substance: "penicillin",
    relatedConditionIds: [condition.record.entity.conditionId],
    note: "Avoid beta-lactam exposure until formally reviewed.",
  });

  const clearedCondition = await upsertCondition({
    vaultRoot,
    conditionId: condition.record.entity.conditionId,
    relatedGoalIds: [],
    relatedRegimenIds: [],
  });
  const clearedAllergy = await upsertAllergy({
    vaultRoot,
    allergyId: allergy.record.entity.allergyId,
    relatedConditionIds: [],
  });
  const readConditionRecord = await readCondition({
    vaultRoot,
    conditionId: condition.record.entity.conditionId,
  });
  const readAllergyRecord = await readAllergy({
    vaultRoot,
    allergyId: allergy.record.entity.allergyId,
  });

  assert.equal(clearedCondition.created, false);
  assert.equal(clearedAllergy.created, false);
  assert.equal(readConditionRecord.entity.relatedGoalIds, undefined);
  assert.equal(readConditionRecord.entity.relatedRegimenIds, undefined);
  assert.deepEqual(readConditionRecord.entity.links, []);
  assert.match(readConditionRecord.document.markdown, /## Related Goals[\s\S]*- none/);
  assert.match(readConditionRecord.document.markdown, /## Related Regimens[\s\S]*- none/);
  assert.doesNotMatch(readConditionRecord.document.markdown, new RegExp(goal.record.entity.goalId));
  assert.doesNotMatch(readConditionRecord.document.markdown, new RegExp(regimen.record.entity.regimenId));

  const relinkedCondition = await upsertCondition({
    vaultRoot,
    conditionId: condition.record.entity.conditionId,
    links: [
      {
        type: "related_goal",
        targetId: goal.record.entity.goalId,
      },
      {
        type: "related_regimen",
        targetId: regimen.record.entity.regimenId,
      },
    ],
  });
  assert.deepEqual(relinkedCondition.record.entity.relatedGoalIds, [goal.record.entity.goalId]);
  assert.deepEqual(relinkedCondition.record.entity.relatedRegimenIds, [
    regimen.record.entity.regimenId,
  ]);

  const clearedConditionByNullLinks = await upsertCondition({
    vaultRoot,
    conditionId: condition.record.entity.conditionId,
    links: null,
  });
  const readConditionClearedByNullLinks = await readCondition({
    vaultRoot,
    conditionId: condition.record.entity.conditionId,
  });

  assert.equal(clearedConditionByNullLinks.created, false);
  assert.equal(readConditionClearedByNullLinks.entity.relatedGoalIds, undefined);
  assert.equal(readConditionClearedByNullLinks.entity.relatedRegimenIds, undefined);
  assert.deepEqual(readConditionClearedByNullLinks.entity.links, []);
  assert.match(
    readConditionClearedByNullLinks.document.markdown,
    /## Related Goals[\s\S]*- none/,
  );
  assert.match(
    readConditionClearedByNullLinks.document.markdown,
    /## Related Regimens[\s\S]*- none/,
  );
  assert.doesNotMatch(
    readConditionClearedByNullLinks.document.markdown,
    new RegExp(goal.record.entity.goalId),
  );
  assert.doesNotMatch(
    readConditionClearedByNullLinks.document.markdown,
    new RegExp(regimen.record.entity.regimenId),
  );

  assert.equal(readAllergyRecord.entity.relatedConditionIds, undefined);
  assert.deepEqual(readAllergyRecord.entity.links, []);
  assert.match(readAllergyRecord.document.markdown, /## Related Conditions[\s\S]*- none/);
  assert.doesNotMatch(readAllergyRecord.document.markdown, new RegExp(condition.record.entity.conditionId));
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
        conditionId: firstCondition.record.entity.conditionId,
        slug: secondCondition.record.entity.slug,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_CONDITION_CONFLICT" &&
      error.message === "Condition id and slug resolve to different records.",
  );

  const readConditionByConflictingSelectors = await readCondition({
    vaultRoot,
    conditionId: firstCondition.record.entity.conditionId,
    slug: secondCondition.record.entity.slug,
  });

  assert.equal(readConditionByConflictingSelectors.entity.conditionId, firstCondition.record.entity.conditionId);

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
        allergyId: firstAllergy.record.entity.allergyId,
        slug: secondAllergy.record.entity.slug,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_ALLERGY_CONFLICT" &&
      error.message === "Allergy id and slug resolve to different records.",
  );

  const readAllergyByConflictingSelectors = await readAllergy({
    vaultRoot,
    allergyId: firstAllergy.record.entity.allergyId,
    slug: secondAllergy.record.entity.slug,
  });

  assert.equal(readAllergyByConflictingSelectors.entity.allergyId, firstAllergy.record.entity.allergyId);

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

test("condition and allergy reads reject non-canonical frontmatter after the hard cut", async () => {
  const vaultRoot = await makeTempDirectory("murph-condition-allergy-strict-frontmatter");
  await initializeVault({ vaultRoot });

  await fs.writeFile(
    path.join(vaultRoot, "bank/conditions/legacy-condition.md"),
    [
      "---",
      "schemaVersion: murph.frontmatter.condition.v1",
      "docType: condition",
      "conditionId: cond_01JNYB6M9A6W4K2N8P3Q7R5S4T",
      "slug: legacy-condition",
      "title: Legacy condition",
      "clinicalStatus: active",
      "owner: coach",
      "---",
      "",
      "# Legacy condition",
      "",
      "Out-of-schema condition document.",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(vaultRoot, "bank/allergies/legacy-allergy.md"),
    [
      "---",
      "schemaVersion: murph.frontmatter.allergy.v1",
      "docType: allergy",
      "allergyId: alg_01JNYB6M9A6W4K2N8P3Q7R5S4T",
      "slug: legacy-allergy",
      "title: Legacy allergy",
      "substance: Peanut",
      "status: active",
      "owner: coach",
      "---",
      "",
      "# Legacy allergy",
      "",
      "Out-of-schema allergy document.",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      readCondition({
        vaultRoot,
        slug: "legacy-condition",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_CONDITION" &&
      error.message === "Condition registry document has an unexpected shape.",
  );
  await assert.rejects(
    () =>
      readAllergy({
        vaultRoot,
        slug: "legacy-allergy",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_ALLERGY" &&
      error.message === "Allergy registry document has an unexpected shape.",
  );
});

test("conditions and allergies normalize repeated relations and enforce timeline rules", async () => {
  const vaultRoot = await makeTempDirectory("murph-condition-allergy-normalization");
  await initializeVault({ vaultRoot });

  const goalA = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S6A",
    title: "Goal A",
    window: {
      startAt: "2026-03-01",
    },
  });
  const goalB = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S6B",
    title: "Goal B",
    window: {
      startAt: "2026-03-02",
    },
  });
  const regimenA = await upsertRegimen({
    vaultRoot,
    regimenId: "reg_01JNYB6M9A6W4K2N8P3Q7R5S6A",
    title: "Regimen A",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-03",
  });
  const regimenB = await upsertRegimen({
    vaultRoot,
    regimenId: "reg_01JNYB6M9A6W4K2N8P3Q7R5S6B",
    title: "Regimen B",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-04",
  });

  const condition = await upsertCondition({
    vaultRoot,
    conditionId: "cond_01JNYB6M9A6W4K2N8P3Q7R5S6A",
    title: "Migraine",
    clinicalStatus: "resolved",
    verificationStatus: "confirmed",
    assertedOn: "2026-03-01",
    resolvedOn: "2026-03-10",
    relatedGoalIds: [goalB.record.entity.goalId, goalA.record.entity.goalId, goalA.record.entity.goalId],
    relatedRegimenIds: [
      regimenB.record.entity.regimenId,
      regimenA.record.entity.regimenId,
      regimenA.record.entity.regimenId,
    ],
    note: "Likely worsened by sleep disruption.",
  });
  const allergy = await upsertAllergy({
    vaultRoot,
    allergyId: "alg_01JNYB6M9A6W4K2N8P3Q7R5S6A",
    title: "Penicillin allergy",
    substance: "penicillin",
    status: "active",
    criticality: "high",
    reaction: "rash",
    recordedOn: "2018-04-10",
    relatedConditionIds: [
      condition.record.entity.conditionId,
      condition.record.entity.conditionId,
    ],
    note: "Avoid beta-lactam exposure until formally reviewed.",
  });
  const conditionRead = await readCondition({
    vaultRoot,
    conditionId: condition.record.entity.conditionId,
  });
  const allergyRead = await readAllergy({
    vaultRoot,
    allergyId: allergy.record.entity.allergyId,
  });

  assert.deepEqual(conditionRead.entity.relatedGoalIds, [
    goalA.record.entity.goalId,
    goalB.record.entity.goalId,
  ]);
  assert.deepEqual(conditionRead.entity.relatedRegimenIds, [
    regimenA.record.entity.regimenId,
    regimenB.record.entity.regimenId,
  ]);
  assert.deepEqual(conditionRead.entity.links, [
    {
      type: "related_goal",
      targetId: goalA.record.entity.goalId,
    },
    {
      type: "related_goal",
      targetId: goalB.record.entity.goalId,
    },
    {
      type: "related_regimen",
      targetId: regimenA.record.entity.regimenId,
    },
    {
      type: "related_regimen",
      targetId: regimenB.record.entity.regimenId,
    },
  ]);
  assert.deepEqual(allergyRead.entity.relatedConditionIds, [condition.record.entity.conditionId]);
  assert.deepEqual(allergyRead.entity.links, [
    {
      type: "related_condition",
      targetId: condition.record.entity.conditionId,
    },
  ]);
  assert.match(conditionRead.document.markdown, /## Related Goals/);
  assert.match(conditionRead.document.markdown, /## Related Regimens/);
  assert.match(allergyRead.document.markdown, /## Related Conditions/);

  const extraCondition = await upsertCondition({
    vaultRoot,
    conditionId: "cond_01JNYB6M9A6W4K2N8P3Q7R5S6C",
    title: "Asthma",
    clinicalStatus: "active",
  });
  const linkedAllergy = await upsertAllergy({
    vaultRoot,
    allergyId: "alg_01JNYB6M9A6W4K2N8P3Q7R5S6B",
    title: "Shellfish allergy",
    substance: "shellfish",
    links: [
      {
        type: "related_condition",
        targetId: extraCondition.record.entity.conditionId,
      },
      {
        type: "related_condition",
        targetId: condition.record.entity.conditionId,
      },
      {
        type: "related_condition",
        targetId: condition.record.entity.conditionId,
      },
    ],
  });
  const linkedAllergyRead = await readAllergy({
    vaultRoot,
    allergyId: linkedAllergy.record.entity.allergyId,
  });

  assert.deepEqual(linkedAllergyRead.entity.relatedConditionIds, [
    condition.record.entity.conditionId,
    extraCondition.record.entity.conditionId,
  ]);
  assert.deepEqual(linkedAllergyRead.entity.links, [
    {
      type: "related_condition",
      targetId: condition.record.entity.conditionId,
    },
    {
      type: "related_condition",
      targetId: extraCondition.record.entity.conditionId,
    },
  ]);

  await assert.rejects(
    () =>
      upsertCondition({
        vaultRoot,
        title: "Active resolved date",
        clinicalStatus: "active",
        resolvedOn: "2026-03-02",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "resolvedOn requires clinicalStatus=resolved.",
  );

  await assert.rejects(
    () =>
      upsertCondition({
        vaultRoot,
        title: "Backwards recovery",
        clinicalStatus: "resolved",
        assertedOn: "2026-03-10",
        resolvedOn: "2026-03-09",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "resolvedOn must be on or after assertedOn.",
  );
});

test("regimens support medication and supplement groups plus stop handling", async () => {
  const vaultRoot = await makeTempDirectory("murph-regimens");
  await initializeVault({ vaultRoot });
  const goal = await upsertGoal({
    vaultRoot,
    title: "Improve recovery consistency",
    window: {
      startAt: "2026-02-01",
    },
  });
  const condition = await upsertCondition({
    vaultRoot,
    title: "Delayed recovery",
    clinicalStatus: "active",
  });

  const medication = await upsertRegimen({
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
  const supplement = await upsertRegimen({
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
    relatedGoalIds: [goal.record.entity.goalId],
    relatedConditionIds: [condition.record.entity.conditionId],
  });
  const stopped = await stopRegimen({
    vaultRoot,
    regimenId: medication.record.entity.regimenId,
    stoppedOn: "2026-03-20",
  });

  const listed = await listRegimens(vaultRoot);
  const readMedication = await readRegimen({
    vaultRoot,
    regimenId: medication.record.entity.regimenId,
  });
  const readSupplement = await readRegimen({
    vaultRoot,
    slug: supplement.record.entity.slug,
    group: "supplement",
  });
  const regimenMarkdown = await fs.readFile(
    path.join(vaultRoot, supplement.record.document.relativePath),
    "utf8",
  );
  const patchedSupplement = await upsertRegimen({
    vaultRoot,
    regimenId: supplement.record.entity.regimenId,
  });
  await assert.rejects(
    () =>
      upsertRegimen({
        vaultRoot,
        title: "Too many ingredients",
        kind: "supplement",
        status: "active",
        ingredients: Array.from({ length: SUPPLEMENT_INGREDIENTS_MAX_ITEMS + 1 }, (_, index) => ({
          compound: `Ingredient ${index + 1}`,
        })),
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === `ingredients must contain at most ${SUPPLEMENT_INGREDIENTS_MAX_ITEMS} ingredients.`,
  );
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
  assert.equal(readMedication.entity.group, "medication");
  assert.equal(readSupplement.entity.group, "supplement");
  assert.equal(readSupplement.entity.brand, "Nordic Naturals");
  assert.equal(readSupplement.entity.manufacturer, "Nordic Naturals");
  assert.equal(readSupplement.entity.servingSize, "2 softgels");
  assert.deepEqual(readSupplement.entity.relatedGoalIds, [goal.record.entity.goalId]);
  assert.deepEqual(readSupplement.entity.relatedConditionIds, [condition.record.entity.conditionId]);
  assert.deepEqual(readSupplement.entity.links, [
    { type: "supports_goal", targetId: goal.record.entity.goalId },
    { type: "addresses_condition", targetId: condition.record.entity.conditionId },
  ]);
  assert.deepEqual(
    readSupplement.entity.ingredients?.map((ingredient) => ({
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
  assert.equal(stopped.record.entity.status, "stopped");
  assert.equal(stopped.record.entity.stoppedOn, "2026-03-20");
  assert.equal(patchedSupplement.record.entity.title, supplement.record.entity.title);
  assert.equal(patchedSupplement.record.entity.schedule, "with breakfast");
  assert.equal(patchedSupplement.record.entity.startedOn, "2026-02-15");
  assert.equal(patchedSupplement.record.entity.brand, "Nordic Naturals");
  assert.equal(patchedSupplement.record.entity.servingSize, "2 softgels");
  assert.deepEqual(patchedSupplement.record.entity.links, [
    { type: "supports_goal", targetId: goal.record.entity.goalId },
    { type: "addresses_condition", targetId: condition.record.entity.conditionId },
  ]);
  assert.match(stopped.record.document.relativePath, /^bank\/regimens\/medication\//);
  assert.match(readMedication.document.markdown, /Stopped on: 2026-03-20/);
  assert.match(readSupplement.document.markdown, /## Product/);
  assert.match(readSupplement.document.markdown, /Brand: Nordic Naturals/);
  assert.match(readSupplement.document.markdown, /Serving size: 2 softgels/);
  assert.match(readSupplement.document.markdown, /## Ingredients/);
  assert.match(readSupplement.document.markdown, /EPA — 600 mg/);
  assert.match(readSupplement.document.markdown, /DHA — 400 mg/);
  assert.doesNotMatch(regimenMarkdown, /^group:/mu);
  assert.deepEqual(selectAuditMetadata(regimenAuditRecords, "regimen_upsert"), [
    { action: "regimen_upsert", commandName: "core.upsertRegimen", op: "create" },
    { action: "regimen_upsert", commandName: "core.upsertRegimen", op: "create" },
    { action: "regimen_upsert", commandName: "core.upsertRegimen", op: "update" },
  ]);
  assert.deepEqual(selectAuditMetadata(stopAuditRecords, "regimen_stop"), [
    { action: "regimen_stop", commandName: "core.stopRegimen", op: "update" },
  ]);
  assert.equal(regimenOperations.filter((operation) => operation.operationType === "regimen_upsert").length, 3);
  assert.equal(regimenOperations.filter((operation) => operation.operationType === "regimen_stop").length, 1);
  assert.ok(regimenOperations.every((operation) => operation.status === "committed"));
});

test("regimen reads reject conflicting regimenId and slug selectors", async () => {
  const vaultRoot = await makeTempDirectory("murph-regimen-read-conflict");
  await initializeVault({ vaultRoot });

  const medication = await upsertRegimen({
    vaultRoot,
    title: "Magnesium glycinate medication",
    slug: "magnesium-glycinate",
    kind: "medication",
    status: "active",
    startedOn: "2026-02-01",
  });
  const supplement = await upsertRegimen({
    vaultRoot,
    title: "Magnesium glycinate supplement",
    slug: "magnesium-glycinate-supplement",
    kind: "supplement",
    status: "active",
    startedOn: "2026-02-02",
  });

  await assert.rejects(
    () =>
      readRegimen({
        vaultRoot,
        regimenId: supplement.record.entity.regimenId,
        slug: medication.record.entity.slug,
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_REGIMEN_CONFLICT" &&
      error.message === "regimenId and slug resolve to different regimen records.",
  );
});

test("regimen upserts reject new regimenId when slug resolves to another regimen", async () => {
  const vaultRoot = await makeTempDirectory("murph-regimen-upsert-id-slug-conflict");
  await initializeVault({ vaultRoot });

  const medication = await upsertRegimen({
    vaultRoot,
    title: "Magnesium glycinate medication",
    slug: "magnesium-glycinate",
    kind: "medication",
    status: "active",
    startedOn: "2026-02-01",
  });

  await assert.rejects(
    () =>
      upsertRegimen({
        vaultRoot,
        regimenId: "reg_01JNYB6M9A6W4K2N8P3Q7R5S7A",
        title: "Magnesium glycinate medication",
        slug: medication.record.entity.slug,
        kind: "medication",
        status: "active",
        startedOn: "2026-02-02",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_REGIMEN_CONFLICT" &&
      error.message === "regimenId and slug resolve to different regimen records.",
  );

  const readMedication = await readRegimen({
    vaultRoot,
    regimenId: medication.record.entity.regimenId,
  });
  assert.equal(readMedication.entity.startedOn, "2026-02-01");
});

test("regimen upserts can reject existing slug updates in normalized groups", async () => {
  const vaultRoot = await makeTempDirectory("murph-regimen-upsert-slug-exists");
  await initializeVault({ vaultRoot });

  const medication = await upsertRegimen({
    vaultRoot,
    title: "Antibiotic course",
    slug: "antibiotic-course-2019-04-10-2019-04-20",
    kind: "medication",
    group: "medication/history",
    status: "completed",
    startedOn: "2019-04-10",
    stoppedOn: "2019-04-20",
    substance: "amoxicillin",
    dose: 875,
    unit: "mg",
  });

  await assert.rejects(
    () =>
      upsertRegimen({
        vaultRoot,
        title: "Antibiotic course",
        slug: "antibiotic-course-2019-04-10-2019-04-20",
        rejectExistingSlug: true,
        kind: "medication",
        group: "Medication\\History",
        status: "completed",
        startedOn: "2019-04-10",
        stoppedOn: "2019-04-20",
        substance: "azithromycin",
        dose: 250,
        unit: "mg",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_REGIMEN_CONFLICT" &&
      error.message === "regimen slug already exists; include regimenId or choose a different slug.",
  );

  const readMedication = await readRegimen({
    vaultRoot,
    regimenId: medication.record.entity.regimenId,
  });

  assert.equal(readMedication.entity.group, "medication/history");
  assert.equal(readMedication.entity.substance, "amoxicillin");
  assert.equal(readMedication.entity.dose, 875);
});

test("regimen reads reject ambiguous slugs across groups unless group is supplied", async () => {
  const vaultRoot = await makeTempDirectory("murph-regimen-read-ambiguous-slug");
  await initializeVault({ vaultRoot });

  await upsertRegimen({
    vaultRoot,
    title: "Electrolyte support medication",
    slug: "electrolyte-support",
    kind: "medication",
    group: "medication",
    status: "active",
    startedOn: "2026-02-01",
  });
  const supplement = await upsertRegimen({
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
      readRegimen({
        vaultRoot,
        slug: "electrolyte-support",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_REGIMEN_CONFLICT" &&
      error.message === "slug resolves to multiple regimen records; include group.",
  );

  const readSupplement = await readRegimen({
    vaultRoot,
    slug: "electrolyte-support",
    group: "supplement",
  });

  assert.equal(readSupplement.entity.regimenId, supplement.record.entity.regimenId);
  assert.equal(readSupplement.entity.group, "supplement");
});

test("regimen upserts reject ambiguous slugs across groups unless regimenId or group is supplied", async () => {
  const vaultRoot = await makeTempDirectory("murph-regimen-upsert-ambiguous-slug");
  await initializeVault({ vaultRoot });

  await upsertRegimen({
    vaultRoot,
    title: "Vitamin D medication",
    slug: "vitamin-d",
    kind: "medication",
    group: "medication",
    status: "active",
    startedOn: "2026-02-01",
  });
  await upsertRegimen({
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
      upsertRegimen({
        vaultRoot,
        slug: "vitamin-d",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_REGIMEN_CONFLICT" &&
      error.message === "slug resolves to multiple regimen records; include group or regimenId.",
  );
});

test("regimens normalize repeated relations, support ingredient edge cases, and reject bad timing", async () => {
  const vaultRoot = await makeTempDirectory("murph-regimen-normalization");
  await initializeVault({ vaultRoot });

  const goalA = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S7A",
    title: "Goal A",
    window: {
      startAt: "2026-03-01",
    },
  });
  const goalB = await upsertGoal({
    vaultRoot,
    goalId: "goal_01JNYB6M9A6W4K2N8P3Q7R5S7B",
    title: "Goal B",
    window: {
      startAt: "2026-03-02",
    },
  });
  const conditionA = await upsertCondition({
    vaultRoot,
    conditionId: "cond_01JNYB6M9A6W4K2N8P3Q7R5S7A",
    title: "Condition A",
    clinicalStatus: "active",
  });
  const conditionB = await upsertCondition({
    vaultRoot,
    conditionId: "cond_01JNYB6M9A6W4K2N8P3Q7R5S7B",
    title: "Condition B",
    clinicalStatus: "active",
  });
  const peerRegimen = await upsertRegimen({
    vaultRoot,
    regimenId: "reg_01JNYB6M9A6W4K2N8P3Q7R5S7A",
    title: "Peer regimen",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-03",
  });

  const created = await upsertRegimen({
    vaultRoot,
    regimenId: "reg_01JNYB6M9A6W4K2N8P3Q7R5S7B",
    title: "Recovery stack",
    slug: "recovery-stack",
    kind: "supplement",
    group: "supplement",
    status: "active",
    startedOn: "2026-03-04",
    substance: "omega-3",
    dose: 1000,
    unit: "mg",
    schedule: "daily",
    brand: "Example",
    manufacturer: "Example",
    servingSize: "2 softgels",
    ingredients: [
      {
        compound: "EPA",
        note: "Primary omega-3 source.",
      },
      {
        compound: "DHA",
        amount: 400,
        unit: "mg",
        active: false,
      },
      {
        compound: "Creatine",
        amount: 5,
        unit: "g",
        active: true,
      },
    ],
    relatedGoalIds: [goalB.record.entity.goalId, goalA.record.entity.goalId, goalA.record.entity.goalId],
    relatedConditionIds: [
      conditionB.record.entity.conditionId,
      conditionA.record.entity.conditionId,
      conditionA.record.entity.conditionId,
    ],
    relatedRegimenIds: [
      peerRegimen.record.entity.regimenId,
      peerRegimen.record.entity.regimenId,
    ],
  });
  const read = await readRegimen({
    vaultRoot,
    regimenId: created.record.entity.regimenId,
  });
  const cleared = await upsertRegimen({
    vaultRoot,
    regimenId: created.record.entity.regimenId,
    relatedGoalIds: [],
    relatedConditionIds: [],
    relatedRegimenIds: [],
  });
  const clearedRead = await readRegimen({
    vaultRoot,
    regimenId: created.record.entity.regimenId,
  });

  assert.deepEqual(created.record.entity.relatedGoalIds, [
    goalA.record.entity.goalId,
    goalB.record.entity.goalId,
  ]);
  assert.deepEqual(created.record.entity.relatedConditionIds, [
    conditionA.record.entity.conditionId,
    conditionB.record.entity.conditionId,
  ]);
  assert.deepEqual(created.record.entity.relatedRegimenIds, [peerRegimen.record.entity.regimenId]);
  assert.deepEqual(read.entity.links, [
    {
      type: "supports_goal",
      targetId: goalA.record.entity.goalId,
    },
    {
      type: "supports_goal",
      targetId: goalB.record.entity.goalId,
    },
    {
      type: "addresses_condition",
      targetId: conditionA.record.entity.conditionId,
    },
    {
      type: "addresses_condition",
      targetId: conditionB.record.entity.conditionId,
    },
    {
      type: "related_regimen",
      targetId: peerRegimen.record.entity.regimenId,
    },
  ]);
  assert.match(read.document.markdown, /EPA — amount not specified/);
  assert.match(read.document.markdown, /DHA — 400 mg; inactive/);
  assert.match(read.document.markdown, /Creatine — 5 g/);
  assert.match(read.document.markdown, /## Related Goals/);
  assert.match(read.document.markdown, /## Related Conditions/);
  assert.match(read.document.markdown, /## Related Regimens/);
  assert.equal(cleared.created, false);
  assert.deepEqual(clearedRead.entity.relatedGoalIds, undefined);
  assert.deepEqual(clearedRead.entity.relatedConditionIds, undefined);
  assert.deepEqual(clearedRead.entity.relatedRegimenIds, undefined);
  assert.deepEqual(clearedRead.entity.links, []);
  assert.match(clearedRead.document.markdown, /## Related Goals[\s\S]*- none/);
  assert.match(clearedRead.document.markdown, /## Related Conditions[\s\S]*- none/);
  assert.match(clearedRead.document.markdown, /## Related Regimens[\s\S]*- none/);

  await assert.rejects(
    () =>
      upsertRegimen({
        vaultRoot,
        title: "Mismatched explicit goal link",
        kind: "supplement",
        startedOn: "2026-03-04",
        links: invalidTestValue<Parameters<typeof upsertRegimen>[0]["links"]>([
          {
            type: "supports_goal",
            targetId: peerRegimen.record.entity.regimenId,
          },
        ]),
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "links.targetId[0] must match goal_<ULID>.",
  );
  assert.equal((await listRegimens(vaultRoot)).length, 2);

  await assert.rejects(
    () =>
      upsertRegimen({
        vaultRoot,
        title: "Missing startedOn",
        kind: "supplement",
        startedOn: "",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "startedOn is required.",
  );

  await assert.rejects(
    () =>
      upsertRegimen({
        vaultRoot,
        title: "Backwards stop",
        kind: "supplement",
        startedOn: "2026-03-04",
        stoppedOn: "2026-03-03",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "stoppedOn must be on or after startedOn.",
  );

  await assert.rejects(
    () =>
      upsertRegimen({
        vaultRoot,
        title: "Stopped while active",
        kind: "supplement",
        status: "active",
        startedOn: "2026-03-04",
        stoppedOn: "2026-03-05",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "stoppedOn requires status=stopped or completed.",
  );

  await assert.rejects(
    () =>
      upsertRegimen({
        vaultRoot,
        title: "Stopped without date",
        kind: "supplement",
        status: "stopped",
        startedOn: "2026-03-04",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT" &&
      error.message === "status=stopped requires stoppedOn.",
  );

  await fs.writeFile(
    path.join(vaultRoot, "bank/regimens/supplement/legacy-regimen.md"),
    [
      "---",
      "schemaVersion: murph.frontmatter.regimen.v1",
      "docType: regimen",
      "regimenId: prot_01JNYB6M9A6W4K2N8P3Q7R5S7C",
      "slug: legacy-regimen",
      "title: Legacy regimen",
      "kind: supplement",
      "status: active",
      "startedOn: 2026-03-05",
      "---",
      "",
      "# Legacy regimen",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      readRegimen({
        vaultRoot,
        slug: "legacy-regimen",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_REGIMEN" &&
      error.message === "regimenId must match reg_<ULID>.",
  );
});
