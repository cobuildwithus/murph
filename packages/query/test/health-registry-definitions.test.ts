import assert from "node:assert/strict";

import {
  allergyRegistryEntityDefinition,
  bankEntityDefinitionByKind,
  conditionRegistryEntityDefinition,
  extractBankEntityRegistryLinks,
  extractBankEntityRegistryRelatedIds,
  extractHealthEntityRegistryLinks,
  extractHealthEntityRegistryRelatedIds,
  familyRegistryEntityDefinition,
  geneticsRegistryEntityDefinition,
  goalRegistryEntityDefinition,
  hasHealthEntityRegistry,
  healthEntityDefinitionByKind,
  protocolRegistryEntityDefinition,
} from "@murphai/contracts";
import { test } from "vitest";

import {
  allergyRecordFromEntity,
  allergyRegistryDefinition,
  conditionRecordFromEntity,
  conditionRegistryDefinition,
  familyRecordFromEntity,
  familyRegistryDefinition,
  foodRecordFromEntity,
  foodRegistryDefinition,
  geneticsRecordFromEntity,
  geneticsRegistryDefinition,
  goalRecordFromEntity,
  goalRegistryDefinition,
  protocolRecordFromEntity,
  protocolRegistryDefinition,
  providerRecordFromEntity,
  providerRegistryDefinition,
  recipeRecordFromEntity,
  recipeRegistryDefinition,
  sortRegistryRecords,
  toRegistryRecord,
  workoutFormatRecordFromEntity,
  workoutFormatRegistryDefinition,
} from "../src/health/registries.ts";
import { getHealthRegistryQueryMetadata } from "../src/health/health-registry-query-metadata.ts";
import { projectRegistryEntity } from "../src/health/projectors/registry.ts";
import type { MarkdownDocumentRecord } from "../src/health/shared.ts";

test("query registry definitions combine canonical registry metadata with query-owned projection metadata", () => {
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

    const queryMetadata = getHealthRegistryQueryMetadata(kind);

    assert.equal(registryDefinition.registry.directory, definition.registry.directory);
    assert.deepEqual(registryDefinition.registry.idKeys, definition.registry.idKeys);
    assert.deepEqual(registryDefinition.registry.titleKeys, definition.registry.titleKeys);
    assert.deepEqual(registryDefinition.registry.statusKeys, definition.registry.statusKeys);
    assert.equal(typeof registryDefinition.transform, "function");
    assert.equal(
      typeof registryDefinition.compare,
      queryMetadata.sortBehavior ? "function" : "undefined",
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

  assert.equal(projected?.entity.group, "supplements/sleep");
});

test("protocol shared registry definition owns payload and relation metadata", () => {
  assert.equal(protocolRegistryEntityDefinition.registry.idField, "protocolId");
  assert.ok(protocolRegistryEntityDefinition.registry.frontmatterSchema);
  assert.ok(protocolRegistryEntityDefinition.registry.upsertPayloadSchema);

  const parsedPayload = protocolRegistryEntityDefinition.registry.upsertPayloadSchema?.safeParse({
    title: "Magnesium glycinate",
  });

  assert.equal(parsedPayload?.success, true);
  if (parsedPayload?.success) {
    const payload = parsedPayload.data as { kind: string; status: string };

    assert.equal(payload.kind, "supplement");
    assert.equal(payload.status, "active");
  }

  const links = extractHealthEntityRegistryLinks("protocol", {
    goalId: "goal_scalar_01",
    conditionIds: ["cond_array_01"],
    protocolIds: ["prot_related_01"],
    protocolId: "prot_self_01",
  });

  assert.deepEqual(
    links.map((link: { type: string; targetId: string }) => ({ type: link.type, targetId: link.targetId })),
    [
      { type: "supports_goal", targetId: "goal_scalar_01" },
      { type: "addresses_condition", targetId: "cond_array_01" },
      { type: "related_protocol", targetId: "prot_related_01" },
      { type: "related_protocol", targetId: "prot_self_01" },
    ],
  );
  assert.deepEqual(
    extractHealthEntityRegistryRelatedIds("protocol", {
      goalId: "goal_scalar_01",
      conditionIds: ["cond_array_01"],
      protocolIds: ["prot_related_01"],
      protocolId: "prot_self_01",
    }),
    ["goal_scalar_01", "cond_array_01", "prot_related_01", "prot_self_01"],
  );
});

test("protocol query projection merges mixed relation alias arrays into normalized links", () => {
  const protocolRecord = toRegistryRecord(
    {
      relativePath: "bank/protocols/recovery/cold-exposure.md",
      markdown: "# Cold exposure",
      body: "# Cold exposure",
      attributes: {
        protocolId: "prot_01",
        title: "Cold exposure",
        status: "active",
        kind: "recovery",
        goalIds: ["goal_primary_01", "goal_shared_01"],
        relatedGoalIds: ["goal_secondary_01", "goal_shared_01"],
        conditionIds: ["cond_primary_01", "cond_shared_01"],
        relatedConditionIds: ["cond_secondary_01", "cond_shared_01"],
        protocolIds: ["prot_related_01", "prot_shared_01"],
        relatedProtocolIds: ["prot_related_02", "prot_shared_01"],
      },
    },
    protocolRegistryDefinition,
  );

  assert.ok(protocolRecord);

  const entity = projectRegistryEntity("protocol", protocolRecord!);

  assert.deepEqual(
    entity.links.map((link) => ({ type: link.type, targetId: link.targetId })),
    [
      { type: "supports_goal", targetId: "goal_primary_01" },
      { type: "supports_goal", targetId: "goal_shared_01" },
      { type: "supports_goal", targetId: "goal_secondary_01" },
      { type: "addresses_condition", targetId: "cond_primary_01" },
      { type: "addresses_condition", targetId: "cond_shared_01" },
      { type: "addresses_condition", targetId: "cond_secondary_01" },
      { type: "related_to", targetId: "prot_related_01" },
      { type: "related_to", targetId: "prot_shared_01" },
      { type: "related_to", targetId: "prot_related_02" },
    ],
  );
  assert.deepEqual(entity.relatedIds, [
    "goal_primary_01",
    "goal_shared_01",
    "goal_secondary_01",
    "cond_primary_01",
    "cond_shared_01",
    "cond_secondary_01",
    "prot_related_01",
    "prot_shared_01",
    "prot_related_02",
  ]);
});

test("explicit registry links remain authoritative over legacy relation arrays", () => {
  const attributes = {
    protocolId: "prot_01JNY0B2W4VG5C2A0G9S8M7R6Z",
    slug: "cleared-protocol-links",
    title: "Cleared protocol links",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-12",
    links: [],
    relatedGoalIds: ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"],
    relatedConditionIds: ["cond_01JNY0B2W4VG5C2A0G9S8M7R6R"],
    relatedProtocolIds: ["prot_01JNY0B2W4VG5C2A0G9S8M7R6Y"],
  } satisfies Record<string, unknown>;

  assert.deepEqual(extractHealthEntityRegistryLinks("protocol", attributes), []);
  assert.deepEqual(extractHealthEntityRegistryRelatedIds("protocol", attributes), []);

  const protocolRecord = toRegistryRecord(
    {
      relativePath: "bank/protocols/supplements/cleared-protocol-links.md",
      markdown: "# Cleared protocol links",
      body: "# Cleared protocol links",
      attributes,
    },
    protocolRegistryDefinition,
  );

  assert.ok(protocolRecord);

  const entity = projectRegistryEntity("protocol", protocolRecord!);

  assert.deepEqual(entity.links, []);
  assert.deepEqual(entity.relatedIds, []);
});

test("protocol query projection round-trips shared protocol relation and ingredient metadata", () => {
  const document: MarkdownDocumentRecord = {
    relativePath: "bank/protocols/supplements/sleep/magnesium-glycinate.md",
    markdown: "# Magnesium glycinate",
    body: "# Magnesium glycinate",
    attributes: {
      protocolId: "prot_01JNY0B2W4VG5C2A0G9S8M7R6P",
      slug: "magnesium-glycinate",
      title: "Magnesium glycinate",
      kind: "supplement",
      status: "active",
      startedOn: "2026-03-12",
      ingredients: [
        {
          compound: "Magnesium",
          label: null,
          amount: 200,
          unit: "mg",
          active: true,
          note: null,
        },
        {
          compound: "Glycine",
          label: "Glycine buffer",
          amount: null,
          unit: null,
          active: false,
          note: "Paired to smooth GI tolerance.",
        },
      ],
      relatedGoalIds: ["goal_01JNY0B2W4VG5C2A0G9S8M7R6Q"],
      relatedConditionIds: ["cond_01JNY0B2W4VG5C2A0G9S8M7R6R"],
      relatedProtocolIds: ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
    },
  };

  const protocolRecord = toRegistryRecord(document, protocolRegistryDefinition);

  assert.ok(protocolRecord);
  assert.deepEqual(protocolRecord?.entity.ingredients, [
    {
      compound: "Magnesium",
      label: null,
      amount: 200,
      unit: "mg",
      active: true,
      note: null,
    },
    {
      compound: "Glycine",
      label: "Glycine buffer",
      amount: null,
      unit: null,
      active: false,
      note: "Paired to smooth GI tolerance.",
    },
  ]);
  assert.deepEqual(protocolRecord?.entity.relatedGoalIds, ["goal_01JNY0B2W4VG5C2A0G9S8M7R6Q"]);
  assert.deepEqual(protocolRecord?.entity.relatedConditionIds, ["cond_01JNY0B2W4VG5C2A0G9S8M7R6R"]);
  assert.deepEqual(protocolRecord?.entity.relatedProtocolIds, ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"]);
  assert.equal(protocolRecord?.entity.group, "supplements/sleep");

  const entity = projectRegistryEntity("protocol", protocolRecord!);
  const roundTripped = protocolRecordFromEntity(entity);

  assert.ok(roundTripped);
  assert.deepEqual(roundTripped?.entity.ingredients, protocolRecord?.entity.ingredients);
  assert.deepEqual(roundTripped?.entity.relatedGoalIds, ["goal_01JNY0B2W4VG5C2A0G9S8M7R6Q"]);
  assert.deepEqual(roundTripped?.entity.relatedConditionIds, ["cond_01JNY0B2W4VG5C2A0G9S8M7R6R"]);
  assert.deepEqual(roundTripped?.entity.relatedProtocolIds, ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"]);
  assert.equal(roundTripped?.entity.group, "supplements/sleep");
});

test("goal shared registry definition owns payload and relation metadata", () => {
  assert.equal(goalRegistryEntityDefinition.registry.idField, "goalId");
  assert.ok(goalRegistryEntityDefinition.registry.frontmatterSchema);
  assert.ok(goalRegistryEntityDefinition.registry.upsertPayloadSchema);

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
    links.map((link: { type: string; targetId: string }) => ({ type: link.type, targetId: link.targetId })),
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

test("condition and allergy shared registry definitions own payload and relation metadata", () => {
  assert.equal(conditionRegistryEntityDefinition.registry.idField, "conditionId");
  assert.ok(conditionRegistryEntityDefinition.registry.frontmatterSchema);
  assert.ok(conditionRegistryEntityDefinition.registry.upsertPayloadSchema);
  assert.ok(conditionRegistryEntityDefinition.registry.patchPayloadSchema);
  assert.equal(allergyRegistryEntityDefinition.registry.idField, "allergyId");
  assert.ok(allergyRegistryEntityDefinition.registry.frontmatterSchema);
  assert.ok(allergyRegistryEntityDefinition.registry.upsertPayloadSchema);
  assert.ok(allergyRegistryEntityDefinition.registry.patchPayloadSchema);

  const conditionPayloadSchema = conditionRegistryEntityDefinition.registry.upsertPayloadSchema;
  const allergyPayloadSchema = allergyRegistryEntityDefinition.registry.upsertPayloadSchema;

  assert.ok(conditionPayloadSchema);
  assert.ok(allergyPayloadSchema);

  const parsedConditionPayload = conditionPayloadSchema?.safeParse({
    title: "Migraine",
  });
  const parsedAllergyPayload = allergyPayloadSchema?.safeParse({
    title: "Peanut allergy",
    substance: "Peanut",
  });

  assert.equal(parsedConditionPayload?.success, true);
  assert.equal(parsedAllergyPayload?.success, true);

  if (parsedConditionPayload?.success) {
    const payload = parsedConditionPayload.data as { clinicalStatus: string };

    assert.equal(payload.clinicalStatus, "active");
  }

  if (parsedAllergyPayload?.success) {
    const payload = parsedAllergyPayload.data as { status: string };

    assert.equal(payload.status, "active");
  }

  const conditionLinks = extractHealthEntityRegistryLinks("condition", {
    relatedGoalIds: ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"],
    relatedProtocolIds: ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
  });
  const allergyLinks = extractHealthEntityRegistryLinks("allergy", {
    relatedConditionIds: ["cond_01JNY0B2W4VG5C2A0G9S8M7R6T"],
  });

  assert.deepEqual(
    conditionLinks.map((link: { type: string; targetId: string }) => ({
      type: link.type,
      targetId: link.targetId,
    })),
    [
      { type: "related_goal", targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6R" },
      { type: "related_protocol", targetId: "prot_01JNY0B2W4VG5C2A0G9S8M7R6S" },
    ],
  );
  assert.deepEqual(
    extractHealthEntityRegistryRelatedIds("condition", {
      relatedGoalIds: ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R", "goal_01JNY0B2W4VG5C2A0G9S8M7R6R"],
      relatedProtocolIds: ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
    }),
    ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R", "prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
  );
  assert.deepEqual(
    allergyLinks.map((link: { type: string; targetId: string }) => ({
      type: link.type,
      targetId: link.targetId,
    })),
    [{ type: "related_condition", targetId: "cond_01JNY0B2W4VG5C2A0G9S8M7R6T" }],
  );
  assert.deepEqual(
    extractHealthEntityRegistryRelatedIds("allergy", {
      relatedConditionIds: ["cond_01JNY0B2W4VG5C2A0G9S8M7R6T", "cond_01JNY0B2W4VG5C2A0G9S8M7R6T"],
    }),
    ["cond_01JNY0B2W4VG5C2A0G9S8M7R6T"],
  );
});

test("family and genetics split canonical payload metadata from query sort metadata", () => {
  assert.equal(familyRegistryEntityDefinition.registry.idField, "familyMemberId");
  assert.equal(familyRegistryEntityDefinition.noun, "family member");
  assert.ok(familyRegistryEntityDefinition.registry.frontmatterSchema);
  assert.ok(familyRegistryEntityDefinition.registry.upsertPayloadSchema);
  assert.ok(familyRegistryEntityDefinition.registry.patchPayloadSchema);
  assert.equal(getHealthRegistryQueryMetadata("family").sortBehavior, "title");

  const parsedFamilyPayload = familyRegistryEntityDefinition.registry.upsertPayloadSchema?.safeParse({
    title: "Mother",
    relationship: "mother",
  });

  assert.equal(parsedFamilyPayload?.success, true);
  assert.deepEqual(
    extractHealthEntityRegistryLinks("family", {
      relatedVariantIds: ["var_related_01", "var_related_02"],
    }).map((link: { type: string; targetId: string }) => ({
      type: link.type,
      targetId: link.targetId,
    })),
    [
      { type: "related_variant", targetId: "var_related_01" },
      { type: "related_variant", targetId: "var_related_02" },
    ],
  );

  assert.equal(geneticsRegistryEntityDefinition.registry.idField, "variantId");
  assert.equal(geneticsRegistryEntityDefinition.noun, "genetic variant");
  assert.ok(geneticsRegistryEntityDefinition.registry.frontmatterSchema);
  assert.ok(geneticsRegistryEntityDefinition.registry.upsertPayloadSchema);
  assert.ok(geneticsRegistryEntityDefinition.registry.patchPayloadSchema);
  assert.equal(getHealthRegistryQueryMetadata("genetics").sortBehavior, "gene-title");

  const parsedGeneticsPayload = geneticsRegistryEntityDefinition.registry.upsertPayloadSchema?.safeParse({
    gene: "APOE",
    title: "APOE e4 allele",
  });

  assert.equal(parsedGeneticsPayload?.success, true);
  assert.deepEqual(
    extractHealthEntityRegistryLinks("genetics", {
      sourceFamilyMemberIds: ["fam_related_01", "fam_related_02"],
    }).map((link: { type: string; targetId: string }) => ({
      type: link.type,
      targetId: link.targetId,
    })),
    [
      { type: "source_family_member", targetId: "fam_related_01" },
      { type: "source_family_member", targetId: "fam_related_02" },
    ],
  );
  assert.deepEqual(
    extractHealthEntityRegistryRelatedIds("genetics", {
      sourceFamilyMemberIds: ["fam_related_01", "fam_related_01"],
    }),
    ["fam_related_01"],
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
  assert.equal(goalRecord?.entity.windowStartAt, "2026-03-01");
  assert.equal(goalRecord?.entity.windowTargetAt, "2026-06-01");
  assert.equal(goalRecord?.entity.parentGoalId, "goal_01JNY0B2W4VG5C2A0G9S8M7R6P");
  assert.deepEqual(goalRecord?.entity.relatedGoalIds, ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"]);
  assert.deepEqual(goalRecord?.entity.relatedExperimentIds, ["exp_01JNY0B2W4VG5C2A0G9S8M7R6S"]);
  assert.deepEqual(goalRecord?.entity.domains, ["sleep", "recovery"]);

  const entity = projectRegistryEntity("goal", goalRecord!);

  assert.deepEqual(
    entity.links.map((link) => ({ type: link.type, targetId: link.targetId })),
    [
      { type: "parent_of", targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6P" },
      { type: "related_to", targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6R" },
      { type: "related_to", targetId: "exp_01JNY0B2W4VG5C2A0G9S8M7R6S" },
    ],
  );
  assert.deepEqual(entity.relatedIds, [
    "goal_01JNY0B2W4VG5C2A0G9S8M7R6P",
    "goal_01JNY0B2W4VG5C2A0G9S8M7R6R",
    "exp_01JNY0B2W4VG5C2A0G9S8M7R6S",
  ]);

  const roundTripped = goalRecordFromEntity(entity);

  assert.ok(roundTripped);
  assert.equal(roundTripped?.entity.windowStartAt, "2026-03-01");
  assert.equal(roundTripped?.entity.windowTargetAt, "2026-06-01");
  assert.equal(roundTripped?.entity.parentGoalId, "goal_01JNY0B2W4VG5C2A0G9S8M7R6P");
  assert.deepEqual(roundTripped?.entity.relatedGoalIds, ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"]);
  assert.deepEqual(roundTripped?.entity.relatedExperimentIds, ["exp_01JNY0B2W4VG5C2A0G9S8M7R6S"]);
  assert.deepEqual(roundTripped?.entity.domains, ["sleep", "recovery"]);
});

test("family and genetics query projections round-trip shared registry metadata without leaking legacy aliases", () => {
  const familyRecord = toRegistryRecord(
    {
      relativePath: "bank/family/mother.md",
      markdown: "# Mother",
      body: "# Mother",
      attributes: {
        familyMemberId: "fam_01JNY0B2W4VG5C2A0G9S8M7R6P",
        slug: "mother",
        title: "Mother",
        relationship: "mother",
        conditions: ["hypertension"],
        relatedVariantIds: ["var_01JNY0B2W4VG5C2A0G9S8M7R6Q"],
        familyMemberIds: ["var_should_not_leak"],
        updatedAt: "2026-03-12T09:00:00Z",
      },
    },
    familyRegistryDefinition,
  );

  assert.ok(familyRecord);
  assert.equal("updatedAt" in (familyRecord ?? {}), false);

  const familyEntity = projectRegistryEntity("family", familyRecord!);

  assert.deepEqual(
    familyEntity.links.map((link) => ({ type: link.type, targetId: link.targetId })),
    [{ type: "related_to", targetId: "var_01JNY0B2W4VG5C2A0G9S8M7R6Q" }],
  );
  assert.deepEqual(familyEntity.relatedIds, ["var_01JNY0B2W4VG5C2A0G9S8M7R6Q"]);

  const familyRoundTrip = familyRecordFromEntity(familyEntity);

  assert.ok(familyRoundTrip);
  assert.equal("updatedAt" in (familyRoundTrip ?? {}), false);
  assert.deepEqual(familyRoundTrip?.entity.relatedVariantIds, ["var_01JNY0B2W4VG5C2A0G9S8M7R6Q"]);

  const geneticsRecord = toRegistryRecord(
    {
      relativePath: "bank/genetics/apoe-e4.md",
      markdown: "# APOE e4 allele",
      body: "# APOE e4 allele",
      attributes: {
        variantId: "var_01JNY0B2W4VG5C2A0G9S8M7R6R",
        slug: "apoe-e4",
        title: "APOE e4 allele",
        gene: "APOE",
        significance: "risk_factor",
        sourceFamilyMemberIds: ["fam_01JNY0B2W4VG5C2A0G9S8M7R6P"],
        updatedAt: "2026-03-12T11:00:00Z",
      },
    },
    geneticsRegistryDefinition,
  );

  assert.ok(geneticsRecord);
  assert.equal("updatedAt" in (geneticsRecord ?? {}), false);

  const geneticsEntity = projectRegistryEntity("genetics", geneticsRecord!);
  const geneticsRoundTrip = geneticsRecordFromEntity(geneticsEntity);

  assert.ok(geneticsRoundTrip);
  assert.deepEqual(
    geneticsEntity.links.map((link) => ({ type: link.type, targetId: link.targetId })),
    [{ type: "source_family_member", targetId: "fam_01JNY0B2W4VG5C2A0G9S8M7R6P" }],
  );
  assert.deepEqual(geneticsEntity.relatedIds, ["fam_01JNY0B2W4VG5C2A0G9S8M7R6P"]);
  assert.equal("updatedAt" in (geneticsRoundTrip ?? {}), false);
  assert.deepEqual(geneticsRoundTrip?.entity.sourceFamilyMemberIds, ["fam_01JNY0B2W4VG5C2A0G9S8M7R6P"]);

  const sortedGenetics = sortRegistryRecords(
    [
      geneticsRecord!,
      toRegistryRecord(
        {
          relativePath: "bank/genetics/mthfr-c677t.md",
          markdown: "# MTHFR C677T",
          body: "# MTHFR C677T",
          attributes: {
            variantId: "var_01JNY0B2W4VG5C2A0G9S8M7R6S",
            slug: "mthfr-c677t",
            title: "MTHFR C677T",
            gene: "MTHFR",
          },
        },
        geneticsRegistryDefinition,
      )!,
    ],
    geneticsRegistryDefinition,
  );

  assert.deepEqual(sortedGenetics.map((record) => record.entity.gene), ["APOE", "MTHFR"]);
});

test("condition query projection round-trips shared condition relation metadata", () => {
  const document = {
    relativePath: "bank/conditions/migraine.md",
    markdown: "# Migraine",
    body: "# Migraine",
    attributes: {
      conditionId: "cond_01JNY0B2W4VG5C2A0G9S8M7R6Q",
      slug: "migraine",
      title: "Migraine",
      clinicalStatus: "active",
      verificationStatus: "confirmed",
      assertedOn: "2026-03-01",
      severity: "moderate",
      bodySites: ["head"],
      relatedGoalIds: ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"],
      relatedProtocolIds: ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
      note: "Likely worsened by poor sleep.",
    },
  };

  const conditionRecord = toRegistryRecord(document, conditionRegistryDefinition);

  assert.ok(conditionRecord);
  assert.equal(conditionRecord?.entity.clinicalStatus, "active");
  assert.equal(conditionRecord?.entity.verificationStatus, "confirmed");
  assert.deepEqual(conditionRecord?.entity.bodySites, ["head"]);
  assert.deepEqual(conditionRecord?.entity.relatedGoalIds, ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"]);
  assert.deepEqual(conditionRecord?.entity.relatedProtocolIds, ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"]);

  const entity = projectRegistryEntity("condition", conditionRecord!);

  assert.deepEqual(
    entity.links.map((link) => ({ type: link.type, targetId: link.targetId })),
    [
      { type: "related_to", targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6R" },
      { type: "related_to", targetId: "prot_01JNY0B2W4VG5C2A0G9S8M7R6S" },
    ],
  );
  assert.deepEqual(entity.relatedIds, [
    "goal_01JNY0B2W4VG5C2A0G9S8M7R6R",
    "prot_01JNY0B2W4VG5C2A0G9S8M7R6S",
  ]);

  const roundTripped = conditionRecordFromEntity(entity);

  assert.ok(roundTripped);
  assert.equal(roundTripped?.entity.clinicalStatus, "active");
  assert.equal(roundTripped?.entity.verificationStatus, "confirmed");
  assert.deepEqual(roundTripped?.entity.bodySites, ["head"]);
  assert.deepEqual(roundTripped?.entity.relatedGoalIds, ["goal_01JNY0B2W4VG5C2A0G9S8M7R6R"]);
  assert.deepEqual(roundTripped?.entity.relatedProtocolIds, ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"]);
  assert.equal(roundTripped?.entity.note, "Likely worsened by poor sleep.");
});

test("allergy query projection round-trips shared allergy relation metadata", () => {
  const document = {
    relativePath: "bank/allergies/peanut-allergy.md",
    markdown: "# Peanut allergy",
    body: "# Peanut allergy",
    attributes: {
      allergyId: "alg_01JNY0B2W4VG5C2A0G9S8M7R6Q",
      slug: "peanut-allergy",
      title: "Peanut allergy",
      substance: "Peanut",
      status: "active",
      criticality: "high",
      reaction: "Hives",
      recordedOn: "2026-03-02",
      relatedConditionIds: ["cond_01JNY0B2W4VG5C2A0G9S8M7R6T"],
      note: "Carries an epinephrine auto-injector.",
    },
  };

  const allergyRecord = toRegistryRecord(document, allergyRegistryDefinition);

  assert.ok(allergyRecord);
  assert.equal(allergyRecord?.entity.substance, "Peanut");
  assert.equal(allergyRecord?.entity.criticality, "high");
  assert.deepEqual(allergyRecord?.entity.relatedConditionIds, ["cond_01JNY0B2W4VG5C2A0G9S8M7R6T"]);

  const entity = projectRegistryEntity("allergy", allergyRecord!);

  assert.deepEqual(
    entity.links.map((link) => ({ type: link.type, targetId: link.targetId })),
    [{ type: "related_to", targetId: "cond_01JNY0B2W4VG5C2A0G9S8M7R6T" }],
  );
  assert.deepEqual(entity.relatedIds, ["cond_01JNY0B2W4VG5C2A0G9S8M7R6T"]);

  const roundTripped = allergyRecordFromEntity(entity);

  assert.ok(roundTripped);
  assert.equal(roundTripped?.entity.substance, "Peanut");
  assert.equal(roundTripped?.entity.criticality, "high");
  assert.equal(roundTripped?.entity.reaction, "Hives");
  assert.equal(roundTripped?.entity.recordedOn, "2026-03-02");
  assert.deepEqual(roundTripped?.entity.relatedConditionIds, ["cond_01JNY0B2W4VG5C2A0G9S8M7R6T"]);
  assert.equal(roundTripped?.entity.note, "Carries an epinephrine auto-injector.");
});


test("bank registry definitions inherit canonical registry metadata from shared bank entity definitions", () => {
  const registryDefinitions = [
    ["food", foodRegistryDefinition],
    ["recipe", recipeRegistryDefinition],
    ["provider", providerRegistryDefinition],
    ["workout_format", workoutFormatRegistryDefinition],
  ] as const;

  for (const [kind, registryDefinition] of registryDefinitions) {
    const definition = bankEntityDefinitionByKind.get(kind);

    assert.ok(definition, `missing bank entity definition for ${kind}`);
    if (!definition) {
      continue;
    }

    assert.equal(registryDefinition.registry.directory, definition.registry.directory);
    assert.deepEqual(registryDefinition.registry.idKeys, definition.registry.idKeys);
    assert.deepEqual(registryDefinition.registry.titleKeys, definition.registry.titleKeys);
    assert.deepEqual(registryDefinition.registry.statusKeys, definition.registry.statusKeys);
    assert.equal("transform" in definition.registry, false);
    assert.equal("sortBehavior" in definition.registry, false);
    assert.equal(typeof registryDefinition.transform, "function");
  }
});

test("bank entity projections normalize food and workout format metadata through the shared seam", () => {
  assert.deepEqual(
    extractBankEntityRegistryLinks("food", {
      attachedProtocolIds: ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
    }).map((link) => ({ type: link.type, targetId: link.targetId })),
    [
      { type: "related_protocol", targetId: "prot_01JNY0B2W4VG5C2A0G9S8M7R6S" },
    ],
  );
  assert.deepEqual(
    extractBankEntityRegistryRelatedIds("food", {
      attachedProtocolIds: ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
    }),
    ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
  );

  const foodRecord = toRegistryRecord(
    {
      relativePath: "bank/foods/overnight-oats.md",
      markdown: "# Overnight oats",
      body: "# Overnight oats",
      attributes: {
        foodId: "food_01JNY0B2W4VG5C2A0G9S8M7R6A",
        slug: "overnight-oats",
        title: "Overnight oats",
        status: "active",
        serving: "1 bowl",
        tags: ["breakfast"],
        autoLogDaily: {
          time: "08:00",
        },
        attachedProtocolIds: ["prot_01JNY0B2W4VG5C2A0G9S8M7R6S"],
      },
    },
    foodRegistryDefinition,
  );

  assert.ok(foodRecord);
  assert.equal(foodRecord?.entity.serving, "1 bowl");
  assert.deepEqual(foodRecord?.entity.tags, ["breakfast"]);
  assert.deepEqual(foodRecord?.entity.autoLogDaily, { time: "08:00" });

  const foodEntity = projectRegistryEntity("food", foodRecord!);
  assert.equal(foodEntity.recordClass, "bank");
  assert.deepEqual(foodEntity.relatedIds, [
    "prot_01JNY0B2W4VG5C2A0G9S8M7R6S",
  ]);

  const roundTrippedFood = foodRecordFromEntity(foodEntity);
  assert.ok(roundTrippedFood);
  assert.deepEqual(roundTrippedFood?.entity.autoLogDaily, { time: "08:00" });
  assert.deepEqual(roundTrippedFood?.entity.attachedProtocolIds, [
    "prot_01JNY0B2W4VG5C2A0G9S8M7R6S",
  ]);

  const workoutFormatRecord = toRegistryRecord(
    {
      relativePath: "bank/workout-formats/push-day-a.md",
      markdown: "# Push Day A",
      body: "# Push Day A",
      attributes: {
        workoutFormatId: "wfmt_01JNY0B2W4VG5C2A0G9S8M7R6D",
        slug: "push-day-a",
        title: "Push Day A",
        status: "active",
        activityType: "strength-training",
        durationMinutes: 45,
        templateText: "45 min push day with incline bench.",
        template: {
          routineNote: "45 min push day with incline bench.",
          exercises: [
            {
              name: "incline bench",
              order: 1,
              mode: "weight_reps",
              plannedSets: [
                { order: 1, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
                { order: 2, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
                { order: 3, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
                { order: 4, targetReps: 10, targetWeight: 65, targetWeightUnit: "lb" },
              ],
            },
          ],
        },
      },
    },
    workoutFormatRegistryDefinition,
  );

  assert.ok(workoutFormatRecord);
  assert.equal(
    workoutFormatRecord?.entity.id,
    "wfmt_01JNY0B2W4VG5C2A0G9S8M7R6D",
  );
  assert.equal(workoutFormatRecord?.entity.activityType, "strength-training");
  assert.equal(workoutFormatRecord?.entity.durationMinutes, 45);
  assert.equal(workoutFormatRecord?.entity.templateText, "45 min push day with incline bench.");

  const workoutFormatEntity = projectRegistryEntity("workout_format", workoutFormatRecord!);
  assert.equal(workoutFormatEntity.recordClass, "bank");

  const roundTrippedWorkoutFormat = workoutFormatRecordFromEntity(workoutFormatEntity);
  assert.ok(roundTrippedWorkoutFormat);
  assert.equal(
    roundTrippedWorkoutFormat?.entity.id,
    "wfmt_01JNY0B2W4VG5C2A0G9S8M7R6D",
  );
  assert.equal(roundTrippedWorkoutFormat?.entity.templateText, "45 min push day with incline bench.");
});

test("recipe and provider bank records round-trip through the shared registry seam", () => {
  const recipeRecord = toRegistryRecord(
    {
      relativePath: "bank/recipes/salmon-rice-bowl.md",
      markdown: "# Salmon rice bowl",
      body: "# Salmon rice bowl",
      attributes: {
        recipeId: "recipe_01JNY0B2W4VG5C2A0G9S8M7R6B",
        slug: "salmon-rice-bowl",
        title: "Salmon rice bowl",
        status: "saved",
        servings: 2,
        links: [
          { type: "supports_goal", targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6Q" },
          { type: "addresses_condition", targetId: "cond_01JNY0B2W4VG5C2A0G9S8M7R6R" },
        ],
        relatedGoalIds: ["goal_01JNY0B2W4VG5C2A0G9S8M7R6Q"],
        relatedConditionIds: ["cond_01JNY0B2W4VG5C2A0G9S8M7R6R"],
      },
    },
    recipeRegistryDefinition,
  );
  const providerRecord = toRegistryRecord(
    {
      relativePath: "bank/providers/primary-care.md",
      markdown: "# Primary care physician",
      body: "# Primary care physician",
      attributes: {
        providerId: "prov_01JNY0B2W4VG5C2A0G9S8M7R6C",
        slug: "primary-care",
        title: "Primary care physician",
        status: "active",
        specialty: "primary-care",
        organization: "Neighborhood Clinic",
      },
    },
    providerRegistryDefinition,
  );

  assert.ok(recipeRecord);
  assert.ok(providerRecord);

  const recipeEntity = projectRegistryEntity("recipe", recipeRecord!);
  const providerEntity = projectRegistryEntity("provider", providerRecord!);

  assert.equal(recipeEntity.recordClass, "bank");
  assert.equal(providerEntity.recordClass, "bank");
  assert.deepEqual(recipeEntity.links, [
    { type: "supports_goal", targetId: "goal_01JNY0B2W4VG5C2A0G9S8M7R6Q" },
    { type: "addresses_condition", targetId: "cond_01JNY0B2W4VG5C2A0G9S8M7R6R" },
  ]);
  assert.deepEqual(recipeEntity.relatedIds, [
    "goal_01JNY0B2W4VG5C2A0G9S8M7R6Q",
    "cond_01JNY0B2W4VG5C2A0G9S8M7R6R",
  ]);

  const roundTrippedRecipe = recipeRecordFromEntity(recipeEntity);
  const roundTrippedProvider = providerRecordFromEntity(providerEntity);

  assert.ok(roundTrippedRecipe);
  assert.ok(roundTrippedProvider);
  assert.equal(roundTrippedRecipe?.entity.servings, 2);
  assert.equal(roundTrippedProvider?.entity.organization, "Neighborhood Clinic");
});
