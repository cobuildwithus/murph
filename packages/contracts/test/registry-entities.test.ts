import { describe, expect, it } from "vitest";

import {
  bankEntityDefinitionByKind,
  familyBankEntityDefinition,
  extractBankEntityRegistryLinks,
  extractBankEntityRegistryRelatedIds,
  getBankEntityRegistryProjectionMetadata,
  goalBankEntityDefinition,
  geneticsBankEntityDefinition,
  providerBankEntityDefinition,
  recipeBankEntityDefinition,
  protocolBankEntityDefinition,
  workoutFormatBankEntityDefinition,
} from "../src/bank-entities.ts";
import {
  deriveProtocolGroupFromRelativePath,
  extractHealthEntityRegistryLinks,
  extractHealthEntityRegistryRelatedIds,
  getHealthEntityRegistryCommandMetadata,
  getHealthEntityRegistryProjectionMetadata,
  goalRegistryEntityDefinition,
  hasHealthEntityRegistry,
  healthEntityDefinitionByKind,
  requireHealthEntityRegistryDefinition,
  protocolRegistryEntityDefinition,
} from "../src/health-entities.ts";
import {
  applyRegistryMetadataDefaults,
  extractRegistryLinks,
  extractRegistryRelatedIds,
  extractRegistryRelationTargets,
  normalizeRegistryString,
} from "../src/registry-helpers.ts";

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const normalized = normalizeRegistryString(source[key]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function firstStringArray(source: Record<string, unknown>, keys: readonly string[]): string[] {
  return [
    ...new Set(
      keys.flatMap((key) => {
        const value = source[key];
        if (!Array.isArray(value)) {
          return [];
        }

        return value.flatMap((entry) => {
          const normalized = normalizeRegistryString(entry);
          return normalized ? [normalized] : [];
        });
      }),
    ),
  ];
}

const projectionHelpers = {
  firstBoolean(source: Record<string, unknown>, keys: readonly string[]): boolean | null {
    for (const key of keys) {
      if (typeof source[key] === "boolean") {
        return source[key] as boolean;
      }
    }

    return null;
  },
  firstNumber(source: Record<string, unknown>, keys: readonly string[]): number | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  },
  firstObject(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | null {
    for (const key of keys) {
      const value = source[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }

    return null;
  },
  firstString,
  firstStringArray,
};

describe("registry helper seam", () => {
  it("applies default id and slug metadata while keeping explicit overrides", () => {
    expect(
      applyRegistryMetadataDefaults({
        directory: "bank/goals",
        idField: "goalId",
        titleKeys: ["title"],
      }),
    ).toMatchObject({
      directory: "bank/goals",
      idField: "goalId",
      idKeys: ["goalId"],
      slugKeys: ["slug"],
      titleKeys: ["title"],
    });

    expect(
      applyRegistryMetadataDefaults({
        directory: "bank/protocols",
        idField: "protocolId",
        idKeys: ["protocolId", "legacyProtocolId"],
        slugKeys: ["slug", "aliases"],
        titleKeys: ["title"],
      }),
    ).toMatchObject({
      idKeys: ["protocolId", "legacyProtocolId"],
      slugKeys: ["slug", "aliases"],
    });
  });

  it("normalizes relation targets and lets explicit links override derived relations", () => {
    const relations = [
      {
        type: "parent_goal",
        cardinality: "one" as const,
        keys: ["parentGoalId", "legacyParentGoalId"],
      },
      {
        type: "related_goal",
        cardinality: "many" as const,
        keys: ["relatedGoalIds", "goalIds"],
      },
    ];

    expect(normalizeRegistryString("  goal_123  ")).toBe("goal_123");
    expect(normalizeRegistryString("   ")).toBeNull();
    expect(extractRegistryRelationTargets(
      {
        legacyParentGoalId: " goal_parent ",
        relatedGoalIds: [" goal_alpha ", "", "goal_beta", "goal_alpha"],
        goalIds: ["goal_beta", " goal_gamma "],
      },
      relations[0],
    )).toEqual(["goal_parent"]);
    expect(extractRegistryLinks(
      {
        legacyParentGoalId: " goal_parent ",
        relatedGoalIds: [" goal_alpha ", "", "goal_beta", "goal_alpha"],
        goalIds: ["goal_beta", " goal_gamma "],
      },
      relations,
    )).toEqual([
      {
        type: "parent_goal",
        targetId: "goal_parent",
        sourceKeys: ["parentGoalId", "legacyParentGoalId"],
      },
      {
        type: "related_goal",
        targetId: "goal_alpha",
        sourceKeys: ["relatedGoalIds", "goalIds"],
      },
      {
        type: "related_goal",
        targetId: "goal_beta",
        sourceKeys: ["relatedGoalIds", "goalIds"],
      },
      {
        type: "related_goal",
        targetId: "goal_gamma",
        sourceKeys: ["relatedGoalIds", "goalIds"],
      },
    ]);

    const explicitLinks = extractRegistryLinks(
      {
        parentGoalId: "goal_from_attributes",
        relatedGoalIds: ["goal_should_be_ignored"],
        links: [
          null,
          { type: "unknown", targetId: "goal_ignore" },
          { type: "parent_goal", targetId: " goal_explicit_parent " },
          { type: "related_goal", targetId: "goal_explicit_peer" },
          { type: "related_goal", targetId: "goal_explicit_peer" },
          { type: "related_goal", targetId: " " },
        ],
      },
      relations,
    );

    expect(explicitLinks).toEqual([
      {
        type: "parent_goal",
        targetId: "goal_explicit_parent",
        sourceKeys: ["links"],
      },
      {
        type: "related_goal",
        targetId: "goal_explicit_peer",
        sourceKeys: ["links"],
      },
    ]);
    expect(extractRegistryRelatedIds(explicitLinks)).toEqual([
      "goal_explicit_parent",
      "goal_explicit_peer",
    ]);
  });
});

describe("health registry seam", () => {
  it("exposes stable registry definitions and derived command metadata", () => {
    expect(goalRegistryEntityDefinition.registry).toMatchObject({
      directory: "bank/goals",
      idField: "goalId",
      idKeys: ["goalId"],
      slugKeys: ["slug"],
      titleKeys: ["title"],
      statusKeys: ["status"],
    });

    expect(getHealthEntityRegistryCommandMetadata("goal")).toEqual({
      commandDescription: "Goal registry commands for the health extension surface.",
      commandName: "goal",
      listServiceMethodName: "listGoals",
      listStatusDescription: "Optional goal status to filter by.",
      payloadFile: "goal.json",
      runtimeListMethodName: "listGoals",
      runtimeMethodName: "upsertGoal",
      runtimeShowMethodName: "showGoal",
      scaffoldServiceMethodName: "scaffoldGoal",
      showId: {
        description: "Goal id or slug to show.",
        example: "<goal-id>",
      },
      showServiceMethodName: "showGoal",
      upsertServiceMethodName: "upsertGoal",
    });

    expect(getHealthEntityRegistryCommandMetadata("protocol")).toMatchObject({
      runtimeMethodName: "upsertProtocolItem",
      payloadFile: "protocol.json",
    });
  });

  it("projects protocol metadata, derives protocol groups from paths, and prefers explicit links when present", () => {
    const projection = getHealthEntityRegistryProjectionMetadata("protocol");

    expect(deriveProtocolGroupFromRelativePath("bank/protocols/sleep/magnesium.md")).toBe("sleep");
    expect(deriveProtocolGroupFromRelativePath("./bank/protocols/recovery/evening/magnesium.md")).toBe(
      "recovery/evening",
    );
    expect(deriveProtocolGroupFromRelativePath("bank/protocols/magnesium.md")).toBeNull();
    expect(deriveProtocolGroupFromRelativePath("bank/foods/magnesium.md")).toBeNull();

    expect(
      projection.transform({
        attributes: {
          kind: "supplement",
          startedOn: "2026-03-12",
          dose: 240,
          unit: "mg",
          ingredients: [
            { compound: " Magnesium Glycinate ", label: " Glycinate ", amount: 240, unit: " mg " },
            { compound: " Taurine ", active: false, note: " bedtime " },
            { compound: " " },
          ],
          goalIds: ["goal_sleep"],
          relatedGoalIds: [" goal_energy ", "goal_sleep"],
          conditionId: "cond_insomnia",
          relatedProtocolIds: [" protocol_existing "],
        },
        helpers: projectionHelpers,
        relativePath: "bank/protocols/sleep/magnesium-glycinate.md",
      }),
    ).toEqual({
      kind: "supplement",
      startedOn: "2026-03-12",
      stoppedOn: null,
      substance: null,
      dose: 240,
      unit: "mg",
      schedule: null,
      brand: null,
      manufacturer: null,
      servingSize: null,
      ingredients: [
        {
          compound: "Magnesium Glycinate",
          label: "Glycinate",
          amount: 240,
          unit: "mg",
          active: true,
          note: null,
        },
        {
          compound: "Taurine",
          label: null,
          amount: null,
          unit: null,
          active: false,
          note: "bedtime",
        },
      ],
      relatedGoalIds: ["goal_energy", "goal_sleep"],
      relatedConditionIds: [],
      relatedProtocolIds: ["protocol_existing"],
      group: "sleep",
    });

    expect(
      extractHealthEntityRegistryLinks("protocol", {
        goalIds: ["goal_sleep", "goal_energy"],
        goalId: "goal_sleep",
        conditionIds: ["cond_insomnia"],
        relatedConditionIds: [" cond_fatigue ", "cond_insomnia"],
        protocolId: "protocol_base",
        relatedProtocolIds: ["protocol_stack", "protocol_base"],
      }),
    ).toEqual([
      {
        type: "supports_goal",
        targetId: "goal_sleep",
        sourceKeys: ["goalIds", "relatedGoalIds"],
      },
      {
        type: "supports_goal",
        targetId: "goal_energy",
        sourceKeys: ["goalIds", "relatedGoalIds"],
      },
      {
        type: "addresses_condition",
        targetId: "cond_insomnia",
        sourceKeys: ["conditionIds", "relatedConditionIds"],
      },
      {
        type: "addresses_condition",
        targetId: "cond_fatigue",
        sourceKeys: ["conditionIds", "relatedConditionIds"],
      },
      {
        type: "related_protocol",
        targetId: "protocol_stack",
        sourceKeys: ["protocolIds", "relatedProtocolIds"],
      },
      {
        type: "related_protocol",
        targetId: "protocol_base",
        sourceKeys: ["protocolIds", "relatedProtocolIds"],
      },
    ]);

    expect(
      extractHealthEntityRegistryLinks("protocol", {
        goalIds: ["goal_should_be_ignored"],
        links: [
          { type: "supports_goal", targetId: "goal_explicit" },
          { type: "related_protocol", targetId: "protocol_explicit" },
          { type: "unknown", targetId: "ignored" },
        ],
      }),
    ).toEqual([
      {
        type: "supports_goal",
        targetId: "goal_explicit",
        sourceKeys: ["links"],
      },
      {
        type: "related_protocol",
        targetId: "protocol_explicit",
        sourceKeys: ["links"],
      },
    ]);
  });
});

describe("bank registry seam", () => {
  it("reuses health-backed registry definitions and projects bank-owned entities", () => {
    expect(bankEntityDefinitionByKind.get("goal")).toBe(goalBankEntityDefinition);
    expect(goalBankEntityDefinition).toBe(goalRegistryEntityDefinition);
    expect(protocolBankEntityDefinition).toBe(protocolRegistryEntityDefinition);

    const projection = getBankEntityRegistryProjectionMetadata("food");

    expect(
      projection.transform({
        attributes: {
          summary: "  Quick breakfast  ",
          kind: "meal",
          brand: "Homemade",
          serving: "1 bowl",
          aliases: [" acai bowl ", "", "breakfast bowl", "acai bowl"],
          ingredients: ["acai", " banana "],
          tags: [" breakfast ", "post-workout"],
          attachedProtocolIds: [" protocol_sleep ", "protocol_sleep"],
          autoLogDaily: {
            time: " 08:30 ",
          },
        },
        helpers: projectionHelpers,
        relativePath: "bank/foods/acai-bowl.md",
      }),
    ).toEqual({
      summary: "Quick breakfast",
      kind: "meal",
      brand: "Homemade",
      vendor: null,
      location: null,
      serving: "1 bowl",
      aliases: ["acai bowl", "breakfast bowl"],
      ingredients: ["acai", "banana"],
      tags: ["breakfast", "post-workout"],
      note: null,
      attachedProtocolIds: ["protocol_sleep"],
      autoLogDaily: {
        time: "08:30",
      },
    });

    expect(
      getBankEntityRegistryProjectionMetadata("food").transform({
        attributes: {
          autoLogDaily: null,
        },
        helpers: projectionHelpers,
        relativePath: "bank/foods/missing-auto-log.md",
      }),
    ).toMatchObject({
      autoLogDaily: null,
    });

    expect(
      getBankEntityRegistryProjectionMetadata("food").transform({
        attributes: {
          autoLogDaily: {},
        },
        helpers: projectionHelpers,
        relativePath: "bank/foods/blank-auto-log.md",
      }),
    ).toMatchObject({
      autoLogDaily: null,
    });
  });

  it("extracts related ids for bank-owned and health-backed kinds through the shared seam", () => {
    expect(
      extractBankEntityRegistryLinks("recipe", {
        relatedGoalIds: ["goal_sleep", " goal_energy "],
        relatedConditionIds: ["cond_insomnia", "cond_insomnia"],
      }),
    ).toEqual([
      {
        type: "supports_goal",
        targetId: "goal_sleep",
        sourceKeys: ["relatedGoalIds"],
      },
      {
        type: "supports_goal",
        targetId: "goal_energy",
        sourceKeys: ["relatedGoalIds"],
      },
      {
        type: "addresses_condition",
        targetId: "cond_insomnia",
        sourceKeys: ["relatedConditionIds"],
      },
    ]);

    expect(
      extractBankEntityRegistryRelatedIds("goal", {
        parentGoalId: "goal_parent",
        relatedGoalIds: ["goal_peer", "goal_parent"],
        relatedExperimentIds: ["exp_sleep"],
      }),
    ).toEqual(["goal_parent", "goal_peer", "exp_sleep"]);
    expect(
      extractBankEntityRegistryLinks("goal", {
        links: [
          { type: "parent_goal", targetId: "goal_explicit" },
          { type: "related_experiment", targetId: "exp_explicit" },
        ],
      }),
    ).toEqual([
      {
        type: "parent_goal",
        targetId: "goal_explicit",
        sourceKeys: ["links"],
      },
      {
        type: "related_experiment",
        targetId: "exp_explicit",
        sourceKeys: ["links"],
      },
    ]);
  });

  it("covers the remaining bank projection branches and family/provider/workout helpers", () => {
    expect(familyBankEntityDefinition).toBe(requireHealthEntityRegistryDefinition("family"));
    expect(geneticsBankEntityDefinition).toBe(requireHealthEntityRegistryDefinition("genetics"));
    expect(providerBankEntityDefinition.registry.titleKeys).toEqual(["title"]);
    expect(recipeBankEntityDefinition.registry.statusKeys).toEqual(["status"]);
    expect(workoutFormatBankEntityDefinition.registry.directory).toBe("bank/workout-formats");

    expect(getBankEntityRegistryProjectionMetadata("recipe").transform({
      attributes: {
        summary: " Salmon rice bowl ",
        cuisine: "japanese",
        dishType: "dinner",
        source: "family",
        servings: 2,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        tags: [" weeknight ", "weeknight"],
        ingredients: ["rice", "salmon"],
        steps: ["cook", "serve"],
        relatedGoalIds: ["goal_sleep"],
        relatedConditionIds: ["cond_insomnia"],
      },
      helpers: projectionHelpers,
      relativePath: "bank/recipes/salmon-rice-bowl.md",
    })).toMatchObject({
      summary: "Salmon rice bowl",
      cuisine: "japanese",
      ingredients: ["rice", "salmon"],
      relatedGoalIds: ["goal_sleep"],
      relatedConditionIds: ["cond_insomnia"],
    });

    expect(getBankEntityRegistryProjectionMetadata("provider").transform({
      attributes: {
        specialty: "primary-care",
        organization: "Neighborhood Clinic",
        location: "Sydney",
        website: "https://clinic.test",
        phone: "555-0100",
        note: "Primary provider",
        aliases: ["doctor", "clinic"],
      },
      helpers: projectionHelpers,
      relativePath: "bank/providers/clinic.md",
    })).toMatchObject({
      specialty: "primary-care",
      aliases: ["doctor", "clinic"],
    });

    expect(getBankEntityRegistryProjectionMetadata("workout_format").transform({
      attributes: {
        summary: " Push day ",
        activityType: "strength-training",
        durationMinutes: 45,
        distanceKm: 3,
        template: {
          blocks: ["press"],
        },
        tags: ["strength", "push"],
        note: "Upper body",
        templateText: "Press day",
      },
      helpers: projectionHelpers,
      relativePath: "bank/workout-formats/push-day-a.md",
    })).toMatchObject({
      summary: "Push day",
      activityType: "strength-training",
      durationMinutes: 45,
      template: { blocks: ["press"] },
    });

    expect(extractBankEntityRegistryLinks("food", {
      attachedProtocolIds: ["prot_0123456789ABCDEFGHJKMNPQRS"],
    })).toEqual([
      {
        type: "related_protocol",
        targetId: "prot_0123456789ABCDEFGHJKMNPQRS",
        sourceKeys: ["attachedProtocolIds"],
      },
    ]);
    expect(extractBankEntityRegistryRelatedIds("recipe", {
      relatedGoalIds: ["goal_0123456789ABCDEFGHJKMNPQRS"],
      relatedConditionIds: ["cond_0123456789ABCDEFGHJKMNPQRS"],
    })).toEqual([
      "goal_0123456789ABCDEFGHJKMNPQRS",
      "cond_0123456789ABCDEFGHJKMNPQRS",
    ]);
  });

  it("covers the remaining health projection branches and registry guards", () => {
    expect(hasHealthEntityRegistry(healthEntityDefinitionByKind.get("assessment")!)).toBe(false);
    expect(() => requireHealthEntityRegistryDefinition("assessment")).toThrow(
      'Health entity "assessment" does not define a registry projection.',
    );

    expect(getHealthEntityRegistryProjectionMetadata("goal").transform({
      attributes: {
        domains: ["sleep"],
        horizon: "long_term",
        parentGoalId: "goal_0123456789ABCDEFGHJKMNPQRS",
        priority: 3,
        relatedExperimentIds: ["exp_0123456789ABCDEFGHJKMNPQRS"],
        relatedGoalIds: ["goal_0123456789ABCDEFGHJKMNPQRT"],
        window: {
          startAt: "2026-04-08",
          targetAt: "2026-05-08",
        },
      },
      helpers: projectionHelpers,
      relativePath: "bank/goals/sleep.md",
    })).toMatchObject({
      domains: ["sleep"],
      horizon: "long_term",
      parentGoalId: "goal_0123456789ABCDEFGHJKMNPQRS",
      relatedGoalIds: ["goal_0123456789ABCDEFGHJKMNPQRT"],
    });

    expect(getHealthEntityRegistryProjectionMetadata("family").transform({
      attributes: {
        relationship: "mother",
        deceased: false,
        conditions: ["hypertension"],
        relatedVariantIds: ["var_0123456789ABCDEFGHJKMNPQRS"],
        note: "Family history",
      },
      helpers: projectionHelpers,
      relativePath: "bank/family/mother.md",
    })).toMatchObject({
      relationship: "mother",
      deceased: false,
      conditions: ["hypertension"],
      relatedVariantIds: ["var_0123456789ABCDEFGHJKMNPQRS"],
      note: "Family history",
    });

    expect(getHealthEntityRegistryProjectionMetadata("genetics").transform({
      attributes: {
        gene: "MTHFR",
        zygosity: "heterozygous",
        significance: "risk_factor",
        inheritance: "autosomal_dominant",
        sourceFamilyMemberIds: ["fam_0123456789ABCDEFGHJKMNPQRS"],
        note: "Known variant",
      },
      helpers: projectionHelpers,
      relativePath: "bank/genetics/mthfr.md",
    })).toMatchObject({
      gene: "MTHFR",
      zygosity: "heterozygous",
      significance: "risk_factor",
      sourceFamilyMemberIds: ["fam_0123456789ABCDEFGHJKMNPQRS"],
    });

    const originalFoodDefinition = bankEntityDefinitionByKind.get("food");
    expect(originalFoodDefinition).toBeDefined();
    bankEntityDefinitionByKind.delete("food");
    try {
      expect(() => getBankEntityRegistryProjectionMetadata("food")).toThrow(
        'Bank entity "food" does not define a registry projection.',
      );
      expect(() => extractBankEntityRegistryLinks("food", {})).toThrow(
        'Bank entity "food" does not define a registry projection.',
      );
    } finally {
      if (originalFoodDefinition) {
        bankEntityDefinitionByKind.set("food", originalFoodDefinition);
      }
    }

    expect(getHealthEntityRegistryProjectionMetadata("protocol").transform({
      attributes: {
        ingredients: [
          {
            compound: "magnesium-glycinate",
            label: "Magnesium glycinate",
            amount: 200,
            unit: "mg",
            active: true,
            note: "evening",
          },
          {
            compound: "theanine",
            note: "bedtime",
          },
        ],
        kind: "supplement",
        relatedGoalIds: ["goal_0123456789ABCDEFGHJKMNPQRS"],
        source: "manual",
        status: "active",
        title: "Magnesium glycinate",
      },
      helpers: projectionHelpers,
      relativePath: "bank/protocols/supplements/magnesium.md",
    })).toMatchObject({
      kind: "supplement",
      relatedGoalIds: ["goal_0123456789ABCDEFGHJKMNPQRS"],
    });

    expect(extractHealthEntityRegistryLinks("family", {
      relatedVariantIds: ["var_0123456789ABCDEFGHJKMNPQRS"],
    })).toEqual([
      {
        type: "related_variant",
        targetId: "var_0123456789ABCDEFGHJKMNPQRS",
        sourceKeys: ["relatedVariantIds"],
      },
    ]);
    expect(extractHealthEntityRegistryRelatedIds("genetics", {
      sourceFamilyMemberIds: ["fam_0123456789ABCDEFGHJKMNPQRS"],
    })).toEqual(["fam_0123456789ABCDEFGHJKMNPQRS"]);
  });
});
