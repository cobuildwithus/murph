import assert from "node:assert/strict";

import {
  extractHealthEntityRegistryLinks,
  extractHealthEntityRegistryRelatedIds,
  goalRegistryEntityDefinition,
  hasHealthEntityRegistry,
  healthEntityDefinitionByKind,
} from "@murph/contracts";
import { test } from "vitest";

import {
  allergyRegistryDefinition,
  conditionRegistryDefinition,
  goalRecordFromEntity,
  familyRegistryDefinition,
  geneticsRegistryDefinition,
  goalRegistryDefinition,
  protocolRegistryDefinition,
  toRegistryRecord,
} from "../src/health/registries.ts";
import { projectRegistryEntity } from "../src/canonical-entities.ts";

test("query registry definitions inherit canonical registry metadata from shared health entity definitions", () => {
  const registryDefinitions = [
    ["goal", goalRegistryDefinition],
    ["condition", conditionRegistryDefinition],
    ["allergy", allergyRegistryDefinition],
    ["protocol", protocolRegistryDefinition],
    ["family", familyRegistryDefinition],
    ["genetics", geneticsRegistryDefinition],
  ] as const;

  for (const [kind, registryDefinition] of registryDefinitions) {
    const definition = healthEntityDefinitionByKind.get(kind);

    assert.ok(definition, `missing health entity definition for ${kind}`);
    assert.ok(
      definition && hasHealthEntityRegistry(definition),
      `missing health registry metadata for ${kind}`,
    );

    if (!definition || !hasHealthEntityRegistry(definition)) {
      continue;
    }

    assert.equal(registryDefinition.directory, definition.registry.directory);
    assert.deepEqual(registryDefinition.idKeys, definition.registry.idKeys);
    assert.deepEqual(registryDefinition.titleKeys, definition.registry.titleKeys);
    assert.deepEqual(registryDefinition.statusKeys, definition.registry.statusKeys);
    assert.equal(typeof registryDefinition.transform, "function");
    assert.equal(
      typeof registryDefinition.compare,
      definition.registry.sortBehavior ? "function" : "undefined",
    );
  }
});

test("protocol registry projection keeps the shared relative-path grouping rule", () => {
  const projected = toRegistryRecord(
    {
      relativePath: "bank/protocols/supplements/sleep/magnesium-glycinate.md",
      markdown: "",
      body: "",
      attributes: {
        protocolId: "prot_01",
        title: "Magnesium glycinate",
        status: "active",
        kind: "supplement",
      },
    },
    protocolRegistryDefinition,
  );

  assert.equal(projected?.group, "supplements/sleep");
});

test("goal shared registry definition owns payload, command, and relation metadata", () => {
  assert.equal(goalRegistryEntityDefinition.registry.idField, "goalId");
  assert.ok(goalRegistryEntityDefinition.registry.frontmatterSchema);
  assert.ok(goalRegistryEntityDefinition.registry.upsertPayloadSchema);
  assert.equal(goalRegistryEntityDefinition.registry.command?.runtimeMethod, "upsertGoal");
  assert.equal(goalRegistryEntityDefinition.registry.command?.runtimeShowMethod, "showGoal");

  const goalPayloadSchema = goalRegistryEntityDefinition.registry.upsertPayloadSchema;

  assert.ok(goalPayloadSchema);

  const parsedPayload = goalPayloadSchema?.safeParse({
    title: "Sleep longer",
  });

  assert.equal(parsedPayload?.success, true);
  if (parsedPayload?.success) {
    const payload = parsedPayload.data as { status: string; horizon: string };

    assert.equal(payload.status, "active");
    assert.equal(payload.horizon, "ongoing");
  }

  const links = extractHealthEntityRegistryLinks("goal", {
    parentGoalId: "goal_parent_01",
    relatedGoalIds: ["goal_related_01", "goal_related_02"],
    relatedExperimentIds: ["exp_related_01"],
  });

  assert.deepEqual(
    links.map(({ type, targetId }) => ({ type, targetId })),
    [
      { type: "parent_goal", targetId: "goal_parent_01" },
      { type: "related_goal", targetId: "goal_related_01" },
      { type: "related_goal", targetId: "goal_related_02" },
      { type: "related_experiment", targetId: "exp_related_01" },
    ],
  );
  assert.deepEqual(
    extractHealthEntityRegistryRelatedIds("goal", {
      parentGoalId: "goal_parent_01",
      relatedGoalIds: ["goal_related_01", "goal_related_01"],
      relatedExperimentIds: ["exp_related_01"],
    }),
    ["goal_parent_01", "goal_related_01", "exp_related_01"],
  );
});

test("goal query projection round-trips shared Goal relation and window metadata", () => {
  const document = {
    relativePath: "bank/goals/recover-better.md",
    markdown: "# Recover better",
    body: "# Recover better",
    attributes: {
      goalId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6Q",
      slug: "recover-better",
      title: "Recover better",
      status: "active",
      horizon: "long_term",
      priority: 4,
      window: {
        startAt: "2026-03-01",
        targetAt: "2026-06-01",
      },
      parentGoalId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6P",
      relatedGoalIds: ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"],
      relatedExperimentIds: ["exp_01JNY0B2W4VG5C2A0G9S8M7R6S"],
      domains: ["sleep", "recovery"],
    },
  };

  const goalRecord = toRegistryRecord(document, goalRegistryDefinition);

  assert.ok(goalRecord);
  assert.equal(goalRecord?.windowStartAt, "2026-03-01");
  assert.equal(goalRecord?.windowTargetAt, "2026-06-01");
  assert.equal(goalRecord?.parentGoalId, "goal_01JNY0B2W4VG5C2A0G9S8M7R6P");
  assert.deepEqual(goalRecord?.relatedGoalIds, ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"]);
  assert.deepEqual(goalRecord?.relatedExperimentIds, ["exp_01JNY0B2W4VG5C2A0G9S8M7R6S"]);
  assert.deepEqual(goalRecord?.domains, ["sleep", "recovery"]);

  const entity = projectRegistryEntity("goal", goalRecord!);

  assert.deepEqual(entity.relatedIds, [
    "goal_01JNY0B2W4VG5C2A0G9S8M7R6P",
    "goal_01JNY0B2W4VG5C2A0G9S8M7R6R",
    "exp_01JNY0B2W4VG5C2A0G9S8M7R6S",
    "goal_01JNY0B2W4VG5C2A0G9S8M7R6Q",
  ]);

  const roundTripped = goalRecordFromEntity(entity);

  assert.ok(roundTripped);
  assert.equal(roundTripped?.windowStartAt, "2026-03-01");
  assert.equal(roundTripped?.windowTargetAt, "2026-06-01");
  assert.equal(roundTripped?.parentGoalId, "goal_01JNY0B2W4VG5C2A0G9S8M7R6P");
  assert.deepEqual(roundTripped?.relatedGoalIds, ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"]);
  assert.deepEqual(roundTripped?.relatedExperimentIds, ["exp_01JNY0B2W4VG5C2A0G9S8M7R6S"]);
  assert.deepEqual(roundTripped?.domains, ["sleep", "recovery"]);
});
