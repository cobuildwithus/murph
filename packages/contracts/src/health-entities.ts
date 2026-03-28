import type { ZodTypeAny } from "zod";

import { ID_PREFIXES } from "./constants.ts";
import { goalUpsertPatchPayloadSchema, goalUpsertPayloadSchema } from "./shares.ts";
import { goalFrontmatterSchema } from "./zod.ts";

export type HealthEntityKind =
  | "assessment"
  | "profile"
  | "goal"
  | "condition"
  | "allergy"
  | "protocol"
  | "history"
  | "blood_test"
  | "family"
  | "genetics";

export type HealthEntitySortBehavior = "priority-title" | "title";

export type HealthEntityRegistryLinkCardinality = "one" | "many";

export interface HealthEntityRegistryLink {
  type: string;
  targetId: string;
  sourceKeys: readonly string[];
}

export interface HealthEntityRegistryLinkMetadata {
  type: string;
  keys: readonly string[];
  cardinality: HealthEntityRegistryLinkCardinality;
}

export interface HealthEntityRegistryCommandMetadata {
  commandName: string;
  commandDescription: string;
  listServiceMethod: string;
  listStatusDescription?: string;
  payloadFile: string;
  runtimeListMethod: string;
  runtimeMethod: string;
  runtimeShowMethod: string;
  scaffoldServiceMethod: string;
  showId: {
    description: string;
    example: string;
  };
  showServiceMethod: string;
  upsertServiceMethod: string;
}

export interface HealthEntityRegistryProjectionHelpers {
  firstBoolean(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): boolean | null;
  firstNumber(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): number | null;
  firstObject(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): Record<string, unknown> | null;
  firstString(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): string | null;
  firstStringArray(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): string[];
}

export interface HealthEntityRegistryProjectionContext {
  attributes: Record<string, unknown>;
  helpers: HealthEntityRegistryProjectionHelpers;
  relativePath: string;
}

export interface HealthEntityRegistryMetadata {
  directory: string;
  idField?: string;
  idKeys: readonly string[];
  slugKeys?: readonly string[];
  titleKeys: readonly string[];
  statusKeys: readonly string[];
  frontmatterSchema?: ZodTypeAny;
  upsertPayloadSchema?: ZodTypeAny;
  patchPayloadSchema?: ZodTypeAny;
  relationKeys?: readonly HealthEntityRegistryLinkMetadata[];
  command?: HealthEntityRegistryCommandMetadata;
  sortBehavior?: HealthEntitySortBehavior;
  transform?(
    context: HealthEntityRegistryProjectionContext,
  ): Record<string, unknown>;
}

export interface HealthEntityDefinition {
  kind: HealthEntityKind;
  noun: string;
  plural: string;
  prefixes?: readonly string[];
  lookupAliases?: readonly string[];
  listKinds?: readonly string[];
  scaffoldTemplate?: Record<string, unknown>;
  registry?: HealthEntityRegistryMetadata;
}

export interface DefineRegistryEntityInput extends Omit<HealthEntityDefinition, "registry"> {
  registry: Omit<HealthEntityRegistryMetadata, "idKeys"> & {
    idField: string;
    idKeys?: readonly string[];
  };
}

function normalizeRegistryString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readFirstRegistryString(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = normalizeRegistryString(source[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function readFirstRegistryStringArray(
  source: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  for (const key of keys) {
    const value = source[key];
    if (!Array.isArray(value)) {
      continue;
    }

    return [...new Set(value.map((entry) => normalizeRegistryString(entry)).filter((entry): entry is string => Boolean(entry)))];
  }

  return [];
}

function extractRegistryRelationTargets(
  source: Record<string, unknown>,
  relation: HealthEntityRegistryLinkMetadata,
): string[] {
  return relation.cardinality === "one"
    ? [readFirstRegistryString(source, relation.keys)].filter((entry): entry is string => Boolean(entry))
    : readFirstRegistryStringArray(source, relation.keys);
}

export function defineRegistryEntity(
  input: DefineRegistryEntityInput,
): HealthEntityDefinitionWithRegistry {
  const registry: HealthEntityRegistryMetadata = {
    ...input.registry,
    idField: input.registry.idField,
    idKeys: input.registry.idKeys ?? [input.registry.idField],
    slugKeys: input.registry.slugKeys ?? ["slug"],
  };

  return {
    ...input,
    registry,
  };
}

export function deriveProtocolGroupFromRelativePath(relativePath: string): string | null {
  const directories = relativePath.split("/").slice(0, -1);

  return directories.length > 2 ? directories.slice(2).join("/") : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectSupplementIngredients(
  value: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }

    const compound = typeof entry.compound === "string" ? entry.compound.trim() : "";
    if (!compound) {
      return [];
    }

    return [
      Object.fromEntries(
        Object.entries({
          compound,
          label: typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : undefined,
          amount: typeof entry.amount === "number" && Number.isFinite(entry.amount) ? entry.amount : undefined,
          unit: typeof entry.unit === "string" && entry.unit.trim().length > 0 ? entry.unit.trim() : undefined,
          active: typeof entry.active === "boolean" ? entry.active : undefined,
          note: typeof entry.note === "string" && entry.note.trim().length > 0 ? entry.note.trim() : undefined,
        }).filter(([, entryValue]) => entryValue !== undefined),
      ),
    ];
  });
}

const checkedHealthEntityDefinitions = [
  {
    kind: "assessment",
    listKinds: ["assessment"],
    noun: "assessment",
    plural: "assessments",
    prefixes: [`${ID_PREFIXES.assessment}_`],
  },
  {
    kind: "profile",
    listKinds: ["profile"],
    lookupAliases: ["current"],
    noun: "profile",
    plural: "profiles",
    prefixes: [`${ID_PREFIXES.profileSnapshot}_`],
    scaffoldTemplate: {
      source: "manual",
      profile: {
        domains: [],
        topGoalIds: [],
      },
    },
  },
  defineRegistryEntity({
    kind: "goal",
    listKinds: ["goal"],
    noun: "goal",
    plural: "goals",
    prefixes: [`${ID_PREFIXES.goal}_`],
    scaffoldTemplate: {
      title: "Improve sleep quality and duration",
      status: "active",
      horizon: "long_term",
      priority: 1,
      window: {
        startAt: "2026-03-12",
        targetAt: "2026-06-01",
      },
      domains: ["sleep"],
    },
    registry: {
      frontmatterSchema: goalFrontmatterSchema,
      directory: "bank/goals",
      idField: "goalId",
      patchPayloadSchema: goalUpsertPatchPayloadSchema,
      upsertPayloadSchema: goalUpsertPayloadSchema,
      relationKeys: [
        {
          type: "parent_goal",
          keys: ["parentGoalId"],
          cardinality: "one",
        },
        {
          type: "related_goal",
          keys: ["relatedGoalIds"],
          cardinality: "many",
        },
        {
          type: "related_experiment",
          keys: ["relatedExperimentIds"],
          cardinality: "many",
        },
      ],
      command: {
        commandDescription: "Goal registry commands for the health extension surface.",
        commandName: "goal",
        listServiceMethod: "listGoals",
        listStatusDescription: "Optional goal status to filter by.",
        payloadFile: "goal.json",
        runtimeListMethod: "listGoals",
        runtimeMethod: "upsertGoal",
        runtimeShowMethod: "showGoal",
        scaffoldServiceMethod: "scaffoldGoal",
        showId: {
          description: "Goal id or slug to show.",
          example: "<goal-id>",
        },
        showServiceMethod: "showGoal",
        upsertServiceMethod: "upsertGoal",
      },
      titleKeys: ["title"],
      statusKeys: ["status"],
      sortBehavior: "priority-title",
      transform({ attributes, helpers }) {
        const window = helpers.firstObject(attributes, ["window"]);

        return {
          horizon: helpers.firstString(attributes, ["horizon"]),
          priority: helpers.firstNumber(attributes, ["priority"]),
          windowStartAt: window ? helpers.firstString(window, ["startAt"]) : null,
          windowTargetAt: window ? helpers.firstString(window, ["targetAt"]) : null,
          parentGoalId: helpers.firstString(attributes, ["parentGoalId"]),
          relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
          relatedExperimentIds: helpers.firstStringArray(attributes, ["relatedExperimentIds"]),
          domains: helpers.firstStringArray(attributes, ["domains"]),
        };
      },
    },
  }),
  {
    kind: "condition",
    listKinds: ["condition"],
    noun: "condition",
    plural: "conditions",
    prefixes: [`${ID_PREFIXES.condition}_`],
    scaffoldTemplate: {
      title: "Insomnia symptoms",
      clinicalStatus: "active",
      verificationStatus: "provisional",
      assertedOn: "2026-03-12",
    },
    registry: {
      directory: "bank/conditions",
      idKeys: ["conditionId"],
      titleKeys: ["title"],
      statusKeys: ["clinicalStatus"],
      transform({ attributes, helpers }) {
        return {
          clinicalStatus: helpers.firstString(attributes, ["clinicalStatus"]),
          verificationStatus: helpers.firstString(attributes, ["verificationStatus"]),
          assertedOn: helpers.firstString(attributes, ["assertedOn"]),
          resolvedOn: helpers.firstString(attributes, ["resolvedOn"]),
          severity: helpers.firstString(attributes, ["severity"]),
          bodySites: helpers.firstStringArray(attributes, ["bodySites"]),
          relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
          relatedProtocolIds: helpers.firstStringArray(attributes, ["relatedProtocolIds"]),
          note: helpers.firstString(attributes, ["note"]),
        };
      },
    },
  },
  {
    kind: "allergy",
    listKinds: ["allergy"],
    noun: "allergy",
    plural: "allergies",
    prefixes: [`${ID_PREFIXES.allergy}_`],
    scaffoldTemplate: {
      title: "Penicillin intolerance",
      substance: "Penicillin",
      status: "active",
    },
    registry: {
      directory: "bank/allergies",
      idKeys: ["allergyId"],
      titleKeys: ["title"],
      statusKeys: ["status"],
      transform({ attributes, helpers }) {
        return {
          substance: helpers.firstString(attributes, ["substance"]),
          criticality: helpers.firstString(attributes, ["criticality"]),
          reaction: helpers.firstString(attributes, ["reaction"]),
          recordedOn: helpers.firstString(attributes, ["recordedOn"]),
          relatedConditionIds: helpers.firstStringArray(attributes, ["relatedConditionIds"]),
          note: helpers.firstString(attributes, ["note"]),
        };
      },
    },
  },
  {
    kind: "protocol",
    listKinds: ["protocol"],
    noun: "protocol",
    plural: "protocols",
    prefixes: [`${ID_PREFIXES.protocol}_`],
    scaffoldTemplate: {
      title: "Magnesium glycinate",
      kind: "supplement",
      status: "active",
      startedOn: "2026-03-12",
      group: "sleep",
    },
    registry: {
      directory: "bank/protocols",
      idKeys: ["protocolId"],
      titleKeys: ["title"],
      statusKeys: ["status"],
      transform({ attributes, helpers, relativePath }) {
        return {
          kind: helpers.firstString(attributes, ["kind"]),
          startedOn: helpers.firstString(attributes, ["startedOn"]),
          stoppedOn: helpers.firstString(attributes, ["stoppedOn"]),
          substance: helpers.firstString(attributes, ["substance"]),
          dose: helpers.firstNumber(attributes, ["dose"]),
          unit: helpers.firstString(attributes, ["unit"]),
          schedule: helpers.firstString(attributes, ["schedule"]),
          brand: helpers.firstString(attributes, ["brand"]),
          manufacturer: helpers.firstString(attributes, ["manufacturer"]),
          servingSize: helpers.firstString(attributes, ["servingSize"]),
          ingredients: projectSupplementIngredients(attributes.ingredients),
          relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
          relatedConditionIds: helpers.firstStringArray(attributes, ["relatedConditionIds"]),
          group: deriveProtocolGroupFromRelativePath(relativePath),
        };
      },
    },
  },
  {
    kind: "history",
    listKinds: ["encounter", "procedure", "test", "adverse_effect", "exposure"],
    noun: "history",
    plural: "history",
    scaffoldTemplate: {
      kind: "encounter",
      occurredAt: "2026-03-12T09:00:00.000Z",
      title: "Primary care visit",
      encounterType: "office_visit",
      location: "Primary care clinic",
    },
  },
  {
    kind: "blood_test",
    listKinds: ["blood_test"],
    noun: "blood test",
    plural: "blood tests",
    scaffoldTemplate: {
      occurredAt: "2026-03-12T11:15:00.000Z",
      title: "Functional health panel",
      testName: "functional_health_panel",
      labName: "Function Health",
      specimenType: "blood",
      fastingStatus: "fasting",
      results: [
        {
          analyte: "Apolipoprotein B",
          value: 87,
          unit: "mg/dL",
          referenceRange: {
            text: "<90",
          },
          flag: "normal",
        },
      ],
    },
  },
  {
    kind: "family",
    listKinds: ["family"],
    noun: "family",
    plural: "families",
    prefixes: [`${ID_PREFIXES.family}_`],
    scaffoldTemplate: {
      title: "Mother",
      relationship: "mother",
      conditions: ["hypertension"],
    },
    registry: {
      directory: "bank/family",
      idKeys: ["familyMemberId"],
      titleKeys: ["title"],
      statusKeys: [],
      transform({ attributes, helpers }) {
        return {
          relationship: helpers.firstString(attributes, ["relationship"]),
          deceased: helpers.firstBoolean(attributes, ["deceased"]),
          conditions: helpers.firstStringArray(attributes, ["conditions"]),
          relatedVariantIds: helpers.firstStringArray(attributes, ["relatedVariantIds"]),
          note: helpers.firstString(attributes, ["note"]),
          lineage: helpers.firstString(attributes, ["lineage"]),
          updatedAt: helpers.firstString(attributes, ["updatedAt"]),
        };
      },
    },
  },
  {
    kind: "genetics",
    listKinds: ["genetics"],
    noun: "genetics",
    plural: "genetics",
    prefixes: [`${ID_PREFIXES.variant}_`],
    scaffoldTemplate: {
      title: "MTHFR C677T",
      gene: "MTHFR",
      significance: "risk_factor",
    },
    registry: {
      directory: "bank/genetics",
      idKeys: ["variantId"],
      titleKeys: ["title"],
      statusKeys: ["significance"],
      transform({ attributes, helpers }) {
        return {
          gene: helpers.firstString(attributes, ["gene"]),
          zygosity: helpers.firstString(attributes, ["zygosity"]),
          significance: helpers.firstString(attributes, ["significance"]),
          inheritance: helpers.firstString(attributes, ["inheritance"]),
          sourceFamilyMemberIds: helpers.firstStringArray(attributes, ["sourceFamilyMemberIds"]),
          note: helpers.firstString(attributes, ["note"]),
          updatedAt: helpers.firstString(attributes, ["updatedAt"]),
        };
      },
    },
  },
] as const satisfies readonly HealthEntityDefinition[];

export const healthEntityDefinitions: readonly HealthEntityDefinition[] =
  checkedHealthEntityDefinitions;

export type HealthEntityDefinitionWithRegistry = HealthEntityDefinition & {
  registry: HealthEntityRegistryMetadata;
};

export const healthEntityDefinitionByKind = new Map<HealthEntityKind, HealthEntityDefinition>(
  healthEntityDefinitions.map((definition) => [definition.kind, definition]),
);

export function hasHealthEntityRegistry(
  definition: HealthEntityDefinition,
): definition is HealthEntityDefinitionWithRegistry {
  return Boolean(definition.registry);
}

export function requireHealthEntityRegistryDefinition(
  kind: HealthEntityKind,
): HealthEntityDefinitionWithRegistry {
  const definition = healthEntityDefinitionByKind.get(kind);

  if (!definition || !hasHealthEntityRegistry(definition)) {
    throw new Error(`Health entity "${kind}" does not define a registry projection.`);
  }

  return definition;
}

export function extractHealthEntityRegistryLinks(
  kind: HealthEntityKind,
  attributes: Record<string, unknown>,
): HealthEntityRegistryLink[] {
  const definition = requireHealthEntityRegistryDefinition(kind);
  const relationKeys = definition.registry.relationKeys ?? [];

  return relationKeys.flatMap((relation) =>
    extractRegistryRelationTargets(attributes, relation).map((targetId) => ({
      type: relation.type,
      targetId,
      sourceKeys: relation.keys,
    })),
  );
}

export function extractHealthEntityRegistryRelatedIds(
  kind: HealthEntityKind,
  attributes: Record<string, unknown>,
): string[] {
  return [...new Set(extractHealthEntityRegistryLinks(kind, attributes).map((link) => link.targetId))];
}

export const goalRegistryEntityDefinition = requireHealthEntityRegistryDefinition("goal");
