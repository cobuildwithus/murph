import type { ZodTypeAny } from "zod";

import { ID_PREFIXES } from "./constants.ts";
import {
  extractHealthEntityRegistryLinks,
  requireHealthEntityRegistryDefinition,
  type HealthEntityKind,
  type HealthEntityRegistryLink,
  type HealthEntityRegistryLinkCardinality,
  type HealthEntityRegistryLinkMetadata,
  type HealthEntityRegistryMetadata,
} from "./health-entities.ts";
import {
  foodUpsertPayloadSchema,
  recipeUpsertPayloadSchema,
  workoutFormatUpsertPayloadSchema,
} from "./shares.ts";
import {
  extractRegistryRelationTargets,
  isPlainObject,
  projectSupplementIngredients,
} from "./registry-helpers.ts";
import {
  foodFrontmatterSchema,
  providerFrontmatterSchema,
  recipeFrontmatterSchema,
  workoutFormatFrontmatterSchema,
} from "./zod.ts";

export type BankEntityKind =
  | "allergy"
  | "condition"
  | "family"
  | "food"
  | "genetics"
  | "goal"
  | "protocol"
  | "provider"
  | "recipe"
  | "workout_format";

export type BankEntitySortBehavior = "gene-title" | "priority-title" | "title";
export type BankEntityRegistryLink = HealthEntityRegistryLink;
export type BankEntityRegistryLinkCardinality = HealthEntityRegistryLinkCardinality;
export type BankEntityRegistryLinkMetadata = HealthEntityRegistryLinkMetadata;

export interface BankEntityRegistryProjectionHelpers {
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

export interface BankEntityRegistryProjectionContext {
  attributes: Record<string, unknown>;
  helpers: BankEntityRegistryProjectionHelpers;
  relativePath: string;
}

export interface BankEntityRegistryMetadata extends HealthEntityRegistryMetadata {
  sortBehavior?: BankEntitySortBehavior;
  transform?(
    context: BankEntityRegistryProjectionContext,
  ): Record<string, unknown>;
}

export type BankEntityDefinitionWithRegistry = BankEntityDefinition;

export interface BankEntityDefinition {
  kind: BankEntityKind;
  noun: string;
  plural: string;
  prefixes?: readonly string[];
  lookupAliases?: readonly string[];
  listKinds?: readonly string[];
  scaffoldTemplate?: Record<string, unknown>;
  registry: BankEntityRegistryMetadata;
}

interface DefineBankRegistryEntityInput extends Omit<BankEntityDefinition, "registry"> {
  registry: Omit<BankEntityRegistryMetadata, "idKeys"> & {
    idField: string;
    idKeys?: readonly string[];
  };
}

const RELATED_IDS_COMPATIBILITY_RELATION: BankEntityRegistryLinkMetadata = {
  type: "related_to",
  keys: ["relatedIds"],
  cardinality: "many",
};

const HEALTH_BANK_ENTITY_KINDS = [
  "goal",
  "condition",
  "allergy",
  "protocol",
  "family",
  "genetics",
] as const satisfies readonly Extract<BankEntityKind, HealthEntityKind>[];

function defineBankRegistryEntity(
  input: DefineBankRegistryEntityInput,
): BankEntityDefinition {
  return {
    ...input,
    registry: {
      ...input.registry,
      idField: input.registry.idField,
      idKeys: input.registry.idKeys ?? [input.registry.idField],
      slugKeys: input.registry.slugKeys ?? ["slug"],
    },
  };
}

function projectWorkoutStrengthExercises(
  value: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

function projectFoodAutoLogDaily(
  value: unknown,
  helpers: BankEntityRegistryProjectionHelpers,
): { time: string } | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const time = helpers.firstString(value, ["time"]);
  return time ? { time } : null;
}

const checkedBankEntityDefinitions = [
  ...HEALTH_BANK_ENTITY_KINDS.map((kind) =>
    requireHealthEntityRegistryDefinition(kind) as unknown as BankEntityDefinition,
  ),
  defineBankRegistryEntity({
    kind: "food",
    listKinds: ["food"],
    noun: "food",
    plural: "foods",
    prefixes: [`${ID_PREFIXES.food}_`],
    scaffoldTemplate: {
      title: "Acai bowl",
      status: "active",
      kind: "meal",
      serving: "1 bowl",
      tags: ["breakfast"],
    },
    registry: {
      frontmatterSchema: foodFrontmatterSchema as ZodTypeAny,
      directory: "bank/foods",
      idField: "foodId",
      upsertPayloadSchema: foodUpsertPayloadSchema as ZodTypeAny,
      relationKeys: [
        RELATED_IDS_COMPATIBILITY_RELATION,
        {
          type: "related_protocol",
          keys: ["attachedProtocolIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["status"],
      sortBehavior: "title",
      transform({ attributes, helpers }) {
        return {
          summary: helpers.firstString(attributes, ["summary"]),
          kind: helpers.firstString(attributes, ["kind"]),
          brand: helpers.firstString(attributes, ["brand"]),
          vendor: helpers.firstString(attributes, ["vendor"]),
          location: helpers.firstString(attributes, ["location"]),
          serving: helpers.firstString(attributes, ["serving"]),
          aliases: helpers.firstStringArray(attributes, ["aliases"]),
          ingredients: helpers.firstStringArray(attributes, ["ingredients"]),
          tags: helpers.firstStringArray(attributes, ["tags"]),
          note: helpers.firstString(attributes, ["note"]),
          attachedProtocolIds: helpers.firstStringArray(attributes, ["attachedProtocolIds"]),
          autoLogDaily: projectFoodAutoLogDaily(attributes.autoLogDaily, helpers),
        };
      },
    },
  }),
  defineBankRegistryEntity({
    kind: "recipe",
    listKinds: ["recipe"],
    noun: "recipe",
    plural: "recipes",
    prefixes: [`${ID_PREFIXES.recipe}_`],
    scaffoldTemplate: {
      title: "Salmon rice bowl",
      status: "saved",
      servings: 2,
      tags: ["weeknight"],
    },
    registry: {
      frontmatterSchema: recipeFrontmatterSchema as ZodTypeAny,
      directory: "bank/recipes",
      idField: "recipeId",
      upsertPayloadSchema: recipeUpsertPayloadSchema as ZodTypeAny,
      relationKeys: [
        RELATED_IDS_COMPATIBILITY_RELATION,
        {
          type: "related_goal",
          keys: ["relatedGoalIds"],
          cardinality: "many",
        },
        {
          type: "related_condition",
          keys: ["relatedConditionIds"],
          cardinality: "many",
        },
      ],
      titleKeys: ["title"],
      statusKeys: ["status"],
      sortBehavior: "title",
      transform({ attributes, helpers }) {
        return {
          summary: helpers.firstString(attributes, ["summary"]),
          cuisine: helpers.firstString(attributes, ["cuisine"]),
          dishType: helpers.firstString(attributes, ["dishType"]),
          source: helpers.firstString(attributes, ["source"]),
          servings: helpers.firstNumber(attributes, ["servings"]),
          prepTimeMinutes: helpers.firstNumber(attributes, ["prepTimeMinutes"]),
          cookTimeMinutes: helpers.firstNumber(attributes, ["cookTimeMinutes"]),
          totalTimeMinutes: helpers.firstNumber(attributes, ["totalTimeMinutes"]),
          tags: helpers.firstStringArray(attributes, ["tags"]),
          ingredients: helpers.firstStringArray(attributes, ["ingredients"]),
          steps: helpers.firstStringArray(attributes, ["steps"]),
          relatedGoalIds: helpers.firstStringArray(attributes, ["relatedGoalIds"]),
          relatedConditionIds: helpers.firstStringArray(attributes, ["relatedConditionIds"]),
        };
      },
    },
  }),
  defineBankRegistryEntity({
    kind: "provider",
    listKinds: ["provider"],
    noun: "provider",
    plural: "providers",
    prefixes: [`${ID_PREFIXES.provider}_`],
    scaffoldTemplate: {
      title: "Primary care physician",
      specialty: "primary-care",
      organization: "Neighborhood Clinic",
    },
    registry: {
      frontmatterSchema: providerFrontmatterSchema as ZodTypeAny,
      directory: "bank/providers",
      idField: "providerId",
      relationKeys: [RELATED_IDS_COMPATIBILITY_RELATION],
      titleKeys: ["title"],
      statusKeys: ["status"],
      sortBehavior: "title",
      transform({ attributes, helpers }) {
        return {
          specialty: helpers.firstString(attributes, ["specialty"]),
          organization: helpers.firstString(attributes, ["organization"]),
          location: helpers.firstString(attributes, ["location"]),
          website: helpers.firstString(attributes, ["website"]),
          phone: helpers.firstString(attributes, ["phone"]),
          note: helpers.firstString(attributes, ["note"]),
          aliases: helpers.firstStringArray(attributes, ["aliases"]),
        };
      },
    },
  }),
  defineBankRegistryEntity({
    kind: "workout_format",
    listKinds: ["workout_format"],
    noun: "workout format",
    plural: "workout formats",
    prefixes: [`${ID_PREFIXES.workoutFormat}_`],
    scaffoldTemplate: {
      title: "Push Day A",
      status: "active",
      activityType: "strength-training",
      durationMinutes: 20,
    },
    registry: {
      frontmatterSchema: workoutFormatFrontmatterSchema as ZodTypeAny,
      directory: "bank/workout-formats",
      idField: "workoutFormatId",
      upsertPayloadSchema: workoutFormatUpsertPayloadSchema as ZodTypeAny,
      titleKeys: ["title"],
      statusKeys: ["status"],
      sortBehavior: "title",
      transform({ attributes, helpers }) {
        return {
          summary: helpers.firstString(attributes, ["summary"]),
          activityType: helpers.firstString(attributes, ["activityType"]),
          durationMinutes: helpers.firstNumber(attributes, ["durationMinutes"]),
          distanceKm: helpers.firstNumber(attributes, ["distanceKm"]),
          strengthExercises: projectWorkoutStrengthExercises(attributes.strengthExercises),
          tags: helpers.firstStringArray(attributes, ["tags"]),
          note: helpers.firstString(attributes, ["note"]),
          templateText: helpers.firstString(attributes, ["templateText"]),
        };
      },
    },
  }),
] as const satisfies readonly BankEntityDefinition[];

export const bankEntityDefinitions: readonly BankEntityDefinition[] =
  checkedBankEntityDefinitions;

export const bankEntityDefinitionByKind = new Map<BankEntityKind, BankEntityDefinition>(
  bankEntityDefinitions.map((definition) => [definition.kind, definition]),
);

export function requireBankEntityRegistryDefinition(
  kind: BankEntityKind,
): BankEntityDefinitionWithRegistry {
  const definition = bankEntityDefinitionByKind.get(kind);

  if (!definition) {
    throw new Error(`Bank entity "${kind}" does not define a registry projection.`);
  }

  return definition;
}

function isHealthBackedBankEntityKind(kind: BankEntityKind): kind is Extract<BankEntityKind, HealthEntityKind> {
  return (HEALTH_BANK_ENTITY_KINDS as readonly string[]).includes(kind);
}

export function extractBankEntityRegistryLinks(
  kind: BankEntityKind,
  attributes: Record<string, unknown>,
): BankEntityRegistryLink[] {
  if (isHealthBackedBankEntityKind(kind)) {
    return extractHealthEntityRegistryLinks(kind, attributes);
  }

  const definition = requireBankEntityRegistryDefinition(kind);
  const relationKeys = definition.registry.relationKeys ?? [];

  return relationKeys.flatMap((relation) =>
    extractRegistryRelationTargets(attributes, relation).map((targetId) => ({
      type: relation.type,
      targetId,
      sourceKeys: relation.keys,
    })),
  );
}

export function extractBankEntityRegistryRelatedIds(
  kind: BankEntityKind,
  attributes: Record<string, unknown>,
): string[] {
  return [
    ...new Set(
      extractBankEntityRegistryLinks(kind, attributes).map((link) => link.targetId),
    ),
  ];
}

export const goalBankEntityDefinition = requireBankEntityRegistryDefinition("goal");
export const conditionBankEntityDefinition = requireBankEntityRegistryDefinition("condition");
export const allergyBankEntityDefinition = requireBankEntityRegistryDefinition("allergy");
export const protocolBankEntityDefinition = requireBankEntityRegistryDefinition("protocol");
export const familyBankEntityDefinition = requireBankEntityRegistryDefinition("family");
export const geneticsBankEntityDefinition = requireBankEntityRegistryDefinition("genetics");
export const foodBankEntityDefinition = requireBankEntityRegistryDefinition("food");
export const recipeBankEntityDefinition = requireBankEntityRegistryDefinition("recipe");
export const providerBankEntityDefinition = requireBankEntityRegistryDefinition("provider");
export const workoutFormatBankEntityDefinition = requireBankEntityRegistryDefinition("workout_format");
